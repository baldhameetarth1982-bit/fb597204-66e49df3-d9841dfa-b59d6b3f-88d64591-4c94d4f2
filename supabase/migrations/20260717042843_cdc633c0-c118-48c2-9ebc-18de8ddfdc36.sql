-- Stage 2C closure migration (retry: drop known FK names first)
ALTER TABLE public.user_role_block_scopes
  DROP CONSTRAINT IF EXISTS user_role_block_scopes_role_id_fkey,
  DROP CONSTRAINT IF EXISTS user_role_block_scopes_block_id_fkey;

ALTER TABLE public.user_role_block_scopes
  ADD CONSTRAINT user_role_block_scopes_role_id_fkey
    FOREIGN KEY (role_id) REFERENCES public.user_roles(id) ON DELETE RESTRICT;
ALTER TABLE public.user_role_block_scopes
  ADD CONSTRAINT user_role_block_scopes_block_id_fkey
    FOREIGN KEY (block_id) REFERENCES public.blocks(id) ON DELETE RESTRICT;

-- (1) Three-arg permission helper: fail closed on NULL block for block-scoped caps.
CREATE OR REPLACE FUNCTION public.current_user_has_society_permission(
  _society_id uuid, _capability text, _block_id uuid DEFAULT NULL
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
  ) THEN RETURN true; END IF;

  SELECT ur.role INTO v_role FROM public.user_roles ur
    WHERE ur.user_id = v_uid AND ur.society_id = _society_id AND COALESCE(ur.is_active,true)
    ORDER BY CASE ur.role WHEN 'society_admin' THEN 1 WHEN 'block_admin' THEN 2
                          WHEN 'security' THEN 3 WHEN 'resident' THEN 4 ELSE 5 END LIMIT 1;
  IF v_role IS NULL THEN RETURN false; END IF;

  IF v_role = 'society_admin' THEN
    RETURN _capability IN (
      'team.view','team.manage','privacy.view','privacy.manage',
      'society.settings','blocks.view','blocks.manage','flats.manage',
      'directory.view','residents.view_society','residents.private_detail','residents.manage',
      'finance.admin','billing.manage','notices.manage','polls.manage','self.household'
    );
  END IF;

  IF v_role = 'block_admin' THEN
    IF _capability NOT IN ('directory.view','residents.view_block','blocks.view','self.household') THEN
      RETURN false;
    END IF;
    v_block_scoped := _capability IN ('directory.view','residents.view_block','blocks.view');
    IF NOT v_block_scoped THEN RETURN true; END IF;
    IF _block_id IS NULL THEN RETURN false; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.blocks
      WHERE id = _block_id AND society_id = _society_id AND COALESCE(is_active,true)
    ) THEN RETURN false; END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.user_role_block_scopes s
      JOIN public.user_roles ur ON ur.id = s.role_id
      WHERE ur.user_id = v_uid AND ur.society_id = _society_id
        AND ur.role = 'block_admin' AND COALESCE(ur.is_active, true)
        AND s.is_active AND s.block_id = _block_id
    );
  END IF;

  IF v_role = 'security' THEN RETURN _capability IN ('guard.operate','self.household'); END IF;
  IF v_role = 'resident' THEN RETURN _capability = 'self.household'; END IF;
  RETURN false;
