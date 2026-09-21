REVOKE TRUNCATE ON TABLE public.audit_log FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS audit_log_truncate_immutable ON public.audit_log;
CREATE TRIGGER audit_log_truncate_immutable
BEFORE TRUNCATE ON public.audit_log
FOR EACH STATEMENT
EXECUTE FUNCTION public._protect_audit_log_history();