DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.list_society_residents_page(uuid,text,uuid,text,boolean,integer,integer)'::regprocedure);
  d := replace(d, 'f.moved_in_at, c.total_count', 'f.moved_in_at::timestamptz, c.total_count');
  EXECUTE d;
END $do$;