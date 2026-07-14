
-- Turn 11 — Secure role helpers + additive certificate encryption columns

-- =========================================================
-- 1. Internal (service_role only) trusted-actor role helpers
-- =========================================================

CREATE OR REPLACE FUNCTION public.is_society_admin_for_internal(_actor_id uuid, _society_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _actor_id
      AND ur.role IN ('society_admin', 'block_admin')
      AND ur.society_id = _society_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin_internal(_actor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _actor_id AND ur.role = 'super_admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_society_admin_for_internal(uuid, uuid) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.is_super_admin_internal(uuid) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_society_admin_for_internal(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin_internal(uuid) TO service_role;

-- =========================================================
-- 2. Authenticated self-check wrappers (auth.uid() only)
-- =========================================================

CREATE OR REPLACE FUNCTION public.current_user_is_society_admin_for(_society_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT public.is_society_admin_for_internal(auth.uid(), _society_id)),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT public.is_super_admin_internal(auth.uid())),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_is_society_admin_for(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_is_society_admin_for(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_is_super_admin() TO authenticated, service_role;

-- =========================================================
-- 3. Revoke arbitrary-user role probes from authenticated
-- Old helpers remain callable by service_role for compat.
-- =========================================================

REVOKE EXECUTE ON FUNCTION public.is_society_admin_for(uuid, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM authenticated;

-- =========================================================
-- 4. Additive certificate encryption columns
-- Plaintext verification_token column left untouched (legacy) for
-- a later backfill+drop migration; new columns are additive only.
-- =========================================================

ALTER TABLE public.no_dues_certificates
  ADD COLUMN IF NOT EXISTS verification_token_ciphertext text,
  ADD COLUMN IF NOT EXISTS verification_token_iv text,
  ADD COLUMN IF NOT EXISTS verification_token_key_version smallint;

COMMENT ON COLUMN public.no_dues_certificates.verification_token_ciphertext IS
  'AES-GCM ciphertext (base64) of the raw verification token. Server-decrypted only.';
COMMENT ON COLUMN public.no_dues_certificates.verification_token_iv IS
  'Base64 12-byte IV, unique per certificate.';
COMMENT ON COLUMN public.no_dues_certificates.verification_token_key_version IS
  'Key rotation version. Server maps this to the active encryption key.';
