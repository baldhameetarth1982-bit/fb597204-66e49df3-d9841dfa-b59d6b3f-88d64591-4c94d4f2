-- P07: historical confirmed payments reconcile to bills; never create an unpaid bill for a verified payment.
DROP TRIGGER IF EXISTS trg_historical_payment_auto_bill ON public.historical_payments;

ALTER TABLE public.historical_payments
  ADD COLUMN IF NOT EXISTS reconciled_bill_id uuid REFERENCES public.bills(id),
  ADD COLUMN IF NOT EXISTS reconciliation_state text,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;
ALTER TABLE public.historical_payments ADD CONSTRAINT historical_payments_recon_state_chk
  CHECK (reconciliation_state IS NULL OR reconciliation_state IN
    ('bill_created_paid','bill_exists','exception_amount_mismatch','exception_no_amount_source','exception_approval_required','not_eligible_plan'));
CREATE UNIQUE INDEX IF NOT EXISTS historical_payments_one_recon_bill ON public.historical_payments(reconciled_bill_id)
  WHERE reconciled_bill_id IS NOT NULL;

-- Allow the reconciliation columns to be written by the definer function despite the immutability guard.
CREATE OR REPLACE FUNCTION public._historical_payments_recon_only(_old public.historical_payments, _new public.historical_payments)
 RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (to_jsonb(_old) - ARRAY['reconciled_bill_id','reconciliation_state','reconciled_at'])
       = (to_jsonb(_new) - ARRAY['reconciled_bill_id','reconciliation_state','reconciled_at'])
$$;

DROP FUNCTION IF EXISTS public._auto_create_missing_bill(uuid, uuid, date, uuid);

CREATE OR REPLACE FUNCTION public._reconcile_historical_payment(_hp_id uuid)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  hp public.historical_payments%ROWTYPE; s record; v_top text; v_start date; v_end date;
  v_amount numeric(12,2); v_period uuid; sch record; f record; v_bill uuid; v_state text; v_existing uuid;
