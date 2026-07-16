
-- Stage 2B — Residents, Occupancy, Family, Vehicles
-- Adds authoritative SQL RPCs on top of canonical flat_residents, family_members, vehicles.
-- No new tables. Reuses existing has_role / is_society_admin_for auth model.
-- Adds indexes and audit-preserving lifecycle behavior.

-- =========================================================================
-- 1. Family members: society scoping (canonical column) + indexes
-- =========================================================================

-- family_members has user_id (the household head / resident account).
-- society_id is derived through profiles.society_id.  We add an index only.
CREATE INDEX IF NOT EXISTS idx_family_members_user_id
  ON public.family_members(user_id);

-- =========================================================================
-- 2. Vehicles: normalization + uniqueness inside society
-- =========================================================================

-- Deduplicate any stale active duplicates before adding the partial index.
-- We keep the newest row active per (society_id, upper(plate_number)).
WITH ranked AS (
  SELECT id, society_id,
         upper(regexp_replace(plate_number, '\s+', '', 'g')) AS plate_norm,
         created_at,
         row_number() OVER (
           PARTITION BY society_id, upper(regexp_replace(plate_number, '\s+', '', 'g'))
           ORDER BY created_at DESC
         ) AS rn
  FROM public.vehicles
)
UPDATE public.vehicles v
   SET plate_number = v.plate_number || '-dup-' || substr(v.id::text, 1, 8)
  FROM ranked r
 WHERE r.id = v.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_vehicles_society_plate_norm
  ON public.vehicles (society_id, (upper(regexp_replace(plate_number, '\s+', '', 'g'))));

