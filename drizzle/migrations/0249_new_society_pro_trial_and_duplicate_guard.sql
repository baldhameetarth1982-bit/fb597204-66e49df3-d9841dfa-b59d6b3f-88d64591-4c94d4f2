-- New societies: 30-day top-tier (Pro) trial from creation; one verified phone may run only one society;
-- the same society name at the same address cannot be registered twice.

CREATE OR REPLACE FUNCTION public._norm_society_key(_t text)
 RETURNS text LANGUAGE sql IMMUTABLE
 SET search_path TO 'public'
AS $$ SELECT NULLIF(regexp_replace(lower(coalesce(_t,'')), '[^a-z0-9\u0900-\u0DFF]+', '', 'g'), '') $$;

CREATE OR REPLACE FUNCTION public._phone_key(_p text)
 RETURNS text LANGUAGE sql IMMUTABLE
 SET search_path TO 'public'
AS $$ SELECT NULLIF(right(regexp_replace(coalesce(_p,''), '\D', '', 'g'), 10), '') $$;

CREATE OR REPLACE FUNCTION public._societies_block_duplicates()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_name text; v_addr text;
BEGIN
  IF auth.uid() IS NOT NULL AND public.is_super_admin(auth.uid()) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.name IS NOT DISTINCT FROM OLD.name
     AND NEW.address IS NOT DISTINCT FROM OLD.address
     AND NEW.full_address IS NOT DISTINCT FROM OLD.full_address THEN
    RETURN NEW;
  END IF;
  v_name := public._norm_society_key(NEW.name);
  v_addr := public._norm_society_key(coalesce(NULLIF(trim(NEW.address),''), NEW.full_address));
  IF v_name IS NULL OR v_addr IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('society_dup:' || v_name || ':' || v_addr, 0));
  IF EXISTS (
    SELECT 1 FROM public.societies s
     WHERE s.id <> NEW.id
       AND public._norm_society_key(s.name) = v_name
       AND public._norm_society_key(coalesce(NULLIF(trim(s.address),''), s.full_address)) = v_addr
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_SOCIETY: A society with this name is already registered at this address'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public._societies_block_duplicates() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS societies_block_duplicates ON public.societies;
CREATE TRIGGER societies_block_duplicates
  BEFORE INSERT OR UPDATE OF name, address, full_address ON public.societies
  FOR EACH ROW EXECUTE FUNCTION public._societies_block_duplicates();

CREATE OR REPLACE FUNCTION public.create_society_full(_name text, _registration_number text DEFAULT NULL::text, _full_address text DEFAULT NULL::text, _city text DEFAULT NULL::text, _state text DEFAULT NULL::text, _pincode text DEFAULT NULL::text, _logo_url text DEFAULT NULL::text, _total_units integer DEFAULT NULL::integer, _referral_code text DEFAULT NULL::text)
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
  v_phone text;
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

  -- One phone number runs one society: another account verified with the same number
  -- that already administers a society blocks a second one.
  SELECT public._phone_key(pv.phone) INTO v_phone FROM public.phone_verifications pv WHERE pv.user_id = v_user;
  IF v_phone IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('society_phone:' || v_phone, 0));
    IF EXISTS (
      SELECT 1 FROM public.phone_verifications pv
        JOIN public.user_roles ur ON ur.user_id = pv.user_id
       WHERE pv.user_id <> v_user
         AND public._phone_key(pv.phone) = v_phone
         AND ur.role = 'society_admin'::public.app_role
         AND ur.society_id IS NOT NULL
         AND COALESCE(ur.is_active, true)
    ) THEN
      RAISE EXCEPTION 'PHONE_ALREADY_HAS_SOCIETY: This phone number already runs a society'
        USING ERRCODE = '23505';
    END IF;
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

  -- Every new society starts a 30-day trial of the highest plan straight away (no plan choice needed).
  UPDATE public.societies s
     SET plan_id = 'trial', plan_status = 'trialing',
         trial_ends_at = now() + interval '30 days',
         trial_consumed_at = now(), plan_selected_at = now(), updated_at = now()
   WHERE s.id = v_society_id;

  INSERT INTO public.user_roles (user_id, role, society_id)
  VALUES (v_user, 'society_admin'::public.app_role, v_society_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (v_user, 'society.trial_started', 'societies', v_society_id::text, v_society_id,
          jsonb_build_object('days', 30, 'source', 'society_created'));

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
