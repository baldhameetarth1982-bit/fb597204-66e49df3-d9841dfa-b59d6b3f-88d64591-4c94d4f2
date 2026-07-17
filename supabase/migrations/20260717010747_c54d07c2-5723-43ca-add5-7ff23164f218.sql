
-- ============================================================
-- Stage 2C — Teams, Roles and Privacy Controls
-- ============================================================

-- 1. Additive lifecycle columns on user_roles
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_user_roles_touch ON public.user_roles;
CREATE TRIGGER trg_user_roles_touch
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_user_roles_active_society
  ON public.user_roles(society_id, role) WHERE is_active;

-- 2. Additive privacy columns on society_settings
ALTER TABLE public.society_settings
  ADD COLUMN IF NOT EXISTS privacy_directory text NOT NULL DEFAULT 'admins_only'
    CHECK (privacy_directory IN ('admins_only','residents_safe')),
  ADD COLUMN IF NOT EXISTS privacy_contacts text NOT NULL DEFAULT 'self_household_and_admins'
    CHECK (privacy_contacts IN ('admins_only','self_household_and_admins')),
  ADD COLUMN IF NOT EXISTS privacy_finances text NOT NULL DEFAULT 'admins_only'
    CHECK (privacy_finances IN ('admins_only','resident_summary','resident_detailed')),
  ADD COLUMN IF NOT EXISTS privacy_vehicles text NOT NULL DEFAULT 'owner_and_admins'
    CHECK (privacy_vehicles IN ('admins_only','owner_and_admins')),
  ADD COLUMN IF NOT EXISTS privacy_documents text NOT NULL DEFAULT 'owner_and_admins'
    CHECK (privacy_documents IN ('admins_only','owner_and_admins'));

