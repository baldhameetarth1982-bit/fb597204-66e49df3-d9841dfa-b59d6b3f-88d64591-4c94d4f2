DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'cron' AND p.proname = 'unschedule') THEN
    BEGIN
      PERFORM cron.unschedule('run-billing-daily');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.bill_run_insert_period(_society_id uuid, _period_start date, _period_end date, _rows jsonb)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'blanket_billing_retired' USING ERRCODE = '42501';
END $function$;
COMMENT ON FUNCTION public.bill_run_insert_period(uuid, date, date, jsonb) IS 'DEPRECATED: blanket scheduled billing retired; always raises.';
COMMENT ON TABLE public.billing_schedules IS 'DEPRECATED: blanket schedule no longer generates bills; kept for history only.';

ALTER TABLE public.societies
  ADD COLUMN IF NOT EXISTS pricing_type text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS purchased_flat_quantity integer,
  ADD COLUMN IF NOT EXISTS rate_per_flat_inr numeric(10,2),
  ADD COLUMN IF NOT EXISTS custom_offer_id uuid,
  ADD COLUMN IF NOT EXISTS subscription_term_months integer;
ALTER TABLE public.societies ADD CONSTRAINT societies_pricing_type_chk CHECK (pricing_type IN ('standard','custom'));
ALTER TABLE public.societies ADD CONSTRAINT societies_purchased_qty_chk CHECK (purchased_flat_quantity IS NULL OR purchased_flat_quantity > 0);

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
     OR NEW.subscription_term_months IS DISTINCT FROM OLD.subscription_term_months THEN
    RAISE EXCEPTION 'protected_society_columns' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public._society_flat_capacity(_society_id uuid)
 RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE WHEN s.pricing_type = 'custom' AND s.purchased_flat_quantity IS NOT NULL
              THEN s.purchased_flat_quantity
              ELSE COALESCE((SELECT enterprise_threshold_units FROM public.pricing_settings WHERE id = 1), 300) END
  FROM public.societies s WHERE s.id = _society_id
