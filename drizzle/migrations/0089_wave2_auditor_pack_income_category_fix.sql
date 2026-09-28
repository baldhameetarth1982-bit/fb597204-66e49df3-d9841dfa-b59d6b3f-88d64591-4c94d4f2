DO $m$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.get_auditor_pack(uuid,date,date,text)'::regprocedure);
  d := replace(d, 'c.name AS category, i.payer_kind', 'c.display_name AS category, i.payer_kind');
  EXECUTE d;
END $m$;