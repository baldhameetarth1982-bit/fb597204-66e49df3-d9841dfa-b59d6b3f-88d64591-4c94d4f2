ALTER TABLE public.saas_subscription_payments
  ADD COLUMN IF NOT EXISTS request_id uuid,
  ADD COLUMN IF NOT EXISTS provider_mode text,
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'created',
  ADD COLUMN IF NOT EXISTS failure_code text,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_reference text;

CREATE UNIQUE INDEX IF NOT EXISTS saas_subscription_payments_request_idx
  ON public.saas_subscription_payments (purchased_by, request_id)
  WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS saas_subscription_payments_lifecycle_idx
  ON public.saas_subscription_payments (society_id, lifecycle_status, created_at DESC);

ALTER TABLE public.saas_subscription_payments
  ADD CONSTRAINT saas_subscription_payments_provider_mode_check
  CHECK (provider_mode IS NULL OR provider_mode IN ('test','live')) NOT VALID;
ALTER TABLE public.saas_subscription_payments
  ADD CONSTRAINT saas_subscription_payments_lifecycle_check
  CHECK (lifecycle_status IN ('created','pending','processing','captured','failed','cancelled','refund_pending','refunded','reversed')) NOT VALID;

CREATE TABLE public.saas_subscription_receipt_sequences (
  period_yyyymm integer PRIMARY KEY,
  last_number integer NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.saas_subscription_receipt_sequences TO service_role;
ALTER TABLE public.saas_subscription_receipt_sequences ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.saas_subscription_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL UNIQUE REFERENCES public.saas_subscription_payments(id) ON DELETE RESTRICT,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  purchased_by uuid NOT NULL,
  plan_id text NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  receipt_number text NOT NULL UNIQUE,
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  status text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','void','refunded')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  void_reason text,
  refunded_at timestamptz
);
GRANT SELECT ON public.saas_subscription_receipts TO authenticated;
GRANT ALL ON public.saas_subscription_receipts TO service_role;
ALTER TABLE public.saas_subscription_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plan managers read subscription receipts"
  ON public.saas_subscription_receipts FOR SELECT TO authenticated
  USING (
    public.current_user_has_society_permission(society_id, 'society.settings'::text, NULL::uuid)
    OR public.current_user_is_super_admin()
  );
CREATE INDEX saas_subscription_receipts_society_issued_idx
  ON public.saas_subscription_receipts (society_id, issued_at DESC);

CREATE TABLE public.saas_payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'razorpay' CHECK (provider = 'razorpay'),
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  payment_id uuid REFERENCES public.saas_subscription_payments(id) ON DELETE RESTRICT,
  society_id uuid REFERENCES public.societies(id) ON DELETE RESTRICT,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  signature_verified boolean NOT NULL DEFAULT false,
  processing_status text NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received','processed','ignored','failed')),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  failure_code text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, provider_event_id)
);
GRANT SELECT ON public.saas_payment_events TO authenticated;
GRANT ALL ON public.saas_payment_events TO service_role;
ALTER TABLE public.saas_payment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super admins read subscription events"
  ON public.saas_payment_events FOR SELECT TO authenticated
  USING (public.current_user_is_super_admin());
CREATE INDEX saas_payment_events_payment_received_idx
  ON public.saas_payment_events (payment_id, received_at DESC);

CREATE TABLE public.saas_subscription_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.saas_subscription_payments(id) ON DELETE RESTRICT,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL,
  request_id uuid NOT NULL UNIQUE,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  provider_refund_id text UNIQUE,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','submitted','processed','failed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  failure_code text
);
GRANT SELECT ON public.saas_subscription_refunds TO authenticated;
GRANT ALL ON public.saas_subscription_refunds TO service_role;
ALTER TABLE public.saas_subscription_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super admins read subscription refunds"
  ON public.saas_subscription_refunds FOR SELECT TO authenticated
  USING (public.current_user_is_super_admin());
