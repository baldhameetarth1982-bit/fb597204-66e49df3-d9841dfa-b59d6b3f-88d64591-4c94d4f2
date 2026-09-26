CREATE TABLE public.saas_subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  plan_id text NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  purchased_by uuid NOT NULL,
  razorpay_order_id text NOT NULL UNIQUE,
  razorpay_payment_id text UNIQUE,
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','captured','failed')),
  provider_status text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.saas_subscription_payments TO authenticated;
GRANT ALL ON public.saas_subscription_payments TO service_role;
ALTER TABLE public.saas_subscription_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "society admins read SaaS subscription payments"
ON public.saas_subscription_payments
FOR SELECT TO authenticated
USING (public.current_user_has_society_permission(society_id, 'society.settings'::text, NULL::uuid));

CREATE INDEX saas_subscription_payments_society_created_idx
ON public.saas_subscription_payments (society_id, created_at DESC);

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
  IF current_user <> 'service_role' THEN
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

  INSERT INTO public.audit_log (user_id, action, target_table, target_id, society_id, metadata)
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