REVOKE INSERT ON TABLE public.audit_log FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON TABLE public.audit_log FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.audit_log TO authenticated;
GRANT SELECT, INSERT ON TABLE public.audit_log TO service_role;

COMMENT ON TABLE public.audit_log IS 'Append-only canonical audit history. Browser roles cannot insert, update, or delete rows; canonical server-side writers append with service-role privileges, and configured RLS policies govern authenticated reads.';