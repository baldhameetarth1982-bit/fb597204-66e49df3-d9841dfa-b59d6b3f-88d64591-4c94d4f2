DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.get_auditor_pack_extras'::regproc);
  d := replace(d, 'm.scheduled_at', 'm.starts_at');
  EXECUTE d;
END $do$;