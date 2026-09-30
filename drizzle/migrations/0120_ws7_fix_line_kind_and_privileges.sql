REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.bill_run_approvals, public.opening_balances, public.bill_adjustments FROM authenticated, anon;
REVOKE ALL ON public.bill_run_approvals, public.opening_balances, public.bill_adjustments FROM anon;

DO $m$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.finalize_bill_batch(uuid,uuid,text,text)'::regprocedure);
  IF position('SELECT _bill_id, _society_id, l.rule_type, h.name' IN d) = 0 THEN RAISE EXCEPTION 'finalize_shape_changed'; END IF;
  d := replace(d, 'SELECT _bill_id, _society_id, l.rule_type, h.name', 'SELECT _bill_id, _society_id, ''maintenance'', h.name');
  EXECUTE d;
END $m$;