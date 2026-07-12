
CREATE OR REPLACE FUNCTION public.create_society_full(
  _name text,
  _registration_number text DEFAULT NULL,
  _full_address text DEFAULT NULL,
  _city text DEFAULT NULL,
  _state text DEFAULT NULL,
  _pincode text DEFAULT NULL,
  _logo_url text DEFAULT NULL,
  _total_units integer DEFAULT NULL,
  _referral_code text DEFAULT NULL
)
RETURNS TABLE(id uuid, name text, invite_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_name text := NULLIF(trim(_name),'');
  v_society_id uuid;
  v_invite_code text;
  v_referrer uuid;
  v_existing uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_name IS NULL OR length(v_name) > 120 THEN RAISE EXCEPTION 'Society name required (max 120)'; END IF;

  SELECT ur.society_id INTO v_existing
  FROM public.user_roles ur
  WHERE ur.user_id = v_user
    AND ur.role = 'society_admin'::public.app_role
    AND ur.society_id IS NOT NULL
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN QUERY
      SELECT s.id, s.name, s.invite_code
      FROM public.societies s
      WHERE s.id = v_existing;
    RETURN;
  END IF;

  INSERT INTO public.societies (
    name, registration_number, full_address, city, state, pincode, logo_url, total_units, status
  ) VALUES (
    v_name,
    NULLIF(trim(COALESCE(_registration_number,'')),''),
    NULLIF(trim(COALESCE(_full_address,'')),''),
    NULLIF(trim(COALESCE(_city,'')),''),
    NULLIF(trim(COALESCE(_state,'')),''),
    NULLIF(trim(COALESCE(_pincode,'')),''),
    NULLIF(trim(COALESCE(_logo_url,'')),''),
    _total_units,
    'active'
  )
  RETURNING societies.id, societies.invite_code INTO v_society_id, v_invite_code;

  INSERT INTO public.user_roles (user_id, role, society_id)
  VALUES (v_user, 'society_admin'::public.app_role, v_society_id)
  ON CONFLICT DO NOTHING;

  PERFORM set_config('app.allow_society_change', 'on', true);
  UPDATE public.profiles p
    SET society_id = v_society_id,
        accepted_terms_at = COALESCE(p.accepted_terms_at, now()),
        updated_at = now()
  WHERE p.id = v_user;
  PERFORM set_config('app.allow_society_change', 'off', true);

  IF NULLIF(trim(COALESCE(_referral_code,'')),'') IS NOT NULL THEN
    SELECT public.find_referrer_by_code(_referral_code) INTO v_referrer;
    IF v_referrer IS NOT NULL AND v_referrer <> v_user THEN
      UPDATE public.profiles p
        SET referred_by = COALESCE(p.referred_by, v_referrer),
            updated_at = now()
      WHERE p.id = v_user;
    END IF;
  END IF;

  RETURN QUERY SELECT v_society_id, v_name, v_invite_code;
END $function$;

NOTIFY pgrst, 'reload schema';
