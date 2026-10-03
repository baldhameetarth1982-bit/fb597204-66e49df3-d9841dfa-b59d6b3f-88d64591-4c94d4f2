-- AI usage ledger (metadata only: never prompts, outputs or documents)
CREATE TABLE public.ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  feature text NOT NULL CHECK (feature ~ '^[a-z0-9_]{2,40}$'),
  society_id uuid REFERENCES public.societies(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('ok','failed','refused','rate_limited','blocked')),
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0)
);
CREATE INDEX ai_usage_events_created_idx ON public.ai_usage_events (created_at DESC);
CREATE INDEX ai_usage_events_society_idx ON public.ai_usage_events (society_id, created_at DESC);
GRANT SELECT ON public.ai_usage_events TO authenticated;
GRANT ALL ON public.ai_usage_events TO service_role;
ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins read AI usage" ON public.ai_usage_events FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));

-- Manually recorded platform operating costs (SociyoHub's own costs, never society money)
CREATE TABLE public.platform_cost_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month date NOT NULL CHECK (period_month = date_trunc('month', period_month)::date),
  category text NOT NULL CHECK (category IN ('ai','payment_processing','messaging','storage','infrastructure','other')),
  amount_inr numeric(12,2) NOT NULL CHECK (amount_inr > 0),
  note text CHECK (note IS NULL OR char_length(note) <= 300),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text
);
GRANT SELECT ON public.platform_cost_entries TO authenticated;
GRANT ALL ON public.platform_cost_entries TO service_role;
ALTER TABLE public.platform_cost_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins read platform costs" ON public.platform_cost_entries FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));

ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS ai_cost_per_request_inr numeric(10,4) CHECK (ai_cost_per_request_inr IS NULL OR ai_cost_per_request_inr >= 0);

CREATE OR REPLACE FUNCTION public.admin_record_platform_cost(_period date, _category text, _amount numeric, _note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN RETURN jsonb_build_object('status','not_authorized'); END IF;
  IF _period IS NULL OR _amount IS NULL OR _amount <= 0 OR _amount > 100000000
     OR _category NOT IN ('ai','payment_processing','messaging','storage','infrastructure','other') THEN
    RETURN jsonb_build_object('status','invalid_input'); END IF;
  INSERT INTO public.platform_cost_entries(period_month, category, amount_inr, note, created_by)
  VALUES (date_trunc('month', _period)::date, _category, round(_amount, 2), nullif(btrim(left(_note, 300)), ''), auth.uid())
  RETURNING id INTO _id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, metadata)
  VALUES (auth.uid(), 'super_admin.platform_cost_recorded', 'platform_cost_entries', _id,
          jsonb_build_object('category', _category, 'amount_inr', round(_amount,2), 'period', date_trunc('month', _period)::date));
  RETURN jsonb_build_object('status','ok','id',_id);
END $$;