CREATE INDEX saas_subscription_refunds_payment_idx
  ON public.saas_subscription_refunds (payment_id, requested_at DESC);

CREATE OR REPLACE FUNCTION public._allocate_saas_receipt_number(_issued_at timestamptz DEFAULT now())
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period integer := to_char(_issued_at AT TIME ZONE 'Asia/Kolkata', 'YYYYMM')::integer;
  v_number integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
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
$$;
REVOKE ALL ON FUNCTION public._allocate_saas_receipt_number(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._allocate_saas_receipt_number(timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_saas_subscription_payment(
  _society_id uuid,
  _plan_id text,
  _purchased_by uuid,
  _razorpay_order_id text,
  _razorpay_payment_id text,
  _amount_paise integer,
  _currency text,
  _provider_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expected integer;
  v_payment public.saas_subscription_payments%ROWTYPE;
  v_receipt public.saas_subscription_receipts%ROWTYPE;
  v_expires_at timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF _razorpay_order_id !~ '^order_[A-Za-z0-9]+$' OR _razorpay_payment_id !~ '^pay_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'invalid_provider_reference' USING ERRCODE = '22023';
  END IF;
  SELECT round(price_monthly_inr * 100)::integer INTO v_expected
  FROM public.plans
  WHERE id = _plan_id AND id NOT IN ('trial', 'ad_free', 'resident');
  IF v_expected IS NULL OR v_expected <> _amount_paise OR _currency <> 'INR' OR _provider_status <> 'captured' THEN
    RAISE EXCEPTION 'invalid_subscription_payment' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_payment
  FROM public.saas_subscription_payments
  WHERE razorpay_order_id = _razorpay_order_id
  FOR UPDATE;
  IF NOT FOUND OR v_payment.society_id <> _society_id OR v_payment.plan_id <> _plan_id
     OR v_payment.purchased_by <> _purchased_by OR v_payment.amount_paise <> _amount_paise
     OR v_payment.currency <> _currency
     OR (v_payment.razorpay_payment_id IS NOT NULL AND v_payment.razorpay_payment_id <> _razorpay_payment_id) THEN
    RAISE EXCEPTION 'subscription_payment_conflict' USING ERRCODE = '23505';
  END IF;
  IF v_payment.lifecycle_status IN ('refunded','reversed') THEN
    RAISE EXCEPTION 'invalid_subscription_transition' USING ERRCODE = '22023';
  END IF;

  IF v_payment.lifecycle_status <> 'captured' THEN
    UPDATE public.saas_subscription_payments
       SET razorpay_payment_id = _razorpay_payment_id,
           status = 'captured', lifecycle_status = 'captured', provider_status = _provider_status,
           confirmed_at = COALESCE(confirmed_at, now()), failure_code = NULL, failed_at = NULL, updated_at = now()
     WHERE id = v_payment.id;

    UPDATE public.societies
       SET plan_id = _plan_id, plan_status = 'active', plan_selected_at = now(),
           plan_expires_at = GREATEST(COALESCE(plan_expires_at, now()), now()) + interval '1 month',
           updated_at = now()
     WHERE id = _society_id
     RETURNING plan_expires_at INTO v_expires_at;

    INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (_purchased_by, 'subscription.payment_confirmed', 'saas_subscription_payments', v_payment.id::text, _society_id,
      jsonb_build_object('plan_id', _plan_id, 'razorpay_order_id', _razorpay_order_id,
        'razorpay_payment_id', _razorpay_payment_id, 'amount_paise', _amount_paise, 'currency', _currency));
  ELSE
    SELECT plan_expires_at INTO v_expires_at FROM public.societies WHERE id = _society_id;
  END IF;

  INSERT INTO public.saas_subscription_receipts(
    payment_id, society_id, purchased_by, plan_id, receipt_number, amount_paise, currency
  ) VALUES (
    v_payment.id, _society_id, _purchased_by, _plan_id, public._allocate_saas_receipt_number(now()), _amount_paise, _currency
  ) ON CONFLICT (payment_id) DO NOTHING;
  SELECT * INTO v_receipt FROM public.saas_subscription_receipts WHERE payment_id = v_payment.id;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_payment.lifecycle_status = 'captured' THEN 'already_confirmed' ELSE 'success' END,
    'payment_id', v_payment.id,
    'receipt_id', v_receipt.id,
    'receipt_number', v_receipt.receipt_number,
    'expires_at', v_expires_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_saas_subscription_payment(uuid,text,uuid,text,text,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_saas_subscription_payment(uuid,text,uuid,text,text,integer,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_saas_subscription_refund(
  _payment_id uuid,
  _provider_refund_id text,
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
  v_new_expiry timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF _provider_refund_id !~ '^rfnd_[A-Za-z0-9]+$' OR char_length(btrim(_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'invalid_refund' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_payment FROM public.saas_subscription_payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND OR v_payment.lifecycle_status <> 'captured' OR v_payment.razorpay_payment_id IS NULL THEN
    RAISE EXCEPTION 'payment_not_refundable' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.saas_subscription_refunds(
    payment_id, society_id, requested_by, request_id, reason, amount_paise, currency,
    provider_refund_id, status, processed_at
  ) VALUES (
    v_payment.id, v_payment.society_id, _requested_by, _request_id, btrim(_reason),
    v_payment.amount_paise, v_payment.currency, _provider_refund_id, 'processed', now()
  ) ON CONFLICT (request_id) DO NOTHING;
  SELECT * INTO v_refund FROM public.saas_subscription_refunds WHERE request_id = _request_id;
  IF v_refund.payment_id <> _payment_id OR v_refund.provider_refund_id <> _provider_refund_id THEN
    RAISE EXCEPTION 'refund_conflict' USING ERRCODE = '23505';
  END IF;

  UPDATE public.saas_subscription_payments
     SET lifecycle_status = 'refunded', provider_status = 'refunded', refunded_at = COALESCE(refunded_at, now()),
         refund_reference = _provider_refund_id, updated_at = now()
   WHERE id = v_payment.id AND lifecycle_status = 'captured';
  UPDATE public.saas_subscription_receipts
     SET status = 'refunded', refunded_at = COALESCE(refunded_at, now())
   WHERE payment_id = v_payment.id AND status = 'valid';

  IF NOT EXISTS (
    SELECT 1 FROM public.saas_subscription_payments later
    WHERE later.society_id = v_payment.society_id AND later.lifecycle_status = 'captured'
      AND later.confirmed_at > v_payment.confirmed_at
  ) THEN
    UPDATE public.societies
       SET plan_expires_at = GREATEST(now(), COALESCE(plan_expires_at, now()) - interval '1 month'),
           plan_status = CASE WHEN COALESCE(plan_expires_at, now()) - interval '1 month' <= now() THEN 'canceled' ELSE plan_status END,
           updated_at = now()
     WHERE id = v_payment.society_id
     RETURNING plan_expires_at INTO v_new_expiry;
  END IF;

  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (_requested_by, 'subscription.payment_refunded', 'saas_subscription_payments', v_payment.id::text,
    v_payment.society_id, jsonb_build_object('provider_refund_id', _provider_refund_id,
      'amount_paise', v_payment.amount_paise, 'currency', v_payment.currency, 'reason', btrim(_reason)));

  RETURN jsonb_build_object('status', 'refunded', 'refund_id', v_refund.id, 'expires_at', v_new_expiry);
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_saas_subscription_refund(uuid,text,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_saas_subscription_refund(uuid,text,uuid,uuid,text) TO service_role;

COMMENT ON COLUMN public.pricing_settings.active_gateway IS 'DEPRECATED: unused legacy gateway selector; Razorpay SaaS checkout uses platform configuration and server secrets.';