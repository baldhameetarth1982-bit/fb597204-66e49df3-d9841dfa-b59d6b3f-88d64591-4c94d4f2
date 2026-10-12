-- Discount codes (Super Admin managed, private; read only through RPCs)
CREATE TABLE IF NOT EXISTS public.saas_discount_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{3,24}$'),
  percent_off numeric(5,2) NOT NULL CHECK (percent_off > 0 AND percent_off <= 50),
  plan_ids text[] CHECK (plan_ids IS NULL OR plan_ids <@ ARRAY['basic','pro','premium']::text[]),
  valid_from timestamptz,
  valid_until timestamptz,
  max_uses integer CHECK (max_uses IS NULL OR max_uses > 0),
  is_active boolean NOT NULL DEFAULT true,
  note text CHECK (note IS NULL OR char_length(note) <= 200),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS saas_discount_codes_code_uidx ON public.saas_discount_codes (code);
GRANT ALL ON public.saas_discount_codes TO service_role;
ALTER TABLE public.saas_discount_codes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.saas_upi_payment_requests
  ADD COLUMN IF NOT EXISTS discount_code_id uuid REFERENCES public.saas_discount_codes(id),
  ADD COLUMN IF NOT EXISTS gross_amount_paise bigint,
  ADD COLUMN IF NOT EXISTS term_discount_paise bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS code_discount_paise bigint NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS saas_upi_discount_code_idx ON public.saas_upi_payment_requests (discount_code_id) WHERE discount_code_id IS NOT NULL;

-- Term discounts are fixed server-side: quarterly 6%, yearly 8%.
CREATE OR REPLACE FUNCTION public._saas_term_discount_percent(_term integer) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE _term WHEN 3 THEN 6::numeric WHEN 12 THEN 8::numeric ELSE 0::numeric END $$;

