-- Plan changes: renewals start after the current paid period / trial, cheaper or
-- different plans start next period, upgrades now pay only the remaining days.
ALTER TABLE public.societies
  ADD COLUMN IF NOT EXISTS scheduled_plan_id text,
  ADD COLUMN IF NOT EXISTS scheduled_plan_starts_at timestamptz;
ALTER TABLE public.societies DROP CONSTRAINT IF EXISTS societies_scheduled_plan_check;
ALTER TABLE public.societies ADD CONSTRAINT societies_scheduled_plan_check
  CHECK ((scheduled_plan_id IS NULL AND scheduled_plan_starts_at IS NULL)
      OR (scheduled_plan_id IN ('basic','pro','premium') AND scheduled_plan_starts_at IS NOT NULL));
CREATE INDEX IF NOT EXISTS societies_scheduled_plan_due_idx ON public.societies (scheduled_plan_starts_at) WHERE scheduled_plan_id IS NOT NULL;

ALTER TABLE public.saas_upi_payment_requests
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'term',
  ADD COLUMN IF NOT EXISTS upgrade_from_plan_id text,
  ADD COLUMN IF NOT EXISTS upgrade_days integer;
ALTER TABLE public.saas_upi_payment_requests DROP CONSTRAINT IF EXISTS saas_upi_kind_check;
ALTER TABLE public.saas_upi_payment_requests ADD CONSTRAINT saas_upi_kind_check
  CHECK ((kind = 'term' AND upgrade_from_plan_id IS NULL AND upgrade_days IS NULL)
      OR (kind = 'upgrade' AND upgrade_from_plan_id IN ('basic','pro','premium') AND upgrade_days BETWEEN 1 AND 400));

-- Users can never write the new schedule columns directly.
CREATE OR REPLACE FUNCTION public._societies_protect_saas_columns()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated','anon') OR public.is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.plan := 'basic'; NEW.plan_id := 'trial'; NEW.plan_status := 'none';
    NEW.plan_expires_at := NULL; NEW.plan_selected_at := NULL;
    NEW.trial_ends_at := now() + interval '14 days'; NEW.trial_consumed_at := NULL;
    NEW.status := 'pending'; NEW.billing_active := true;
    NEW.razorpay_account_id := NULL; NEW.payout_status := 'not_setup';
    NEW.payout_bank_last4 := NULL; NEW.payout_holder_name := NULL;
    NEW.pricing_type := 'standard'; NEW.purchased_flat_quantity := NULL; NEW.rate_per_flat_inr := NULL;
    NEW.custom_offer_id := NULL; NEW.subscription_term_months := NULL;
    NEW.scheduled_plan_id := NULL; NEW.scheduled_plan_starts_at := NULL;
    RETURN NEW;
  END IF;
  IF NEW.plan IS DISTINCT FROM OLD.plan OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
     OR NEW.plan_status IS DISTINCT FROM OLD.plan_status OR NEW.plan_expires_at IS DISTINCT FROM OLD.plan_expires_at
     OR NEW.plan_selected_at IS DISTINCT FROM OLD.plan_selected_at OR NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
     OR NEW.trial_consumed_at IS DISTINCT FROM OLD.trial_consumed_at OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.billing_active IS DISTINCT FROM OLD.billing_active OR NEW.razorpay_account_id IS DISTINCT FROM OLD.razorpay_account_id
     OR NEW.payout_status IS DISTINCT FROM OLD.payout_status OR NEW.payout_bank_last4 IS DISTINCT FROM OLD.payout_bank_last4
     OR NEW.payout_holder_name IS DISTINCT FROM OLD.payout_holder_name
     OR NEW.pricing_type IS DISTINCT FROM OLD.pricing_type OR NEW.purchased_flat_quantity IS DISTINCT FROM OLD.purchased_flat_quantity
     OR NEW.rate_per_flat_inr IS DISTINCT FROM OLD.rate_per_flat_inr OR NEW.custom_offer_id IS DISTINCT FROM OLD.custom_offer_id
     OR NEW.subscription_term_months IS DISTINCT FROM OLD.subscription_term_months
     OR NEW.scheduled_plan_id IS DISTINCT FROM OLD.scheduled_plan_id
     OR NEW.scheduled_plan_starts_at IS DISTINCT FROM OLD.scheduled_plan_starts_at THEN
    RAISE EXCEPTION 'protected_society_columns' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $function$;

