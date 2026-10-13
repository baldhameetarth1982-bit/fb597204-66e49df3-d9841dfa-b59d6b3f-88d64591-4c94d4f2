CREATE OR REPLACE FUNCTION public.admin_platform_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  SELECT coalesce(sum(r.amount_paise),0)/100.0 INTO refunds FROM public.saas_subscription_refunds r
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
END $function$;