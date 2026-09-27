CREATE TABLE public.society_branding (
  society_id uuid PRIMARY KEY REFERENCES public.societies(id) ON DELETE CASCADE,
  display_name text CHECK (display_name IS NULL OR (char_length(btrim(display_name)) BETWEEN 2 AND 60 AND display_name !~ '[<>{}]')),
  primary_color text CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9A-F]{6}$'),
  accent_color text CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9A-F]{6}$'),
  logo_path text CHECK (logo_path IS NULL OR logo_path ~ '^[0-9a-f-]{36}/brand-logo-[0-9]{10,16}\.(png|webp|jpg)$'),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT society_branding_logo_scope CHECK (logo_path IS NULL OR logo_path LIKE society_id::text || '/%')
);
GRANT SELECT ON public.society_branding TO authenticated;
GRANT ALL ON public.society_branding TO service_role;
ALTER TABLE public.society_branding ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read own society branding" ON public.society_branding FOR SELECT TO authenticated
  USING (public.current_user_is_society_admin_for(society_id) OR public.current_user_is_super_admin());

-- Premium (or active trial) entitlement, mirrors normalizePlan.
CREATE OR REPLACE FUNCTION public._branding_plan_enabled(_society_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.societies s
    WHERE s.id = _society_id
      AND lower(btrim(coalesce(s.status,'active'))) = 'active'
      AND CASE
        WHEN lower(coalesce(s.plan_status,'')) IN ('trial','trialing') THEN s.trial_ends_at IS NOT NULL AND s.trial_ends_at > now()
        ELSE lower(coalesce(s.plan_id,'')) = 'premium'
             AND lower(coalesce(s.plan_status,'')) = 'active'
             AND (s.plan_expires_at IS NULL OR s.plan_expires_at > now())
      END)
$$;
REVOKE ALL ON FUNCTION public._branding_plan_enabled(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._branding_plan_enabled(uuid) TO authenticated, service_role;

-- Effective branding for any active member; empty when not entitled.
CREATE OR REPLACE FUNCTION public.get_society_branding(_society_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); b public.society_branding; v_ent boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF NOT (public.current_user_is_super_admin() OR EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_uid AND ur.society_id = _society_id AND coalesce(ur.is_active, true))) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  v_ent := public._branding_plan_enabled(_society_id);
  SELECT * INTO b FROM public.society_branding WHERE society_id = _society_id;
  RETURN jsonb_build_object(
    'entitled', v_ent,
    'custom', b.society_id IS NOT NULL,
    'display_name', CASE WHEN v_ent THEN b.display_name END,
    'primary_color', CASE WHEN v_ent THEN b.primary_color END,
    'accent_color', CASE WHEN v_ent THEN b.accent_color END,
    'logo_path', CASE WHEN v_ent THEN b.logo_path END,
    'updated_at', b.updated_at);
END $$;
REVOKE ALL ON FUNCTION public.get_society_branding(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_society_branding(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_society_branding(_society_id uuid, _display_name text, _primary_color text, _accent_color text, _logo_path text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_before jsonb; v_after jsonb; v_name text := nullif(btrim(_display_name), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF NOT (public.current_user_is_society_admin_for(_society_id) OR public.current_user_is_super_admin()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF NOT public._branding_plan_enabled(_society_id) THEN RAISE EXCEPTION 'plan_required' USING ERRCODE='42501'; END IF;
  IF v_name IS NOT NULL AND (char_length(v_name) NOT BETWEEN 2 AND 60 OR v_name ~ '[<>{}]') THEN RAISE EXCEPTION 'invalid_name'; END IF;
  IF _primary_color IS NOT NULL AND _primary_color !~ '^#[0-9A-F]{6}$' THEN RAISE EXCEPTION 'invalid_color'; END IF;
  IF _accent_color IS NOT NULL AND _accent_color !~ '^#[0-9A-F]{6}$' THEN RAISE EXCEPTION 'invalid_color'; END IF;
  IF _logo_path IS NOT NULL THEN
    IF _logo_path !~ '^[0-9a-f-]{36}/brand-logo-[0-9]{10,16}\.(png|webp|jpg)$' OR _logo_path NOT LIKE _society_id::text || '/%' THEN
      RAISE EXCEPTION 'invalid_logo';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'branding' AND o.name = _logo_path) THEN
      RAISE EXCEPTION 'invalid_logo';
    END IF;
  END IF;
  SELECT jsonb_build_object('display_name', display_name, 'primary_color', primary_color, 'accent_color', accent_color, 'logo', logo_path IS NOT NULL, 'logo_path', logo_path)
    INTO v_before FROM public.society_branding WHERE society_id = _society_id FOR UPDATE;
  INSERT INTO public.society_branding AS s (society_id, display_name, primary_color, accent_color, logo_path, updated_by, updated_at)
  VALUES (_society_id, v_name, _primary_color, _accent_color, _logo_path, v_uid, now())
  ON CONFLICT (society_id) DO UPDATE SET display_name = EXCLUDED.display_name, primary_color = EXCLUDED.primary_color,
    accent_color = EXCLUDED.accent_color, logo_path = EXCLUDED.logo_path, updated_by = v_uid, updated_at = now();
  v_after := jsonb_build_object('display_name', v_name, 'primary_color', _primary_color, 'accent_color', _accent_color, 'logo', _logo_path IS NOT NULL, 'logo_path', _logo_path);
  IF v_before IS DISTINCT FROM v_after THEN
    INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (v_uid, 'society.branding_updated', 'society_branding', _society_id::text, _society_id,
      jsonb_build_object('before', v_before - 'logo_path', 'after', v_after - 'logo_path',
        'logo_changed', (v_before->>'logo_path') IS DISTINCT FROM _logo_path));
  END IF;
  RETURN jsonb_build_object('previous_logo_path', v_before->>'logo_path');
END $$;
REVOKE ALL ON FUNCTION public.admin_set_society_branding(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_society_branding(uuid, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_reset_society_branding(_society_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_before public.society_branding;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF NOT (public.current_user_is_society_admin_for(_society_id) OR public.current_user_is_super_admin()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  DELETE FROM public.society_branding WHERE society_id = _society_id RETURNING * INTO v_before;
  IF v_before.society_id IS NOT NULL THEN
    INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (v_uid, 'society.branding_reset', 'society_branding', _society_id::text, _society_id,
      jsonb_build_object('before', jsonb_build_object('display_name', v_before.display_name, 'primary_color', v_before.primary_color,
        'accent_color', v_before.accent_color, 'logo', v_before.logo_path IS NOT NULL), 'after', 'sociyohub_default'));
  END IF;
  RETURN jsonb_build_object('previous_logo_path', v_before.logo_path);
END $$;
REVOKE ALL ON FUNCTION public.admin_reset_society_branding(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_society_branding(uuid) TO authenticated;