CREATE INDEX IF NOT EXISTS idx_vehicles_society ON public.vehicles(society_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_flat ON public.vehicles(flat_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_user ON public.vehicles(user_id);

-- =========================================================================
-- 3. Occupancy indexes
-- =========================================================================
CREATE INDEX IF NOT EXISTS idx_flat_residents_flat ON public.flat_residents(flat_id);
CREATE INDEX IF NOT EXISTS idx_flat_residents_user ON public.flat_residents(user_id);
CREATE INDEX IF NOT EXISTS idx_flat_residents_active
  ON public.flat_residents(flat_id) WHERE is_active;

-- Reject duplicate active (flat_id,user_id,relationship) at DB layer.
CREATE UNIQUE INDEX IF NOT EXISTS ux_flat_residents_active_triplet
  ON public.flat_residents(flat_id, user_id, relationship) WHERE is_active;

-- =========================================================================
-- 4. Server-paginated privacy-safe resident directory
-- =========================================================================
CREATE OR REPLACE FUNCTION public.list_society_residents_page(
  _society_id uuid,
  _search text DEFAULT NULL,
  _flat_id uuid DEFAULT NULL,
  _relationship text DEFAULT NULL,
  _active_only boolean DEFAULT true,
  _limit int DEFAULT 25,
  _offset int DEFAULT 0
)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  avatar_url text,
  flat_id uuid,
  flat_number text,
  block_name text,
  structure_mode text,
  relationship text,
  is_active boolean,
  is_primary boolean,
  moved_in_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_limit int := LEAST(GREATEST(coalesce(_limit,25),1),100);
  v_offset int := GREATEST(coalesce(_offset,0),0);
  v_search text := nullif(trim(coalesce(_search,'')),'');
  v_mode text;
BEGIN
  IF NOT public.is_society_admin_for(_society_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT structure_mode INTO v_mode FROM public.societies WHERE id = _society_id;

  RETURN QUERY
  WITH base AS (
    SELECT
      p.id AS user_id,
      p.full_name,
      p.avatar_url,
      fr.flat_id,
      f.flat_number,
      b.name AS block_name,
      fr.relationship,
      fr.is_active,
      fr.is_primary,
      fr.moved_in_at,
      row_number() OVER (
        PARTITION BY p.id
        ORDER BY fr.is_primary DESC NULLS LAST, fr.is_active DESC, fr.moved_in_at DESC NULLS LAST
      ) AS rn
    FROM public.profiles p
    LEFT JOIN public.flat_residents fr ON fr.user_id = p.id
    LEFT JOIN public.flats f ON f.id = fr.flat_id AND f.society_id = _society_id
    LEFT JOIN public.blocks b ON b.id = f.block_id
    WHERE p.society_id = _society_id
  ),
  filtered AS (
    SELECT * FROM base
    WHERE rn = 1
      AND (v_search IS NULL OR full_name ILIKE '%'||v_search||'%')
      AND (_flat_id IS NULL OR flat_id = _flat_id)
      AND (_relationship IS NULL OR relationship = _relationship)
      AND (NOT coalesce(_active_only,true) OR coalesce(is_active,true) = true)
  ),
  counted AS (
    SELECT count(*) AS total_count FROM filtered
  )
  SELECT
    f.user_id,
    f.full_name,
    f.avatar_url,
    f.flat_id,
    f.flat_number,
    f.block_name,
    v_mode AS structure_mode,
    f.relationship,
    coalesce(f.is_active, false) AS is_active,
    coalesce(f.is_primary, false) AS is_primary,
    f.moved_in_at,
    c.total_count
  FROM filtered f, counted c
  ORDER BY f.full_name ASC NULLS LAST, f.user_id ASC
  LIMIT v_limit OFFSET v_offset;
END; $$;

REVOKE ALL ON FUNCTION public.list_society_residents_page(uuid,text,uuid,text,boolean,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_society_residents_page(uuid,text,uuid,text,boolean,int,int) TO authenticated;

-- =========================================================================
-- 5. Directory overview counters (authoritative)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.get_resident_directory_overview(_society_id uuid)
RETURNS TABLE (
  total_residents bigint,
  active_residents bigint,
  owners bigint,
  tenants bigint,
  occupied_units bigint,
  vacant_units bigint,
  active_vehicles bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_society_admin_for(_society_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH prof AS (
    SELECT count(*) AS total FROM public.profiles WHERE society_id = _society_id
  ),
  active AS (
    SELECT count(DISTINCT fr.user_id) AS active_count,
           count(DISTINCT CASE WHEN fr.relationship IN ('owner','co-owner') THEN fr.user_id END) AS owners,
           count(DISTINCT CASE WHEN fr.relationship = 'tenant' THEN fr.user_id END) AS tenants,
           count(DISTINCT fr.flat_id) AS occupied
      FROM public.flat_residents fr
      JOIN public.flats f ON f.id = fr.flat_id AND f.society_id = _society_id
     WHERE fr.is_active
  ),
  flats_total AS (
    SELECT count(*) AS total_flats FROM public.flats WHERE society_id = _society_id
  ),
  veh AS (
    SELECT count(*) AS active_vehicles FROM public.vehicles WHERE society_id = _society_id
  )
  SELECT
    prof.total,
    coalesce(active.active_count,0),
    coalesce(active.owners,0),
    coalesce(active.tenants,0),
    coalesce(active.occupied,0),
    GREATEST(flats_total.total_flats - coalesce(active.occupied,0), 0),
    coalesce(veh.active_vehicles,0)
  FROM prof, flats_total
  LEFT JOIN active ON true
  LEFT JOIN veh ON true;
END; $$;

REVOKE ALL ON FUNCTION public.get_resident_directory_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_resident_directory_overview(uuid) TO authenticated;

-- =========================================================================
-- 6. Private resident detail (authorised only)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.get_resident_private_detail(_society_id uuid, _user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_profile jsonb;
  v_relations jsonb;
  v_family jsonb;
  v_vehicles jsonb;
BEGIN
  IF NOT public.is_society_admin_for(_society_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT to_jsonb(p) - 'password' - 'auth_metadata' INTO v_profile
    FROM (
      SELECT id, full_name, email, phone, avatar_url,
             property_number, ugvcl_number, share_certificate_number,
             move_in_date, aadhaar_verified, is_offline, society_id
      FROM public.profiles WHERE id = _user_id AND society_id = _society_id
    ) p;

  IF v_profile IS NULL THEN
    RETURN NULL; -- non-enumerating unavailable
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.is_active DESC, r.moved_in_at DESC NULLS LAST), '[]'::jsonb)
    INTO v_relations
    FROM (
      SELECT fr.id, fr.flat_id, f.flat_number, b.name AS block_name,
             fr.relationship, fr.is_active, fr.is_primary,
             fr.moved_in_at, fr.moved_out_at, fr.ended_reason, fr.created_at
      FROM public.flat_residents fr
      JOIN public.flats f ON f.id = fr.flat_id AND f.society_id = _society_id
      LEFT JOIN public.blocks b ON b.id = f.block_id
      WHERE fr.user_id = _user_id
    ) r;

  SELECT coalesce(jsonb_agg(to_jsonb(fm) ORDER BY fm.created_at ASC), '[]'::jsonb)
    INTO v_family
    FROM (
      SELECT id, full_name, relation, phone, age, created_at
      FROM public.family_members WHERE user_id = _user_id
    ) fm;

  SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.created_at DESC), '[]'::jsonb)
    INTO v_vehicles
    FROM (
      SELECT id, plate_number, type, make_model, color, flat_id, created_at
      FROM public.vehicles WHERE user_id = _user_id AND society_id = _society_id
    ) v;

  RETURN jsonb_build_object(
    'profile', v_profile,
    'relationships', v_relations,
    'family', v_family,
    'vehicles', v_vehicles
  );
END; $$;

REVOKE ALL ON FUNCTION public.get_resident_private_detail(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_resident_private_detail(uuid,uuid) TO authenticated;

-- =========================================================================
-- 7. Occupancy lifecycle (assign / end) with audit
-- =========================================================================
CREATE OR REPLACE FUNCTION public.assign_resident_to_unit(
  _society_id uuid,
  _user_id uuid,
  _flat_id uuid,
  _relationship text,
  _is_primary boolean DEFAULT false,
  _moved_in_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flat_society uuid;
  v_flat_active boolean;
  v_new_id uuid;
BEGIN
  IF NOT public.is_society_admin_for(_society_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF _relationship NOT IN ('owner','co-owner','tenant','resident','family') THEN
    RAISE EXCEPTION 'invalid_relationship';
  END IF;

  SELECT society_id, coalesce(is_active,true) INTO v_flat_society, v_flat_active
    FROM public.flats WHERE id = _flat_id;
  IF v_flat_society IS NULL OR v_flat_society <> _society_id THEN
    RAISE EXCEPTION 'unit_not_in_society';
  END IF;
  IF NOT v_flat_active THEN
    RAISE EXCEPTION 'unit_inactive';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND society_id = _society_id) THEN
    RAISE EXCEPTION 'resident_not_in_society';
  END IF;

  IF EXISTS (SELECT 1 FROM public.flat_residents
             WHERE flat_id = _flat_id AND user_id = _user_id
               AND relationship = _relationship AND is_active) THEN
    RAISE EXCEPTION 'duplicate_active_assignment';
  END IF;

  IF _is_primary THEN
    UPDATE public.flat_residents SET is_primary = false
      WHERE user_id = _user_id AND is_primary = true;
  END IF;

  INSERT INTO public.flat_residents(flat_id, user_id, relationship, is_primary, is_active, moved_in_at)
    VALUES (_flat_id, _user_id, _relationship, coalesce(_is_primary,false), true, coalesce(_moved_in_at, now()))
    RETURNING id INTO v_new_id;

  INSERT INTO public.audit_log(actor_id, society_id, entity_type, entity_id, action, metadata)
    VALUES (auth.uid(), _society_id, 'flat_residents', v_new_id, 'assign',
            jsonb_build_object('user_id',_user_id,'flat_id',_flat_id,'relationship',_relationship));
  RETURN v_new_id;
END; $$;

REVOKE ALL ON FUNCTION public.assign_resident_to_unit(uuid,uuid,uuid,text,boolean,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_resident_to_unit(uuid,uuid,uuid,text,boolean,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.end_resident_unit_relationship(
  _society_id uuid,
  _flat_resident_id uuid,
  _moved_out_at timestamptz DEFAULT now(),
  _reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flat_id uuid;
  v_moved_in timestamptz;
BEGIN
  IF NOT public.is_society_admin_for(_society_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  SELECT fr.flat_id, fr.moved_in_at INTO v_flat_id, v_moved_in
    FROM public.flat_residents fr
    JOIN public.flats f ON f.id = fr.flat_id
   WHERE fr.id = _flat_resident_id AND f.society_id = _society_id;

  IF v_flat_id IS NULL THEN RAISE EXCEPTION 'relationship_not_found'; END IF;
  IF v_moved_in IS NOT NULL AND _moved_out_at < v_moved_in THEN
    RAISE EXCEPTION 'moved_out_before_moved_in';
  END IF;

  UPDATE public.flat_residents
     SET is_active = false,
         moved_out_at = coalesce(_moved_out_at, now()),
         ended_reason = _reason
   WHERE id = _flat_resident_id AND is_active;

  INSERT INTO public.audit_log(actor_id, society_id, entity_type, entity_id, action, metadata)
    VALUES (auth.uid(), _society_id, 'flat_residents', _flat_resident_id, 'move_out',
            jsonb_build_object('reason',_reason));
END; $$;

REVOKE ALL ON FUNCTION public.end_resident_unit_relationship(uuid,uuid,timestamptz,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_resident_unit_relationship(uuid,uuid,timestamptz,text) TO authenticated;

-- =========================================================================
-- 8. Society-scoped family CRUD (admin managed)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.admin_upsert_family_member(
  _society_id uuid,
  _resident_user_id uuid,
  _id uuid,
  _full_name text,
  _relation text,
  _phone text,
  _age int
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid; BEGIN
  IF NOT public.is_society_admin_for(_society_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _resident_user_id AND society_id = _society_id) THEN
    RAISE EXCEPTION 'resident_not_in_society';
  END IF;
  IF _relation NOT IN ('spouse','child','parent','sibling','helper','other') THEN
    RAISE EXCEPTION 'invalid_relation';
  END IF;

  IF _id IS NULL THEN
    INSERT INTO public.family_members(user_id, full_name, relation, phone, age)
      VALUES (_resident_user_id, _full_name, _relation, _phone, _age)
      RETURNING id INTO v_id;
    INSERT INTO public.audit_log(actor_id, society_id, entity_type, entity_id, action, metadata)
      VALUES (auth.uid(), _society_id, 'family_members', v_id, 'create', jsonb_build_object('resident',_resident_user_id));
  ELSE
    UPDATE public.family_members
       SET full_name = _full_name, relation = _relation, phone = _phone, age = _age, updated_at = now()
     WHERE id = _id AND user_id = _resident_user_id
     RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'family_member_not_found'; END IF;
    INSERT INTO public.audit_log(actor_id, society_id, entity_type, entity_id, action, metadata)
      VALUES (auth.uid(), _society_id, 'family_members', v_id, 'update', '{}'::jsonb);
  END IF;
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.admin_upsert_family_member(uuid,uuid,uuid,text,text,text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_family_member(uuid,uuid,uuid,text,text,text,int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_family_member(_society_id uuid, _id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; BEGIN
  IF NOT public.is_society_admin_for(_society_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  SELECT fm.user_id INTO v_uid
    FROM public.family_members fm
    JOIN public.profiles p ON p.id = fm.user_id AND p.society_id = _society_id
   WHERE fm.id = _id;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'family_member_not_found'; END IF;
  DELETE FROM public.family_members WHERE id = _id;
  INSERT INTO public.audit_log(actor_id, society_id, entity_type, entity_id, action, metadata)
    VALUES (auth.uid(), _society_id, 'family_members', _id, 'delete', jsonb_build_object('resident',v_uid));
END; $$;

REVOKE ALL ON FUNCTION public.admin_delete_family_member(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_family_member(uuid,uuid) TO authenticated;

-- =========================================================================
-- 9. Society-scoped vehicle CRUD
-- =========================================================================
CREATE OR REPLACE FUNCTION public.admin_upsert_vehicle(
  _society_id uuid,
  _id uuid,
  _resident_user_id uuid,
  _flat_id uuid,
  _plate_number text,
  _type text,
  _make_model text,
  _color text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_norm text; BEGIN
  IF NOT public.is_society_admin_for(_society_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  v_norm := upper(regexp_replace(coalesce(_plate_number,''), '\s+', '', 'g'));
  IF length(v_norm) < 3 THEN RAISE EXCEPTION 'invalid_plate'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _resident_user_id AND society_id = _society_id) THEN
    RAISE EXCEPTION 'resident_not_in_society';
  END IF;
  IF _flat_id IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM public.flats WHERE id = _flat_id AND society_id = _society_id
  ) THEN
    RAISE EXCEPTION 'unit_not_in_society';
  END IF;

  IF _id IS NULL THEN
    INSERT INTO public.vehicles(society_id, user_id, flat_id, plate_number, type, make_model, color)
      VALUES (_society_id, _resident_user_id, _flat_id, v_norm,
              coalesce(nullif(_type,''),'car'), _make_model, _color)
      RETURNING id INTO v_id;
    INSERT INTO public.audit_log(actor_id, society_id, entity_type, entity_id, action, metadata)
      VALUES (auth.uid(), _society_id, 'vehicles', v_id, 'create', jsonb_build_object('plate', v_norm));
  ELSE
    UPDATE public.vehicles
       SET user_id = _resident_user_id, flat_id = _flat_id, plate_number = v_norm,
           type = coalesce(nullif(_type,''), type),
           make_model = _make_model, color = _color, updated_at = now()
     WHERE id = _id AND society_id = _society_id
     RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'vehicle_not_found'; END IF;
    INSERT INTO public.audit_log(actor_id, society_id, entity_type, entity_id, action, metadata)
      VALUES (auth.uid(), _society_id, 'vehicles', v_id, 'update', jsonb_build_object('plate', v_norm));
  END IF;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'duplicate_active_plate';
END; $$;

REVOKE ALL ON FUNCTION public.admin_upsert_vehicle(uuid,uuid,uuid,uuid,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_vehicle(uuid,uuid,uuid,uuid,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_vehicle(_society_id uuid, _id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_society_admin_for(_society_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicles WHERE id = _id AND society_id = _society_id) THEN
    RAISE EXCEPTION 'vehicle_not_found';
  END IF;
  DELETE FROM public.vehicles WHERE id = _id AND society_id = _society_id;
  INSERT INTO public.audit_log(actor_id, society_id, entity_type, entity_id, action, metadata)
    VALUES (auth.uid(), _society_id, 'vehicles', _id, 'delete', '{}'::jsonb);
END; $$;

REVOKE ALL ON FUNCTION public.admin_delete_vehicle(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_vehicle(uuid,uuid) TO authenticated;
