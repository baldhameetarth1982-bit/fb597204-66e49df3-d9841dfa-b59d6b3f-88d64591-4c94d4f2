CREATE TABLE IF NOT EXISTS public.platform_payment_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  razorpay_locked boolean NOT NULL DEFAULT true,
  upi_enabled boolean NOT NULL DEFAULT true,
  upi_vpa text NOT NULL CHECK (upi_vpa ~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z0-9.-]{2,64}$'),
  payee_name text NOT NULL CHECK (char_length(payee_name) BETWEEN 2 AND 80 AND payee_name !~ '[<>{}]'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT ALL ON public.platform_payment_settings TO service_role;
ALTER TABLE public.platform_payment_settings ENABLE ROW LEVEL SECURITY;
INSERT INTO public.platform_payment_settings (id, upi_vpa, payee_name)
VALUES (true, '8264606535@fam', 'SociyoHub') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.saas_upi_payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  plan_id text NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  submitted_by uuid NOT NULL,
  pricing_type text NOT NULL CHECK (pricing_type IN ('standard','custom')),
  flat_count integer NOT NULL CHECK (flat_count > 0),
  price_per_flat_inr numeric(10,2) NOT NULL,
  term_months integer NOT NULL DEFAULT 1 CHECK (term_months BETWEEN 1 AND 36),
  custom_offer_id uuid REFERENCES public.custom_plan_offers(id),
  base_amount_paise bigint,
  tax_amount_paise bigint,
  tax_percent numeric,
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  payee_vpa text NOT NULL,
  utr text NOT NULL CHECK (utr ~ '^[A-Za-z0-9]{8,35}$'),
  payer_name text NOT NULL CHECK (char_length(payer_name) BETWEEN 2 AND 80 AND payer_name !~ '[<>{}]'),
  payer_upi text CHECK (payer_upi IS NULL OR payer_upi ~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z0-9.-]{2,64}$'),
  paid_at timestamptz NOT NULL,
  proof_path text NOT NULL CHECK (proof_path ~ '^saas-upi/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$'),
  consent_version text NOT NULL CHECK (char_length(consent_version) BETWEEN 1 AND 40),
  consent_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reject_code text CHECK (reject_code IS NULL OR reject_code IN ('short_paid','not_received','wrong_reference','unclear_proof','duplicate','other')),
  received_amount_paise integer CHECK (received_amount_paise IS NULL OR received_amount_paise >= 0),
  review_note text CHECK (review_note IS NULL OR char_length(review_note) <= 500),
  reviewed_by uuid,
  reviewed_at timestamptz,
  subscription_payment_id uuid REFERENCES public.saas_subscription_payments(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS saas_upi_utr_active_uidx
  ON public.saas_upi_payment_requests (upper(utr)) WHERE status IN ('pending','approved');
CREATE UNIQUE INDEX IF NOT EXISTS saas_upi_one_pending_per_society_uidx
  ON public.saas_upi_payment_requests (society_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS saas_upi_status_created_idx ON public.saas_upi_payment_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS saas_upi_society_created_idx ON public.saas_upi_payment_requests (society_id, created_at DESC);
GRANT ALL ON public.saas_upi_payment_requests TO service_role;
ALTER TABLE public.saas_upi_payment_requests ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._saas_upi_guard_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status <> 'pending' THEN RAISE EXCEPTION 'already_reviewed' USING ERRCODE = '22023'; END IF;
  IF NEW.status NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '22023'; END IF;
  IF NEW.amount_paise <> OLD.amount_paise OR NEW.utr <> OLD.utr OR NEW.proof_path <> OLD.proof_path
     OR NEW.society_id <> OLD.society_id OR NEW.plan_id <> OLD.plan_id OR NEW.submitted_by <> OLD.submitted_by THEN
    RAISE EXCEPTION 'immutable_fields' USING ERRCODE = '22023';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_saas_upi_guard ON public.saas_upi_payment_requests;
CREATE TRIGGER trg_saas_upi_guard BEFORE UPDATE ON public.saas_upi_payment_requests
  FOR EACH ROW EXECUTE FUNCTION public._saas_upi_guard_transition();
CREATE OR REPLACE FUNCTION public._saas_upi_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'append_only' USING ERRCODE = '42501'; END $$;
DROP TRIGGER IF EXISTS trg_saas_upi_no_delete ON public.saas_upi_payment_requests;
CREATE TRIGGER trg_saas_upi_no_delete BEFORE DELETE ON public.saas_upi_payment_requests
  FOR EACH ROW EXECUTE FUNCTION public._saas_upi_no_delete();

CREATE OR REPLACE FUNCTION public.get_saas_payment_methods() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT jsonb_build_object('razorpay_locked', razorpay_locked, 'upi_enabled', upi_enabled,
    'upi_vpa', upi_vpa, 'payee_name', payee_name) FROM public.platform_payment_settings WHERE id),
    jsonb_build_object('razorpay_locked', true, 'upi_enabled', false));
$$;
REVOKE ALL ON FUNCTION public.get_saas_payment_methods() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_saas_payment_methods() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_saas_payment_methods(_razorpay_locked boolean, _upi_enabled boolean, _upi_vpa text, _payee_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  UPDATE public.platform_payment_settings
     SET razorpay_locked = _razorpay_locked, upi_enabled = _upi_enabled, upi_vpa = trim(_upi_vpa),
         payee_name = trim(_payee_name), updated_at = now(), updated_by = auth.uid()
   WHERE id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, metadata)
  VALUES (auth.uid(), 'platform.payment_methods_updated', 'platform_payment_settings', 'singleton',
    jsonb_build_object('razorpay_locked', _razorpay_locked, 'upi_enabled', _upi_enabled, 'upi_vpa', trim(_upi_vpa)));
END $$;
REVOKE ALL ON FUNCTION public.admin_set_saas_payment_methods(boolean, boolean, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_saas_payment_methods(boolean, boolean, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_saas_upi_payment(
  _society_id uuid, _plan_id text, _flat_quantity integer, _request_id uuid, _expected_amount_paise integer,
  _utr text, _payer_name text, _payer_upi text, _paid_at timestamptz, _proof_path text, _consent_version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.platform_payment_settings%ROWTYPE; q jsonb; v_id uuid; v_existing public.saas_upi_payment_requests%ROWTYPE;
  v_amount integer; r record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_society_admin_for(auth.uid(), _society_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing FROM public.saas_upi_payment_requests WHERE request_id = _request_id;
  IF FOUND THEN
    IF v_existing.society_id <> _society_id OR v_existing.submitted_by <> auth.uid() THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('id', v_existing.id, 'status', v_existing.status, 'replayed', true);
  END IF;
  SELECT * INTO s FROM public.platform_payment_settings WHERE id;
  IF NOT FOUND OR NOT s.upi_enabled THEN RAISE EXCEPTION 'upi_unavailable' USING ERRCODE = '22023'; END IF;
  IF _plan_id NOT IN ('basic','pro','premium') THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023'; END IF;
  IF _paid_at > now() + interval '10 minutes' OR _paid_at < now() - interval '7 days' THEN
    RAISE EXCEPTION 'invalid_paid_at' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.saas_upi_payment_requests WHERE society_id = _society_id AND status = 'pending') THEN
    RAISE EXCEPTION 'already_pending' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.saas_upi_payment_requests WHERE upper(utr) = upper(_utr) AND status IN ('pending','approved')) THEN
    RAISE EXCEPTION 'duplicate_reference' USING ERRCODE = '23505';
  END IF;

  q := public.saas_subscription_quote(_society_id, _plan_id, _flat_quantity);
  IF COALESCE((q->>'custom_pricing')::boolean, false) OR q->>'amount_paise' IS NULL THEN
    RAISE EXCEPTION 'custom_pricing' USING ERRCODE = '22023';
  END IF;
  v_amount := (q->>'amount_paise')::integer;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'nothing_due' USING ERRCODE = '22023'; END IF;
  IF v_amount <> _expected_amount_paise THEN RAISE EXCEPTION 'price_changed' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.saas_upi_payment_requests(
    request_id, society_id, plan_id, submitted_by, pricing_type, flat_count, price_per_flat_inr, term_months,
    custom_offer_id, base_amount_paise, tax_amount_paise, tax_percent, amount_paise, payee_vpa,
    utr, payer_name, payer_upi, paid_at, proof_path, consent_version)
  VALUES (_request_id, _society_id, _plan_id, auth.uid(), COALESCE(q->>'pricing_type','standard'),
    (q->>'flat_count')::integer, (q->>'price_per_flat_inr')::numeric, COALESCE((q->>'term_months')::integer, 1),
    NULLIF(q->>'custom_offer_id','')::uuid, (q->>'base_amount_paise')::bigint, (q->>'tax_amount_paise')::bigint,
    (q->>'tax_percent')::numeric, v_amount, s.upi_vpa,
    upper(trim(_utr)), trim(_payer_name), NULLIF(trim(COALESCE(_payer_upi,'')),''), _paid_at, _proof_path, _consent_version)
  RETURNING id INTO v_id;

  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'subscription.upi_submitted', 'saas_upi_payment_requests', v_id::text, _society_id,
    jsonb_build_object('plan_id', _plan_id, 'amount_paise', v_amount, 'utr_last4', right(upper(_utr), 4)));

  FOR r IN SELECT DISTINCT user_id FROM public.user_roles WHERE role = 'super_admin' AND is_active LOOP
    PERFORM public._notify_user(r.user_id, NULL, 'subscription', 'New UPI plan payment to verify',
      'A society submitted ₹' || to_char(v_amount / 100.0, 'FM999999990.00') || ' for review.', '/admin/upi-payments');
  END LOOP;
  RETURN jsonb_build_object('id', v_id, 'status', 'pending', 'replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.submit_saas_upi_payment(uuid, text, integer, uuid, integer, text, text, text, timestamptz, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.submit_saas_upi_payment(uuid, text, integer, uuid, integer, text, text, text, timestamptz, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_saas_upi_payments(_society_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_society_admin_for(auth.uid(), _society_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
    SELECT id, plan_id, amount_paise, utr, status, reject_code, received_amount_paise, review_note, created_at, reviewed_at
      FROM public.saas_upi_payment_requests WHERE society_id = _society_id
     ORDER BY created_at DESC LIMIT 10) x), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.list_my_saas_upi_payments(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.list_my_saas_upi_payments(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_saas_upi_payments(_status text, _limit integer DEFAULT 50, _before timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
    SELECT r.id, r.society_id, so.name AS society_name, r.plan_id, p.name AS plan_name, r.flat_count,
           r.price_per_flat_inr, r.base_amount_paise, r.tax_amount_paise, r.tax_percent, r.amount_paise,
           r.payee_vpa, r.utr, r.payer_name, r.payer_upi, r.paid_at, r.status, r.reject_code,
           r.received_amount_paise, r.review_note, r.created_at, r.reviewed_at, r.term_months
      FROM public.saas_upi_payment_requests r
      JOIN public.societies so ON so.id = r.society_id
      JOIN public.plans p ON p.id = r.plan_id
     WHERE (_status IS NULL OR r.status = _status) AND (_before IS NULL OR r.created_at < _before)
     ORDER BY r.created_at DESC LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 100)) x), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.admin_list_saas_upi_payments(text, integer, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_saas_upi_payments(text, integer, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_saas_upi_proof_path(_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  RETURN (SELECT proof_path FROM public.saas_upi_payment_requests WHERE id = _id);
END $$;
REVOKE ALL ON FUNCTION public.admin_get_saas_upi_proof_path(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_saas_upi_proof_path(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_saas_upi_payment(
  _id uuid, _approve boolean, _reject_code text DEFAULT NULL, _received_amount_paise integer DEFAULT NULL, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.saas_upi_payment_requests%ROWTYPE; v_pay uuid; v_expires timestamptz; v_receipt text; o public.custom_plan_offers%ROWTYPE;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.saas_upi_payment_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = '22023'; END IF;
  IF r.status <> 'pending' THEN
    RETURN jsonb_build_object('status', r.status, 'replayed', true);
  END IF;
  IF _note IS NOT NULL AND char_length(_note) > 500 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023'; END IF;

  IF NOT _approve THEN
    IF _reject_code IS NULL THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
    UPDATE public.saas_upi_payment_requests
       SET status = 'rejected', reject_code = _reject_code, received_amount_paise = _received_amount_paise,
           review_note = NULLIF(trim(COALESCE(_note,'')),''), reviewed_by = auth.uid(), reviewed_at = now()
     WHERE id = _id;
    INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (auth.uid(), 'subscription.upi_rejected', 'saas_upi_payment_requests', _id::text, r.society_id,
      jsonb_build_object('reject_code', _reject_code, 'received_amount_paise', _received_amount_paise));
    PERFORM public._notify_user(r.submitted_by, r.society_id, 'subscription', 'Plan payment needs attention',
      CASE WHEN _reject_code = 'short_paid'
        THEN 'We received less than the plan total. Please pay the remaining amount and submit again.'
        ELSE 'We could not verify your UPI payment. Open Plan & billing to see why.' END,
      '/society/subscription');
    RETURN jsonb_build_object('status', 'rejected', 'replayed', false);
  END IF;

  INSERT INTO public.saas_subscription_payments(
    society_id, plan_id, purchased_by, razorpay_order_id, amount_paise, currency, status, lifecycle_status,
    provider_status, confirmed_at, flat_count, price_per_flat_inr, custom_offer_id, term_months)
  VALUES (r.society_id, r.plan_id, r.submitted_by, 'upi_' || replace(r.id::text, '-', ''), r.amount_paise, 'INR',
    'captured', 'captured', 'manual_upi_verified', now(), r.flat_count, r.price_per_flat_inr, r.custom_offer_id, r.term_months)
  RETURNING id INTO v_pay;

  IF r.custom_offer_id IS NOT NULL THEN
    SELECT * INTO o FROM public.custom_plan_offers WHERE id = r.custom_offer_id FOR UPDATE;
    IF o.status = 'accepted' THEN
      UPDATE public.custom_plan_offers SET status = 'superseded'
       WHERE society_id = r.society_id AND status = 'active' AND id <> o.id;
      UPDATE public.custom_plan_offers SET status = 'active', activated_at = now() WHERE id = o.id;
      UPDATE public.custom_plan_requests SET status = 'active', updated_at = now() WHERE id = o.request_id;
    END IF;
  END IF;
  UPDATE public.societies
     SET plan_id = r.plan_id, plan_status = 'active', plan_selected_at = now(),
         plan_expires_at = GREATEST(COALESCE(plan_expires_at, now()), now()) + make_interval(months => r.term_months),
         pricing_type = r.pricing_type, purchased_flat_quantity = r.flat_count,
         rate_per_flat_inr = r.price_per_flat_inr, custom_offer_id = r.custom_offer_id,
         subscription_term_months = r.term_months, updated_at = now()
   WHERE id = r.society_id
   RETURNING plan_expires_at INTO v_expires;

  INSERT INTO public.saas_subscription_receipts(payment_id, society_id, purchased_by, plan_id, receipt_number, amount_paise, currency)
  VALUES (v_pay, r.society_id, r.submitted_by, r.plan_id, public._allocate_saas_receipt_number(now()), r.amount_paise, 'INR')
  ON CONFLICT (payment_id) DO NOTHING;
  SELECT receipt_number INTO v_receipt FROM public.saas_subscription_receipts WHERE payment_id = v_pay;

  UPDATE public.saas_upi_payment_requests
     SET status = 'approved', subscription_payment_id = v_pay, review_note = NULLIF(trim(COALESCE(_note,'')),''),
         reviewed_by = auth.uid(), reviewed_at = now()
   WHERE id = _id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'subscription.upi_approved', 'saas_upi_payment_requests', _id::text, r.society_id,
    jsonb_build_object('payment_id', v_pay, 'plan_id', r.plan_id, 'amount_paise', r.amount_paise, 'receipt_number', v_receipt));
  PERFORM public._notify_user(r.submitted_by, r.society_id, 'subscription', 'Plan payment verified',
    'Your UPI payment was verified and your plan is active. Receipt ' || COALESCE(v_receipt, '') || '.', '/society/subscription');
  RETURN jsonb_build_object('status', 'approved', 'replayed', false, 'receipt_number', v_receipt, 'expires_at', v_expires);
END $$;
REVOKE ALL ON FUNCTION public.admin_review_saas_upi_payment(uuid, boolean, text, integer, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_saas_upi_payment(uuid, boolean, text, integer, text) TO authenticated;