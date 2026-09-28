-- Per-flat SaaS pricing: Starter(basic) ₹8, Growth(pro) ₹10, Pro(premium) ₹12 per flat/month.
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS price_per_flat_inr numeric(10,2) NOT NULL DEFAULT 0;
UPDATE public.plans SET price_per_flat_inr = CASE id WHEN 'basic' THEN 8 WHEN 'pro' THEN 10 WHEN 'premium' THEN 12 ELSE 0 END;
COMMENT ON COLUMN public.plans.price_monthly_inr IS 'DEPRECATED: flat per-society price retired; use price_per_flat_inr x billable flats (saas_subscription_quote).';

ALTER TABLE public.saas_subscription_order_requests
  ADD COLUMN IF NOT EXISTS flat_count integer,
  ADD COLUMN IF NOT EXISTS price_per_flat_inr numeric(10,2);
ALTER TABLE public.saas_subscription_payments
  ADD COLUMN IF NOT EXISTS flat_count integer,
  ADD COLUMN IF NOT EXISTS price_per_flat_inr numeric(10,2);

-- Authoritative quote. Billable flats = active flats of the society.
CREATE OR REPLACE FUNCTION public.saas_subscription_quote(_society_id uuid, _plan_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_threshold integer;
  v_flats integer;
  v_price numeric(10,2);
  v_name text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (public.is_society_admin_for(auth.uid(), _society_id) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT price_per_flat_inr, name INTO v_price, v_name FROM public.plans
   WHERE id = _plan_id AND id IN ('basic','pro','premium');
  IF v_price IS NULL OR v_price <= 0 THEN
    RAISE EXCEPTION 'plan_not_available' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(enterprise_threshold_units, 300) INTO v_threshold FROM public.pricing_settings WHERE id = 1;
  v_threshold := COALESCE(v_threshold, 300);
  SELECT count(*)::integer INTO v_flats FROM public.flats WHERE society_id = _society_id AND is_active;
  RETURN jsonb_build_object(
    'plan_id', _plan_id,
    'plan_name', v_name,
    'flat_count', v_flats,
    'price_per_flat_inr', v_price,
    'threshold', v_threshold,
    'custom_pricing', v_flats > v_threshold,
    'amount_paise', CASE WHEN v_flats > v_threshold OR v_flats = 0 THEN NULL
                         ELSE round(v_flats * v_price * 100)::integer END
  );
END $$;
REVOKE ALL ON FUNCTION public.saas_subscription_quote(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saas_subscription_quote(uuid, text) TO authenticated, service_role;

-- Claim: the database recomputes the amount; the caller's amount must match it.
CREATE OR REPLACE FUNCTION public.claim_saas_subscription_order(_request_id uuid, _society_id uuid, _plan_id text, _requested_by uuid, _amount_paise integer, _currency text, _provider_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.saas_subscription_order_requests%ROWTYPE;
  v_inserted integer := 0;
  v_quote jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF _amount_paise <= 0 OR _currency <> 'INR' OR _provider_mode NOT IN ('test','live') THEN
    RAISE EXCEPTION 'invalid_order_request' USING ERRCODE = '22023';
  END IF;
  v_quote := public.saas_subscription_quote(_society_id, _plan_id);
  IF (v_quote->>'custom_pricing')::boolean THEN
    RAISE EXCEPTION 'custom_pricing_required' USING ERRCODE = '22023';
  END IF;
  IF (v_quote->>'amount_paise') IS NULL THEN
    RAISE EXCEPTION 'no_billable_flats' USING ERRCODE = '22023';
  END IF;
  IF (v_quote->>'amount_paise')::integer <> _amount_paise THEN
    RAISE EXCEPTION 'amount_mismatch' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.saas_subscription_order_requests(
    request_id, society_id, plan_id, requested_by, amount_paise, currency, provider_mode, flat_count, price_per_flat_inr
  ) VALUES (_request_id, _society_id, _plan_id, _requested_by, _amount_paise, _currency, _provider_mode,
    (v_quote->>'flat_count')::integer, (v_quote->>'price_per_flat_inr')::numeric)
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
$function$;

CREATE OR REPLACE FUNCTION public.complete_saas_subscription_order(_request_record_id uuid, _razorpay_order_id text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    request_id, provider_mode, status, lifecycle_status, provider_status, flat_count, price_per_flat_inr
  ) VALUES (
    v_request.society_id, v_request.plan_id, v_request.requested_by, _razorpay_order_id,
    v_request.amount_paise, v_request.currency, v_request.request_id, v_request.provider_mode,
    'created', 'pending', 'created', v_request.flat_count, v_request.price_per_flat_inr
  ) ON CONFLICT (razorpay_order_id) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_payment_id;
  UPDATE public.saas_subscription_order_requests
     SET status = 'ready', razorpay_order_id = _razorpay_order_id, updated_at = now()
   WHERE id = v_request.id;
  RETURN v_payment_id;
END;
$function$;

-- Finalize: the expected amount is the server-quoted amount stored on the order (flat count may change after ordering).
CREATE OR REPLACE FUNCTION public.finalize_saas_subscription_payment(_society_id uuid, _plan_id text, _purchased_by uuid, _razorpay_order_id text, _razorpay_payment_id text, _amount_paise integer, _currency text, _provider_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
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
  IF _plan_id NOT IN ('basic','pro','premium') OR _amount_paise <= 0 OR _currency <> 'INR' OR _provider_status <> 'captured' THEN
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
        'razorpay_payment_id', _razorpay_payment_id, 'amount_paise', _amount_paise, 'currency', _currency,
        'flat_count', v_payment.flat_count, 'price_per_flat_inr', v_payment.price_per_flat_inr));
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
$function$;

-- Public plan list now returns per-flat price; monthly total only when a unit count is supplied.
DROP FUNCTION IF EXISTS public.get_applicable_plans(integer);
CREATE FUNCTION public.get_applicable_plans(_total_units integer DEFAULT NULL::integer)
 RETURNS TABLE(tier text, plan_id text, plan_name text, price_per_flat_inr numeric, price_monthly_inr integer, trial_days integer, features jsonb, is_recommended boolean, enterprise boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_threshold integer;
BEGIN
  SELECT enterprise_threshold_units INTO v_threshold FROM public.pricing_settings WHERE id = 1;
  IF _total_units IS NOT NULL AND _total_units > COALESCE(v_threshold, 300) THEN
    RETURN QUERY SELECT 'enterprise'::text, 'enterprise'::text, 'Custom pricing'::text,
      NULL::numeric, NULL::integer, 0, '{}'::jsonb, true, true;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT 'standard'::text, p.id, p.name, p.price_per_flat_inr,
           CASE WHEN _total_units IS NULL OR _total_units <= 0 THEN NULL
                ELSE round(p.price_per_flat_inr * _total_units)::integer END,
           p.trial_days, p.features, COALESCE(p.is_recommended,false), false
    FROM public.plans p
    WHERE p.id IN ('basic','pro','premium')
    ORDER BY p.sort_order;
END $function$;
GRANT EXECUTE ON FUNCTION public.get_applicable_plans(integer) TO anon, authenticated, service_role;

-- Super Admin MRR estimate follows per-flat pricing.
CREATE OR REPLACE FUNCTION public.admin_income_summary()
 RETURNS TABLE(subscription_mrr numeric, collected_total numeric, collected_30d numeric, total_revenue numeric, plans jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT coalesce(sum(p.price_per_flat_inr * (SELECT count(*) FROM public.flats f WHERE f.society_id = s.id AND f.is_active)),0)
    INTO subscription_mrr
    FROM public.societies s JOIN public.plans p ON p.id = s.plan_id
    WHERE s.plan_status = 'active' AND coalesce(s.status,'active') <> 'suspended'
      AND (s.plan_expires_at IS NULL OR s.plan_expires_at > now());
  SELECT coalesce(sum(amount_paise),0)/100.0 INTO collected_total
    FROM public.saas_subscription_payments WHERE lifecycle_status = 'captured';
  SELECT coalesce(sum(amount_paise),0)/100.0 INTO collected_30d
    FROM public.saas_subscription_payments WHERE lifecycle_status = 'captured' AND confirmed_at > now() - interval '30 days';
  total_revenue := collected_total;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'price_per_flat_inr',p.price_per_flat_inr,
           'society_count',(SELECT count(*) FROM public.societies s WHERE s.plan_id=p.id)) ORDER BY p.sort_order),'[]'::jsonb)
    INTO plans FROM public.plans p WHERE p.id NOT IN ('ad_free','resident');
  RETURN NEXT;
END $function$;