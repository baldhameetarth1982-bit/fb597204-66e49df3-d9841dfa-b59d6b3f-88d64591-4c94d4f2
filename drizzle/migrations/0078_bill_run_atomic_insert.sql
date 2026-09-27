CREATE OR REPLACE FUNCTION public.bill_run_insert_period(_society_id uuid, _period_start date, _period_end date, _rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n integer;
BEGIN
  IF jsonb_typeof(_rows) <> 'array' OR jsonb_array_length(_rows) = 0 THEN
    RETURN 0;
  END IF;
  -- Serialise every bill run for the same society + period.
  PERFORM pg_advisory_xact_lock(hashtextextended('bill_run:' || _society_id::text || ':' || _period_start::text || ':' || _period_end::text, 0));
  IF EXISTS (SELECT 1 FROM public.bills WHERE society_id = _society_id AND period_start = _period_start AND period_end = _period_end) THEN
    RETURN 0;
  END IF;
  INSERT INTO public.bills (society_id, flat_id, period_label, period_start, period_end, amount, due_date, status)
  SELECT _society_id, r.flat_id, r.period_label, _period_start, _period_end, r.amount, r.due_date, 'unpaid'
  FROM jsonb_to_recordset(_rows) AS r(flat_id uuid, period_label text, amount numeric, due_date date)
  WHERE EXISTS (SELECT 1 FROM public.flats f WHERE f.id = r.flat_id AND f.society_id = _society_id);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.bill_run_insert_period(uuid, date, date, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bill_run_insert_period(uuid, date, date, jsonb) TO service_role;