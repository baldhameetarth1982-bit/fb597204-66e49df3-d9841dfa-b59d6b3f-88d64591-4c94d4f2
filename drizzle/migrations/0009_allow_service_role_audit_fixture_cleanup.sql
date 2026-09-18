CREATE OR REPLACE FUNCTION public._protect_audit_log_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_log_immutable' USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION public._protect_audit_log_history() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._protect_audit_log_history() TO service_role;
COMMENT ON FUNCTION public._protect_audit_log_history() IS 'Rejects authenticated audit-history mutation while permitting the service role to perform controlled synthetic fixture cleanup and operational retention.';