-- 3. Canonical capability helper (mirrors src/lib/role-permissions.ts)
CREATE OR REPLACE FUNCTION public.current_user_has_society_permission(
  _society_id uuid,
  _capability text
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_super boolean;
  v_is_soc_admin boolean;
  v_is_block_admin boolean;
BEGIN
  IF v_uid IS NULL OR _society_id IS NULL OR _capability IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_uid AND role = 'super_admin' AND COALESCE(is_active, true)
  ) INTO v_super;
  IF v_super THEN RETURN true; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_uid AND society_id = _society_id
      AND role = 'society_admin' AND COALESCE(is_active, true)
  ) INTO v_is_soc_admin;
  IF v_is_soc_admin THEN RETURN true; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_uid AND society_id = _society_id
      AND role = 'block_admin' AND COALESCE(is_active, true)
      AND block_id IS NOT NULL
  ) INTO v_is_block_admin;

  IF v_is_block_admin AND _capability IN (
    'directory.view', 'residents.view_block', 'blocks.view'
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.current_user_has_society_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_has_society_permission(uuid, text) TO authenticated, service_role;

-- 4. Team directory listing (safe projection)
CREATE OR REPLACE FUNCTION public.list_society_team_members(
  _society_id uuid,
  _include_inactive boolean DEFAULT true
) RETURNS TABLE (
  role_id uuid,
  user_id uuid,
  full_name text,
  role public.app_role,
  block_id uuid,
  block_name text,
  is_active boolean,
  assigned_by uuid,
  updated_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.current_user_is_society_admin_for(_society_id)
          OR public.current_user_is_super_admin()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    ur.id, ur.user_id,
    COALESCE(p.full_name, p.email, ur.user_id::text)::text AS full_name,
    ur.role, ur.block_id, b.name AS block_name,
    COALESCE(ur.is_active, true), ur.assigned_by, ur.updated_at, ur.created_at
  FROM public.user_roles ur
  LEFT JOIN public.profiles p ON p.id = ur.user_id
  LEFT JOIN public.blocks b ON b.id = ur.block_id
  WHERE ur.society_id = _society_id
    AND ur.role IN ('society_admin','block_admin','security')
    AND (_include_inactive OR COALESCE(ur.is_active, true))
  ORDER BY (ur.role = 'society_admin') DESC, ur.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_society_team_members(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_society_team_members(uuid, boolean) TO authenticated, service_role;

-- 5. Assign/update role (transactional, audited, last-admin protected)
CREATE OR REPLACE FUNCTION public.admin_upsert_team_role(
  _society_id uuid,
  _target_user_id uuid,
  _new_role public.app_role,
  _block_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row public.user_roles%ROWTYPE;
  v_prev_role public.app_role;
  v_prev_block uuid;
  v_prev_active boolean;
  v_admin_count int;
  v_structure_mode text;
  v_role_id uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT (public.current_user_is_society_admin_for(_society_id)
          OR public.current_user_is_super_admin()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _new_role = 'super_admin' AND NOT public.current_user_is_super_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _new_role NOT IN ('society_admin','block_admin','security') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;

  -- Actor cannot target self for role downgrade of last admin — handled below.
  PERFORM pg_advisory_xact_lock(hashtextextended(_society_id::text, 42));

  -- Target must be a member of the society (via profile or existing role)
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _target_user_id AND society_id = _society_id
    UNION ALL
    SELECT 1 FROM public.user_roles WHERE user_id = _target_user_id AND society_id = _society_id
  ) THEN
    RAISE EXCEPTION 'target_not_in_society';
  END IF;

  IF _new_role = 'block_admin' THEN
    SELECT COALESCE(structure_mode, 'structured') INTO v_structure_mode
    FROM public.societies WHERE id = _society_id;
    IF v_structure_mode = 'serial' THEN
      RAISE EXCEPTION 'block_admin_unavailable_serial_mode';
    END IF;
    IF _block_id IS NULL THEN RAISE EXCEPTION 'block_scope_required'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.blocks
      WHERE id = _block_id AND society_id = _society_id AND COALESCE(is_active, true)
    ) THEN
      RAISE EXCEPTION 'invalid_block_scope';
    END IF;
  ELSE
    _block_id := NULL;
  END IF;

  -- Find existing team-scoped role for the target in this society
  SELECT * INTO v_row FROM public.user_roles
  WHERE society_id = _society_id
    AND user_id = _target_user_id
    AND role IN ('society_admin','block_admin','security')
  ORDER BY created_at DESC LIMIT 1
  FOR UPDATE;

  v_prev_role := v_row.role;
  v_prev_block := v_row.block_id;
  v_prev_active := COALESCE(v_row.is_active, true);

  -- Last-admin protection: if we would leave zero active society_admins, block.
  IF v_prev_role = 'society_admin' AND v_prev_active AND _new_role <> 'society_admin' THEN
    SELECT count(*) INTO v_admin_count FROM public.user_roles
    WHERE society_id = _society_id AND role = 'society_admin'
      AND COALESCE(is_active, true);
    IF v_admin_count <= 1 THEN RAISE EXCEPTION 'last_society_admin'; END IF;
  END IF;

  IF v_row.id IS NULL THEN
    INSERT INTO public.user_roles
      (user_id, role, society_id, block_id, is_active, assigned_by, updated_at)
    VALUES (_target_user_id, _new_role, _society_id, _block_id, true, v_actor, now())
    RETURNING id INTO v_role_id;
  ELSE
    UPDATE public.user_roles
    SET role = _new_role,
        block_id = _block_id,
        is_active = true,
        deactivated_at = NULL,
        deactivated_by = NULL,
        assigned_by = v_actor,
        updated_at = now()
    WHERE id = v_row.id
    RETURNING id INTO v_role_id;
  END IF;

  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (v_actor, 'team.role_upserted', 'user_roles', v_role_id::text, _society_id,
    jsonb_build_object(
      'target_user_id', _target_user_id,
      'previous_role', v_prev_role,
      'resulting_role', _new_role,
      'previous_block_id', v_prev_block,
      'resulting_block_id', _block_id,
      'previous_active', v_prev_active
    ));

  RETURN v_role_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_upsert_team_role(uuid, uuid, public.app_role, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_team_role(uuid, uuid, public.app_role, uuid) TO authenticated, service_role;

-- 6. Deactivate/reactivate team member (soft, audited, last-admin protected)
CREATE OR REPLACE FUNCTION public.admin_set_team_active(
  _society_id uuid,
  _role_id uuid,
  _is_active boolean
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row public.user_roles%ROWTYPE;
  v_admin_count int;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT (public.current_user_is_society_admin_for(_society_id)
          OR public.current_user_is_super_admin()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_society_id::text, 42));

  SELECT * INTO v_row FROM public.user_roles
  WHERE id = _role_id AND society_id = _society_id
  FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'role_not_found'; END IF;
  IF v_row.role NOT IN ('society_admin','block_admin','security') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT _is_active AND v_row.role = 'society_admin' AND COALESCE(v_row.is_active, true) THEN
    SELECT count(*) INTO v_admin_count FROM public.user_roles
    WHERE society_id = _society_id AND role = 'society_admin'
      AND COALESCE(is_active, true);
    IF v_admin_count <= 1 THEN RAISE EXCEPTION 'last_society_admin'; END IF;
  END IF;

  UPDATE public.user_roles
  SET is_active = _is_active,
      deactivated_at = CASE WHEN _is_active THEN NULL ELSE now() END,
      deactivated_by = CASE WHEN _is_active THEN NULL ELSE v_actor END,
      updated_at = now()
  WHERE id = _role_id;

  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (v_actor,
    CASE WHEN _is_active THEN 'team.role_reactivated' ELSE 'team.role_deactivated' END,
    'user_roles', _role_id::text, _society_id,
    jsonb_build_object(
      'target_user_id', v_row.user_id,
      'role', v_row.role,
      'previous_active', COALESCE(v_row.is_active, true),
      'resulting_active', _is_active
    ));

  RETURN _role_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_team_active(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_team_active(uuid, uuid, boolean) TO authenticated, service_role;

-- 7. Read privacy settings (safe defaults if missing)
CREATE OR REPLACE FUNCTION public.get_society_privacy(_society_id uuid)
RETURNS TABLE (
  privacy_directory text,
  privacy_contacts text,
  privacy_finances text,
  privacy_vehicles text,
  privacy_documents text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.current_user_is_society_admin_for(_society_id)
          OR public.current_user_is_super_admin()
          OR public.authorize_membership(auth.uid(), _society_id)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  SELECT
    COALESCE(s.privacy_directory, 'admins_only'),
    COALESCE(s.privacy_contacts,  'self_household_and_admins'),
    COALESCE(s.privacy_finances,  'admins_only'),
    COALESCE(s.privacy_vehicles,  'owner_and_admins'),
    COALESCE(s.privacy_documents, 'owner_and_admins')
  FROM (SELECT _society_id AS society_id) q
  LEFT JOIN public.society_settings s ON s.society_id = q.society_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_society_privacy(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_society_privacy(uuid) TO authenticated, service_role;

-- 8. Update privacy settings (transactional + audited)
CREATE OR REPLACE FUNCTION public.admin_set_society_privacy(
  _society_id uuid,
  _directory text,
  _contacts  text,
  _finances  text,
  _vehicles  text,
  _documents text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_prev record;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT (public.current_user_is_society_admin_for(_society_id)
          OR public.current_user_is_super_admin()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _directory NOT IN ('admins_only','residents_safe') THEN RAISE EXCEPTION 'invalid_directory'; END IF;
  IF _contacts  NOT IN ('admins_only','self_household_and_admins') THEN RAISE EXCEPTION 'invalid_contacts'; END IF;
  IF _finances  NOT IN ('admins_only','resident_summary','resident_detailed') THEN RAISE EXCEPTION 'invalid_finances'; END IF;
  IF _vehicles  NOT IN ('admins_only','owner_and_admins') THEN RAISE EXCEPTION 'invalid_vehicles'; END IF;
  IF _documents NOT IN ('admins_only','owner_and_admins') THEN RAISE EXCEPTION 'invalid_documents'; END IF;

  SELECT privacy_directory, privacy_contacts, privacy_finances, privacy_vehicles, privacy_documents
  INTO v_prev FROM public.society_settings WHERE society_id = _society_id;

  INSERT INTO public.society_settings (society_id,
    privacy_directory, privacy_contacts, privacy_finances, privacy_vehicles, privacy_documents)
  VALUES (_society_id, _directory, _contacts, _finances, _vehicles, _documents)
  ON CONFLICT (society_id) DO UPDATE SET
    privacy_directory = EXCLUDED.privacy_directory,
    privacy_contacts  = EXCLUDED.privacy_contacts,
    privacy_finances  = EXCLUDED.privacy_finances,
    privacy_vehicles  = EXCLUDED.privacy_vehicles,
    privacy_documents = EXCLUDED.privacy_documents,
    updated_at = now();

  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (v_actor, 'society.privacy_updated', 'society_settings', _society_id::text, _society_id,
    jsonb_build_object(
      'previous', to_jsonb(v_prev),
      'resulting', jsonb_build_object(
        'privacy_directory', _directory,
        'privacy_contacts',  _contacts,
        'privacy_finances',  _finances,
        'privacy_vehicles',  _vehicles,
        'privacy_documents', _documents
      )
    ));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_society_privacy(uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_society_privacy(uuid, text, text, text, text, text) TO authenticated, service_role;
