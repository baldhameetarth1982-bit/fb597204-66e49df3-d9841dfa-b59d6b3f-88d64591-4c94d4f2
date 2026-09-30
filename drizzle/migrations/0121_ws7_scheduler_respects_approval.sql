DO $m$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.bill_run_insert_period(uuid,date,date,jsonb)'::regprocedure);
  IF position('-- Serialise every bill run' IN d) = 0 THEN RAISE EXCEPTION 'shape_changed'; END IF;
  d := replace(d, '-- Serialise every bill run',
    '-- Societies requiring a second approver only bill through the reviewed, approved run.
  IF EXISTS (SELECT 1 FROM public.society_settings WHERE society_id = _society_id AND coalesce(bill_run_approval_required,false)) THEN
    RETURN 0;
  END IF;
  -- Serialise every bill run');
  EXECUTE d;
END $m$;