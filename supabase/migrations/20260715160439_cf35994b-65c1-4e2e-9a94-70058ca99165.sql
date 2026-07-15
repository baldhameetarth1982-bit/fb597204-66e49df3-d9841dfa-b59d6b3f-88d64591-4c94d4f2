
-- 1) Trigger: ensure unit_billing_overrides.flat_id belongs to the same society_id
CREATE OR REPLACE FUNCTION public.enforce_unit_override_flat_society()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  flat_society uuid;
BEGIN
  SELECT society_id INTO flat_society FROM public.flats WHERE id = NEW.flat_id;
  IF flat_society IS NULL THEN
    RAISE EXCEPTION 'Flat % not found', NEW.flat_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF flat_society <> NEW.society_id THEN
    RAISE EXCEPTION 'flat_id % does not belong to society_id %', NEW.flat_id, NEW.society_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_unit_override_flat_society ON public.unit_billing_overrides;
CREATE TRIGGER trg_unit_override_flat_society
BEFORE INSERT OR UPDATE ON public.unit_billing_overrides
FOR EACH ROW EXECUTE FUNCTION public.enforce_unit_override_flat_society();

-- 2) Revoke direct write access on tables that must only be written by SECURITY DEFINER RPCs.
--    RLS remains enabled and existing SELECT policies are unchanged. Service role keeps full access.

-- flat360_ai_summary_cache: no client access at all
REVOKE ALL ON public.flat360_ai_summary_cache FROM anon, authenticated;
GRANT ALL ON public.flat360_ai_summary_cache TO service_role;

-- no_dues_cert_counters: no client access at all
REVOKE ALL ON public.no_dues_cert_counters FROM anon, authenticated;
GRANT ALL ON public.no_dues_cert_counters TO service_role;

-- no_dues_certificates: keep SELECT via existing policies, block direct writes
REVOKE INSERT, UPDATE, DELETE ON public.no_dues_certificates FROM anon, authenticated;
GRANT SELECT ON public.no_dues_certificates TO authenticated;
GRANT ALL ON public.no_dues_certificates TO service_role;

-- user_points: read-only for clients, writes only via server/RPC
REVOKE INSERT, UPDATE, DELETE ON public.user_points FROM anon, authenticated;
GRANT SELECT ON public.user_points TO authenticated;
GRANT ALL ON public.user_points TO service_role;

-- achievements: read-only for clients, writes only via server/RPC
REVOKE INSERT, UPDATE, DELETE ON public.achievements FROM anon, authenticated;
GRANT SELECT ON public.achievements TO authenticated;
GRANT ALL ON public.achievements TO service_role;