-- Paid time that has already started (scheduled plan whose start passed) keeps access
-- even before the hourly switch job runs.
CREATE OR REPLACE FUNCTION public.is_active_society_plan(_society_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.societies s
    WHERE s.id = _society_id
      AND COALESCE(s.status, 'active') = 'active'
      AND (
        (s.plan_status = 'active'
          AND COALESCE(NULLIF(s.plan_id, ''), '') <> ''
          AND COALESCE(s.plan_expires_at, now() + interval '100 years') > now())
        OR (s.plan_status = 'trialing' AND s.trial_ends_at IS NOT NULL AND s.trial_ends_at > now())
        OR (s.scheduled_plan_id IS NOT NULL AND s.scheduled_plan_starts_at <= now()
            AND s.plan_expires_at IS NOT NULL AND s.plan_expires_at > now())
      )
  );
$function$;

-- What a term purchase of _plan_id would do right now. Read-only.
CREATE OR REPLACE FUNCTION public._saas_term_effect(_society_id uuid, _plan_id text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s public.societies%ROWTYPE; v_paid boolean; v_trial boolean; v_next text;
BEGIN
  SELECT * INTO s FROM public.societies WHERE id = _society_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = '22023'; END IF;
  v_paid := s.plan_status = 'active' AND s.plan_expires_at > now() AND COALESCE(s.plan_id,'') IN ('basic','pro','premium');
  v_trial := NOT v_paid AND s.plan_status IN ('trial','trialing') AND s.trial_ends_at > now();
  IF v_paid THEN
    v_next := COALESCE(s.scheduled_plan_id, s.plan_id);
    IF _plan_id = v_next THEN
      RETURN jsonb_build_object('effect', 'extend', 'starts_at', s.plan_expires_at);
    ELSIF s.scheduled_plan_id IS NOT NULL THEN
      RETURN jsonb_build_object('effect', 'blocked', 'reason', 'plan_change_already_scheduled');
    END IF;
    RETURN jsonb_build_object('effect', 'schedule', 'starts_at', s.plan_expires_at);
  ELSIF v_trial THEN
    IF s.scheduled_plan_id IS NOT NULL AND s.scheduled_plan_id <> _plan_id THEN
      RETURN jsonb_build_object('effect', 'blocked', 'reason', 'plan_change_already_scheduled');
    END IF;
    RETURN jsonb_build_object('effect', CASE WHEN s.scheduled_plan_id IS NULL THEN 'after_trial' ELSE 'extend' END,
      'starts_at', COALESCE(s.plan_expires_at, s.trial_ends_at));
  END IF;
  RETURN jsonb_build_object('effect', 'start_now', 'starts_at', now());
END $function$;

-- Apply a paid term. Never overlaps: starts after the current paid period or trial.
CREATE OR REPLACE FUNCTION public._saas_apply_paid_term(_society_id uuid, _plan_id text, _months integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE e jsonb; s public.societies%ROWTYPE; v_exp timestamptz;
BEGIN
  IF _plan_id NOT IN ('basic','pro','premium') OR _months NOT BETWEEN 1 AND 36 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM public.societies WHERE id = _society_id FOR UPDATE;
  e := public._saas_term_effect(_society_id, _plan_id);
  CASE e->>'effect'
    WHEN 'blocked' THEN RAISE EXCEPTION 'plan_change_already_scheduled' USING ERRCODE = '22023';
    WHEN 'extend' THEN
      UPDATE public.societies SET plan_expires_at = COALESCE(plan_expires_at, trial_ends_at) + make_interval(months => _months)
       WHERE id = _society_id RETURNING plan_expires_at INTO v_exp;
    WHEN 'schedule' THEN
      UPDATE public.societies SET scheduled_plan_id = _plan_id, scheduled_plan_starts_at = plan_expires_at,
             plan_expires_at = plan_expires_at + make_interval(months => _months)
       WHERE id = _society_id RETURNING plan_expires_at INTO v_exp;
    WHEN 'after_trial' THEN
      UPDATE public.societies SET scheduled_plan_id = _plan_id, scheduled_plan_starts_at = trial_ends_at,
             plan_expires_at = trial_ends_at + make_interval(months => _months)
       WHERE id = _society_id RETURNING plan_expires_at INTO v_exp;
    ELSE
      UPDATE public.societies SET plan_id = _plan_id, plan_status = 'active', plan_selected_at = now(),
             scheduled_plan_id = NULL, scheduled_plan_starts_at = NULL,
             plan_expires_at = now() + make_interval(months => _months)
       WHERE id = _society_id RETURNING plan_expires_at INTO v_exp;
  END CASE;
  RETURN e || jsonb_build_object('expires_at', v_exp);
END $function$;
REVOKE ALL ON FUNCTION public._saas_term_effect(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._saas_apply_paid_term(uuid, text, integer) FROM PUBLIC, anon, authenticated;

-- Remaining-days upgrade price (higher plan only, while a paid period is running).
CREATE OR REPLACE FUNCTION public._saas_upgrade_quote(_society_id uuid, _plan_id text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s public.societies%ROWTYPE; q jsonb; v_cur numeric; v_new numeric; v_days integer; v_flats integer;
  v_base bigint; v_taxp numeric; v_tax bigint;
BEGIN
  SELECT * INTO s FROM public.societies WHERE id = _society_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = '22023'; END IF;
  IF NOT (s.plan_status = 'active' AND s.plan_expires_at > now() AND COALESCE(s.plan_id,'') IN ('basic','pro','premium')) THEN
    RETURN jsonb_build_object('available', false, 'reason', 'no_paid_period');
  END IF;
  IF s.scheduled_plan_id IS NOT NULL THEN RETURN jsonb_build_object('available', false, 'reason', 'plan_change_already_scheduled'); END IF;
  IF COALESCE(s.pricing_type,'standard') = 'custom' THEN RETURN jsonb_build_object('available', false, 'reason', 'custom_pricing'); END IF;
  SELECT price_per_flat_inr INTO v_cur FROM public.plans WHERE id = s.plan_id;
  SELECT price_per_flat_inr INTO v_new FROM public.plans WHERE id = _plan_id;
  IF v_cur IS NULL OR v_new IS NULL OR v_new <= v_cur THEN RETURN jsonb_build_object('available', false, 'reason', 'not_higher'); END IF;
  q := public.saas_subscription_quote(_society_id, _plan_id, NULL);
  IF COALESCE((q->>'custom_pricing')::boolean, false) THEN RETURN jsonb_build_object('available', false, 'reason', 'custom_pricing'); END IF;
  v_flats := GREATEST(COALESCE((q->>'flat_count')::integer, 0), COALESCE(s.purchased_flat_quantity, 0));
  IF v_flats <= 0 THEN RETURN jsonb_build_object('available', false, 'reason', 'no_flats'); END IF;
  v_days := LEAST(GREATEST(ceil(extract(epoch FROM s.plan_expires_at - now()) / 86400)::integer, 1), 400);
  v_base := round(v_flats * (v_new - v_cur) * 100 * v_days / 30.0)::bigint;
  IF v_base < 100 THEN v_base := 100; END IF; -- at least Rs 1
  v_taxp := COALESCE((q->>'tax_percent')::numeric, 0);
  v_tax := round(v_base * v_taxp / 100)::bigint;
  RETURN jsonb_build_object('available', true, 'from_plan_id', s.plan_id, 'plan_id', _plan_id,
    'flat_count', v_flats, 'days_left', v_days, 'price_diff_per_flat_inr', v_new - v_cur,
    'price_per_flat_inr', v_new, 'until', s.plan_expires_at,
    'base_amount_paise', v_base, 'tax_percent', v_taxp, 'tax_amount_paise', v_tax, 'amount_paise', v_base + v_tax);
END $function$;
REVOKE ALL ON FUNCTION public._saas_upgrade_quote(uuid, text) FROM PUBLIC, anon, authenticated;

-- What the checkout should offer for this plan.
CREATE OR REPLACE FUNCTION public.saas_plan_change_options(_society_id uuid, _plan_id text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s public.societies%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_society_admin_for(auth.uid(), _society_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF _plan_id NOT IN ('basic','pro','premium') THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023'; END IF;
  SELECT * INTO s FROM public.societies WHERE id = _society_id;
  RETURN jsonb_build_object(
    'current_plan_id', CASE WHEN s.plan_id IN ('basic','pro','premium') THEN s.plan_id END,
    'plan_status', s.plan_status, 'plan_expires_at', s.plan_expires_at, 'trial_ends_at', s.trial_ends_at,
    'scheduled_plan_id', s.scheduled_plan_id, 'scheduled_plan_starts_at', s.scheduled_plan_starts_at,
    'term', public._saas_term_effect(_society_id, _plan_id),
    'upgrade', public._saas_upgrade_quote(_society_id, _plan_id));
END $function$;
REVOKE ALL ON FUNCTION public.saas_plan_change_options(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saas_plan_change_options(uuid, text) TO authenticated;

-- Submit a UPI payment for a remaining-days upgrade.
CREATE OR REPLACE FUNCTION public.submit_saas_upi_upgrade(_society_id uuid, _plan_id text, _request_id uuid,
  _expected_amount_paise integer, _utr text, _payer_name text, _payer_upi text, _paid_at timestamptz,
  _proof_path text, _consent_version text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s public.platform_payment_settings%ROWTYPE; q jsonb; v_id uuid; v_existing public.saas_upi_payment_requests%ROWTYPE; v_amount integer;
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
  PERFORM pg_advisory_xact_lock(hashtext('saas_upi:' || _society_id::text));
  IF EXISTS (SELECT 1 FROM public.saas_upi_payment_requests WHERE society_id = _society_id AND status = 'pending') THEN
    RAISE EXCEPTION 'already_pending' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.saas_upi_payment_requests WHERE upper(utr) = upper(_utr) AND status IN ('pending','approved')) THEN
    RAISE EXCEPTION 'duplicate_reference' USING ERRCODE = '23505';
  END IF;
  q := public._saas_upgrade_quote(_society_id, _plan_id);
  IF NOT COALESCE((q->>'available')::boolean, false) THEN RAISE EXCEPTION 'upgrade_unavailable' USING ERRCODE = '22023'; END IF;
  v_amount := (q->>'amount_paise')::integer;
  IF v_amount <> _expected_amount_paise THEN RAISE EXCEPTION 'price_changed' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.saas_upi_payment_requests(
    request_id, society_id, plan_id, submitted_by, pricing_type, flat_count, price_per_flat_inr, term_months,
    base_amount_paise, tax_amount_paise, tax_percent, amount_paise, payee_vpa,
    utr, payer_name, payer_upi, paid_at, proof_path, consent_version, gross_amount_paise,
    kind, upgrade_from_plan_id, upgrade_days)
  VALUES (_request_id, _society_id, _plan_id, auth.uid(), 'standard', (q->>'flat_count')::integer,
    (q->>'price_per_flat_inr')::numeric, 1, (q->>'base_amount_paise')::bigint, (q->>'tax_amount_paise')::bigint,
    (q->>'tax_percent')::numeric, v_amount, s.upi_vpa,
    upper(trim(_utr)), trim(_payer_name), NULLIF(trim(COALESCE(_payer_upi,'')),''), _paid_at, _proof_path, _consent_version,
    (q->>'base_amount_paise')::bigint, 'upgrade', q->>'from_plan_id', (q->>'days_left')::integer)
  RETURNING id INTO v_id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'subscription.upi_upgrade_submitted', 'saas_upi_payment_requests', v_id::text, _society_id,
    jsonb_build_object('from_plan_id', q->'from_plan_id', 'plan_id', _plan_id, 'days_left', q->'days_left',
      'amount_paise', v_amount, 'utr_last4', right(upper(trim(_utr)), 4)));
  RETURN jsonb_build_object('id', v_id, 'status', 'pending', 'replayed', false);
END $function$;
REVOKE ALL ON FUNCTION public.submit_saas_upi_upgrade(uuid, text, uuid, integer, text, text, text, timestamptz, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_saas_upi_upgrade(uuid, text, uuid, integer, text, text, text, timestamptz, text, text) TO authenticated;

-- Term submissions refuse a second, different scheduled change.
DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.submit_saas_upi_payment_v2'::regproc);
  IF position('_saas_term_effect' IN d) = 0 THEN
    d := replace(d, $x$  q := public.saas_upi_quote(_society_id, _plan_id, _flat_quantity, _term_months, _discount_code);$x$,
      $x$  IF public._saas_term_effect(_society_id, _plan_id)->>'effect' = 'blocked' THEN
    RAISE EXCEPTION 'plan_change_already_scheduled' USING ERRCODE = '22023';
  END IF;
  q := public.saas_upi_quote(_society_id, _plan_id, _flat_quantity, _term_months, _discount_code);$x$);
    IF position('_saas_term_effect' IN d) = 0 THEN RAISE EXCEPTION 'submit_v2 patch anchor missing'; END IF;
    EXECUTE d;
  END IF;
  -- Expiry reminders every day for the last 5 days (plus 7, end day and day after).
  d := pg_get_functiondef('public.send_subscription_renewal_reminders'::regproc);
  IF position('IN (7,3,1,0,-1)' IN d) > 0 THEN
    EXECUTE replace(d, 'IN (7,3,1,0,-1)', 'IN (7,5,4,3,2,1,0,-1)');
  END IF;
END $do$;

-- Approval: upgrades switch plan now; terms never overlap the running period.
CREATE OR REPLACE FUNCTION public.admin_review_saas_upi_payment(_id uuid, _approve boolean, _reject_code text DEFAULT NULL::text, _received_amount_paise integer DEFAULT NULL::integer, _note text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r public.saas_upi_payment_requests%ROWTYPE; v_pay uuid; v_expires timestamptz; v_receipt text;
  o public.custom_plan_offers%ROWTYPE; e jsonb; v_msg text;
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

  IF r.kind = 'upgrade' THEN
    PERFORM 1 FROM public.societies WHERE id = r.society_id FOR UPDATE;
    UPDATE public.societies
       SET plan_id = r.plan_id, plan_status = 'active', plan_selected_at = now(),
           rate_per_flat_inr = r.price_per_flat_inr,
           purchased_flat_quantity = GREATEST(COALESCE(purchased_flat_quantity, 0), r.flat_count), updated_at = now()
     WHERE id = r.society_id
     RETURNING plan_expires_at INTO v_expires;
    v_msg := 'Your UPI payment was verified and your plan is upgraded now.';
  ELSE
    IF r.custom_offer_id IS NOT NULL THEN
      SELECT * INTO o FROM public.custom_plan_offers WHERE id = r.custom_offer_id FOR UPDATE;
      IF o.status = 'accepted' THEN
        UPDATE public.custom_plan_offers SET status = 'superseded'
         WHERE society_id = r.society_id AND status = 'active' AND id <> o.id;
        UPDATE public.custom_plan_offers SET status = 'active', activated_at = now() WHERE id = o.id;
        UPDATE public.custom_plan_requests SET status = 'active', updated_at = now() WHERE id = o.request_id;
      END IF;
    END IF;
    e := public._saas_apply_paid_term(r.society_id, r.plan_id, r.term_months);
    v_expires := (e->>'expires_at')::timestamptz;
    UPDATE public.societies
       SET pricing_type = r.pricing_type, purchased_flat_quantity = r.flat_count,
           custom_offer_id = r.custom_offer_id, subscription_term_months = r.term_months, updated_at = now(),
           rate_per_flat_inr = CASE WHEN e->>'effect' IN ('extend','start_now') THEN r.price_per_flat_inr ELSE rate_per_flat_inr END
     WHERE id = r.society_id;
    v_msg := CASE WHEN e->>'effect' IN ('schedule','after_trial')
      THEN 'Your UPI payment was verified. Your new plan starts on '
           || to_char((e->>'starts_at')::timestamptz AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') || '.'
      WHEN e->>'effect' = 'extend'
      THEN 'Your UPI payment was verified. Your plan now runs until '
           || to_char(v_expires AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') || '.'
      ELSE 'Your UPI payment was verified and your plan is active.' END;
  END IF;

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
    jsonb_build_object('payment_id', v_pay, 'plan_id', r.plan_id, 'kind', r.kind, 'amount_paise', r.amount_paise,
      'receipt_number', v_receipt, 'effect', e->'effect', 'starts_at', e->'starts_at'));
  PERFORM public._notify_user(r.submitted_by, r.society_id, 'subscription', 'Plan payment verified',
    v_msg || ' Receipt ' || COALESCE(v_receipt, '') || '.', '/society/subscription');
  RETURN jsonb_build_object('status', 'approved', 'replayed', false, 'receipt_number', v_receipt, 'expires_at', v_expires,
    'effect', COALESCE(e->>'effect', 'upgrade'));
END $function$;

-- Switch scheduled plans when their start time arrives.
CREATE OR REPLACE FUNCTION public.apply_due_plan_switches()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  IF current_user NOT IN ('postgres','supabase_admin','service_role') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  WITH sw AS (
    UPDATE public.societies s
       SET plan_id = s.scheduled_plan_id, plan_status = 'active', plan_selected_at = now(),
           rate_per_flat_inr = COALESCE((SELECT p.price_per_flat_inr FROM public.plans p WHERE p.id = s.scheduled_plan_id), s.rate_per_flat_inr),
           scheduled_plan_id = NULL, scheduled_plan_starts_at = NULL, updated_at = now()
     WHERE s.scheduled_plan_id IS NOT NULL AND s.scheduled_plan_starts_at <= now()
     RETURNING s.id, s.plan_id
  ), au AS (
    INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    SELECT NULL, 'subscription.scheduled_plan_started', 'societies', sw.id::text, sw.id, jsonb_build_object('plan_id', sw.plan_id)
    FROM sw RETURNING 1
  )
  SELECT count(*)::integer INTO n FROM sw;
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION public.apply_due_plan_switches() FROM PUBLIC, anon, authenticated;

DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.run_logged_db_job'::regproc);
  IF position('subscription-plan-switch' IN d) = 0 THEN
    d := replace(d, $x$'subscription-renewal-reminders') THEN
    RAISE EXCEPTION 'unknown_job';$x$, $x$'subscription-renewal-reminders','subscription-plan-switch') THEN
    RAISE EXCEPTION 'unknown_job';$x$);
    d := replace(d, $x$      WHEN 'subscription-renewal-reminders' THEN n := public.send_subscription_renewal_reminders();$x$,
      $x$      WHEN 'subscription-renewal-reminders' THEN n := public.send_subscription_renewal_reminders();
      WHEN 'subscription-plan-switch' THEN n := public.apply_due_plan_switches();$x$);
    IF position('apply_due_plan_switches' IN d) = 0 OR position($x$'subscription-plan-switch') THEN$x$ IN d) = 0 THEN
      RAISE EXCEPTION 'run_logged_db_job patch anchor missing';
    END IF;
    EXECUTE d;
  END IF;
END $do$;

SELECT cron.schedule('subscription-plan-switch', '2 * * * *', $$SELECT public.run_logged_db_job('subscription-plan-switch');$$);