CREATE OR REPLACE FUNCTION public.admin_void_platform_cost(_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN RETURN jsonb_build_object('status','not_authorized'); END IF;
  IF char_length(btrim(coalesce(_reason,''))) < 3 THEN RETURN jsonb_build_object('status','reason_required'); END IF;
  UPDATE public.platform_cost_entries SET voided_at = now(), voided_by = auth.uid(), void_reason = left(btrim(_reason), 300)
   WHERE id = _id AND voided_at IS NULL RETURNING * INTO r;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, metadata)
  VALUES (auth.uid(), 'super_admin.platform_cost_voided', 'platform_cost_entries', _id,
          jsonb_build_object('before', jsonb_build_object('category', r.category, 'amount_inr', r.amount_inr), 'reason', left(btrim(_reason),300)));
  RETURN jsonb_build_object('status','ok');
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_ai_cost_rate(_rate numeric, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _old numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN RETURN jsonb_build_object('status','not_authorized'); END IF;
  IF _rate IS NOT NULL AND (_rate < 0 OR _rate > 1000) THEN RETURN jsonb_build_object('status','invalid_input'); END IF;
  IF char_length(btrim(coalesce(_reason,''))) < 3 THEN RETURN jsonb_build_object('status','reason_required'); END IF;
  SELECT ai_cost_per_request_inr INTO _old FROM public.platform_settings WHERE id = 1;
  UPDATE public.platform_settings SET ai_cost_per_request_inr = _rate, updated_at = now() WHERE id = 1;
  INSERT INTO public.audit_log(actor_id, action, target_table, metadata)
  VALUES (auth.uid(), 'super_admin.ai_cost_rate_set', 'platform_settings',
          jsonb_build_object('before', _old, 'after', _rate, 'reason', left(btrim(_reason),300)));
  RETURN jsonb_build_object('status','ok');
END $$;

-- Platform overview: SociyoHub's own health and business. Aggregates only.
CREATE OR REPLACE FUNCTION public.admin_platform_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m_start timestamptz := date_trunc('month', now());
  v_soc jsonb; v_people jsonb; v_subs jsonb; v_rev jsonb; v_costs jsonb; v_ai jsonb; v_health jsonb;
  gross numeric; refunds numeric; ai_month int; ai_rate numeric; cost_manual numeric; cost_cats text[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN RETURN jsonb_build_object('status','not_authorized'); END IF;

  SELECT jsonb_build_object(
    'total', count(*),
    'active', count(*) FILTER (WHERE coalesce(status,'active') <> 'suspended'),
    'suspended', count(*) FILTER (WHERE status = 'suspended'),
    'paid', count(*) FILTER (WHERE status IS DISTINCT FROM 'suspended' AND lower(coalesce(plan_status,'')) = 'active' AND (plan_expires_at IS NULL OR plan_expires_at > now())),
    'trial', count(*) FILTER (WHERE status IS DISTINCT FROM 'suspended' AND lower(coalesce(plan_status,'')) IN ('trial','trialing') AND trial_ends_at > now()),
    'lapsed', count(*) FILTER (WHERE status IS DISTINCT FROM 'suspended' AND (
        (lower(coalesce(plan_status,'')) IN ('trial','trialing') AND (trial_ends_at IS NULL OR trial_ends_at <= now()))
        OR (lower(coalesce(plan_status,'')) = 'active' AND plan_expires_at <= now())
        OR lower(coalesce(plan_status,'')) IN ('expired','cancelled','canceled','past_due'))),
    'new_30d', count(*) FILTER (WHERE created_at > now() - interval '30 days'),
    'new_prev_30d', count(*) FILTER (WHERE created_at <= now() - interval '30 days' AND created_at > now() - interval '60 days')
  ) INTO v_soc FROM public.societies;

  SELECT jsonb_build_object(
    'users', (SELECT count(DISTINCT user_id) FROM public.user_roles WHERE coalesce(is_active,true) AND role <> 'super_admin'),
    'residents', count(DISTINCT user_id) FILTER (WHERE role = 'resident'),
    'admins', count(DISTINCT user_id) FILTER (WHERE role IN ('society_admin','block_admin')),
    'guards', count(DISTINCT user_id) FILTER (WHERE role = 'security'),
    'staff', count(DISTINCT user_id) FILTER (WHERE role::text = 'staff'),
    'auditors', count(DISTINCT user_id) FILTER (WHERE role::text = 'auditor'),
    'active_7d', (SELECT count(DISTINCT actor_id) FROM public.audit_log WHERE created_at > now() - interval '7 days' AND actor_id IS NOT NULL),
    'active_30d', (SELECT count(DISTINCT actor_id) FROM public.audit_log WHERE created_at > now() - interval '30 days' AND actor_id IS NOT NULL)
  ) INTO v_people FROM public.user_roles WHERE coalesce(is_active,true);

  SELECT jsonb_build_object(
    'starter', count(*) FILTER (WHERE plan_id = 'basic' AND lower(coalesce(plan_status,'')) = 'active'),
    'growth', count(*) FILTER (WHERE plan_id = 'pro' AND lower(coalesce(plan_status,'')) = 'active'),
    'pro', count(*) FILTER (WHERE plan_id = 'premium' AND lower(coalesce(plan_status,'')) = 'active'),
    'custom', count(*) FILTER (WHERE lower(coalesce(plan_status,'')) = 'active' AND plan_id NOT IN ('basic','pro','premium','trial')),
    'expiring_14d', count(*) FILTER (WHERE status IS DISTINCT FROM 'suspended' AND (
        (lower(coalesce(plan_status,'')) = 'active' AND plan_expires_at BETWEEN now() AND now() + interval '14 days')
        OR (lower(coalesce(plan_status,'')) IN ('trial','trialing') AND trial_ends_at BETWEEN now() AND now() + interval '14 days'))),
    'mrr_estimate_inr', coalesce(sum(
        CASE WHEN status IS DISTINCT FROM 'suspended' AND lower(coalesce(plan_status,'')) = 'active' AND (plan_expires_at IS NULL OR plan_expires_at > now())
          THEN (SELECT count(*) FROM public.flats f WHERE f.society_id = s.id AND coalesce(f.is_active,true))
             * CASE plan_id WHEN 'basic' THEN 8 WHEN 'pro' THEN 10 WHEN 'premium' THEN 12 ELSE 0 END
          ELSE 0 END), 0),
    'failed_payments_30d', (SELECT count(*) FROM public.saas_subscription_payments WHERE lifecycle_status = 'failed' AND coalesce(failed_at, updated_at) > now() - interval '30 days'),
    'stuck_payments', (SELECT count(*) FROM public.saas_subscription_payments WHERE lifecycle_status IN ('pending','processing','refund_pending') AND updated_at < now() - interval '1 hour')
  ) INTO v_subs FROM public.societies s;

  SELECT coalesce(sum(amount_paise),0)/100.0 INTO gross FROM public.saas_subscription_payments
   WHERE status = 'captured' AND coalesce(provider_mode,'live') = 'live' AND confirmed_at >= m_start;
  SELECT coalesce(sum(amount_paise),0)/100.0 INTO refunds FROM public.saas_subscription_refunds r
   JOIN public.saas_subscription_payments p ON p.id = r.payment_id
   WHERE r.status = 'processed' AND coalesce(p.provider_mode,'live') = 'live' AND r.processed_at >= m_start;
  v_rev := jsonb_build_object('gross_inr', gross, 'refunds_inr', refunds, 'net_inr', gross - refunds,
    'test_mode_excluded', (SELECT count(*) FROM public.saas_subscription_payments WHERE provider_mode = 'test' AND status = 'captured' AND confirmed_at >= m_start),
    'lifetime_net_inr', (SELECT coalesce(sum(amount_paise),0)/100.0 FROM public.saas_subscription_payments WHERE status='captured' AND coalesce(provider_mode,'live')='live')
      - (SELECT coalesce(sum(r.amount_paise),0)/100.0 FROM public.saas_subscription_refunds r JOIN public.saas_subscription_payments p ON p.id=r.payment_id WHERE r.status='processed' AND coalesce(p.provider_mode,'live')='live'));

  SELECT count(*) INTO ai_month FROM public.ai_usage_events WHERE created_at >= m_start;
  SELECT ai_cost_per_request_inr INTO ai_rate FROM public.platform_settings WHERE id = 1;
  SELECT coalesce(sum(amount_inr),0), coalesce(array_agg(DISTINCT category), '{}') INTO cost_manual, cost_cats
    FROM public.platform_cost_entries WHERE voided_at IS NULL AND period_month = m_start::date;
  v_costs := jsonb_build_object(
    'recorded_inr', cost_manual,
    'recorded_categories', to_jsonb(cost_cats),
    'by_category', coalesce((SELECT jsonb_object_agg(category, total) FROM (SELECT category, sum(amount_inr) total FROM public.platform_cost_entries WHERE voided_at IS NULL AND period_month = m_start::date GROUP BY 1) c), '{}'::jsonb),
    'ai_rate_inr', ai_rate,
    'ai_estimate_inr', CASE WHEN ai_rate IS NULL OR 'ai' = ANY(cost_cats) THEN NULL ELSE round(ai_month * ai_rate, 2) END);

  SELECT jsonb_build_object(
    'month_total', count(*) FILTER (WHERE created_at >= m_start),
    'month_ok', count(*) FILTER (WHERE created_at >= m_start AND status = 'ok'),
    'month_failed', count(*) FILTER (WHERE created_at >= m_start AND status = 'failed'),
    'month_refused', count(*) FILTER (WHERE created_at >= m_start AND status IN ('refused','blocked')),
    'month_rate_limited', count(*) FILTER (WHERE created_at >= m_start AND status = 'rate_limited'),
    'tokens_in', sum(input_tokens) FILTER (WHERE created_at >= m_start),
    'tokens_out', sum(output_tokens) FILTER (WHERE created_at >= m_start),
    'last_24h', count(*) FILTER (WHERE created_at > now() - interval '24 hours'),
    'avg_daily_prev_7d', round(count(*) FILTER (WHERE created_at BETWEEN now() - interval '8 days' AND now() - interval '24 hours') / 7.0, 1),
    'by_feature', coalesce((SELECT jsonb_agg(x ORDER BY (x->>'n')::int DESC) FROM (
        SELECT jsonb_build_object('feature', feature, 'n', count(*), 'failed', count(*) FILTER (WHERE status='failed')) x
        FROM public.ai_usage_events WHERE created_at >= m_start GROUP BY feature) f), '[]'::jsonb),
    'daily', coalesce((SELECT jsonb_agg(jsonb_build_object('d', d, 'n', n) ORDER BY d) FROM (
        SELECT date_trunc('day', created_at)::date d, count(*) n FROM public.ai_usage_events WHERE created_at > now() - interval '14 days' GROUP BY 1) dd), '[]'::jsonb),
    'tracking_since', (SELECT min(created_at) FROM public.ai_usage_events)
  ) INTO v_ai FROM public.ai_usage_events WHERE created_at > LEAST(m_start, now() - interval '14 days');

  SELECT jsonb_build_object(
    'jobs_24h', count(*) FILTER (WHERE started_at > now() - interval '24 hours'),
    'jobs_failed_24h', count(*) FILTER (WHERE started_at > now() - interval '24 hours' AND status NOT IN ('succeeded','running','skipped')),
    'jobs_recovered_7d', coalesce(sum(recovered_count) FILTER (WHERE started_at > now() - interval '7 days'),0),
    'jobs_stuck', count(*) FILTER (WHERE status = 'running' AND started_at < now() - interval '2 hours'),
    'last_job_at', max(started_at),
    'webhooks_failed_7d', (SELECT count(*) FROM public.saas_payment_events WHERE processing_status = 'failed' AND received_at > now() - interval '7 days'),
    'webhooks_unverified_7d', (SELECT count(*) FROM public.saas_payment_events WHERE NOT signature_verified AND received_at > now() - interval '7 days'),
    'webhooks_last_at', (SELECT max(received_at) FROM public.saas_payment_events),
    'razorpay_configured', (SELECT coalesce(razorpay_configured,false) FROM public.platform_settings WHERE id = 1),
    'security_events_7d', (SELECT count(*) FROM public.audit_log WHERE created_at > now() - interval '7 days' AND (action ILIKE 'security.%' OR action ILIKE '%denied%' OR action ILIKE '%revoked%' OR action ILIKE 'auth.%fail%')),
    'app_errors_24h', (SELECT count(*) FROM public.audit_log WHERE created_at > now() - interval '24 hours' AND action ILIKE 'client_error%'),
    'app_errors_prev_24h', (SELECT count(*) FROM public.audit_log WHERE created_at BETWEEN now() - interval '48 hours' AND now() - interval '24 hours' AND action ILIKE 'client_error%')
  ) INTO v_health FROM public.scheduler_job_runs WHERE started_at > now() - interval '7 days';

  RETURN jsonb_build_object('status','ok','generated_at', now(), 'month_start', m_start,
    'societies', v_soc, 'people', v_people, 'subscriptions', v_subs, 'revenue', v_rev, 'costs', v_costs, 'ai', v_ai, 'health', v_health);
END $$;

-- Society Health list: one row per society with health signals (no resident PII).
CREATE OR REPLACE FUNCTION public.admin_society_health_list()
RETURNS TABLE(id uuid, name text, city text, plan_id text, plan_status text, plan_expires_at timestamptz, trial_ends_at timestamptz,
  status text, created_at timestamptz, flats integer, declared_units integer, residents integer, admins integer, guards integer, staff integer,
  pending_joins integer, open_tickets integer, overdue_tickets integer, open_incidents integer, failed_payments integer,
  ai_requests_30d integer, last_activity_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT s.id, s.name, s.city, s.plan_id, s.plan_status, s.plan_expires_at, s.trial_ends_at, s.status, s.created_at,
    (SELECT count(*)::int FROM public.flats f WHERE f.society_id = s.id AND coalesce(f.is_active,true)),
    s.total_units,
    (SELECT count(DISTINCT ur.user_id)::int FROM public.user_roles ur WHERE ur.society_id = s.id AND coalesce(ur.is_active,true) AND ur.role = 'resident'),
    (SELECT count(DISTINCT ur.user_id)::int FROM public.user_roles ur WHERE ur.society_id = s.id AND coalesce(ur.is_active,true) AND ur.role IN ('society_admin','block_admin')),
    (SELECT count(DISTINCT ur.user_id)::int FROM public.user_roles ur WHERE ur.society_id = s.id AND coalesce(ur.is_active,true) AND ur.role = 'security'),
    (SELECT count(DISTINCT ur.user_id)::int FROM public.user_roles ur WHERE ur.society_id = s.id AND coalesce(ur.is_active,true) AND ur.role::text = 'staff'),
    (SELECT count(*)::int FROM public.join_requests j WHERE j.society_id = s.id AND j.status = 'pending'),
    (SELECT count(*)::int FROM public.support_tickets t WHERE t.society_id = s.id AND t.status NOT IN ('resolved','closed')),
    (SELECT count(*)::int FROM public.support_tickets t WHERE t.society_id = s.id AND t.status NOT IN ('resolved','closed') AND t.created_at < now() - interval '7 days'),
    (SELECT count(*)::int FROM public.security_incidents i WHERE i.society_id = s.id AND coalesce(i.status,'open') NOT IN ('resolved','closed')),
    (SELECT count(*)::int FROM public.saas_subscription_payments p WHERE p.society_id = s.id AND p.lifecycle_status = 'failed' AND coalesce(p.failed_at, p.updated_at) > now() - interval '30 days'),
    (SELECT count(*)::int FROM public.ai_usage_events a WHERE a.society_id = s.id AND a.created_at > now() - interval '30 days'),
    (SELECT max(al.created_at) FROM public.audit_log al WHERE al.society_id = s.id)
  FROM public.societies s
  ORDER BY s.created_at DESC;
END $$;

-- Diagnosis: what is wrong with this society, and who owns the fix.
CREATE OR REPLACE FUNCTION public.admin_society_diagnose(_society_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s record; issues jsonb := '[]'::jsonb; n int; flats int; admins int;
  FUNCTION_ADD text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN RETURN jsonb_build_object('status','not_authorized'); END IF;
  SELECT * INTO s FROM public.societies WHERE id = _society_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;

  IF s.status = 'suspended' THEN
    issues := issues || jsonb_build_object('code','suspended','severity','high','owner','platform','title','Society is suspended',
      'detail','Nobody in this society can use SociyoHub until it is restored.','fix','restore');
  END IF;
  IF lower(coalesce(s.plan_status,'')) IN ('trial','trialing') AND (s.trial_ends_at IS NULL OR s.trial_ends_at <= now()) THEN
    issues := issues || jsonb_build_object('code','trial_ended','severity','high','owner','platform','title','Trial has ended without a paid plan',
      'detail','Paid features are locked. A Society Admin can buy a plan from Settings → Plan & billing; Super Admin can extend the trial if agreed with the society.','fix','trial',
      'steps', jsonb_build_array('Society Admin opens Settings → Plan & billing','Chooses Starter, Growth or Pro and pays through Razorpay'));
  ELSIF lower(coalesce(s.plan_status,'')) = 'active' AND s.plan_expires_at <= now() THEN
    issues := issues || jsonb_build_object('code','plan_expired','severity','high','owner','society_admin','title','Paid plan has expired',
      'detail','The society must renew. Super Admin should only grant a plan for a verified offline payment or an agreed exception.',
      'steps', jsonb_build_array('Society Admin opens Settings → Plan & billing','Presses Renew and completes payment'),'fix','grant');
  ELSIF s.plan_expires_at BETWEEN now() AND now() + interval '7 days' OR (lower(coalesce(s.plan_status,'')) IN ('trial','trialing') AND s.trial_ends_at BETWEEN now() AND now() + interval '3 days') THEN
    issues := issues || jsonb_build_object('code','expiring','severity','medium','owner','society_admin','title','Plan or trial ends within days',
      'detail','Remind the Society Admin to choose or renew a plan.','steps', jsonb_build_array('Society Admin opens Settings → Plan & billing'));
  END IF;

  SELECT count(DISTINCT user_id) INTO admins FROM public.user_roles WHERE society_id = s.id AND coalesce(is_active,true) AND role = 'society_admin';
  IF admins = 0 THEN
    issues := issues || jsonb_build_object('code','no_admin','severity','high','owner','escalate','title','No active Society Admin',
      'detail','Nobody can manage this society. Do not assign an admin from here: verify the committee through a support request (registration papers or committee resolution), then send a role invitation to the verified person.',
      'steps', jsonb_build_array('Open a support case and collect proof of committee authority','Confirm the person''s phone number','Invite them as Society Admin and record the reason'));
  END IF;

  SELECT count(*) INTO flats FROM public.flats WHERE society_id = s.id AND coalesce(is_active,true);
  IF flats = 0 THEN
    issues := issues || jsonb_build_object('code','no_flats','severity','medium','owner','society_admin','title','No homes have been set up',
      'detail','Billing, residents and gate features need homes first.','steps', jsonb_build_array('Society Admin opens Society → Blocks & units','Adds blocks, then units (or imports them from Data Import)'));
  ELSIF s.total_units IS NOT NULL AND s.total_units > 0 AND abs(flats - s.total_units) > greatest(2, s.total_units / 10) THEN
    issues := issues || jsonb_build_object('code','unit_mismatch','severity','low','owner','society_admin','title','Home count differs from the declared size',
      'detail', format('%s homes set up, %s declared at sign-up.', flats, s.total_units),'steps', jsonb_build_array('Society Admin reviews Society → Blocks & units'));
  END IF;

  SELECT count(*) INTO n FROM public.join_requests WHERE society_id = s.id AND status = 'pending' AND created_at < now() - interval '3 days';
  IF n > 0 THEN
    issues := issues || jsonb_build_object('code','stale_joins','severity','medium','owner','society_admin','title', format('%s join request(s) waiting over 3 days', n),
      'detail','Residents cannot use the app until approved.','steps', jsonb_build_array('Society Admin opens Residents → Join requests','Approves or rejects each request'));
  END IF;

  SELECT count(*) INTO n FROM public.support_tickets WHERE society_id = s.id AND status NOT IN ('resolved','closed') AND created_at < now() - interval '7 days';
  IF n > 0 THEN
    issues := issues || jsonb_build_object('code','overdue_tickets','severity','medium','owner','society_admin','title', format('%s helpdesk request(s) open over 7 days', n),
      'detail','Residents are waiting on the committee.','steps', jsonb_build_array('Society Admin opens Helpdesk','Filters by Open and oldest first','Assigns staff or replies'));
  END IF;

  SELECT count(*) INTO n FROM public.security_incidents WHERE society_id = s.id AND coalesce(status,'open') NOT IN ('resolved','closed');
  IF n > 0 THEN
    issues := issues || jsonb_build_object('code','open_incidents','severity','medium','owner','society_admin','title', format('%s open security incident(s)', n),
      'detail','Gate incidents are handled by the society''s guards and committee.','steps', jsonb_build_array('Society Admin opens Gate → Incidents','Reviews and resolves each with a note'));
  END IF;

  SELECT count(*) INTO n FROM public.saas_subscription_payments WHERE society_id = s.id AND lifecycle_status = 'failed' AND coalesce(failed_at, updated_at) > now() - interval '30 days';
  IF n > 0 THEN
    issues := issues || jsonb_build_object('code','payment_failed','severity','medium','owner','society_admin','title', format('%s plan payment(s) failed in 30 days', n),
      'detail','No money was taken for failed payments. The admin can retry; check Plan Payments if they report a deduction.','steps', jsonb_build_array('Society Admin retries from Settings → Plan & billing','If money was deducted, Super Admin checks Plan Payments for the order'));
  END IF;

  SELECT count(*) INTO n FROM public.saas_subscription_payments WHERE society_id = s.id AND lifecycle_status IN ('pending','processing') AND updated_at < now() - interval '1 hour';
  IF n > 0 THEN
    issues := issues || jsonb_build_object('code','payment_stuck','severity','high','owner','platform','title', format('%s plan payment(s) stuck in processing', n),
      'detail','Verify with Razorpay in Plan Payments. Never mark a payment paid without provider confirmation.','link','/admin/subscription-payments');
  END IF;

  IF NOT coalesce(s.invite_code_enabled, true) AND (SELECT count(*) FROM public.user_roles WHERE society_id = s.id AND role='resident' AND coalesce(is_active,true)) = 0 AND flats > 0 THEN
    issues := issues || jsonb_build_object('code','invite_off','severity','low','owner','society_admin','title','Invite code is off and no residents have joined',
      'detail','Residents need an invite code or a direct invitation.','steps', jsonb_build_array('Society Admin opens Residents → Invite','Turns on the invite code or invites residents by phone'));
  END IF;

  RETURN jsonb_build_object('status','ok','issues', issues,
    'ai_30d', (SELECT jsonb_build_object('total', count(*), 'failed', count(*) FILTER (WHERE status='failed')) FROM public.ai_usage_events WHERE society_id = s.id AND created_at > now() - interval '30 days'),
    'role_counts', (SELECT coalesce(jsonb_object_agg(role, n), '{}'::jsonb) FROM (SELECT role::text role, count(DISTINCT user_id) n FROM public.user_roles WHERE society_id = s.id AND coalesce(is_active,true) GROUP BY 1) r),
    'last_activity_at', (SELECT max(created_at) FROM public.audit_log WHERE society_id = s.id));
END $$;

REVOKE ALL ON FUNCTION public.admin_platform_overview(), public.admin_society_health_list(), public.admin_society_diagnose(uuid),
  public.admin_record_platform_cost(date,text,numeric,text), public.admin_void_platform_cost(uuid,text), public.admin_set_ai_cost_rate(numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_platform_overview(), public.admin_society_health_list(), public.admin_society_diagnose(uuid),
  public.admin_record_platform_cost(date,text,numeric,text), public.admin_void_platform_cost(uuid,text), public.admin_set_ai_cost_rate(numeric,text) TO authenticated;
