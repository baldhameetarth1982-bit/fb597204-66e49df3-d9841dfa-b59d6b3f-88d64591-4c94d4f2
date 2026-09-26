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
SET search_path = public
AS $$
DECLARE
  v_expected integer;
  v_existing public.saas_subscription_payments%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT (price_monthly_inr * 100)::integer INTO v_expected
  FROM public.plans
  WHERE id = _plan_id AND id NOT IN ('trial', 'ad_free', 'resident');

  IF v_expected IS NULL OR v_expected <> _amount_paise OR _currency <> 'INR' OR _provider_status <> 'captured' THEN
    RAISE EXCEPTION 'invalid_subscription_payment' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM public.saas_subscription_payments
  WHERE razorpay_payment_id = _razorpay_payment_id
     OR razorpay_order_id = _razorpay_order_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.society_id <> _society_id
       OR v_existing.plan_id <> _plan_id
       OR v_existing.amount_paise <> _amount_paise
       OR (v_existing.razorpay_payment_id IS NOT NULL AND v_existing.razorpay_payment_id <> _razorpay_payment_id) THEN
      RAISE EXCEPTION 'subscription_payment_conflict' USING ERRCODE = '23505';
    END IF;
    IF v_existing.status = 'captured' THEN
      RETURN jsonb_build_object('status', 'already_confirmed', 'expires_at', (SELECT plan_expires_at FROM public.societies WHERE id = _society_id));
    END IF;
  ELSE
    INSERT INTO public.saas_subscription_payments (
      society_id, plan_id, purchased_by, razorpay_order_id, razorpay_payment_id,
      amount_paise, currency, status, provider_status, confirmed_at
    ) VALUES (
      _society_id, _plan_id, _purchased_by, _razorpay_order_id, _razorpay_payment_id,
      _amount_paise, _currency, 'captured', _provider_status, now()
    );
  END IF;

  UPDATE public.saas_subscription_payments
  SET razorpay_payment_id = _razorpay_payment_id,
      status = 'captured', provider_status = _provider_status,
      confirmed_at = COALESCE(confirmed_at, now()), updated_at = now()
  WHERE razorpay_order_id = _razorpay_order_id;

  UPDATE public.societies
  SET plan_id = _plan_id,
      plan_status = 'active',
      plan_selected_at = now(),
      plan_expires_at = GREATEST(COALESCE(plan_expires_at, now()), now()) + interval '1 month'
  WHERE id = _society_id;

  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (
    _purchased_by, 'subscription.payment_confirmed', 'societies', _society_id::text, _society_id,
    jsonb_build_object('plan_id', _plan_id, 'razorpay_order_id', _razorpay_order_id,
      'razorpay_payment_id', _razorpay_payment_id, 'amount_paise', _amount_paise, 'currency', _currency)
  );

  RETURN jsonb_build_object('status', 'success', 'expires_at', (SELECT plan_expires_at FROM public.societies WHERE id = _society_id));
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_saas_subscription_payment(uuid,text,uuid,text,text,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_saas_subscription_payment(uuid,text,uuid,text,text,integer,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.is_login_account_locked(
  _subject text,
  _window_seconds integer DEFAULT 900,
  _max_failures integer DEFAULT 5
)
RETURNS TABLE(locked boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_cutoff timestamptz;
  v_failures integer;
  v_oldest timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF _window_seconds < 1 OR _max_failures < 1 OR length(_subject) < 1 THEN
    RAISE EXCEPTION 'invalid_lock_parameters' USING ERRCODE = '22023';
  END IF;

  v_cutoff := v_now - make_interval(secs => _window_seconds);
  DELETE FROM public.rate_limits
  WHERE bucket = 'login:fail' AND subject = _subject AND window_start <= v_cutoff;

  SELECT COALESCE(sum(count), 0)::integer, min(window_start)
  INTO v_failures, v_oldest
  FROM public.rate_limits
  WHERE bucket = 'login:fail' AND subject = _subject AND window_start > v_cutoff;

  locked := v_failures >= _max_failures;
  retry_after_seconds := CASE
    WHEN locked AND v_oldest IS NOT NULL THEN GREATEST(1, ceil(extract(epoch FROM (v_oldest + make_interval(secs => _window_seconds) - v_now)))::integer)
    ELSE 0
  END;
  RETURN NEXT;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.is_login_account_locked(text,integer,integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_login_account_locked(text,integer,integer) TO service_role;