CREATE OR REPLACE FUNCTION public._upi_rate_ok(_bucket text, _subject text, _limit int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ok boolean;
BEGIN
  SELECT allowed INTO ok FROM public.touch_rate_limit(_bucket, _subject, _limit, 3600);
  IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'rate_limited' USING ERRCODE='54000'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._upi_rate_ok(text,text,int) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.admin_set_society_upi(uuid,boolean,text,text,text,boolean)'::regprocedure);
  src := replace(src, 'PERFORM public.touch_rate_limit(''upi_cfg'', uid::text, 20, 3600);', 'PERFORM public._upi_rate_ok(''upi_cfg'', uid::text, 20);');
  EXECUTE src;
  src := pg_get_functiondef('public.submit_upi_qr_payment(uuid,text,text,text)'::regprocedure);
  src := replace(src, 'PERFORM public.touch_rate_limit(''upi_submit'', uid::text, 10, 3600);', 'PERFORM public._upi_rate_ok(''upi_submit'', uid::text, 10);');
  EXECUTE src;
END $$;