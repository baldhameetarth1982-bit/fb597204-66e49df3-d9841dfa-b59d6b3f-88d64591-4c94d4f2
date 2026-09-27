-- Phone verification rows may only be written by the trusted server after
-- verifying a Firebase phone ID token. Users keep read/delete of their own row.
DROP POLICY IF EXISTS "users manage own phone verification" ON public.phone_verifications;
REVOKE INSERT, UPDATE ON public.phone_verifications FROM authenticated, anon;
GRANT SELECT, DELETE ON public.phone_verifications TO authenticated;
GRANT ALL ON public.phone_verifications TO service_role;
CREATE POLICY "users read own phone verification" ON public.phone_verifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "users delete own phone verification" ON public.phone_verifications
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.user_has_verified_phone_internal(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.phone_verifications pv
    WHERE pv.user_id = _user_id
      AND NULLIF(trim(pv.phone), '') IS NOT NULL
      AND NULLIF(trim(COALESCE(pv.firebase_uid, '')), '') IS NOT NULL
  )
$$;
REVOKE ALL ON FUNCTION public.user_has_verified_phone_internal(uuid) FROM PUBLIC, anon, authenticated;

-- Every society insert made on behalf of a signed-in user (any RPC path)
-- requires a server-verified phone. Super Admins and trusted server jobs
-- (no auth.uid()) are unaffected.
CREATE OR REPLACE FUNCTION public._societies_require_verified_phone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL OR public.has_role(v_user, 'super_admin'::public.app_role) THEN
    RETURN NEW;
  END IF;
  IF NOT public.user_has_verified_phone_internal(v_user) THEN
    RAISE EXCEPTION 'PHONE_VERIFICATION_REQUIRED: Verify your mobile number before creating a society'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._societies_require_verified_phone() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS societies_require_verified_phone ON public.societies;
CREATE TRIGGER societies_require_verified_phone
  BEFORE INSERT ON public.societies
  FOR EACH ROW EXECUTE FUNCTION public._societies_require_verified_phone();