CREATE OR REPLACE FUNCTION public.saas_upi_quote(_society_id uuid, _plan_id text, _flat_quantity integer, _term_months integer, _discount_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  q jsonb; v_term integer := COALESCE(_term_months, 1); v_code text; c public.saas_discount_codes%ROWTYPE;
  v_status text; v_month bigint; v_gross bigint; v_tpct numeric; v_tdisc bigint; v_cdisc bigint := 0;
  v_net bigint; v_taxp numeric; v_tax bigint; v_uses integer;
BEGIN
  IF v_term NOT IN (1,3,12) THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023'; END IF;
  q := public.saas_subscription_quote(_society_id, _plan_id, _flat_quantity);
  IF q->>'pricing_type' = 'custom' OR COALESCE((q->>'custom_pricing')::boolean, false) OR q->>'amount_paise' IS NULL THEN
    RETURN q || jsonb_build_object('term_discount_percent', 0, 'term_discount_paise', 0, 'code_discount_paise', 0,
      'gross_amount_paise', q->'base_amount_paise', 'discount_code_status', NULL, 'discount_code_id', NULL);
  END IF;
  v_month := (q->>'base_amount_paise')::bigint;
  v_taxp := COALESCE((q->>'tax_percent')::numeric, 0);
  v_gross := v_month * v_term;
  v_tpct := public._saas_term_discount_percent(v_term);
  v_tdisc := round(v_gross * v_tpct / 100)::bigint;

  v_code := NULLIF(upper(trim(COALESCE(_discount_code, ''))), '');
  IF v_code IS NOT NULL THEN
    SELECT * INTO c FROM public.saas_discount_codes WHERE code = v_code;
    IF NOT FOUND OR NOT c.is_active THEN v_status := 'invalid';
    ELSIF c.valid_from IS NOT NULL AND now() < c.valid_from THEN v_status := 'not_started';
    ELSIF c.valid_until IS NOT NULL AND now() > c.valid_until THEN v_status := 'expired';
    ELSIF c.plan_ids IS NOT NULL AND NOT (_plan_id = ANY (c.plan_ids)) THEN v_status := 'not_for_plan';
    ELSIF EXISTS (SELECT 1 FROM public.saas_upi_payment_requests WHERE discount_code_id = c.id AND society_id = _society_id AND status IN ('pending','approved')) THEN v_status := 'already_used';
    ELSE
      SELECT count(*)::integer INTO v_uses FROM public.saas_upi_payment_requests WHERE discount_code_id = c.id AND status IN ('pending','approved');
      IF c.max_uses IS NOT NULL AND v_uses >= c.max_uses THEN v_status := 'used_up';
      ELSE v_status := 'applied'; v_cdisc := round((v_gross - v_tdisc) * c.percent_off / 100)::bigint; END IF;
    END IF;
  END IF;

  v_net := GREATEST(v_gross - v_tdisc - v_cdisc, 0);
  v_tax := round(v_net * v_taxp / 100)::bigint;
  RETURN q || jsonb_build_object(
    'term_months', v_term, 'gross_amount_paise', v_gross,
    'term_discount_percent', v_tpct, 'term_discount_paise', v_tdisc,
    'discount_code', v_code, 'discount_code_status', v_status,
    'discount_code_percent', CASE WHEN v_status = 'applied' THEN c.percent_off END,
    'discount_code_id', CASE WHEN v_status = 'applied' THEN c.id END,
    'code_discount_paise', v_cdisc,
    'base_amount_paise', v_net, 'tax_amount_paise', v_tax, 'amount_paise', v_net + v_tax);
END $$;
REVOKE ALL ON FUNCTION public.saas_upi_quote(uuid, text, integer, integer, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.saas_upi_quote(uuid, text, integer, integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.submit_saas_upi_payment_v2(
  _society_id uuid, _plan_id text, _flat_quantity integer, _term_months integer, _discount_code text,
  _request_id uuid, _expected_amount_paise integer,
  _utr text, _payer_name text, _payer_upi text, _paid_at timestamptz, _proof_path text, _consent_version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.platform_payment_settings%ROWTYPE; q jsonb; v_id uuid; v_existing public.saas_upi_payment_requests%ROWTYPE;
  v_amount integer;
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
  -- serialise per society so two tabs cannot both use a one-per-society code
  PERFORM pg_advisory_xact_lock(hashtext('saas_upi:' || _society_id::text));
  IF EXISTS (SELECT 1 FROM public.saas_upi_payment_requests WHERE society_id = _society_id AND status = 'pending') THEN
    RAISE EXCEPTION 'already_pending' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.saas_upi_payment_requests WHERE upper(utr) = upper(_utr) AND status IN ('pending','approved')) THEN
    RAISE EXCEPTION 'duplicate_reference' USING ERRCODE = '23505';
  END IF;
  IF NULLIF(trim(COALESCE(_discount_code,'')),'') IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('saas_code:' || upper(trim(_discount_code))));
  END IF;

  q := public.saas_upi_quote(_society_id, _plan_id, _flat_quantity, _term_months, _discount_code);
  IF COALESCE((q->>'custom_pricing')::boolean, false) OR q->>'amount_paise' IS NULL THEN
    RAISE EXCEPTION 'custom_pricing' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(trim(COALESCE(_discount_code,'')),'') IS NOT NULL AND q->>'discount_code_status' IS DISTINCT FROM 'applied' THEN
    RAISE EXCEPTION 'code_invalid' USING ERRCODE = '22023';
  END IF;
  v_amount := (q->>'amount_paise')::integer;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'nothing_due' USING ERRCODE = '22023'; END IF;
  IF v_amount <> _expected_amount_paise THEN RAISE EXCEPTION 'price_changed' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.saas_upi_payment_requests(
    request_id, society_id, plan_id, submitted_by, pricing_type, flat_count, price_per_flat_inr, term_months,
    custom_offer_id, base_amount_paise, tax_amount_paise, tax_percent, amount_paise, payee_vpa,
    utr, payer_name, payer_upi, paid_at, proof_path, consent_version,
    discount_code_id, gross_amount_paise, term_discount_paise, code_discount_paise)
  VALUES (_request_id, _society_id, _plan_id, auth.uid(), COALESCE(q->>'pricing_type','standard'),
    (q->>'flat_count')::integer, (q->>'price_per_flat_inr')::numeric, COALESCE((q->>'term_months')::integer, 1),
    NULLIF(q->>'custom_offer_id','')::uuid, (q->>'base_amount_paise')::bigint, (q->>'tax_amount_paise')::bigint,
    (q->>'tax_percent')::numeric, v_amount, s.upi_vpa,
    upper(trim(_utr)), trim(_payer_name), NULLIF(trim(COALESCE(_payer_upi,'')),''), _paid_at, _proof_path, _consent_version,
    NULLIF(q->>'discount_code_id','')::uuid, (q->>'gross_amount_paise')::bigint,
    COALESCE((q->>'term_discount_paise')::bigint, 0), COALESCE((q->>'code_discount_paise')::bigint, 0))
  RETURNING id INTO v_id;

  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'subscription.upi_submitted', 'saas_upi_payment_requests', v_id::text, _society_id,
    jsonb_build_object('plan_id', _plan_id, 'amount_paise', v_amount, 'term_months', q->'term_months',
      'discount_code', q->'discount_code', 'utr_last4', right(upper(trim(_utr)), 4)));
  RETURN jsonb_build_object('id', v_id, 'status', 'pending', 'replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.submit_saas_upi_payment_v2(uuid, text, integer, integer, text, uuid, integer, text, text, text, timestamptz, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.submit_saas_upi_payment_v2(uuid, text, integer, integer, text, uuid, integer, text, text, text, timestamptz, text, text) TO authenticated;

-- Super Admin discount code management
CREATE OR REPLACE FUNCTION public.admin_list_saas_discount_codes()
RETURNS TABLE(id uuid, code text, percent_off numeric, plan_ids text[], valid_from timestamptz, valid_until timestamptz,
  max_uses integer, is_active boolean, note text, created_at timestamptz, uses integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT d.id, d.code, d.percent_off, d.plan_ids, d.valid_from, d.valid_until, d.max_uses, d.is_active, d.note, d.created_at,
    (SELECT count(*)::integer FROM public.saas_upi_payment_requests r WHERE r.discount_code_id = d.id AND r.status IN ('pending','approved'))
  FROM public.saas_discount_codes d ORDER BY d.created_at DESC LIMIT 200;
END $$;
REVOKE ALL ON FUNCTION public.admin_list_saas_discount_codes() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_saas_discount_codes() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_saas_discount_code(_id uuid, _code text, _percent_off numeric, _plan_ids text[],
  _valid_from timestamptz, _valid_until timestamptz, _max_uses integer, _is_active boolean, _note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_code text := upper(trim(COALESCE(_code,'')));
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF _plan_ids IS NOT NULL AND cardinality(_plan_ids) = 0 THEN _plan_ids := NULL; END IF;
  IF _id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.saas_discount_codes WHERE code = v_code) THEN RAISE EXCEPTION 'code_exists' USING ERRCODE = '23505'; END IF;
    INSERT INTO public.saas_discount_codes(code, percent_off, plan_ids, valid_from, valid_until, max_uses, is_active, note, created_by)
    VALUES (v_code, _percent_off, _plan_ids, _valid_from, _valid_until, _max_uses, COALESCE(_is_active, true), NULLIF(trim(COALESCE(_note,'')),''), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    -- the code text and percent stay fixed once someone has used it, so past quotes stay explainable
    IF EXISTS (SELECT 1 FROM public.saas_upi_payment_requests WHERE discount_code_id = _id)
       AND EXISTS (SELECT 1 FROM public.saas_discount_codes WHERE id = _id AND (code <> v_code OR percent_off <> _percent_off)) THEN
      RAISE EXCEPTION 'code_in_use' USING ERRCODE = '22023';
    END IF;
    UPDATE public.saas_discount_codes SET code = v_code, percent_off = _percent_off, plan_ids = _plan_ids,
      valid_from = _valid_from, valid_until = _valid_until, max_uses = _max_uses, is_active = COALESCE(_is_active, true),
      note = NULLIF(trim(COALESCE(_note,'')),''), updated_at = now()
    WHERE id = _id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = '22023'; END IF;
  END IF;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, metadata)
  VALUES (auth.uid(), 'platform.discount_code_saved', 'saas_discount_codes', v_id::text,
    jsonb_build_object('code', v_code, 'percent_off', _percent_off, 'active', COALESCE(_is_active, true)));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_saas_discount_code(uuid, text, numeric, text[], timestamptz, timestamptz, integer, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_saas_discount_code(uuid, text, numeric, text[], timestamptz, timestamptz, integer, boolean, text) TO authenticated;

-- Renewal reminders: 7, 3, 1 days before, on the day, and the day after expiry (plan or trial).
CREATE OR REPLACE FUNCTION public.send_subscription_renewal_reminders() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n integer := 0; v_days integer; v_title text; v_body text; v_key text;
BEGIN
  IF current_user NOT IN ('postgres','supabase_admin','service_role') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  FOR r IN
    SELECT s.id, s.name, x.ends_at, x.kind
    FROM public.societies s
    CROSS JOIN LATERAL (
      SELECT CASE WHEN s.plan_expires_at IS NOT NULL AND s.plan_expires_at >= COALESCE(s.trial_ends_at, '-infinity') THEN s.plan_expires_at ELSE s.trial_ends_at END AS ends_at,
             CASE WHEN s.plan_expires_at IS NOT NULL AND s.plan_expires_at >= COALESCE(s.trial_ends_at, '-infinity') THEN 'plan' ELSE 'trial' END AS kind
    ) x
    WHERE s.status = 'active' AND x.ends_at IS NOT NULL
      AND x.ends_at BETWEEN now() - interval '2 days' AND now() + interval '8 days'
  LOOP
    v_days := (x_date(r.ends_at) - (now() AT TIME ZONE 'Asia/Kolkata')::date);
    IF v_days NOT IN (7,3,1,0,-1) THEN CONTINUE; END IF;
    v_key := 'saas-renewal:' || r.id::text || ':' || to_char(r.ends_at AT TIME ZONE 'Asia/Kolkata','YYYYMMDD') || ':' || v_days::text;
    v_title := CASE WHEN v_days < 0 THEN 'Your SociyoHub plan has ended'
                    WHEN v_days = 0 THEN 'Your SociyoHub plan ends today'
                    ELSE 'Your SociyoHub plan ends in ' || v_days || CASE WHEN v_days = 1 THEN ' day' ELSE ' days' END END;
    v_body := r.name || ': ' || CASE WHEN r.kind = 'trial' THEN 'the free trial' ELSE 'the subscription' END
      || CASE WHEN v_days < 0 THEN ' has ended. Renew now to keep every feature working.'
              ELSE ' ends on ' || to_char(r.ends_at AT TIME ZONE 'Asia/Kolkata','DD Mon YYYY') || '. Renew now — quarterly and yearly plans save more.' END;
    INSERT INTO public.user_notifications(user_id, society_id, kind, title, body, link, priority, dedupe_key)
    SELECT ur.user_id, r.id, 'subscription', v_title, v_body, '/society/subscription',
           CASE WHEN v_days <= 1 THEN 'high' ELSE 'normal' END, v_key
    FROM public.user_roles ur
    WHERE ur.society_id = r.id AND ur.role = 'society_admin' AND ur.is_active
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    PERFORM public._enqueue_message(r.id, ur.user_id, 'email', 'saas_renewal', v_key, v_title, v_body)
    FROM public.user_roles ur WHERE ur.society_id = r.id AND ur.role = 'society_admin' AND ur.is_active;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.send_subscription_renewal_reminders() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.x_date(_t timestamptz) RETURNS date LANGUAGE sql IMMUTABLE AS $$ SELECT (_t AT TIME ZONE 'Asia/Kolkata')::date $$;

CREATE OR REPLACE FUNCTION public.run_logged_db_job(_job text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE run uuid; k text; n int := 0; daily boolean;
BEGIN
  IF current_user NOT IN ('postgres','supabase_admin','service_role') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  daily := _job IN ('tenancy-expiry','tenancy-renewal-reminders','ops-daily-reminders','document-expiry','class-reminders','subscription-renewal-reminders');
  IF _job NOT IN ('tenancy-expiry','tenancy-renewal-reminders','ops-daily-reminders','amenity-waitlist-expiry','visitor-overstays','notice-publishing','meeting-reminders','vote-closing','document-expiry','class-reminders','election-reminders','material-pass-expiry','scheduler-stall-check','subscription-renewal-reminders') THEN
    RAISE EXCEPTION 'unknown_job';
  END IF;
  k := CASE WHEN daily THEN to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD') ELSE to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24') END;
  run := public.scheduler_run_begin(_job, k);
  IF run IS NULL THEN RETURN 'skipped'; END IF;
  BEGIN
    CASE _job
      WHEN 'tenancy-expiry' THEN n := public.expire_stale_tenancies(); PERFORM public.scheduler_prune_runs();
      WHEN 'tenancy-renewal-reminders' THEN n := public.send_tenancy_renewal_reminders();
      WHEN 'ops-daily-reminders' THEN PERFORM public.ops_daily_reminders();
      WHEN 'amenity-waitlist-expiry' THEN n := public.expire_stale_amenity_waitlist();
      WHEN 'visitor-overstays' THEN n := public.mark_visitor_overstays();
      WHEN 'notice-publishing' THEN n := public.publish_due_notices();
      WHEN 'meeting-reminders' THEN n := public.send_meeting_reminders();
      WHEN 'vote-closing' THEN n := public.close_expired_votes();
      WHEN 'document-expiry' THEN n := public.send_document_expiry_reminders();
      WHEN 'class-reminders' THEN n := public.send_class_reminders();
      WHEN 'election-reminders' THEN n := public.election_reminders();
      WHEN 'material-pass-expiry' THEN n := public.expire_material_passes();
      WHEN 'scheduler-stall-check' THEN n := public.scheduler_mark_stalled();
      WHEN 'subscription-renewal-reminders' THEN n := public.send_subscription_renewal_reminders();
    END CASE;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.scheduler_run_finish(run, 'failed', 0, 1, left(SQLSTATE || ' ' || SQLERRM, 300));
    RETURN 'failed';
  END;
  PERFORM public.scheduler_run_finish(run, 'succeeded', coalesce(n,0), 0, NULL);
  RETURN 'succeeded';
END $function$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'subscription-renewal-reminders-daily';
SELECT cron.schedule('subscription-renewal-reminders-daily', '0 4 * * *', $$SELECT public.run_logged_db_job('subscription-renewal-reminders')$$);