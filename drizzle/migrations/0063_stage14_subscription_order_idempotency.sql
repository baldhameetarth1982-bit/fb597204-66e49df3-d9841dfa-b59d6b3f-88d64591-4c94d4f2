CREATE TABLE public.saas_subscription_order_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  plan_id text NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL,
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  provider_mode text NOT NULL CHECK (provider_mode IN ('test','live')),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','ready','failed')),
  razorpay_order_id text UNIQUE,
  failure_code text,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requested_by, request_id)
);
GRANT SELECT ON public.saas_subscription_order_requests TO authenticated;
GRANT ALL ON public.saas_subscription_order_requests TO service_role;
ALTER TABLE public.saas_subscription_order_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plan managers read subscription order requests"
  ON public.saas_subscription_order_requests FOR SELECT TO authenticated
  USING (
    requested_by = auth.uid()
    AND public.current_user_has_society_permission(society_id, 'society.settings'::text, NULL::uuid)
  );
CREATE INDEX saas_subscription_order_requests_society_created_idx
  ON public.saas_subscription_order_requests (society_id, created_at DESC);

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
DECLARE v_row public.saas_subscription_order_requests%ROWTYPE;
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

  SELECT * INTO v_row FROM public.saas_subscription_order_requests
  WHERE requested_by = _requested_by AND request_id = _request_id FOR UPDATE;
  IF v_row.society_id <> _society_id OR v_row.plan_id <> _plan_id OR v_row.amount_paise <> _amount_paise
     OR v_row.currency <> _currency OR v_row.provider_mode <> _provider_mode THEN
    RAISE EXCEPTION 'order_request_conflict' USING ERRCODE = '23505';
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

CREATE OR REPLACE FUNCTION public.complete_saas_subscription_order(
  _request_record_id uuid,
  _razorpay_order_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_request public.saas_subscription_order_requests%ROWTYPE; v_payment_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF _razorpay_order_id !~ '^order_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'invalid_provider_reference' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_request FROM public.saas_subscription_order_requests WHERE id = _request_record_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_request_not_found'; END IF;
  IF v_request.razorpay_order_id IS NOT NULL AND v_request.razorpay_order_id <> _razorpay_order_id THEN
    RAISE EXCEPTION 'order_request_conflict' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.saas_subscription_payments(
    society_id, plan_id, purchased_by, razorpay_order_id, amount_paise, currency,
    request_id, provider_mode, status, lifecycle_status, provider_status
  ) VALUES (
    v_request.society_id, v_request.plan_id, v_request.requested_by, _razorpay_order_id,
    v_request.amount_paise, v_request.currency, v_request.request_id, v_request.provider_mode,
    'created', 'pending', 'created'
  ) ON CONFLICT (razorpay_order_id) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_payment_id;
  UPDATE public.saas_subscription_order_requests
     SET status = 'ready', razorpay_order_id = _razorpay_order_id, updated_at = now()
   WHERE id = v_request.id;
  RETURN v_payment_id;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_saas_subscription_order(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_saas_subscription_order(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.fail_saas_subscription_order(
  _request_record_id uuid,
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
  UPDATE public.saas_subscription_order_requests
     SET status = 'failed', failure_code = left(coalesce(_failure_code,'provider_error'), 80), updated_at = now()
   WHERE id = _request_record_id AND status = 'processing';
END;
$$;
REVOKE ALL ON FUNCTION public.fail_saas_subscription_order(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_saas_subscription_order(uuid,text) TO service_role;