BEGIN
  SELECT * INTO hp FROM public.historical_payments WHERE id = _hp_id FOR UPDATE;
  IF NOT FOUND OR hp.status <> 'confirmed' OR hp.reconciliation_state IS NOT NULL THEN
    RETURN COALESCE(hp.reconciliation_state, 'skipped');
  END IF;
  v_start := date_trunc('month', hp.payment_date)::date;
  v_end := (date_trunc('month', hp.payment_date) + interval '1 month - 1 day')::date;
  PERFORM pg_advisory_xact_lock(hashtextextended('bill_sched:' || hp.society_id::text || ':' || hp.flat_id::text || ':' || v_start::text, 0));

  SELECT id INTO v_top FROM public.plans WHERE id IN ('basic','pro','premium')
   ORDER BY price_per_flat_inr DESC NULLS LAST LIMIT 1;
  SELECT plan_id, plan_status, plan_expires_at INTO s FROM public.societies WHERE id = hp.society_id;

  SELECT id INTO v_existing FROM public.bills WHERE society_id = hp.society_id AND flat_id = hp.flat_id
     AND period_start = v_start AND COALESCE(status,'') <> 'cancelled' AND cancelled_at IS NULL LIMIT 1;

  IF v_existing IS NOT NULL THEN
    v_state := 'bill_exists';  -- never a second bill; never change the existing bill or the verified payment
  ELSIF s.plan_id IS DISTINCT FROM v_top OR s.plan_status IS DISTINCT FROM 'active'
        OR (s.plan_expires_at IS NOT NULL AND s.plan_expires_at < now()) THEN
    v_state := 'not_eligible_plan';
  ELSIF EXISTS (SELECT 1 FROM public.society_settings WHERE society_id = hp.society_id AND coalesce(bill_run_approval_required,false)) THEN
    v_state := 'exception_approval_required';
  ELSE
    SELECT id, area_sqft, type INTO f FROM public.flats WHERE id = hp.flat_id AND society_id = hp.society_id;
    SELECT id, amount_due INTO v_period, v_amount FROM public.maintenance_periods
     WHERE flat_id = hp.flat_id AND period_start = v_start AND bill_id IS NULL LIMIT 1;
    IF v_amount IS NULL THEN
      SELECT amount INTO v_amount FROM public.unit_billing_overrides WHERE flat_id = hp.flat_id AND society_id = hp.society_id;
    END IF;
    SELECT * INTO sch FROM public.billing_schedules WHERE society_id = hp.society_id;
    IF v_amount IS NULL AND sch.id IS NOT NULL AND f.id IS NOT NULL THEN
      v_amount := CASE sch.mode
        WHEN 'per_sqft' THEN sch.amount * COALESCE(f.area_sqft, 0)
        WHEN 'per_bhk' THEN sch.amount * COALESCE(NULLIF(substring(f.type from '(\d)\s*[bB][hH][kK]'),'')::int, 2)
        ELSE sch.amount END;
    END IF;
    IF v_amount IS NULL OR v_amount <= 0 OR f.id IS NULL THEN
      v_state := 'exception_no_amount_source';
    ELSIF round(v_amount, 2) <> round(hp.amount, 2) THEN
      v_state := 'exception_amount_mismatch';  -- do not invent or force a bill amount
    ELSE
      PERFORM set_config('sociyohub.allow_unbatched_bill', 'on', true);
      INSERT INTO public.bills(society_id, flat_id, period_label, period_start, period_end, amount, due_date,
          status, paid_at, bill_number, bill_date, notes)
        VALUES (hp.society_id, hp.flat_id, to_char(v_start, 'FMMonth YYYY'), v_start, v_end, round(v_amount, 2),
          v_start + COALESCE(sch.due_offset_days, 10), 'paid', hp.payment_date::timestamptz,
          public._allocate_bill_number(hp.society_id, v_start, 'AUTO'), hp.payment_date,
          'Created for a confirmed historical payment with no bill for this month.')
        RETURNING id INTO v_bill;
      IF v_period IS NOT NULL THEN
        INSERT INTO public.bill_line_items(bill_id, society_id, kind, description, amount, maintenance_period_id)
          VALUES (v_bill, hp.society_id, 'maintenance', 'Maintenance — ' || to_char(v_start, 'FMMonth YYYY'), round(v_amount,2), v_period);
        UPDATE public.maintenance_periods SET bill_id = v_bill, updated_at = now() WHERE id = v_period;
      END IF;
      v_state := 'bill_created_paid';
    END IF;
  END IF;

  PERFORM set_config('sociyohub.hp_recon', 'on', true);
  UPDATE public.historical_payments
     SET reconciliation_state = v_state, reconciled_at = now(),
         reconciled_bill_id = CASE WHEN v_state = 'bill_created_paid' THEN v_bill ELSE NULL END
   WHERE id = hp.id;
  PERFORM set_config('sociyohub.hp_recon', '', true);
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (auth.uid(), 'billing.historical_payment_reconciled', 'historical_payments', hp.id::text, hp.society_id,
            jsonb_build_object('state', v_state, 'bill_id', v_bill, 'existing_bill_id', v_existing, 'period_start', v_start));
  RETURN v_state;
