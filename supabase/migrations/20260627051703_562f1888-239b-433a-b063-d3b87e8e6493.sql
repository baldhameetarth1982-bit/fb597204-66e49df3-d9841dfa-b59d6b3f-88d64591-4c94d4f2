
-- 1. Strict trigger function: only allow society_id changes when an allowed RPC
--    has set the session flag, or when the service_role is performing the change.
CREATE OR REPLACE FUNCTION public.prevent_society_id_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed text;
  v_session_role text := current_setting('role', true);
BEGIN
  IF NEW.society_id IS DISTINCT FROM OLD.society_id THEN
    v_allowed := current_setting('app.allow_society_change', true);
    IF v_allowed IS DISTINCT FROM 'on'
       AND COALESCE(v_session_role, '') <> 'service_role'
       AND NOT public.is_super_admin(auth.uid()) THEN
      RAISE EXCEPTION 'society_id can only be changed via join_society_with_code or create_society_for_current_user';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prevent_society_id_change() FROM PUBLIC, anon, authenticated;

-- 2. Tighten the UPDATE policy with a WITH CHECK clause (defense in depth).
DROP POLICY IF EXISTS "users update own profile" ON public.profiles;
CREATE POLICY "users update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 3. Allowed RPCs flag the change before mutating profiles.society_id.
CREATE OR REPLACE FUNCTION public.join_society_with_code(_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE sid UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id INTO sid FROM public.societies
  WHERE upper(invite_code) = upper(_code) AND status = 'active' LIMIT 1;
  IF sid IS NULL THEN RAISE EXCEPTION 'Invalid society code'; END IF;

  PERFORM set_config('app.allow_society_change', 'on', true);
  UPDATE public.profiles SET society_id = sid WHERE id = auth.uid();
  PERFORM set_config('app.allow_society_change', 'off', true);

  INSERT INTO public.user_roles (user_id, role, society_id)
  VALUES (auth.uid(), 'resident', sid)
  ON CONFLICT DO NOTHING;
  RETURN sid;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_society_for_current_user(_name text, _city text DEFAULT NULL::text, _state text DEFAULT NULL::text, _referral_code text DEFAULT NULL::text)
RETURNS TABLE(id uuid, name text, invite_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_name text := NULLIF(trim(_name), '');
  v_city text := NULLIF(trim(COALESCE(_city, '')), '');
  v_state text := NULLIF(trim(COALESCE(_state, '')), '');
  v_society_id uuid;
  v_invite_code text;
  v_referrer_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_name IS NULL OR length(v_name) > 120 THEN RAISE EXCEPTION 'Society name must be 1 to 120 characters'; END IF;
  IF v_city IS NOT NULL AND length(v_city) > 60 THEN RAISE EXCEPTION 'City must be 60 characters or less'; END IF;
  IF v_state IS NOT NULL AND length(v_state) > 60 THEN RAISE EXCEPTION 'State must be 60 characters or less'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_user_id
      AND ur.role = 'society_admin'::public.app_role
      AND ur.society_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'You already manage a society';
  END IF;

  INSERT INTO public.societies (name, city, state, status)
  VALUES (v_name, v_city, v_state, 'active')
  RETURNING societies.id, societies.invite_code
  INTO v_society_id, v_invite_code;

  INSERT INTO public.user_roles (user_id, role, society_id)
  VALUES (v_user_id, 'society_admin'::public.app_role, v_society_id)
  ON CONFLICT DO NOTHING;

  PERFORM set_config('app.allow_society_change', 'on', true);
  UPDATE public.profiles
  SET society_id = v_society_id,
      accepted_terms_at = COALESCE(accepted_terms_at, now()),
      updated_at = now()
  WHERE profiles.id = v_user_id;
  PERFORM set_config('app.allow_society_change', 'off', true);

  IF NULLIF(trim(COALESCE(_referral_code, '')), '') IS NOT NULL THEN
    SELECT public.find_referrer_by_code(_referral_code) INTO v_referrer_id;
    IF v_referrer_id IS NOT NULL AND v_referrer_id <> v_user_id THEN
      UPDATE public.profiles
      SET referred_by = COALESCE(referred_by, v_referrer_id),
          updated_at = now()
      WHERE profiles.id = v_user_id;
    END IF;
  END IF;

  SELECT referred_by INTO v_referrer_id FROM public.profiles WHERE profiles.id = v_user_id;
  IF v_referrer_id IS NOT NULL AND v_referrer_id <> v_user_id THEN
    INSERT INTO public.referral_earnings (referrer_id, referred_user_id, society_id, amount, rate, note)
    VALUES (v_referrer_id, v_user_id, v_society_id, 500, 0.10, 'Society signup commission');
  END IF;

  RETURN QUERY SELECT v_society_id, v_name, v_invite_code;
END;
$$;
