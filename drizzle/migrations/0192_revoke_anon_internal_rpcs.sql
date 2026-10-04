REVOKE EXECUTE ON FUNCTION public._caller_society() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public._helpdesk_report_scope() FROM anon, public;
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('admin_moderate_vendor_rating','admin_rate_vendor_service','helpdesk_report','helpdesk_report_rows','vendor_performance','vendor_rate_ticket','vendor_rating_history','vendor_rating_status','vendor_service_log_unrated')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, public', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f.sig);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public._caller_society() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._helpdesk_report_scope() TO authenticated, service_role;