END $$;
REVOKE ALL ON FUNCTION public._reconcile_historical_payment(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._historical_payment_reconcile_trg()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM 'confirmed' THEN
    PERFORM public._reconcile_historical_payment(NEW.id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_historical_payment_reconcile AFTER UPDATE OF status ON public.historical_payments
  FOR EACH ROW EXECUTE FUNCTION public._historical_payment_reconcile_trg();

-- Let the guard accept reconciliation-column-only updates made by the definer function.
DO $m$
DECLARE d text; i int;
BEGIN
  d := pg_get_functiondef('public._historical_payments_guard()'::regprocedure);
  i := position(E'\nBEGIN\n' IN d);
  IF i = 0 THEN RAISE EXCEPTION 'shape_changed'; END IF;
  d := overlay(d PLACING E'\nBEGIN\n  IF TG_OP = ''UPDATE'' AND coalesce(current_setting(''sociyohub.hp_recon'', true), '''') = ''on'' AND public._historical_payments_recon_only(OLD, NEW) THEN RETURN NEW; END IF;\n' FROM i FOR 7);
  EXECUTE d;
END $m$;

-- P10: purchased quantity is authoritative; never silently 300.
CREATE OR REPLACE FUNCTION public._society_flat_capacity(_society_id uuid)
 RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(s.purchased_flat_quantity,
    (SELECT p.flat_count FROM public.saas_subscription_payments p
      WHERE p.society_id = s.id AND p.lifecycle_status = 'captured' AND p.flat_count IS NOT NULL
      ORDER BY p.confirmed_at DESC NULLS LAST LIMIT 1))
  FROM public.societies s WHERE s.id = _society_id
$$;
REVOKE ALL ON FUNCTION public._society_flat_capacity(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_society_flat_entitlement(_society_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_cap integer; v_cur integer; s record;
BEGIN
  IF NOT (public.is_society_admin_for(auth.uid(), _society_id) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT pricing_type, rate_per_flat_inr, plan_expires_at, plan_status INTO s FROM public.societies WHERE id = _society_id;
  v_cap := public._society_flat_capacity(_society_id);
  SELECT count(*)::integer INTO v_cur FROM public.flats WHERE society_id = _society_id AND is_active;
  RETURN jsonb_build_object('pricing_type', s.pricing_type, 'purchased', v_cap, 'current', v_cur,
    'available', CASE WHEN v_cap IS NULL THEN NULL ELSE GREATEST(v_cap - v_cur, 0) END,
    'state', CASE WHEN v_cap IS NULL THEN 'unrecorded' ELSE 'recorded' END,
    'rate_per_flat_inr', s.rate_per_flat_inr, 'renews_at', s.plan_expires_at, 'plan_status', s.plan_status);
END $$;

-- No recorded purchase (trial / legacy) => no silent cap; recorded => hard server cap.
CREATE OR REPLACE FUNCTION public._flats_enforce_capacity()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_cap integer; v_cur integer;
BEGIN
  IF NOT COALESCE(NEW.is_active, true) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.is_active, true) AND OLD.society_id = NEW.society_id THEN RETURN NEW; END IF;
  PERFORM 1 FROM public.societies WHERE id = NEW.society_id FOR UPDATE;
  v_cap := public._society_flat_capacity(NEW.society_id);
  IF v_cap IS NULL THEN RETURN NEW; END IF;
  SELECT count(*)::integer INTO v_cur FROM public.flats
   WHERE society_id = NEW.society_id AND is_active AND id <> NEW.id;
  IF v_cur + 1 > v_cap THEN
    RAISE EXCEPTION 'flat_capacity_reached' USING ERRCODE = '23514',
      HINT = 'Increase the purchased flat quantity through your subscription.';
  END IF;
  RETURN NEW;
END $$;

-- Standard purchases record the quantity actually bought (may exceed current flats, up to the standard ceiling).
DROP FUNCTION IF EXISTS public.claim_saas_subscription_order(uuid, uuid, text, uuid, integer, text, text);
DROP FUNCTION IF EXISTS public.saas_subscription_quote(uuid, text);

CREATE FUNCTION public.saas_subscription_quote(_society_id uuid, _plan_id text, _flat_quantity integer DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_threshold integer; v_flats integer; v_qty integer; v_price numeric(10,2); v_name text;
  o public.custom_plan_offers%ROWTYPE; v_type text; v_purchased integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (public.is_society_admin_for(auth.uid(), _society_id) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT price_per_flat_inr, name INTO v_price, v_name FROM public.plans
   WHERE id = _plan_id AND id IN ('basic','pro','premium');
  IF v_price IS NULL OR v_price <= 0 THEN RAISE EXCEPTION 'plan_not_available' USING ERRCODE = '22023'; END IF;
  SELECT COALESCE(enterprise_threshold_units, 300) INTO v_threshold FROM public.pricing_settings WHERE id = 1;
  v_threshold := COALESCE(v_threshold, 300);
  SELECT count(*)::integer INTO v_flats FROM public.flats WHERE society_id = _society_id AND is_active;
  SELECT pricing_type INTO v_type FROM public.societies WHERE id = _society_id;
  v_purchased := public._society_flat_capacity(_society_id);

  SELECT * INTO o FROM public.custom_plan_offers
   WHERE society_id = _society_id AND status IN ('accepted','active')
   ORDER BY (status = 'accepted') DESC, created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('plan_id', o.plan_id, 'plan_name', v_name, 'flat_count', o.flat_quantity,
      'current_flats', v_flats,
      'price_per_flat_inr', o.rate_per_flat_inr, 'threshold', v_threshold,
      'custom_pricing', o.plan_id <> _plan_id,
      'pricing_type', 'custom', 'custom_offer_id', o.id, 'term_months', o.term_months,
      'base_amount_paise', o.base_amount_paise, 'tax_amount_paise', o.tax_amount_paise,
      'amount_paise', CASE WHEN o.plan_id <> _plan_id OR o.flat_quantity < v_flats THEN NULL ELSE o.total_amount_paise END);
  END IF;

  v_qty := GREATEST(v_flats, COALESCE(_flat_quantity, 0), CASE WHEN v_type = 'standard' THEN COALESCE(v_purchased, 0) ELSE 0 END);
  IF _flat_quantity IS NOT NULL AND (_flat_quantity < 1 OR _flat_quantity > 100000) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object(
    'plan_id', _plan_id, 'plan_name', v_name, 'flat_count', v_qty, 'current_flats', v_flats,
    'price_per_flat_inr', v_price, 'threshold', v_threshold,
    'custom_pricing', v_qty > v_threshold OR v_type = 'custom',
    'pricing_type', 'standard', 'term_months', 1,
    'base_amount_paise', CASE WHEN v_qty > v_threshold OR v_qty = 0 OR v_type = 'custom' THEN NULL ELSE round(v_qty * v_price * 100)::integer END,
    'tax_amount_paise', 0,
    'amount_paise', CASE WHEN v_qty > v_threshold OR v_qty = 0 OR v_type = 'custom' THEN NULL
                         ELSE round(v_qty * v_price * 100)::integer END
  );
END $function$;
REVOKE ALL ON FUNCTION public.saas_subscription_quote(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saas_subscription_quote(uuid, text, integer) TO authenticated, service_role;

CREATE FUNCTION public.claim_saas_subscription_order(_request_id uuid, _society_id uuid, _plan_id text, _requested_by uuid, _amount_paise integer, _currency text, _provider_mode text, _flat_quantity integer DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.saas_subscription_order_requests%ROWTYPE;
  v_inserted integer := 0;
  v_quote jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF _amount_paise <= 0 OR _currency <> 'INR' OR _provider_mode NOT IN ('test','live') THEN
    RAISE EXCEPTION 'invalid_order_request' USING ERRCODE = '22023';
  END IF;
  v_quote := public.saas_subscription_quote(_society_id, _plan_id, _flat_quantity);
  IF (v_quote->>'custom_pricing')::boolean THEN RAISE EXCEPTION 'custom_pricing_required' USING ERRCODE = '22023'; END IF;
  IF (v_quote->>'amount_paise') IS NULL THEN RAISE EXCEPTION 'no_billable_flats' USING ERRCODE = '22023'; END IF;
  IF (v_quote->>'amount_paise')::bigint <> _amount_paise THEN RAISE EXCEPTION 'amount_mismatch' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.saas_subscription_order_requests(
    request_id, society_id, plan_id, requested_by, amount_paise, currency, provider_mode, flat_count, price_per_flat_inr,
    custom_offer_id, term_months
  ) VALUES (_request_id, _society_id, _plan_id, _requested_by, _amount_paise, _currency, _provider_mode,
    (v_quote->>'flat_count')::integer, (v_quote->>'price_per_flat_inr')::numeric,
    NULLIF(v_quote->>'custom_offer_id','')::uuid, COALESCE((v_quote->>'term_months')::integer, 1))
  ON CONFLICT (requested_by, request_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  SELECT * INTO v_row FROM public.saas_subscription_order_requests
  WHERE requested_by = _requested_by AND request_id = _request_id FOR UPDATE;
  IF v_row.society_id <> _society_id OR v_row.plan_id <> _plan_id OR v_row.amount_paise <> _amount_paise
     OR v_row.currency <> _currency OR v_row.provider_mode <> _provider_mode THEN
    RAISE EXCEPTION 'order_request_conflict' USING ERRCODE = '23505';
  END IF;
  IF v_inserted = 1 THEN RETURN jsonb_build_object('status','claimed','request_record_id',v_row.id); END IF;
  IF v_row.status = 'failed' THEN
    UPDATE public.saas_subscription_order_requests
       SET status = 'processing', failure_code = NULL, attempt_count = attempt_count + 1, updated_at = now()
     WHERE id = v_row.id;
    RETURN jsonb_build_object('status','claimed','request_record_id',v_row.id);
  END IF;
  RETURN jsonb_build_object('status', CASE WHEN v_row.razorpay_order_id IS NULL THEN 'processing' ELSE 'ready' END,
    'request_record_id', v_row.id, 'razorpay_order_id', v_row.razorpay_order_id);
END $function$;
REVOKE ALL ON FUNCTION public.claim_saas_subscription_order(uuid, uuid, text, uuid, integer, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_saas_subscription_order(uuid, uuid, text, uuid, integer, text, text, integer) TO service_role;

-- Standard finalisation now stores the purchased quantity from the verified payment.
DO $m$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.finalize_saas_subscription_payment(uuid,text,uuid,text,text,integer,text,text)'::regprocedure);
  IF position('pricing_type = ''standard'', purchased_flat_quantity = NULL' IN d) = 0 THEN RAISE EXCEPTION 'shape_changed'; END IF;
  d := replace(d, 'pricing_type = ''standard'', purchased_flat_quantity = NULL', 'pricing_type = ''standard'', purchased_flat_quantity = v_payment.flat_count');
  EXECUTE d;
END $m$;