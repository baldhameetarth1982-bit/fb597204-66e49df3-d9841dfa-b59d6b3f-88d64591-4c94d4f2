DO $do$ DECLARE d text; BEGIN
  SELECT pg_get_functiondef('public.get_society_register(text,text,integer)'::regprocedure) INTO d;
  d := replace(d, $x$('owner','self','primary')$x$, $x$('owner','co-owner')$x$);
  EXECUTE d;
END $do$;