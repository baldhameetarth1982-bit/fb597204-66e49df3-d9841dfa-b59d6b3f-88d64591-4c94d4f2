ALTER TABLE public.phone_verifications ADD COLUMN IF NOT EXISTS verified_via text NOT NULL DEFAULT 'firebase'
  CHECK (verified_via IN ('firebase','reverse_otp'));
COMMENT ON COLUMN public.phone_verifications.verified_via IS 'Server-written proof source; users cannot write this table.';
UPDATE public.phone_verifications SET verified_via = 'reverse_otp'
  WHERE NULLIF(trim(COALESCE(firebase_uid, '')), '') IS NULL;

CREATE OR REPLACE FUNCTION public.user_has_verified_phone_internal(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.phone_verifications pv
    WHERE pv.user_id = _user_id
      AND NULLIF(trim(pv.phone), '') IS NOT NULL
      AND (NULLIF(trim(COALESCE(pv.firebase_uid, '')), '') IS NOT NULL OR pv.verified_via = 'reverse_otp')
  )
$function$;