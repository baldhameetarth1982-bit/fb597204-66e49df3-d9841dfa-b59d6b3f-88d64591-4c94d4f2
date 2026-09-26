CREATE OR REPLACE FUNCTION public.claim_saas_subscription_refund(
  _payment_id uuid,
  _request_id uuid,
  _requested_by uuid,
  _reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment public.saas_subscription_payments%ROWTYPE;
  v_refund public.saas_subscription_refunds%ROWTYPE;
  v_inserted integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'invalid_refund_reason' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_payment FROM public.saas_subscription_payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND OR v_payment.lifecycle_status <> 'captured' OR v_payment.razorpay_payment_id IS NULL THEN
    RAISE EXCEPTION 'payment_not_refundable' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.saas_subscription_refunds(
    payment_id, society_id, requested_by, request_id, reason, amount_paise, currency, status
  ) VALUES (
    v_payment.id, v_payment.society_id, _requested_by, _request_id, btrim(_reason),
    v_payment.amount_paise, v_payment.currency, 'requested'
  ) ON CONFLICT (request_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  SELECT * INTO v_refund FROM public.saas_subscription_refunds WHERE request_id = _request_id FOR UPDATE;
  IF v_refund.payment_id <> _payment_id OR v_refund.requested_by <> _requested_by THEN
    RAISE EXCEPTION 'refund_request_conflict' USING ERRCODE = '23505';
  END IF;
  RETURN jsonb_build_object(
    'status', CASE WHEN v_inserted = 1 THEN 'claimed' ELSE v_refund.status END,
    'refund_record_id', v_refund.id,
    'provider_refund_id', v_refund.provider_refund_id,
    'provider_payment_id', v_payment.razorpay_payment_id,
    'amount_paise', v_payment.amount_paise,
    'currency', v_payment.currency
  );
END;
$$;
REVOKE ALL ON FUNCTION public.claim_saas_subscription_refund(uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_saas_subscription_refund(uuid,uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.fail_saas_subscription_refund(
  _refund_record_id uuid,
  _failure_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.saas_subscription_refunds
     SET status = 'failed', failure_code = left(coalesce(_failure_code,'provider_error'), 80)
   WHERE id = _refund_record_id AND status IN ('requested','submitted');
END;
$$;
REVOKE ALL ON FUNCTION public.fail_saas_subscription_refund(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_saas_subscription_refund(uuid,text) TO service_role;