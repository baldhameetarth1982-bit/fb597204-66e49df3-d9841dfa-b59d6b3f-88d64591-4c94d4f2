CREATE OR REPLACE FUNCTION public.claim_saas_subscription_order(
  _request_id uuid,
  _society_id uuid,
  _plan_id text,
  _requested_by uuid,
  _amount_paise integer,
  _currency text,
  _provider_mode text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.saas_subscription_order_requests%ROWTYPE;
  v_inserted integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF _amount_paise <= 0 OR _currency <> 'INR' OR _provider_mode NOT IN ('test','live') THEN
    RAISE EXCEPTION 'invalid_order_request' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.saas_subscription_order_requests(
    request_id, society_id, plan_id, requested_by, amount_paise, currency, provider_mode
  ) VALUES (_request_id, _society_id, _plan_id, _requested_by, _amount_paise, _currency, _provider_mode)
  ON CONFLICT (requested_by, request_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  SELECT * INTO v_row FROM public.saas_subscription_order_requests
  WHERE requested_by = _requested_by AND request_id = _request_id FOR UPDATE;
  IF v_row.society_id <> _society_id OR v_row.plan_id <> _plan_id OR v_row.amount_paise <> _amount_paise
     OR v_row.currency <> _currency OR v_row.provider_mode <> _provider_mode THEN
    RAISE EXCEPTION 'order_request_conflict' USING ERRCODE = '23505';
  END IF;
  IF v_inserted = 1 THEN
    RETURN jsonb_build_object('status','claimed','request_record_id',v_row.id);
  END IF;
  IF v_row.status = 'failed' THEN
    UPDATE public.saas_subscription_order_requests
       SET status = 'processing', failure_code = NULL, attempt_count = attempt_count + 1, updated_at = now()
     WHERE id = v_row.id;
    RETURN jsonb_build_object('status','claimed','request_record_id',v_row.id);
  END IF;
  RETURN jsonb_build_object(
    'status', CASE WHEN v_row.razorpay_order_id IS NULL THEN 'processing' ELSE 'ready' END,
    'request_record_id', v_row.id,
    'razorpay_order_id', v_row.razorpay_order_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.claim_saas_subscription_order(uuid,uuid,text,uuid,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_saas_subscription_order(uuid,uuid,text,uuid,integer,text,text) TO service_role;