END; $$;
REVOKE ALL ON FUNCTION public.current_user_has_society_permission(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_has_society_permission(uuid, text, uuid) TO authenticated, service_role;

-- (2) Two-arg compatibility helper: block-scoped without a block ID → false for non-super/non-society-admin.
CREATE OR REPLACE FUNCTION public.current_user_has_society_permission(
  _society_id uuid, _capability text
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.app_role;
BEGIN
  IF v_uid IS NULL OR _society_id IS NULL OR _capability IS NULL THEN RETURN false; END IF;
  IF NOT public.is_known_capability(_capability) THEN RETURN false; END IF;

  IF _capability IN ('directory.view','residents.view_block','blocks.view') THEN
    IF EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = v_uid AND role = 'super_admin' AND COALESCE(is_active, true)
    ) THEN RETURN true; END IF;

    SELECT ur.role INTO v_role FROM public.user_roles ur
      WHERE ur.user_id = v_uid AND ur.society_id = _society_id AND COALESCE(ur.is_active,true)
      ORDER BY CASE ur.role WHEN 'society_admin' THEN 1 WHEN 'block_admin' THEN 2
                            WHEN 'security' THEN 3 WHEN 'resident' THEN 4 ELSE 5 END LIMIT 1;

    IF v_role = 'society_admin' THEN
      IF _capability = 'residents.view_block' THEN RETURN false; END IF;
      RETURN _capability IN ('directory.view','blocks.view');
    END IF;
    RETURN false;
  END IF;

  RETURN public.current_user_has_society_permission(_society_id, _capability, NULL::uuid);
END; $$;
REVOKE ALL ON FUNCTION public.current_user_has_society_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_has_society_permission(uuid, text) TO authenticated, service_role;

-- (3) Retire legacy team RPCs — fail closed.
CREATE OR REPLACE FUNCTION public.admin_upsert_team_role(
  _society_id uuid, _target_user_id uuid, _new_role public.app_role, _block_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'deprecated_use_v2' USING ERRCODE = '42501';
END; $$;
REVOKE ALL ON FUNCTION public.admin_upsert_team_role(uuid, uuid, public.app_role, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_society_team_members(
  _society_id uuid, _include_inactive boolean DEFAULT true
) RETURNS TABLE (
  role_id uuid, user_id uuid, full_name text, role public.app_role,
  block_id uuid, block_name text,
  is_active boolean, assigned_by uuid, updated_at timestamptz, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'deprecated_use_v2' USING ERRCODE = '42501';
END; $$;
REVOKE ALL ON FUNCTION public.list_society_team_members(uuid, boolean) FROM PUBLIC, anon, authenticated;

-- (7) v2 team listing: remove email fallback.
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
    COALESCE(NULLIF(TRIM(p.full_name), ''), 'Unnamed team member')::text,
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

-- (4)(5) Privacy decision hardening.
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
  IF v_role = 'block_admin' THEN RETURN false; END IF;

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
    IF v_setting <> 'self_household_and_admins' THEN RETURN false; END IF;
    IF _subject_user_id IS NULL THEN RETURN false; END IF;
    IF _subject_user_id = v_uid THEN RETURN true; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _subject_user_id AND society_id = _society_id AND COALESCE(is_active,true)
    ) THEN RETURN false; END IF;
    SELECT EXISTS (
      SELECT 1
      FROM public.flat_residents me
      JOIN public.flat_residents them ON them.flat_id = me.flat_id
      JOIN public.flats f ON f.id = me.flat_id
      WHERE me.user_id = v_uid
        AND them.user_id = _subject_user_id
        AND COALESCE(me.is_active, true)
        AND COALESCE(them.is_active, true)
        AND f.society_id = _society_id
    ) INTO v_hh;
    RETURN COALESCE(v_hh, false);
  END IF;

  RETURN false;
END; $$;
REVOKE ALL ON FUNCTION public.resolve_privacy_access(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_privacy_access(uuid, text, uuid) TO authenticated, service_role;

-- (6) Resource-derived vehicle access decision.
CREATE OR REPLACE FUNCTION public.can_access_vehicle(
  _society_id uuid, _vehicle_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid; v_soc uuid; v_role public.app_role; v_setting text;
BEGIN
  IF v_uid IS NULL OR _society_id IS NULL OR _vehicle_id IS NULL THEN RETURN false; END IF;
  SELECT user_id, society_id INTO v_owner, v_soc
  FROM public.vehicles WHERE id = _vehicle_id;
  IF v_owner IS NULL OR v_soc IS NULL OR v_soc <> _society_id THEN RETURN false; END IF;

  IF public.current_user_is_super_admin() OR public.current_user_is_society_admin_for(_society_id) THEN
    RETURN true;
  END IF;

  SELECT ur.role INTO v_role FROM public.user_roles ur
    WHERE ur.user_id = v_uid AND ur.society_id = _society_id AND COALESCE(ur.is_active,true)
    ORDER BY CASE ur.role WHEN 'society_admin' THEN 1 WHEN 'block_admin' THEN 2
                          WHEN 'security' THEN 3 WHEN 'resident' THEN 4 ELSE 5 END LIMIT 1;
  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role IN ('security','block_admin') THEN RETURN false; END IF;

  SELECT COALESCE(privacy_vehicles,'admins_only') INTO v_setting
  FROM public.society_settings WHERE society_id = _society_id;
  IF v_setting <> 'owner_and_admins' THEN RETURN false; END IF;

  RETURN v_owner = v_uid;
END; $$;
REVOKE ALL ON FUNCTION public.can_access_vehicle(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_vehicle(uuid, uuid) TO authenticated, service_role;