$$;
REVOKE ALL ON FUNCTION public._society_flat_capacity(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_society_flat_entitlement(_society_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_cap integer; v_cur integer; v_type text;
BEGIN
  IF NOT (public.is_society_admin_for(auth.uid(), _society_id) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT pricing_type INTO v_type FROM public.societies WHERE id = _society_id;
  v_cap := public._society_flat_capacity(_society_id);
  SELECT count(*)::integer INTO v_cur FROM public.flats WHERE society_id = _society_id AND is_active;
  RETURN jsonb_build_object('pricing_type', v_type, 'purchased', v_cap, 'current', v_cur,
                            'available', GREATEST(v_cap - v_cur, 0));
END $$;
REVOKE ALL ON FUNCTION public.get_society_flat_entitlement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_society_flat_entitlement(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public._flats_enforce_capacity()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_cap integer; v_cur integer;
BEGIN
  IF NOT COALESCE(NEW.is_active, true) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.is_active, true) AND OLD.society_id = NEW.society_id THEN RETURN NEW; END IF;
  PERFORM 1 FROM public.societies WHERE id = NEW.society_id FOR UPDATE;
  v_cap := public._society_flat_capacity(NEW.society_id);
  SELECT count(*)::integer INTO v_cur FROM public.flats
   WHERE society_id = NEW.society_id AND is_active AND id <> NEW.id;
  IF v_cap IS NOT NULL AND v_cur + 1 > v_cap THEN
    RAISE EXCEPTION 'flat_capacity_reached' USING ERRCODE = '23514',
      HINT = 'Increase the purchased flat quantity through your subscription.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_flats_enforce_capacity ON public.flats;
CREATE TRIGGER trg_flats_enforce_capacity BEFORE INSERT OR UPDATE OF is_active, society_id ON public.flats
  FOR EACH ROW EXECUTE FUNCTION public._flats_enforce_capacity();

CREATE TABLE public.custom_plan_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  flat_quantity integer NOT NULL CHECK (flat_quantity > 0 AND flat_quantity <= 100000),
  plan_id text CHECK (plan_id IS NULL OR plan_id IN ('basic','pro','premium')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','offered','accepted','active','declined','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX custom_plan_requests_one_live ON public.custom_plan_requests(society_id)
  WHERE status IN ('open','offered','accepted');
GRANT SELECT ON public.custom_plan_requests TO authenticated;
GRANT ALL ON public.custom_plan_requests TO service_role;
ALTER TABLE public.custom_plan_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY cpr_read ON public.custom_plan_requests FOR SELECT TO authenticated
  USING (public.is_society_admin_for(auth.uid(), society_id) OR public.is_super_admin(auth.uid()));

CREATE TABLE public.custom_plan_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.custom_plan_requests(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  sender_id uuid,
  sender_side text NOT NULL CHECK (sender_side IN ('society','platform','system')),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX custom_plan_messages_req ON public.custom_plan_messages(request_id, created_at);
GRANT SELECT ON public.custom_plan_messages TO authenticated;
GRANT ALL ON public.custom_plan_messages TO service_role;
ALTER TABLE public.custom_plan_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY cpm_read ON public.custom_plan_messages FOR SELECT TO authenticated
  USING (public.is_society_admin_for(auth.uid(), society_id) OR public.is_super_admin(auth.uid()));

CREATE TABLE public.custom_plan_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.custom_plan_requests(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  plan_id text NOT NULL CHECK (plan_id IN ('basic','pro','premium')),
  rate_per_flat_inr numeric(10,2) NOT NULL CHECK (rate_per_flat_inr > 0 AND rate_per_flat_inr <= 1000),
  flat_quantity integer NOT NULL CHECK (flat_quantity > 0 AND flat_quantity <= 100000),
  term_months integer NOT NULL DEFAULT 1 CHECK (term_months BETWEEN 1 AND 36),
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  base_amount_paise bigint NOT NULL CHECK (base_amount_paise > 0),
  tax_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_percent >= 0 AND tax_percent <= 50),
  tax_amount_paise bigint NOT NULL DEFAULT 0 CHECK (tax_amount_paise >= 0),
  total_amount_paise bigint NOT NULL CHECK (total_amount_paise > 0 AND total_amount_paise <= 2000000000),
  status text NOT NULL DEFAULT 'offered' CHECK (status IN ('offered','accepted','declined','superseded','active','withdrawn')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  activated_at timestamptz
);
CREATE UNIQUE INDEX custom_plan_offers_one_open ON public.custom_plan_offers(request_id)
  WHERE status IN ('offered','accepted');
CREATE UNIQUE INDEX custom_plan_offers_one_active ON public.custom_plan_offers(society_id) WHERE status = 'active';
GRANT SELECT ON public.custom_plan_offers TO authenticated;
GRANT ALL ON public.custom_plan_offers TO service_role;
ALTER TABLE public.custom_plan_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY cpo_read ON public.custom_plan_offers FOR SELECT TO authenticated
  USING (public.is_society_admin_for(auth.uid(), society_id) OR public.is_super_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.request_custom_plan(_society_id uuid, _flat_quantity integer, _plan_id text, _message text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_uid uuid := auth.uid(); v_threshold integer; v_req public.custom_plan_requests%ROWTYPE;
        v_msg text := nullif(btrim(coalesce(_message,'')),'');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF NOT public.current_user_has_society_permission(_society_id, 'society.settings', NULL::uuid) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(enterprise_threshold_units, 300) INTO v_threshold FROM public.pricing_settings WHERE id = 1;
  IF _flat_quantity IS NULL OR _flat_quantity <= COALESCE(v_threshold,300) OR _flat_quantity > 100000
     OR (_plan_id IS NOT NULL AND _plan_id NOT IN ('basic','pro','premium'))
     OR (v_msg IS NOT NULL AND length(v_msg) > 2000) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('custom_plan_req:' || _society_id::text, 0));
  SELECT * INTO v_req FROM public.custom_plan_requests
   WHERE society_id = _society_id AND status IN ('open','offered','accepted') LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('status','existing','request_id', v_req.id);
  END IF;
  PERFORM public._rate_hit('custom_plan_request', v_uid::text, 5, interval '1 day');
  INSERT INTO public.custom_plan_requests(society_id, requested_by, flat_quantity, plan_id)
    VALUES (_society_id, v_uid, _flat_quantity, _plan_id) RETURNING * INTO v_req;
  INSERT INTO public.custom_plan_messages(request_id, society_id, sender_id, sender_side, body)
    VALUES (v_req.id, _society_id, v_uid, 'society',
            COALESCE(v_msg, 'Custom plan requested for ' || _flat_quantity || ' flats.'));
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (v_uid, 'custom_plan.requested', 'custom_plan_requests', v_req.id::text, _society_id,
            jsonb_build_object('flat_quantity', _flat_quantity, 'plan_id', _plan_id));
  RETURN jsonb_build_object('status','created','request_id', v_req.id);
END $$;

CREATE OR REPLACE FUNCTION public.custom_plan_post_message(_request_id uuid, _body text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_uid uuid := auth.uid(); r public.custom_plan_requests%ROWTYPE; v_side text; v_id uuid;
        v_body text := btrim(coalesce(_body,''));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.custom_plan_requests WHERE id = _request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unavailable' USING ERRCODE = 'P0002'; END IF;
  IF public.is_super_admin(v_uid) THEN v_side := 'platform';
  ELSIF public.current_user_has_society_permission(r.society_id, 'society.settings', NULL::uuid) THEN v_side := 'society';
  ELSE RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF length(v_body) < 1 OR length(v_body) > 2000 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023'; END IF;
  IF r.status IN ('declined','closed') THEN RAISE EXCEPTION 'request_closed' USING ERRCODE = '22023'; END IF;
  PERFORM public._rate_hit('custom_plan_message', v_uid::text, 60, interval '1 hour');
  INSERT INTO public.custom_plan_messages(request_id, society_id, sender_id, sender_side, body)
    VALUES (r.id, r.society_id, v_uid, v_side, v_body) RETURNING id INTO v_id;
  IF v_side = 'platform' THEN
    PERFORM public._notify_user(r.requested_by, r.society_id, 'subscription', 'New message about your custom plan',
      left(v_body, 140), '/society/subscription');
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_create_custom_offer(_request_id uuid, _plan_id text, _rate_per_flat_inr numeric,
  _flat_quantity integer, _term_months integer, _effective_from date)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_uid uuid := auth.uid(); r public.custom_plan_requests%ROWTYPE; v_id uuid;
        v_base bigint; v_taxp numeric(5,2); v_tax bigint;
BEGIN
  IF NOT public.is_super_admin(v_uid) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.custom_plan_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unavailable' USING ERRCODE = 'P0002'; END IF;
  IF r.status NOT IN ('open','offered') THEN RAISE EXCEPTION 'invalid_state' USING ERRCODE = '22023'; END IF;
  IF _plan_id NOT IN ('basic','pro','premium') OR _rate_per_flat_inr IS NULL OR _rate_per_flat_inr <= 0
     OR _rate_per_flat_inr > 1000 OR _flat_quantity IS NULL OR _flat_quantity <= 0 OR _flat_quantity > 100000
     OR _term_months IS NULL OR _term_months NOT BETWEEN 1 AND 36
     OR _effective_from IS NULL OR _effective_from < CURRENT_DATE - 1 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  v_base := round(_flat_quantity * round(_rate_per_flat_inr, 2) * _term_months * 100)::bigint;
  SELECT COALESCE((taxes->>'gst_percent')::numeric, 0) INTO v_taxp FROM public.pricing_settings WHERE id = 1;
  v_taxp := COALESCE(v_taxp, 0);
  v_tax := round(v_base * v_taxp / 100)::bigint;
  UPDATE public.custom_plan_offers SET status = 'superseded' WHERE request_id = r.id AND status = 'offered';
  INSERT INTO public.custom_plan_offers(request_id, society_id, plan_id, rate_per_flat_inr, flat_quantity, term_months,
      effective_from, base_amount_paise, tax_percent, tax_amount_paise, total_amount_paise, created_by)
    VALUES (r.id, r.society_id, _plan_id, round(_rate_per_flat_inr,2), _flat_quantity, _term_months,
      _effective_from, v_base, v_taxp, v_tax, v_base + v_tax, v_uid) RETURNING id INTO v_id;
  UPDATE public.custom_plan_requests SET status = 'offered', updated_at = now() WHERE id = r.id;
  INSERT INTO public.custom_plan_messages(request_id, society_id, sender_id, sender_side, body)
    VALUES (r.id, r.society_id, v_uid, 'system',
      'Offer sent: ' || _flat_quantity || ' flats at ₹' || round(_rate_per_flat_inr,2) || ' per flat per month for '
      || _term_months || ' month(s).');
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (v_uid, 'custom_plan.offer_created', 'custom_plan_offers', v_id::text, r.society_id,
      jsonb_build_object('plan_id', _plan_id, 'rate', _rate_per_flat_inr, 'qty', _flat_quantity,
                         'term_months', _term_months, 'total_paise', v_base + v_tax));
  PERFORM public._notify_user(r.requested_by, r.society_id, 'subscription', 'Your custom plan offer is ready',
    'Review and accept it on the Subscription page.', '/society/subscription');
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.respond_custom_offer(_offer_id uuid, _accept boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_uid uuid := auth.uid(); o public.custom_plan_offers%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO o FROM public.custom_plan_offers WHERE id = _offer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unavailable' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.current_user_has_society_permission(o.society_id, 'society.settings', NULL::uuid) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF _accept IS NULL THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023'; END IF;
  IF (o.status = 'accepted' AND _accept) OR (o.status = 'declined' AND NOT _accept) THEN
    RETURN jsonb_build_object('status', o.status, 'already', true);
  END IF;
  IF o.status <> 'offered' THEN RAISE EXCEPTION 'invalid_state' USING ERRCODE = '22023'; END IF;
  UPDATE public.custom_plan_offers SET status = CASE WHEN _accept THEN 'accepted' ELSE 'declined' END,
    decided_by = v_uid, decided_at = now() WHERE id = o.id;
  UPDATE public.custom_plan_requests SET status = CASE WHEN _accept THEN 'accepted' ELSE 'open' END, updated_at = now()
   WHERE id = o.request_id;
  INSERT INTO public.custom_plan_messages(request_id, society_id, sender_id, sender_side, body)
    VALUES (o.request_id, o.society_id, v_uid, 'system', CASE WHEN _accept THEN 'Offer accepted.' ELSE 'Offer declined.' END);
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (v_uid, CASE WHEN _accept THEN 'custom_plan.offer_accepted' ELSE 'custom_plan.offer_declined' END,
      'custom_plan_offers', o.id::text, o.society_id, '{}'::jsonb);
  RETURN jsonb_build_object('status', CASE WHEN _accept THEN 'accepted' ELSE 'declined' END);
END $$;

REVOKE ALL ON FUNCTION public.request_custom_plan(uuid, integer, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.custom_plan_post_message(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_create_custom_offer(uuid, text, numeric, integer, integer, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_custom_offer(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_custom_plan(uuid, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.custom_plan_post_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_custom_offer(uuid, text, numeric, integer, integer, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_custom_offer(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_apply_custom_plan(_custom_plan_id uuid, _reason text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ BEGIN RAISE EXCEPTION 'custom_plan_legacy_retired' USING ERRCODE = '42501'; END $$;
COMMENT ON TABLE public.custom_plans IS 'DEPRECATED: replaced by custom_plan_requests/offers on the SaaS subscription engine.';
COMMENT ON COLUMN public.custom_plans.platform_fee_percent IS 'DEPRECATED: SociyoHub charges no platform fee; inert.';
COMMENT ON COLUMN public.plans.txn_fee_pct IS 'DEPRECATED: SociyoHub charges no platform fee; inert.';
COMMENT ON COLUMN public.plans.price_monthly_inr IS 'DEPRECATED: pricing is price_per_flat_inr x flats.';

ALTER TABLE public.saas_subscription_order_requests
  ADD COLUMN IF NOT EXISTS custom_offer_id uuid REFERENCES public.custom_plan_offers(id),
  ADD COLUMN IF NOT EXISTS term_months integer NOT NULL DEFAULT 1;
ALTER TABLE public.saas_subscription_payments
  ADD COLUMN IF NOT EXISTS custom_offer_id uuid REFERENCES public.custom_plan_offers(id),
  ADD COLUMN IF NOT EXISTS term_months integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.saas_subscription_quote(_society_id uuid, _plan_id text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_threshold integer; v_flats integer; v_price numeric(10,2); v_name text;
  o public.custom_plan_offers%ROWTYPE; v_type text;
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
  SELECT pricing_type INTO v_type FROM public.societies WHERE id = _society_id;

  SELECT * INTO o FROM public.custom_plan_offers
   WHERE society_id = _society_id AND status IN ('accepted','active')
   ORDER BY (status = 'accepted') DESC, created_at DESC LIMIT 1;
  IF FOUND THEN
    IF o.plan_id <> _plan_id THEN
      RETURN jsonb_build_object('plan_id', _plan_id, 'plan_name', v_name, 'flat_count', v_flats,
        'price_per_flat_inr', v_price, 'threshold', v_threshold, 'custom_pricing', true,
        'pricing_type', 'custom', 'amount_paise', NULL);
    END IF;
    RETURN jsonb_build_object('plan_id', _plan_id, 'plan_name', v_name, 'flat_count', o.flat_quantity,
      'price_per_flat_inr', o.rate_per_flat_inr, 'threshold', v_threshold, 'custom_pricing', false,
      'pricing_type', 'custom', 'custom_offer_id', o.id, 'term_months', o.term_months,
      'base_amount_paise', o.base_amount_paise, 'tax_amount_paise', o.tax_amount_paise,
      'amount_paise', CASE WHEN o.flat_quantity < v_flats THEN NULL ELSE o.total_amount_paise END);
  END IF;

  RETURN jsonb_build_object(
    'plan_id', _plan_id, 'plan_name', v_name, 'flat_count', v_flats,
    'price_per_flat_inr', v_price, 'threshold', v_threshold,
    'custom_pricing', v_flats > v_threshold OR v_type = 'custom',
    'pricing_type', 'standard', 'term_months', 1,
    'amount_paise', CASE WHEN v_flats > v_threshold OR v_flats = 0 OR v_type = 'custom' THEN NULL
                         ELSE round(v_flats * v_price * 100)::integer END
  );
END $function$;

CREATE OR REPLACE FUNCTION public.claim_saas_subscription_order(_request_id uuid, _society_id uuid, _plan_id text, _requested_by uuid, _amount_paise integer, _currency text, _provider_mode text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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
  IF (v_quote->>'amount_paise')::bigint <> _amount_paise THEN
    RAISE EXCEPTION 'amount_mismatch' USING ERRCODE = '22023';
  END IF;
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
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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
    request_id, provider_mode, status, lifecycle_status, provider_status, flat_count, price_per_flat_inr,
    custom_offer_id, term_months
  ) VALUES (
    v_request.society_id, v_request.plan_id, v_request.requested_by, _razorpay_order_id,
    v_request.amount_paise, v_request.currency, v_request.request_id, v_request.provider_mode,
    'created', 'pending', 'created', v_request.flat_count, v_request.price_per_flat_inr,
    v_request.custom_offer_id, v_request.term_months
  ) ON CONFLICT (razorpay_order_id) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_payment_id;
  UPDATE public.saas_subscription_order_requests
     SET status = 'ready', razorpay_order_id = _razorpay_order_id, updated_at = now()
   WHERE id = v_request.id;
  RETURN v_payment_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_saas_subscription_payment(_society_id uuid, _plan_id text, _purchased_by uuid, _razorpay_order_id text, _razorpay_payment_id text, _amount_paise integer, _currency text, _provider_status text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_payment public.saas_subscription_payments%ROWTYPE;
  v_receipt public.saas_subscription_receipts%ROWTYPE;
  v_expires_at timestamptz;
  v_offer public.custom_plan_offers%ROWTYPE;
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

  SELECT * INTO v_payment FROM public.saas_subscription_payments
  WHERE razorpay_order_id = _razorpay_order_id FOR UPDATE;
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

    IF v_payment.custom_offer_id IS NOT NULL THEN
      SELECT * INTO v_offer FROM public.custom_plan_offers WHERE id = v_payment.custom_offer_id FOR UPDATE;
      IF v_offer.status = 'accepted' THEN
        UPDATE public.custom_plan_offers SET status = 'superseded'
         WHERE society_id = _society_id AND status = 'active' AND id <> v_offer.id;
        UPDATE public.custom_plan_offers SET status = 'active', activated_at = now() WHERE id = v_offer.id;
        UPDATE public.custom_plan_requests SET status = 'active', updated_at = now() WHERE id = v_offer.request_id;
      END IF;
      UPDATE public.societies
         SET plan_id = _plan_id, plan_status = 'active', plan_selected_at = now(),
             plan_expires_at = GREATEST(COALESCE(plan_expires_at, now()), now()) + make_interval(months => v_payment.term_months),
             pricing_type = 'custom', purchased_flat_quantity = v_payment.flat_count,
             rate_per_flat_inr = v_payment.price_per_flat_inr, custom_offer_id = v_payment.custom_offer_id,
             subscription_term_months = v_payment.term_months, updated_at = now()
       WHERE id = _society_id
       RETURNING plan_expires_at INTO v_expires_at;
    ELSE
      UPDATE public.societies
         SET plan_id = _plan_id, plan_status = 'active', plan_selected_at = now(),
             plan_expires_at = GREATEST(COALESCE(plan_expires_at, now()), now()) + interval '1 month',
             pricing_type = 'standard', purchased_flat_quantity = NULL,
             rate_per_flat_inr = v_payment.price_per_flat_inr, custom_offer_id = NULL,
             subscription_term_months = 1, updated_at = now()
       WHERE id = _society_id
       RETURNING plan_expires_at INTO v_expires_at;
    END IF;

    INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (_purchased_by, 'subscription.payment_confirmed', 'saas_subscription_payments', v_payment.id::text, _society_id,
      jsonb_build_object('plan_id', _plan_id, 'razorpay_order_id', _razorpay_order_id,
        'razorpay_payment_id', _razorpay_payment_id, 'amount_paise', _amount_paise, 'currency', _currency,
        'flat_count', v_payment.flat_count, 'price_per_flat_inr', v_payment.price_per_flat_inr,
        'custom_offer_id', v_payment.custom_offer_id, 'term_months', v_payment.term_months));
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
    'payment_id', v_payment.id, 'receipt_id', v_receipt.id,
    'receipt_number', v_receipt.receipt_number, 'expires_at', v_expires_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._auto_create_missing_bill(_society_id uuid, _flat_id uuid, _paid_on date, _source_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  s record; v_top text; v_start date; v_end date; v_amount numeric(12,2); v_period uuid;
  sch record; f record; v_bill uuid; v_due integer;
BEGIN
  SELECT id INTO v_top FROM public.plans WHERE id IN ('basic','pro','premium')
   ORDER BY price_per_flat_inr DESC NULLS LAST LIMIT 1;
  SELECT plan_id, plan_status, plan_expires_at INTO s FROM public.societies WHERE id = _society_id;
  IF s.plan_id IS DISTINCT FROM v_top OR s.plan_status IS DISTINCT FROM 'active'
     OR (s.plan_expires_at IS NOT NULL AND s.plan_expires_at < now()) THEN
    RETURN NULL;
  END IF;
  SELECT id, area_sqft, type, is_active INTO f FROM public.flats WHERE id = _flat_id AND society_id = _society_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.society_settings WHERE society_id = _society_id AND coalesce(bill_run_approval_required,false)) THEN
    INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
      VALUES (NULL, 'billing.auto_missing_bill_skipped', 'flats', _flat_id::text, _society_id,
              jsonb_build_object('reason','approval_required','source_id',_source_id));
    RETURN NULL;
  END IF;
  v_start := date_trunc('month', _paid_on)::date;
  v_end := (date_trunc('month', _paid_on) + interval '1 month - 1 day')::date;
  PERFORM pg_advisory_xact_lock(hashtextextended('bill_sched:' || _society_id::text || ':' || _flat_id::text || ':' || v_start::text, 0));
  IF EXISTS (SELECT 1 FROM public.bills WHERE society_id = _society_id AND flat_id = _flat_id
             AND period_start = v_start AND COALESCE(status,'') <> 'cancelled' AND cancelled_at IS NULL) THEN
    RETURN NULL;
  END IF;
  SELECT id, amount_due INTO v_period, v_amount FROM public.maintenance_periods
   WHERE flat_id = _flat_id AND period_start = v_start AND bill_id IS NULL LIMIT 1;
  IF v_amount IS NULL THEN
    SELECT amount INTO v_amount FROM public.unit_billing_overrides WHERE flat_id = _flat_id AND society_id = _society_id;
  END IF;
  SELECT * INTO sch FROM public.billing_schedules WHERE society_id = _society_id;
  IF v_amount IS NULL AND sch.id IS NOT NULL THEN
    v_amount := CASE sch.mode
      WHEN 'per_sqft' THEN sch.amount * COALESCE(f.area_sqft, 0)
      WHEN 'per_bhk' THEN sch.amount * COALESCE(NULLIF(substring(f.type from '(\d)\s*[bB][hH][kK]'),'')::int, 2)
      ELSE sch.amount END;
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
      VALUES (NULL, 'billing.auto_missing_bill_skipped', 'flats', _flat_id::text, _society_id,
              jsonb_build_object('reason','no_amount_source','period_start',v_start,'source_id',_source_id));
    RETURN NULL;
  END IF;
  v_due := COALESCE(sch.due_offset_days, 10);
  BEGIN
    INSERT INTO public.bills(society_id, flat_id, period_label, period_start, period_end, amount, due_date,
        status, bill_number, bill_date, notes)
      VALUES (_society_id, _flat_id, to_char(v_start, 'FMMonth YYYY'), v_start, v_end, round(v_amount, 2),
        v_start + v_due, 'unpaid', public._allocate_bill_number(_society_id, v_start, 'AUTO'), CURRENT_DATE,
        'Created automatically for a verified payment with no bill for this month.')
      RETURNING id INTO v_bill;
  EXCEPTION WHEN unique_violation THEN
    RETURN NULL;
  END;
  IF v_period IS NOT NULL THEN
    INSERT INTO public.bill_line_items(bill_id, society_id, kind, description, amount, maintenance_period_id)
      VALUES (v_bill, _society_id, 'maintenance', 'Maintenance — ' || to_char(v_start, 'FMMonth YYYY'), round(v_amount,2), v_period);
    UPDATE public.maintenance_periods SET bill_id = v_bill, updated_at = now() WHERE id = v_period;
  END IF;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (NULL, 'billing.auto_missing_bill_created', 'bills', v_bill::text, _society_id,
            jsonb_build_object('flat_id', _flat_id, 'period_start', v_start, 'source_id', _source_id));
  RETURN v_bill;
END $$;
REVOKE ALL ON FUNCTION public._auto_create_missing_bill(uuid, uuid, date, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._historical_payment_auto_bill()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM 'confirmed' THEN
    PERFORM public._auto_create_missing_bill(NEW.society_id, NEW.flat_id, NEW.payment_date, NEW.id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_historical_payment_auto_bill ON public.historical_payments;
CREATE TRIGGER trg_historical_payment_auto_bill AFTER UPDATE OF status ON public.historical_payments
  FOR EACH ROW EXECUTE FUNCTION public._historical_payment_auto_bill();