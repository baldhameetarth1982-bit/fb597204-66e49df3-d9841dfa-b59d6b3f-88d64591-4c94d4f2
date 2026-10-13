ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS birth_year smallint;
COMMENT ON COLUMN public.profiles.birth_year IS 'Year of birth chosen at sign-up; must make the person 18+.';

CREATE OR REPLACE FUNCTION public._profiles_check_birth_year()
 RETURNS trigger LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE y int := extract(year FROM now())::int;
BEGIN
  IF NEW.birth_year IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.birth_year IS NOT NULL AND current_user IN ('authenticated','anon') THEN
      RAISE EXCEPTION 'AGE_REQUIRED: Year of birth cannot be removed' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.birth_year IS NOT DISTINCT FROM OLD.birth_year THEN RETURN NEW; END IF;
  IF NEW.birth_year < y - 110 OR NEW.birth_year > y - 18 THEN
    RAISE EXCEPTION 'AGE_UNDER_18: You must be 18 or older to use SociyoHub' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS profiles_check_birth_year ON public.profiles;
CREATE TRIGGER profiles_check_birth_year BEFORE INSERT OR UPDATE OF birth_year ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public._profiles_check_birth_year();

CREATE OR REPLACE FUNCTION public.user_account_complete_internal(_user_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.user_has_verified_phone_internal(_user_id)
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user_id AND p.birth_year IS NOT NULL)
$function$;
REVOKE ALL ON FUNCTION public.user_account_complete_internal(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._societies_require_verified_phone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL OR public.has_role(v_user, 'super_admin'::public.app_role) THEN
    RETURN NEW;
  END IF;
  IF NOT public.user_has_verified_phone_internal(v_user) THEN
    RAISE EXCEPTION 'PHONE_VERIFICATION_REQUIRED: Verify your mobile number before creating a society'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.user_account_complete_internal(v_user) THEN
    RAISE EXCEPTION 'AGE_REQUIRED: Choose your year of birth before creating a society' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public._join_requests_require_complete_account()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL OR NEW.user_id IS DISTINCT FROM v_user OR public.has_role(v_user, 'super_admin'::public.app_role) THEN
    RETURN NEW;
  END IF;
  IF NOT public.user_has_verified_phone_internal(v_user) THEN
    RAISE EXCEPTION 'PHONE_VERIFICATION_REQUIRED: Verify your mobile number before joining a society' USING ERRCODE = '42501';
  END IF;
  IF NOT public.user_account_complete_internal(v_user) THEN
    RAISE EXCEPTION 'AGE_REQUIRED: Choose your year of birth before joining a society' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public._join_requests_require_complete_account() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS join_requests_require_complete_account ON public.join_requests;
CREATE TRIGGER join_requests_require_complete_account BEFORE INSERT ON public.join_requests
  FOR EACH ROW EXECUTE FUNCTION public._join_requests_require_complete_account();
