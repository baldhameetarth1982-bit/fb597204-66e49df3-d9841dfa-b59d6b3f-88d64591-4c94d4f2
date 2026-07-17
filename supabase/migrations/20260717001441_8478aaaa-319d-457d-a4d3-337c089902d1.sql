
-- Stage 2B completion — lifecycle-aware family_members and vehicles.
-- No historical data mutation. Historical registration numbers are preserved.

-- 1. Lifecycle columns (additive; historical rows remain active).
ALTER TABLE public.family_members
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by uuid;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by uuid;

-- 2. Duplicate policy: active plates unique per society; inactive history free.
-- Drop the non-partial unique index and recreate as partial WHERE is_active.
DROP INDEX IF EXISTS public.ux_vehicles_society_plate_norm;
CREATE UNIQUE INDEX IF NOT EXISTS ux_vehicles_active_plate_norm
  ON public.vehicles (society_id, (upper(regexp_replace(plate_number, '\s+', '', 'g'))))
  WHERE is_active;

-- 3. Family: deactivate instead of delete. Replaces prior admin_delete_family_member.
CREATE OR REPLACE FUNCTION public.admin_delete_family_member(_society_id uuid, _id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_prev boolean; BEGIN
  IF NOT public.is_society_admin_for(_society_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  SELECT fm.user_id, fm.is_active INTO v_uid, v_prev
    FROM public.family_members fm
    JOIN public.profiles p ON p.id = fm.user_id AND p.society_id = _society_id
   WHERE fm.id = _id;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'family_member_not_found'; END IF;
  UPDATE public.family_members
     SET is_active = false, deactivated_at = now(), deactivated_by = auth.uid(), updated_at = now()
   WHERE id = _id AND is_active = true;
  INSERT INTO public.audit_log(actor_id, society_id, entity_type, entity_id, action, metadata)
    VALUES (auth.uid(), _society_id, 'family_members', _id, 'deactivate',
            jsonb_build_object('resident', v_uid, 'previous_state', v_prev));
END; $$;

REVOKE ALL ON FUNCTION public.admin_delete_family_member(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_family_member(uuid,uuid) TO authenticated;

-- 4. Vehicle: deactivate instead of delete. Preserves registration number.
CREATE OR REPLACE FUNCTION public.admin_delete_vehicle(_society_id uuid, _id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prev boolean; BEGIN
  IF NOT public.is_society_admin_for(_society_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  SELECT is_active INTO v_prev FROM public.vehicles WHERE id = _id AND society_id = _society_id;
  IF v_prev IS NULL THEN RAISE EXCEPTION 'vehicle_not_found'; END IF;
  UPDATE public.vehicles
     SET is_active = false, deactivated_at = now(), deactivated_by = auth.uid(), updated_at = now()
   WHERE id = _id AND society_id = _society_id AND is_active = true;
  INSERT INTO public.audit_log(actor_id, society_id, entity_type, entity_id, action, metadata)
    VALUES (auth.uid(), _society_id, 'vehicles', _id, 'deactivate',
            jsonb_build_object('previous_state', v_prev));
END; $$;

REVOKE ALL ON FUNCTION public.admin_delete_vehicle(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_vehicle(uuid,uuid) TO authenticated;

-- 5. Vehicle upsert: active-scoped duplicate check + reactivation validation.
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
DECLARE v_id uuid; v_norm text; v_prev_active boolean; BEGIN
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

  -- Race-safe active-duplicate guard scoped to (society, normalized plate).
  PERFORM pg_advisory_xact_lock(
    hashtextextended(_society_id::text || '|' || v_norm, 0)
  );

  IF _id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.vehicles
       WHERE society_id = _society_id AND is_active = true
         AND upper(regexp_replace(plate_number, '\s+', '', 'g')) = v_norm
    ) THEN
      RAISE EXCEPTION 'duplicate_active_plate';
    END IF;
    INSERT INTO public.vehicles(society_id, user_id, flat_id, plate_number, type, make_model, color, is_active)
      VALUES (_society_id, _resident_user_id, _flat_id, v_norm,
              coalesce(nullif(_type,''),'car'), _make_model, _color, true)
      RETURNING id INTO v_id;
    INSERT INTO public.audit_log(actor_id, society_id, entity_type, entity_id, action, metadata)
      VALUES (auth.uid(), _society_id, 'vehicles', v_id, 'create', jsonb_build_object('plate', v_norm));
  ELSE
    SELECT is_active INTO v_prev_active FROM public.vehicles
     WHERE id = _id AND society_id = _society_id;
    IF v_prev_active IS NULL THEN RAISE EXCEPTION 'vehicle_not_found'; END IF;
    -- Reactivation or edit while active must not clash with another active row.
    IF EXISTS (
      SELECT 1 FROM public.vehicles
       WHERE society_id = _society_id AND is_active = true AND id <> _id
         AND upper(regexp_replace(plate_number, '\s+', '', 'g')) = v_norm
    ) THEN
      RAISE EXCEPTION 'duplicate_active_plate';
    END IF;
    -- Editing an inactive record MUST NOT accidentally reactivate it.
    UPDATE public.vehicles
       SET user_id = _resident_user_id, flat_id = _flat_id, plate_number = v_norm,
           type = coalesce(nullif(_type,''), type),
           make_model = _make_model, color = _color, updated_at = now()
     WHERE id = _id AND society_id = _society_id
     RETURNING id INTO v_id;
    INSERT INTO public.audit_log(actor_id, society_id, entity_type, entity_id, action, metadata)
      VALUES (auth.uid(), _society_id, 'vehicles', v_id, 'update', jsonb_build_object('plate', v_norm));
  END IF;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'duplicate_active_plate';
END; $$;

REVOKE ALL ON FUNCTION public.admin_upsert_vehicle(uuid,uuid,uuid,uuid,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_vehicle(uuid,uuid,uuid,uuid,text,text,text,text) TO authenticated;

-- 6. Restrict directory overview & private detail to active rows (safer defaults).
--    (Vehicles active count reflects is_active flag from step 1.)
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
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
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
    SELECT count(*) AS active_vehicles FROM public.vehicles
     WHERE society_id = _society_id AND is_active = true
  )
  SELECT prof.total, coalesce(active.active_count,0), coalesce(active.owners,0),
         coalesce(active.tenants,0), coalesce(active.occupied,0),
         GREATEST(flats_total.total_flats - coalesce(active.occupied,0), 0),
         coalesce(veh.active_vehicles,0)
    FROM prof, flats_total LEFT JOIN active ON true LEFT JOIN veh ON true;
END; $$;

REVOKE ALL ON FUNCTION public.get_resident_directory_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_resident_directory_overview(uuid) TO authenticated;
