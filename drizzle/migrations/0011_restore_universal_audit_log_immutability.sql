CREATE OR REPLACE FUNCTION public._protect_audit_log_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log_immutable' USING ERRCODE = '55000';
END;
$$;

REVOKE ALL ON FUNCTION public._protect_audit_log_history() FROM PUBLIC, anon, authenticated, service_role;

REVOKE UPDATE, DELETE ON TABLE public.audit_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.audit_log TO authenticated;
GRANT SELECT, INSERT ON TABLE public.audit_log TO service_role;

DROP TRIGGER IF EXISTS audit_log_immutable ON public.audit_log;
CREATE TRIGGER audit_log_immutable
BEFORE UPDATE OR DELETE ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION public._protect_audit_log_history();

COMMENT ON FUNCTION public._protect_audit_log_history() IS 'Rejects every audit_log update and deletion, including requests made with service-role privileges. Disposable test cleanup must destroy the isolated database or schema instead of mutating audit history.';
COMMENT ON TRIGGER audit_log_immutable ON public.audit_log IS 'Makes canonical audit history immutable for every application database role, including service_role.';