CREATE OR REPLACE FUNCTION public._allocate_saas_receipt_number(_issued_at timestamp with time zone DEFAULT now())
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_period integer := to_char(_issued_at AT TIME ZONE 'Asia/Kolkata', 'YYYYMM')::integer;
  v_number integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.saas_subscription_receipt_sequences(period_yyyymm, last_number)
  VALUES (v_period, 1)
  ON CONFLICT (period_yyyymm) DO UPDATE
    SET last_number = public.saas_subscription_receipt_sequences.last_number + 1,
        updated_at = now()
  RETURNING last_number INTO v_number;
  RETURN 'SH/' || v_period::text || '/' || lpad(v_number::text, 5, '0');
END;
$function$;