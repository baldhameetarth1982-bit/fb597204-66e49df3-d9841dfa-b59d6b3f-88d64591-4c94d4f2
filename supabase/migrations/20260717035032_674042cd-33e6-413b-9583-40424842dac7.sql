-- Stage 2C completion migration
CREATE TABLE IF NOT EXISTS public.user_role_block_scopes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id      uuid NOT NULL REFERENCES public.user_roles(id) ON DELETE CASCADE,
  society_id   uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  block_id     uuid NOT NULL REFERENCES public.blocks(id) ON DELETE CASCADE,
  is_active    boolean NOT NULL DEFAULT true,
  assigned_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  deactivated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

GRANT SELECT ON public.user_role_block_scopes TO authenticated;
GRANT ALL    ON public.user_role_block_scopes TO service_role;

ALTER TABLE public.user_role_block_scopes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "urbs read via admin/super" ON public.user_role_block_scopes;
CREATE POLICY "urbs read via admin/super" ON public.user_role_block_scopes
  FOR SELECT TO authenticated
  USING (
    public.current_user_is_super_admin()
    OR public.current_user_is_society_admin_for(society_id)
  );

CREATE UNIQUE INDEX IF NOT EXISTS ux_urbs_active_role_block
  ON public.user_role_block_scopes (role_id, block_id)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_urbs_role    ON public.user_role_block_scopes(role_id)    WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_urbs_society ON public.user_role_block_scopes(society_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_urbs_block   ON public.user_role_block_scopes(block_id)   WHERE is_active;

INSERT INTO public.user_role_block_scopes (role_id, society_id, block_id, is_active, assigned_by, created_at)
SELECT ur.id, ur.society_id, ur.block_id, true, ur.assigned_by, ur.created_at
FROM public.user_roles ur
WHERE ur.role = 'block_admin'
  AND ur.block_id IS NOT NULL
  AND COALESCE(ur.is_active, true)
  AND NOT EXISTS (
    SELECT 1 FROM public.user_role_block_scopes s
    WHERE s.role_id = ur.id AND s.block_id = ur.block_id AND s.is_active
  );

-- Known-capability helper
CREATE OR REPLACE FUNCTION public.is_known_capability(_cap text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _cap IN (
    'team.view','team.manage',
    'privacy.view','privacy.manage',
    'society.settings','blocks.view','blocks.manage','flats.manage',
    'directory.view',
    'residents.view_society','residents.view_block',
    'residents.private_detail','residents.manage',
    'finance.admin','finance.resident_summary','finance.resident_detailed',
    'billing.manage','notices.manage','polls.manage',
    'guard.operate','self.household'
  );
$$;
REVOKE ALL ON FUNCTION public.is_known_capability(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_known_capability(text) TO authenticated, service_role;

-- Corrected canonical permission helper: 3-arg with block context.
CREATE OR REPLACE FUNCTION public.current_user_has_society_permission(
  _society_id uuid,
  _capability text,
  _block_id  uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.app_role;
  v_block_scoped boolean;
BEGIN
  IF v_uid IS NULL OR _society_id IS NULL OR _capability IS NULL THEN RETURN false; END IF;
  IF NOT public.is_known_capability(_capability) THEN RETURN false; END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_uid AND role = 'super_admin' AND COALESCE(is_active, true)
  ) THEN
    RETURN true;
  END IF;

  SELECT ur.role INTO v_role
  FROM public.user_roles ur
  WHERE ur.user_id = v_uid AND ur.society_id = _society_id AND COALESCE(ur.is_active, true)
  ORDER BY CASE ur.role
    WHEN 'society_admin' THEN 1 WHEN 'block_admin' THEN 2
    WHEN 'security' THEN 3 WHEN 'resident' THEN 4 ELSE 5 END
  LIMIT 1;

  IF v_role IS NULL THEN RETURN false; END IF;

  IF v_role = 'society_admin' THEN
    RETURN _capability IN (
      'team.view','team.manage',
      'privacy.view','privacy.manage',
      'society.settings','blocks.view','blocks.manage','flats.manage',
      'directory.view',
      'residents.view_society','residents.private_detail','residents.manage',
      'finance.admin',
      'billing.manage','notices.manage','polls.manage',
      'self.household'
    );
  END IF;

  IF v_role = 'block_admin' THEN
    IF _capability NOT IN ('directory.view','residents.view_block','blocks.view','self.household') THEN
      RETURN false;
    END IF;
    v_block_scoped := _capability IN ('directory.view','residents.view_block','blocks.view');
    IF NOT v_block_scoped THEN RETURN true; END IF;
    IF _block_id IS NULL THEN
      RETURN EXISTS (
        SELECT 1 FROM public.user_role_block_scopes s
        JOIN public.user_roles ur ON ur.id = s.role_id
        WHERE ur.user_id = v_uid AND ur.society_id = _society_id
          AND ur.role = 'block_admin' AND COALESCE(ur.is_active, true) AND s.is_active
      );
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.user_role_block_scopes s
      JOIN public.user_roles ur ON ur.id = s.role_id
      WHERE ur.user_id = v_uid AND ur.society_id = _society_id
        AND ur.role = 'block_admin' AND COALESCE(ur.is_active, true)
        AND s.is_active AND s.block_id = _block_id
    );
  END IF;

  IF v_role = 'security' THEN
    RETURN _capability IN ('guard.operate','self.household');
  END IF;
  IF v_role = 'resident' THEN
    RETURN _capability = 'self.household';
  END IF;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.current_user_has_society_permission(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_has_society_permission(uuid, text, uuid) TO authenticated, service_role;

-- Overwrite the old 2-arg body so no broad-grant implementation remains.
CREATE OR REPLACE FUNCTION public.current_user_has_society_permission(
  _society_id uuid, _capability text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.current_user_has_society_permission(_society_id, _capability, NULL::uuid);
$$;
REVOKE ALL ON FUNCTION public.current_user_has_society_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_has_society_permission(uuid, text) TO authenticated, service_role;

-- Role scope + team listing v2
CREATE OR REPLACE FUNCTION public.list_role_block_scopes(_role_id uuid)
RETURNS TABLE (block_id uuid, block_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sid uuid;
BEGIN
  SELECT society_id INTO v_sid FROM public.user_roles WHERE id = _role_id;
  IF v_sid IS NULL THEN RAISE EXCEPTION 'role_not_found'; END IF;
  IF NOT (public.current_user_is_society_admin_for(v_sid) OR public.current_user_is_super_admin()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT s.block_id, b.name
    FROM public.user_role_block_scopes s JOIN public.blocks b ON b.id = s.block_id
    WHERE s.role_id = _role_id AND s.is_active ORDER BY b.name;
END; $$;
REVOKE ALL ON FUNCTION public.list_role_block_scopes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_role_block_scopes(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_society_team_members_v2(
  _society_id uuid, _include_inactive boolean DEFAULT true
) RETURNS TABLE (
  role_id uuid, user_id uuid, full_name text, role public.app_role,
  block_ids uuid[], block_names text[],
  is_active boolean, assigned_by uuid, updated_at timestamptz, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.current_user_is_society_admin_for(_society_id) OR public.current_user_is_super_admin()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    ur.id, ur.user_id,
    COALESCE(p.full_name, p.email, ur.user_id::text)::text,
    ur.role,
    COALESCE(sc.block_ids, '{}'::uuid[]),
    COALESCE(sc.block_names, '{}'::text[]),
    COALESCE(ur.is_active, true), ur.assigned_by, ur.updated_at, ur.created_at
  FROM public.user_roles ur
  LEFT JOIN public.profiles p ON p.id = ur.user_id
  LEFT JOIN LATERAL (
    SELECT array_agg(s.block_id ORDER BY b.name) AS block_ids,
           array_agg(b.name     ORDER BY b.name) AS block_names
    FROM public.user_role_block_scopes s
    JOIN public.blocks b ON b.id = s.block_id
    WHERE s.role_id = ur.id AND s.is_active
  ) sc ON true
  WHERE ur.society_id = _society_id
    AND ur.role IN ('society_admin','block_admin','security')
    AND (_include_inactive OR COALESCE(ur.is_active, true))
  ORDER BY (ur.role = 'society_admin') DESC, ur.created_at DESC;
END; $$;
REVOKE ALL ON FUNCTION public.list_society_team_members_v2(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_society_team_members_v2(uuid, boolean) TO authenticated, service_role;

-- Multi-block-aware role upsert.
CREATE OR REPLACE FUNCTION public.admin_upsert_team_role_v2(
  _society_id uuid, _target_user_id uuid, _new_role public.app_role, _block_ids uuid[] DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row public.user_roles%ROWTYPE;
  v_prev_role public.app_role; v_prev_active boolean; v_prev_block_ids uuid[];
  v_admin_count int; v_structure_mode text; v_role_id uuid; v_norm uuid[]; v_valid int; v_ct int;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT (public.current_user_is_society_admin_for(_society_id) OR public.current_user_is_super_admin()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _new_role = 'super_admin' AND NOT public.current_user_is_super_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _new_role NOT IN ('society_admin','block_admin','security') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_society_id::text, 42));

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _target_user_id AND society_id = _society_id
    UNION ALL
    SELECT 1 FROM public.user_roles WHERE user_id = _target_user_id AND society_id = _society_id
  ) THEN
    RAISE EXCEPTION 'target_not_in_society';
  END IF;

  IF _new_role = 'block_admin' THEN
    SELECT COALESCE(structure_mode,'structured') INTO v_structure_mode FROM public.societies WHERE id = _society_id;
    IF v_structure_mode = 'serial' THEN RAISE EXCEPTION 'block_admin_unavailable_serial_mode'; END IF;

    IF _block_ids IS NULL OR array_length(_block_ids,1) IS NULL THEN
      RAISE EXCEPTION 'block_scope_required';
    END IF;
    SELECT array_agg(DISTINCT x) INTO v_norm FROM unnest(_block_ids) AS t(x) WHERE x IS NOT NULL;
    IF v_norm IS NULL OR array_length(v_norm,1) = 0 THEN RAISE EXCEPTION 'block_scope_required'; END IF;
    IF array_length(v_norm,1) > 50 THEN RAISE EXCEPTION 'invalid_block_scope'; END IF;

    SELECT count(*) INTO v_valid FROM public.blocks
      WHERE id = ANY(v_norm) AND society_id = _society_id AND COALESCE(is_active,true);
    IF v_valid <> array_length(v_norm,1) THEN RAISE EXCEPTION 'invalid_block_scope'; END IF;
  ELSE
    v_norm := NULL;
  END IF;

  SELECT * INTO v_row FROM public.user_roles
    WHERE society_id = _society_id AND user_id = _target_user_id
      AND role IN ('society_admin','block_admin','security')
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

  v_prev_role := v_row.role;
  v_prev_active := COALESCE(v_row.is_active, true);
  IF v_row.id IS NOT NULL THEN
    SELECT array_agg(block_id) INTO v_prev_block_ids FROM public.user_role_block_scopes
      WHERE role_id = v_row.id AND is_active;
  END IF;

  IF v_prev_role = 'society_admin' AND v_prev_active AND _new_role <> 'society_admin' THEN
    SELECT count(*) INTO v_admin_count FROM public.user_roles
      WHERE society_id = _society_id AND role = 'society_admin' AND COALESCE(is_active,true);
    IF v_admin_count <= 1 THEN RAISE EXCEPTION 'last_society_admin'; END IF;
  END IF;

  IF v_row.id IS NULL THEN
    INSERT INTO public.user_roles (user_id, role, society_id, block_id, is_active, assigned_by, updated_at)
    VALUES (_target_user_id, _new_role, _society_id,
            CASE WHEN v_norm IS NOT NULL THEN v_norm[1] ELSE NULL END,
            true, v_actor, now())
    RETURNING id INTO v_role_id;
  ELSE
    UPDATE public.user_roles
    SET role = _new_role,
        block_id = CASE WHEN v_norm IS NOT NULL THEN v_norm[1] ELSE NULL END,
        is_active = true, deactivated_at = NULL, deactivated_by = NULL,
        assigned_by = v_actor, updated_at = now()
    WHERE id = v_row.id RETURNING id INTO v_role_id;
  END IF;

  IF _new_role = 'block_admin' AND v_norm IS NOT NULL THEN
    UPDATE public.user_role_block_scopes
      SET is_active = false,
          deactivated_at = COALESCE(deactivated_at, now()),
          deactivated_by = COALESCE(deactivated_by, v_actor)
      WHERE role_id = v_role_id AND is_active AND NOT (block_id = ANY(v_norm));
    UPDATE public.user_role_block_scopes
      SET is_active = true, deactivated_at = NULL, deactivated_by = NULL
      WHERE role_id = v_role_id AND block_id = ANY(v_norm) AND NOT is_active;
    INSERT INTO public.user_role_block_scopes (role_id, society_id, block_id, assigned_by)
      SELECT v_role_id, _society_id, b, v_actor FROM unnest(v_norm) AS t(b)
      WHERE NOT EXISTS (SELECT 1 FROM public.user_role_block_scopes s
                        WHERE s.role_id = v_role_id AND s.block_id = b);
  ELSE
    UPDATE public.user_role_block_scopes
      SET is_active = false,
          deactivated_at = COALESCE(deactivated_at, now()),
          deactivated_by = COALESCE(deactivated_by, v_actor)
      WHERE role_id = v_role_id AND is_active;
  END IF;

  SELECT count(*) INTO v_ct FROM public.user_role_block_scopes WHERE role_id = v_role_id AND is_active;
  IF _new_role = 'block_admin' AND v_ct = 0 THEN RAISE EXCEPTION 'block_scope_required'; END IF;

  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (v_actor, 'team.role_upserted', 'user_roles', v_role_id::text, _society_id,
    jsonb_build_object(
      'target_user_id', _target_user_id,
      'previous_role', v_prev_role, 'resulting_role', _new_role,
      'previous_block_ids', COALESCE(to_jsonb(v_prev_block_ids), '[]'::jsonb),
      'resulting_block_ids', COALESCE(to_jsonb(v_norm), '[]'::jsonb),
      'previous_active', v_prev_active
    ));
  RETURN v_role_id;
END; $$;
REVOKE ALL ON FUNCTION public.admin_upsert_team_role_v2(uuid, uuid, public.app_role, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_team_role_v2(uuid, uuid, public.app_role, uuid[]) TO authenticated, service_role;

-- Financial visibility resolver
CREATE OR REPLACE FUNCTION public.resolve_financial_visibility(_society_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_role public.app_role; v_setting text;
BEGIN
  IF v_uid IS NULL OR _society_id IS NULL THEN RETURN 'none'; END IF;
  IF public.current_user_is_super_admin() OR public.current_user_is_society_admin_for(_society_id) THEN
    RETURN 'admin';
  END IF;
  SELECT ur.role INTO v_role FROM public.user_roles ur
    WHERE ur.user_id = v_uid AND ur.society_id = _society_id AND COALESCE(ur.is_active,true)
    ORDER BY CASE ur.role WHEN 'society_admin' THEN 1 WHEN 'block_admin' THEN 2
                          WHEN 'security' THEN 3 WHEN 'resident' THEN 4 ELSE 5 END LIMIT 1;
  IF v_role IS NULL OR v_role IN ('security','block_admin') THEN RETURN 'none'; END IF;
  SELECT COALESCE(privacy_finances,'admins_only') INTO v_setting FROM public.society_settings WHERE society_id = _society_id;
  IF v_setting = 'resident_summary'  THEN RETURN 'summary';  END IF;
  IF v_setting = 'resident_detailed' THEN RETURN 'detailed'; END IF;
  RETURN 'none';
END; $$;
REVOKE ALL ON FUNCTION public.resolve_financial_visibility(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_financial_visibility(uuid) TO authenticated, service_role;

-- Privacy decision helper
CREATE OR REPLACE FUNCTION public.resolve_privacy_access(
  _society_id uuid, _resource text, _subject_user_id uuid DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_role public.app_role; v_setting text; v_hh boolean;
BEGIN
  IF v_uid IS NULL OR _society_id IS NULL OR _resource IS NULL THEN RETURN false; END IF;
  IF _resource NOT IN ('directory','contacts','finances','vehicles','documents') THEN RETURN false; END IF;
  IF public.current_user_is_super_admin() OR public.current_user_is_society_admin_for(_society_id) THEN RETURN true; END IF;

  SELECT ur.role INTO v_role FROM public.user_roles ur
    WHERE ur.user_id = v_uid AND ur.society_id = _society_id AND COALESCE(ur.is_active,true)
    ORDER BY CASE ur.role WHEN 'society_admin' THEN 1 WHEN 'block_admin' THEN 2
                          WHEN 'security' THEN 3 WHEN 'resident' THEN 4 ELSE 5 END LIMIT 1;
  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role = 'security' THEN RETURN false; END IF;
  IF v_role = 'block_admin' THEN RETURN _resource = 'directory'; END IF;

  IF _resource = 'directory' THEN
    SELECT COALESCE(privacy_directory,'admins_only') INTO v_setting FROM public.society_settings WHERE society_id = _society_id;
    IF v_setting NOT IN ('admins_only','residents_safe') THEN RETURN false; END IF;
    RETURN v_setting = 'residents_safe';
  END IF;
  IF _resource = 'finances' THEN
    SELECT COALESCE(privacy_finances,'admins_only') INTO v_setting FROM public.society_settings WHERE society_id = _society_id;
    IF v_setting NOT IN ('admins_only','resident_summary','resident_detailed') THEN RETURN false; END IF;
    RETURN v_setting IN ('resident_summary','resident_detailed');
  END IF;
  IF _resource = 'contacts' THEN
    SELECT COALESCE(privacy_contacts,'admins_only') INTO v_setting FROM public.society_settings WHERE society_id = _society_id;
    IF v_setting NOT IN ('admins_only','self_household_and_admins') THEN RETURN false; END IF;
    IF v_setting = 'admins_only' THEN RETURN false; END IF;
    IF _subject_user_id IS NULL THEN RETURN false; END IF;
    IF _subject_user_id = v_uid THEN RETURN true; END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.flat_residents me
      JOIN public.flat_residents them ON them.flat_id = me.flat_id
      WHERE me.user_id = v_uid AND them.user_id = _subject_user_id
        AND COALESCE(me.is_active,true) AND COALESCE(them.is_active,true)
    ) INTO v_hh;
    RETURN COALESCE(v_hh, false);
  END IF;
  IF _resource IN ('vehicles','documents') THEN
    SELECT COALESCE(CASE _resource WHEN 'vehicles' THEN privacy_vehicles ELSE privacy_documents END,'admins_only')
      INTO v_setting FROM public.society_settings WHERE society_id = _society_id;
    IF v_setting NOT IN ('admins_only','owner_and_admins') THEN RETURN false; END IF;
    IF v_setting = 'admins_only' THEN RETURN false; END IF;
    IF _subject_user_id IS NULL THEN RETURN false; END IF;
    RETURN _subject_user_id = v_uid;
  END IF;
  RETURN false;
END; $$;
REVOKE ALL ON FUNCTION public.resolve_privacy_access(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_privacy_access(uuid, text, uuid) TO authenticated, service_role;

-- Resident-safe directory
CREATE OR REPLACE FUNCTION public.list_society_residents_safe_page(
  _society_id uuid, _search text DEFAULT NULL, _limit int DEFAULT 25, _offset int DEFAULT 0
) RETURNS TABLE (user_id uuid, full_name text, flat_number text, block_name text, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid(); v_role public.app_role; v_is_admin boolean;
  v_lim int := LEAST(GREATEST(coalesce(_limit,25),1),100);
  v_off int := GREATEST(coalesce(_offset,0),0);
  v_q text := nullif(trim(coalesce(_search,'')),'');
  v_scoped_blocks uuid[];
BEGIN
  IF v_uid IS NULL OR _society_id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  v_is_admin := public.current_user_is_super_admin() OR public.current_user_is_society_admin_for(_society_id);
  IF NOT v_is_admin THEN
    SELECT ur.role INTO v_role FROM public.user_roles ur
      WHERE ur.user_id = v_uid AND ur.society_id = _society_id AND COALESCE(ur.is_active,true)
      ORDER BY CASE ur.role WHEN 'block_admin' THEN 1 WHEN 'resident' THEN 2 WHEN 'security' THEN 3 ELSE 9 END LIMIT 1;
    IF v_role IS NULL OR v_role = 'security' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
    IF v_role = 'block_admin' THEN
      SELECT array_agg(s.block_id) INTO v_scoped_blocks
      FROM public.user_role_block_scopes s
      JOIN public.user_roles ur ON ur.id = s.role_id
      WHERE ur.user_id = v_uid AND ur.society_id = _society_id
        AND ur.role = 'block_admin' AND COALESCE(ur.is_active,true) AND s.is_active;
      IF v_scoped_blocks IS NULL OR array_length(v_scoped_blocks,1) IS NULL THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
      END IF;
    END IF;
    IF v_role = 'resident' AND NOT public.resolve_privacy_access(_society_id,'directory',NULL) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN QUERY
  WITH base AS (
    SELECT p.id user_id, p.full_name, fr.flat_id, f.flat_number,
           b.name block_name, f.block_id,
           row_number() OVER (PARTITION BY p.id
             ORDER BY fr.is_primary DESC NULLS LAST, fr.is_active DESC, fr.moved_in_at DESC NULLS LAST) rn
    FROM public.profiles p
    LEFT JOIN public.flat_residents fr ON fr.user_id = p.id
    LEFT JOIN public.flats f ON f.id = fr.flat_id AND f.society_id = _society_id
    LEFT JOIN public.blocks b ON b.id = f.block_id
    WHERE p.society_id = _society_id
  ),
  filt AS (
    SELECT * FROM base
    WHERE rn = 1
      AND (v_q IS NULL OR full_name ILIKE '%'||v_q||'%')
      AND (v_is_admin OR v_role <> 'block_admin' OR block_id = ANY(v_scoped_blocks))
  ),
  c AS (SELECT count(*) total_count FROM filt)
  SELECT f.user_id, f.full_name, f.flat_number, f.block_name, c.total_count
  FROM filt f, c ORDER BY f.full_name ASC NULLS LAST
  LIMIT v_lim OFFSET v_off;
END; $$;
REVOKE ALL ON FUNCTION public.list_society_residents_safe_page(uuid, text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_society_residents_safe_page(uuid, text, int, int) TO authenticated, service_role;