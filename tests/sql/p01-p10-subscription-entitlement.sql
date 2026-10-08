-- SociyoHub P02/P08/P09/P10 database harness: subscription access, standard pricing, custom plans
-- above 300 flats, purchased-flat entitlement, and custom-plan email-link destination authorization.
--
-- Acts as synthetic signed-in users (and the server-only service role, exactly as the checkout server
-- functions do) against the real RPCs, triggers and RLS. RLS is never disabled.
-- Safety contract: synthetic fixed IDs (prefix 5e5e0000-), *.invalid emails, "[QA]" society names, one DO
-- block that ALWAYS ends with RAISE EXCEPTION, so every row it creates (and the in-transaction pricing
-- setting it pins to the locked 300-flat rule) is rolled back. Run only on a disposable local database:
--   HARNESS_DB_URL=... bash scripts/run-sql-harness.sh tests/sql/p01-p10-subscription-entitlement.sql P0110B_RESULT <min>
-- Output: P0110B_RESULT|pass=<n>|fail=<n>|<OK or failures>|groups=<per-group pass counts>

CREATE OR REPLACE FUNCTION pg_temp.qa_act(_uid uuid, _svc boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  IF _svc THEN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    PERFORM set_config('role', 'service_role', true);
  ELSIF _uid IS NULL THEN
    PERFORM set_config('request.jwt.claims', '', true);
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
  END IF;
END $$;

-- Runs one statement as _uid inside a subtransaction; returns its single text value, or 'ERR:<message>'.
CREATE OR REPLACE FUNCTION pg_temp.qa_run(_uid uuid, _q text, _svc boolean DEFAULT false) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  BEGIN
    PERFORM pg_temp.qa_act(_uid, _svc);
    EXECUTE _q INTO v;
    PERFORM pg_temp.qa_act(NULL);
    RETURN coalesce(v, '<null>');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.qa_act(NULL);
    RETURN 'ERR:' || SQLERRM;
  END;
END $$;

-- Runs one statement as the anonymous (signed-out) Data API role.
CREATE OR REPLACE FUNCTION pg_temp.qa_run_anon(_q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    PERFORM set_config('role', 'anon', true);
    EXECUTE _q INTO v;
    PERFORM pg_temp.qa_act(NULL);
    RETURN coalesce(v, '<null>');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.qa_act(NULL);
    RETURN 'ERR:' || SQLERRM;
  END;
END $$;

-- Records one check. Counters live in transaction-local settings so they survive until the final RAISE.
CREATE OR REPLACE FUNCTION pg_temp.qa_ck(_name text, _ok boolean, _detail text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE g jsonb := coalesce(nullif(current_setting('qa.groups', true), ''), '{}')::jsonb; k text := split_part(_name, '.', 1);
BEGIN
  IF coalesce(_ok, false) THEN
    PERFORM set_config('qa.pass', (coalesce(nullif(current_setting('qa.pass', true), ''), '0')::int + 1)::text, true);
    g := jsonb_set(g, ARRAY[k], to_jsonb(coalesce((g->>k)::int, 0) + 1));
    PERFORM set_config('qa.groups', g::text, true);
  ELSE
    PERFORM set_config('qa.fail', (coalesce(nullif(current_setting('qa.fail', true), ''), '0')::int + 1)::text, true);
    PERFORM set_config('qa.failures', coalesce(nullif(current_setting('qa.failures', true), ''), '') || _name || ' => ' || left(coalesce(_detail, '<null>'), 160) || ' ;; ', true);
  END IF;
END $$;


DO $p0110b$
DECLARE
  ids jsonb := '{
    "S90":"5e5e0000-0000-4000-8000-00000000a001", "S150":"5e5e0000-0000-4000-8000-00000000b001",
    "S300":"5e5e0000-0000-4000-8000-00000000c001", "S310":"5e5e0000-0000-4000-8000-00000000d001",
    "SC":"5e5e0000-0000-4000-8000-00000000e001",
    "A90":"5e5e0000-0000-4000-8000-00000000a101", "R90":"5e5e0000-0000-4000-8000-00000000a102",
    "G90":"5e5e0000-0000-4000-8000-00000000a103", "A150":"5e5e0000-0000-4000-8000-00000000b101",
    "A300":"5e5e0000-0000-4000-8000-00000000c101", "A310":"5e5e0000-0000-4000-8000-00000000d101",
    "AC":"5e5e0000-0000-4000-8000-00000000e101", "RC":"5e5e0000-0000-4000-8000-00000000e102",
    "SU":"5e5e0000-0000-4000-8000-00000000f101",
    "Q90":"5e5e0000-0000-4000-8000-00000000a501", "QC1":"5e5e0000-0000-4000-8000-00000000e501",
    "QC2":"5e5e0000-0000-4000-8000-00000000e502", "RAND":"5e5e0000-0000-4000-8000-00000000ffff"
  }'::jsonb;
  r text; j jsonb; v_req uuid; v_offer uuid; v_rec uuid; v_exp1 timestamptz; v_exp2 timestamptz; v_threshold int;
  v_total bigint; v_base bigint;
  pass int; fail int; failures text; groups text;
BEGIN
  PERFORM set_config('qa.pass', '0', true); PERFORM set_config('qa.fail', '0', true);
  PERFORM set_config('qa.failures', '', true); PERFORM set_config('qa.groups', '{}', true);

  -- P08 baseline: the locked standard ceiling is 300 flats. Read the platform setting as replayed.
  SELECT COALESCE(enterprise_threshold_units, 300) INTO v_threshold FROM public.pricing_settings WHERE id = 1;
  PERFORM pg_temp.qa_ck('p08.standard_ceiling_setting_is_300', COALESCE(v_threshold, 300) = 300, 'enterprise_threshold_units=' || COALESCE(v_threshold::text, 'null'));
  -- Remaining checks evaluate the locked rule (300) inside this rolled-back transaction.
  UPDATE public.pricing_settings SET enterprise_threshold_units = 300 WHERE id = 1;

  -- Fixtures (synthetic only) --------------------------------------------------------------
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT (ids->>u)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'qa-p0110b-' || lower(u) || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()
  FROM unnest(ARRAY['A90','R90','G90','A150','A300','A310','AC','RC','SU']) u;
  INSERT INTO public.societies (id, name, city, plan, plan_id, plan_status, plan_expires_at, status, structure_mode)
  SELECT (ids->>s)::uuid, '[QA] P0110B ' || s, 'Testville', 'trial', 'trial', 'trialing', now() + interval '14 days', 'active', 'serial'
  FROM unnest(ARRAY['S90','S150','S300','S310','SC']) s;
  INSERT INTO public.flats (society_id, flat_number, unit_type)
  SELECT (ids->>v.s)::uuid, 'Q-' || g, 'flat'
  FROM (VALUES ('S90',90),('S150',150),('S300',300),('S310',310),('SC',450)) v(s, n), generate_series(1, v.n) g;
  PERFORM set_config('app.allow_society_change', 'on', true);
  INSERT INTO public.profiles (id, full_name, society_id)
  SELECT (ids->>u)::uuid, 'QA P0110B ' || u, CASE WHEN s IS NULL THEN NULL ELSE (ids->>s)::uuid END
  FROM (VALUES ('A90','S90'),('R90','S90'),('G90','S90'),('A150','S150'),('A300','S300'),('A310','S310'),
               ('AC','SC'),('RC','SC'),('SU',NULL)) v(u, s)
  ON CONFLICT (id) DO UPDATE SET society_id = excluded.society_id, full_name = excluded.full_name;
  INSERT INTO public.user_roles (user_id, role, society_id, is_active)
  SELECT (ids->>u)::uuid, v.rl::public.app_role, CASE WHEN s IS NULL THEN NULL ELSE (ids->>s)::uuid END, true
  FROM (VALUES ('A90','society_admin','S90'),('R90','resident','S90'),('G90','security','S90'),('A150','society_admin','S150'),
               ('A300','society_admin','S300'),('A310','society_admin','S310'),('AC','society_admin','SC'),
               ('RC','resident','SC'),('SU','super_admin',NULL)) v(u, rl, s);
  INSERT INTO public.flat_residents (flat_id, user_id, relationship, is_primary, is_active)
  SELECT (SELECT id FROM public.flats WHERE society_id = (ids->>s)::uuid ORDER BY flat_number LIMIT 1), (ids->>u)::uuid, 'owner', true, true
  FROM (VALUES ('S90','R90'),('SC','RC')) v(s, u);

  -- P08 — standard pricing -------------------------------------------------------------------
  PERFORM pg_temp.qa_ck('p08.rates_are_8_10_12',
    (SELECT array_agg(price_per_flat_inr ORDER BY id) FROM public.plans WHERE id IN ('basic','premium','pro')) = ARRAY[8.00,12.00,10.00]::numeric[], NULL);
  r := pg_temp.qa_run((ids->>'A90')::uuid, format('select public.saas_subscription_quote(%L,''basic'')::text', ids->>'S90'));
  j := CASE WHEN r LIKE 'ERR:%' THEN NULL ELSE r::jsonb END;
  PERFORM pg_temp.qa_ck('p08.s90_starter_quote_is_90x8', (j->>'flat_count')::int = 90 AND (j->>'amount_paise')::bigint = 90 * 8 * 100, r);
  PERFORM pg_temp.qa_ck('p08.no_platform_fee_or_tax_added', (j->>'tax_amount_paise')::bigint = 0 AND (j->>'amount_paise') = (j->>'base_amount_paise')
    AND NOT (j ? 'platform_fee_paise'), r);
  PERFORM pg_temp.qa_ck('p08.legacy_monthly_price_not_used', (j->>'amount_paise')::bigint NOT IN (79900, 99900, 149900, 199900, 299900, 499900), r);
  r := pg_temp.qa_run((ids->>'A150')::uuid, format('select public.saas_subscription_quote(%L,''pro'')::text', ids->>'S150'));
  PERFORM pg_temp.qa_ck('p08.s150_growth_quote_is_150x10', r NOT LIKE 'ERR:%' AND (r::jsonb->>'amount_paise')::bigint = 150 * 10 * 100, r);
  r := pg_temp.qa_run((ids->>'A300')::uuid, format('select public.saas_subscription_quote(%L,''premium'')::text', ids->>'S300'));
  PERFORM pg_temp.qa_ck('p08.s300_pro_quote_is_300x12', r NOT LIKE 'ERR:%' AND (r::jsonb->>'amount_paise')::bigint = 300 * 12 * 100
    AND NOT (r::jsonb->>'custom_pricing')::boolean, r);
  r := pg_temp.qa_run((ids->>'A310')::uuid, format('select public.saas_subscription_quote(%L,''premium'')::text', ids->>'S310'));
  PERFORM pg_temp.qa_ck('p08.over_300_requires_custom', r NOT LIKE 'ERR:%' AND (r::jsonb->>'custom_pricing')::boolean AND (r::jsonb->>'amount_paise') IS NULL, r);
  r := pg_temp.qa_run((ids->>'A90')::uuid, format('select public.saas_subscription_quote(%L,''basic'',301)::text', ids->>'S90'));
  PERFORM pg_temp.qa_ck('p08.standard_quantity_301_not_priced', r NOT LIKE 'ERR:%' AND (r::jsonb->>'amount_paise') IS NULL, r);
  r := pg_temp.qa_run((ids->>'A90')::uuid, format('select public.saas_subscription_quote(%L,''basic'',0)::text', ids->>'S90'));
  PERFORM pg_temp.qa_ck('p08.zero_quantity_rejected', r LIKE 'ERR:%invalid_input%', r);
  r := pg_temp.qa_run((ids->>'A90')::uuid, format('select public.saas_subscription_quote(%L,''basic'',-5)::text', ids->>'S90'));
  PERFORM pg_temp.qa_ck('p08.negative_quantity_rejected', r LIKE 'ERR:%invalid_input%', r);
  r := pg_temp.qa_run((ids->>'A90')::uuid, format('select public.saas_subscription_quote(%L,''basic'',80)::text', ids->>'S90'));
  PERFORM pg_temp.qa_ck('p08.below_current_cannot_underpay', r LIKE 'ERR:%' OR ((r::jsonb->>'flat_count')::int >= 90 AND (r::jsonb->>'amount_paise')::bigint >= 90 * 8 * 100), r);
  r := pg_temp.qa_run((ids->>'A90')::uuid, format('select public.saas_subscription_quote(%L,''trial'')::text', ids->>'S90'));
  PERFORM pg_temp.qa_ck('p08.non_paid_plan_not_quotable', r LIKE 'ERR:%', r);
  r := pg_temp.qa_run(NULL, format('select public.claim_saas_subscription_order(%L,%L,''basic'',%L,%s,''INR'',''test'')::text', ids->>'Q90', ids->>'S90', ids->>'A90', 1), true);
  PERFORM pg_temp.qa_ck('p08.tampered_amount_rejected', r LIKE 'ERR:%amount_mismatch%', r);
  r := pg_temp.qa_run(NULL, format('select public.claim_saas_subscription_order(%L,%L,''premium'',%L,%s,''INR'',''test'')::text', ids->>'Q90', ids->>'S310', ids->>'A310', 310 * 12 * 100), true);
  PERFORM pg_temp.qa_ck('p08.over_300_checkout_refused', r LIKE 'ERR:%custom_pricing_required%', r);
  r := pg_temp.qa_run(NULL, format('update public.plans set price_per_flat_inr = 1 where id = ''basic'' returning 1'), false);
  PERFORM pg_temp.qa_ck('p08.anonymous_cannot_change_rates', (SELECT price_per_flat_inr FROM public.plans WHERE id = 'basic') = 8, r);
  r := pg_temp.qa_run((ids->>'A90')::uuid, 'with u as (update public.plans set price_per_flat_inr = 1 where id = ''basic'' returning 1) select count(*)::text from u');
  PERFORM pg_temp.qa_ck('p08.society_admin_cannot_change_rates', (SELECT price_per_flat_inr FROM public.plans WHERE id = 'basic') = 8, r);

  -- P02 — subscription management access ------------------------------------------------------
  r := pg_temp.qa_run((ids->>'R90')::uuid, format('select public.saas_subscription_quote(%L,''basic'')::text', ids->>'S90'));
  PERFORM pg_temp.qa_ck('p02.resident_cannot_quote', r LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'G90')::uuid, format('select public.saas_subscription_quote(%L,''basic'')::text', ids->>'S90'));
  PERFORM pg_temp.qa_ck('p02.guard_cannot_quote', r LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'A150')::uuid, format('select public.saas_subscription_quote(%L,''basic'')::text', ids->>'S90'));
  PERFORM pg_temp.qa_ck('p02.other_society_admin_cannot_quote', r LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'R90')::uuid, format('select public.get_society_flat_entitlement(%L)::text', ids->>'S90'));
  PERFORM pg_temp.qa_ck('p02.resident_cannot_read_entitlement', r LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'G90')::uuid, format('select public.get_society_flat_entitlement(%L)::text', ids->>'S90'));
  PERFORM pg_temp.qa_ck('p02.guard_cannot_read_entitlement', r LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'A90')::uuid, format('select public.claim_saas_subscription_order(%L,%L,''basic'',%L,%s,''INR'',''test'')::text', ids->>'Q90', ids->>'S90', ids->>'A90', 72000));
  PERFORM pg_temp.qa_ck('p02.admin_cannot_claim_order_directly', r LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'A90')::uuid, format('select public.finalize_saas_subscription_payment(%L,''premium'',%L,''order_QAX'',''pay_QAX'',100,''INR'',''captured'')::text', ids->>'S90', ids->>'A90'));
  PERFORM pg_temp.qa_ck('p02.admin_cannot_self_activate', r LIKE 'ERR:%' AND (SELECT plan_id FROM public.societies WHERE id = (ids->>'S90')::uuid) = 'trial', r);
  r := pg_temp.qa_run((ids->>'A90')::uuid, format('with u as (update public.societies set plan_id = ''premium'', plan_status = ''active'', purchased_flat_quantity = 9999 where id=%L returning 1) select count(*)::text from u', ids->>'S90'));
  PERFORM pg_temp.qa_ck('p02.admin_cannot_write_plan_or_quantity',
    (SELECT plan_id = 'trial' AND purchased_flat_quantity IS NULL FROM public.societies WHERE id = (ids->>'S90')::uuid), r);
  r := pg_temp.qa_run((ids->>'R90')::uuid, format('select public.request_custom_plan(%L, 450, ''premium'', null)::text', ids->>'S90'));
  PERFORM pg_temp.qa_ck('p02.resident_cannot_request_custom_plan', r LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'G90')::uuid, format('select public.request_custom_plan(%L, 450, ''premium'', null)::text', ids->>'S90'));
  PERFORM pg_temp.qa_ck('p02.guard_cannot_request_custom_plan', r LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'SU')::uuid, format('select public.saas_subscription_quote(%L,''basic'')::text', ids->>'S90'));
  PERFORM pg_temp.qa_ck('p02.super_admin_can_quote', r NOT LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'SU')::uuid, format('select public.finalize_saas_subscription_payment(%L,''premium'',%L,''order_QAY'',''pay_QAY'',100,''INR'',''captured'')::text', ids->>'S90', ids->>'SU'));
  PERFORM pg_temp.qa_ck('p02.super_admin_cannot_bypass_payment', r LIKE 'ERR:%', r);

  -- P10 — standard purchase sets the purchased quantity ---------------------------------------
  r := pg_temp.qa_run((ids->>'A150')::uuid, format('select public.get_society_flat_entitlement(%L)::text', ids->>'S150'));
  PERFORM pg_temp.qa_ck('p10.no_purchase_means_unrecorded_not_300', r NOT LIKE 'ERR:%' AND (r::jsonb->>'purchased') IS NULL AND r::jsonb->>'state' = 'unrecorded', r);
  r := pg_temp.qa_run(NULL, format('select public.claim_saas_subscription_order(%L,%L,''basic'',%L,%s,''INR'',''test'')::text', ids->>'Q90', ids->>'S90', ids->>'A90', 72000), true);
  PERFORM pg_temp.qa_ck('p10.standard_order_claimed', r LIKE '%claimed%', r);
  IF r NOT LIKE 'ERR:%' THEN v_rec := (r::jsonb->>'request_record_id')::uuid; END IF;
  r := pg_temp.qa_run(NULL, format('select public.claim_saas_subscription_order(%L,%L,''basic'',%L,%s,''INR'',''test'')::text', ids->>'Q90', ids->>'S90', ids->>'A90', 72000), true);
  PERFORM pg_temp.qa_ck('p10.order_claim_idempotent', r NOT LIKE 'ERR:%' AND (SELECT count(*) FROM public.saas_subscription_order_requests WHERE request_id = (ids->>'Q90')::uuid) = 1, r);
  r := pg_temp.qa_run(NULL, format('select public.complete_saas_subscription_order(%L, ''order_QA90'')::text', v_rec), true);
  r := pg_temp.qa_run(NULL, format('select public.finalize_saas_subscription_payment(%L,''basic'',%L,''order_QA90'',''pay_QA90'',72000,''INR'',''captured'')::text', ids->>'S90', ids->>'A90'), true);
  PERFORM pg_temp.qa_ck('p10.standard_payment_activates', r LIKE '%success%' AND (SELECT plan_id = 'basic' AND plan_status = 'active' AND pricing_type = 'standard' FROM public.societies WHERE id = (ids->>'S90')::uuid), r);
  r := pg_temp.qa_run(NULL, format('select public.finalize_saas_subscription_payment(%L,''basic'',%L,''order_QA90'',''pay_QA90'',72000,''INR'',''captured'')::text', ids->>'S90', ids->>'A90'), true);
  PERFORM pg_temp.qa_ck('p10.finalize_replay_single_receipt', r LIKE '%already_confirmed%'
    AND (SELECT count(*) FROM public.saas_subscription_receipts WHERE society_id = (ids->>'S90')::uuid) = 1, r);
  r := pg_temp.qa_run((ids->>'A90')::uuid, format('select public.get_society_flat_entitlement(%L)::text', ids->>'S90'));
  PERFORM pg_temp.qa_ck('p10.s90_purchased_90_current_90_available_0', r NOT LIKE 'ERR:%' AND (r::jsonb->>'purchased')::int = 90
    AND (r::jsonb->>'current')::int = 90 AND (r::jsonb->>'available')::int = 0, r);
  r := pg_temp.qa_run((ids->>'A90')::uuid, format('select public.saas_subscription_quote(%L,''basic'',110)::text', ids->>'S90'));
  PERFORM pg_temp.qa_ck('p10.request_110_is_a_new_purchase_quote', r NOT LIKE 'ERR:%' AND (r::jsonb->>'flat_count')::int = 110 AND (r::jsonb->>'amount_paise')::bigint = 110 * 8 * 100
    AND (SELECT purchased_flat_quantity FROM public.societies WHERE id = (ids->>'S90')::uuid) = 90, r);
  BEGIN
    INSERT INTO public.flats (society_id, flat_number, unit_type) VALUES ((ids->>'S90')::uuid, 'Q-91', 'flat');
    PERFORM pg_temp.qa_ck('p10.standard_91st_flat_blocked', false, 'insert succeeded');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.qa_ck('p10.standard_91st_flat_blocked', SQLERRM LIKE '%flat_capacity_reached%', SQLERRM);
  END;

  -- P09 — custom plan above 300 flats --------------------------------------------------------
  r := pg_temp.qa_run((ids->>'AC')::uuid, format('select public.request_custom_plan(%L, 250, ''premium'', null)::text', ids->>'SC'));
  PERFORM pg_temp.qa_ck('p09.request_at_or_below_300_rejected', r LIKE 'ERR:%invalid_input%', r);
  r := pg_temp.qa_run((ids->>'A90')::uuid, format('select public.request_custom_plan(%L, 450, ''premium'', null)::text', ids->>'SC'));
  PERFORM pg_temp.qa_ck('p09.other_society_cannot_request_for_sc', r LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'AC')::uuid, format('select public.request_custom_plan(%L, 450, ''premium'', ''QA we need 450 flats'')::text', ids->>'SC'));
  PERFORM pg_temp.qa_ck('p09.admin_requests_450', r LIKE '%created%', r);
  IF r NOT LIKE 'ERR:%' THEN v_req := (r::jsonb->>'request_id')::uuid; END IF;
  r := pg_temp.qa_run((ids->>'AC')::uuid, format('select public.request_custom_plan(%L, 450, ''premium'', null)::text', ids->>'SC'));
  PERFORM pg_temp.qa_ck('p09.repeat_request_returns_existing', r LIKE '%existing%' AND (r::jsonb->>'request_id')::uuid = v_req
    AND (SELECT count(*) FROM public.custom_plan_requests WHERE society_id = (ids->>'SC')::uuid) = 1, r);
  PERFORM pg_temp.qa_ck('p09.request_owned_by_requesting_society', (SELECT society_id = (ids->>'SC')::uuid AND requested_by = (ids->>'AC')::uuid FROM public.custom_plan_requests WHERE id = v_req), NULL);
  r := pg_temp.qa_run((ids->>'AC')::uuid, format('select public.custom_plan_post_message(%L, ''QA society message'')::text', v_req));
  PERFORM pg_temp.qa_ck('p09.society_admin_posts_message', r NOT LIKE 'ERR:%' AND (SELECT sender_side FROM public.custom_plan_messages WHERE id = r::uuid) = 'society', r);
  r := pg_temp.qa_run((ids->>'SU')::uuid, format('select public.custom_plan_post_message(%L, ''QA platform reply'')::text', v_req));
  PERFORM pg_temp.qa_ck('p09.super_admin_posts_as_platform', r NOT LIKE 'ERR:%' AND (SELECT sender_side FROM public.custom_plan_messages WHERE id = r::uuid) = 'platform', r);
  r := pg_temp.qa_run((ids->>'A90')::uuid, format('select public.custom_plan_post_message(%L, ''QA intrusion'')::text', v_req));
  PERFORM pg_temp.qa_ck('p09.other_society_cannot_post', r LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'RC')::uuid, format('select public.custom_plan_post_message(%L, ''QA resident'')::text', v_req));
  PERFORM pg_temp.qa_ck('p09.resident_cannot_post', r LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'AC')::uuid, format('select public.admin_create_custom_offer(%L,''premium'',1,450,12,current_date)::text', v_req));
  PERFORM pg_temp.qa_ck('p09.society_cannot_create_own_offer', r LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'SU')::uuid, format('select public.admin_create_custom_offer(%L,''premium'',9,450,12,current_date)::text', v_req));
  PERFORM pg_temp.qa_ck('p09.super_admin_creates_offer', r NOT LIKE 'ERR:%', r);
  IF r NOT LIKE 'ERR:%' THEN v_offer := r::uuid; END IF;
  SELECT base_amount_paise, total_amount_paise INTO v_base, v_total FROM public.custom_plan_offers WHERE id = v_offer;
  PERFORM pg_temp.qa_ck('p09.offer_terms_server_calculated', v_base = 450 * 9 * 12 * 100
    AND v_total = v_base + (SELECT tax_amount_paise FROM public.custom_plan_offers WHERE id = v_offer), v_base::text || '/' || v_total::text);
  r := pg_temp.qa_run((ids->>'AC')::uuid, format('with u as (update public.custom_plan_offers set rate_per_flat_inr = 1, total_amount_paise = 100, flat_quantity = 500 where id=%L returning 1) select count(*)::text from u', v_offer));
  PERFORM pg_temp.qa_ck('p09.society_cannot_edit_offer_terms', (SELECT rate_per_flat_inr = 9 AND flat_quantity = 450 AND total_amount_paise = v_total FROM public.custom_plan_offers WHERE id = v_offer), r);
  r := pg_temp.qa_run((ids->>'A90')::uuid, format('select public.respond_custom_offer(%L, true)::text', v_offer));
  PERFORM pg_temp.qa_ck('p09.other_society_cannot_accept', r LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'AC')::uuid, format('select public.respond_custom_offer(%L, true)::text', v_offer));
  PERFORM pg_temp.qa_ck('p09.society_accepts_offer', r LIKE '%accepted%', r);
  r := pg_temp.qa_run((ids->>'AC')::uuid, format('select public.respond_custom_offer(%L, true)::text', v_offer));
  PERFORM pg_temp.qa_ck('p09.accept_is_idempotent', r LIKE '%already%', r);
  r := pg_temp.qa_run((ids->>'AC')::uuid, format('select public.saas_subscription_quote(%L,''premium'',500)::text', ids->>'SC'));
  PERFORM pg_temp.qa_ck('p09.accepted_offer_is_authoritative', r NOT LIKE 'ERR:%' AND r::jsonb->>'pricing_type' = 'custom'
    AND (r::jsonb->>'flat_count')::int = 450 AND (r::jsonb->>'amount_paise')::bigint = v_total, r);
  r := pg_temp.qa_run(NULL, format('select public.claim_saas_subscription_order(%L,%L,''premium'',%L,%s,''INR'',''test'')::text', ids->>'QC1', ids->>'SC', ids->>'AC', 100), true);
  PERFORM pg_temp.qa_ck('p09.tampered_custom_amount_rejected', r LIKE 'ERR:%amount_mismatch%', r);
  r := pg_temp.qa_run(NULL, format('select public.claim_saas_subscription_order(%L,%L,''premium'',%L,%s,''INR'',''test'')::text', ids->>'QC1', ids->>'SC', ids->>'AC', v_total), true);
  PERFORM pg_temp.qa_ck('p09.custom_order_uses_same_checkout', r LIKE '%claimed%', r);
  IF r NOT LIKE 'ERR:%' THEN v_rec := (r::jsonb->>'request_record_id')::uuid; END IF;
  r := pg_temp.qa_run(NULL, format('select public.complete_saas_subscription_order(%L, ''order_QAC1'')::text', v_rec), true);
  r := pg_temp.qa_run(NULL, format('select public.finalize_saas_subscription_payment(%L,''premium'',%L,''order_QAC1'',''pay_QAC1'',%s,''INR'',''captured'')::text', ids->>'SC', ids->>'AC', v_total), true);
  PERFORM pg_temp.qa_ck('p09.payment_activates_custom_plan', r LIKE '%success%' AND (SELECT pricing_type = 'custom' AND purchased_flat_quantity = 450
    AND subscription_term_months = 12 AND custom_offer_id = v_offer AND plan_status = 'active' FROM public.societies WHERE id = (ids->>'SC')::uuid), r);
  PERFORM pg_temp.qa_ck('p09.offer_and_request_active', (SELECT status FROM public.custom_plan_offers WHERE id = v_offer) = 'active'
    AND (SELECT status FROM public.custom_plan_requests WHERE id = v_req) = 'active', NULL);
  PERFORM pg_temp.qa_ck('p09.single_payment_engine', (SELECT count(*) FROM public.saas_subscription_payments WHERE society_id = (ids->>'SC')::uuid AND custom_offer_id = v_offer) = 1
    AND (SELECT count(*) FROM public.saas_subscription_receipts WHERE society_id = (ids->>'SC')::uuid) = 1, NULL);
  SELECT plan_expires_at INTO v_exp1 FROM public.societies WHERE id = (ids->>'SC')::uuid;
  r := pg_temp.qa_run(NULL, format('select public.claim_saas_subscription_order(%L,%L,''premium'',%L,%s,''INR'',''test'')::text', ids->>'QC2', ids->>'SC', ids->>'AC', v_total), true);
  IF r NOT LIKE 'ERR:%' THEN v_rec := (r::jsonb->>'request_record_id')::uuid; END IF;
  r := pg_temp.qa_run(NULL, format('select public.complete_saas_subscription_order(%L, ''order_QAC2'')::text', v_rec), true);
  r := pg_temp.qa_run(NULL, format('select public.finalize_saas_subscription_payment(%L,''premium'',%L,''order_QAC2'',''pay_QAC2'',%s,''INR'',''captured'')::text', ids->>'SC', ids->>'AC', v_total), true);
  SELECT plan_expires_at INTO v_exp2 FROM public.societies WHERE id = (ids->>'SC')::uuid;
  PERFORM pg_temp.qa_ck('p09.renewal_same_engine_extends_term', r LIKE '%success%' AND v_exp2 >= v_exp1 + interval '12 months' - interval '1 day'
    AND (SELECT purchased_flat_quantity FROM public.societies WHERE id = (ids->>'SC')::uuid) = 450
    AND (SELECT count(*) FROM public.saas_subscription_receipts WHERE society_id = (ids->>'SC')::uuid) = 2, r);
  r := pg_temp.qa_run((ids->>'SU')::uuid, format('select public.admin_apply_custom_plan(%L, ''QA'')::text', v_offer));
  PERFORM pg_temp.qa_ck('p09.legacy_unpaid_activation_retired', r LIKE 'ERR:%', r);

  -- P10 — custom entitlement 450 -------------------------------------------------------------
  r := pg_temp.qa_run((ids->>'AC')::uuid, format('select public.get_society_flat_entitlement(%L)::text', ids->>'SC'));
  PERFORM pg_temp.qa_ck('p10.custom_450_450_available_0', (r::jsonb->>'purchased')::int = 450 AND (r::jsonb->>'current')::int = 450 AND (r::jsonb->>'available')::int = 0, r);
  UPDATE public.flats SET is_active = false WHERE id IN (SELECT id FROM public.flats WHERE society_id = (ids->>'SC')::uuid AND is_active ORDER BY flat_number DESC LIMIT 30);
  r := pg_temp.qa_run((ids->>'AC')::uuid, format('select public.get_society_flat_entitlement(%L)::text', ids->>'SC'));
  PERFORM pg_temp.qa_ck('p10.delete_30_leaves_30_available', (r::jsonb->>'purchased')::int = 450 AND (r::jsonb->>'current')::int = 420 AND (r::jsonb->>'available')::int = 30, r);
  INSERT INTO public.flats (society_id, flat_number, unit_type) SELECT (ids->>'SC')::uuid, 'Q-N' || g, 'flat' FROM generate_series(1, 30) g;
  r := pg_temp.qa_run((ids->>'AC')::uuid, format('select public.get_society_flat_entitlement(%L)::text', ids->>'SC'));
  PERFORM pg_temp.qa_ck('p10.add_30_back_to_0_available', (r::jsonb->>'current')::int = 450 AND (r::jsonb->>'available')::int = 0, r);
  BEGIN
    INSERT INTO public.flats (society_id, flat_number, unit_type) VALUES ((ids->>'SC')::uuid, 'Q-451', 'flat');
    PERFORM pg_temp.qa_ck('p10.custom_451st_flat_blocked', false, 'insert succeeded');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.qa_ck('p10.custom_451st_flat_blocked', SQLERRM LIKE '%flat_capacity_reached%', SQLERRM);
  END;
  BEGIN
    UPDATE public.flats SET is_active = true WHERE id = (SELECT id FROM public.flats WHERE society_id = (ids->>'SC')::uuid AND NOT is_active LIMIT 1);
    PERFORM pg_temp.qa_ck('p10.reactivating_over_cap_blocked', false, 'update succeeded');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.qa_ck('p10.reactivating_over_cap_blocked', SQLERRM LIKE '%flat_capacity_reached%', SQLERRM);
  END;
  r := pg_temp.qa_run((ids->>'A90')::uuid, format('select public.get_society_flat_entitlement(%L)::text', ids->>'SC'));
  PERFORM pg_temp.qa_ck('p10.entitlement_tenant_scoped', r LIKE 'ERR:%', r);

  -- Custom-plan email-link destination authorization ------------------------------------------
  r := pg_temp.qa_run((ids->>'AC')::uuid, format('select count(*)::text from public.custom_plan_requests where id=%L', v_req));
  PERFORM pg_temp.qa_ck('link.own_society_admin_loads_request', r = '1', r);
  r := pg_temp.qa_run((ids->>'SU')::uuid, format('select count(*)::text from public.custom_plan_requests where id=%L', v_req));
  PERFORM pg_temp.qa_ck('link.super_admin_loads_request', r = '1', r);
  r := pg_temp.qa_run((ids->>'A90')::uuid, format('select count(*)::text from public.custom_plan_requests where id=%L', v_req));
  PERFORM pg_temp.qa_ck('link.other_society_admin_gets_nothing', r = '0', r);
  r := pg_temp.qa_run((ids->>'A90')::uuid, format('select count(*)::text from public.custom_plan_messages where request_id=%L', v_req));
  PERFORM pg_temp.qa_ck('link.other_society_admin_reads_no_messages', r = '0', r);
  r := pg_temp.qa_run((ids->>'A90')::uuid, format('select count(*)::text from public.custom_plan_offers where request_id=%L', v_req));
  PERFORM pg_temp.qa_ck('link.other_society_admin_reads_no_offers', r = '0', r);
  r := pg_temp.qa_run((ids->>'RC')::uuid, format('select count(*)::text from public.custom_plan_requests where id=%L', v_req));
  PERFORM pg_temp.qa_ck('link.resident_of_same_society_gets_nothing', r = '0', r);
  r := pg_temp.qa_run((ids->>'RC')::uuid, format('select count(*)::text from public.custom_plan_messages where request_id=%L', v_req));
  PERFORM pg_temp.qa_ck('link.resident_reads_no_messages', r = '0', r);
  r := pg_temp.qa_run_anon(format('select count(*)::text from public.custom_plan_requests where id=%L', v_req));
  PERFORM pg_temp.qa_ck('link.signed_out_gets_nothing', r = '0' OR r LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'AC')::uuid, format('select count(*)::text from public.custom_plan_requests where id=%L', ids->>'RAND'));
  PERFORM pg_temp.qa_ck('link.missing_request_is_empty', r = '0', r);
  r := pg_temp.qa_run((ids->>'AC')::uuid, format('select public.custom_plan_post_message(%L, ''QA'')::text', ids->>'RAND'));
  PERFORM pg_temp.qa_ck('link.missing_request_reports_unavailable', r LIKE 'ERR:%unavailable%', r);
  r := pg_temp.qa_run((ids->>'A90')::uuid, format('with u as (update public.custom_plan_requests set society_id=%L where id=%L returning 1) select count(*)::text from u', ids->>'S90', v_req));
  PERFORM pg_temp.qa_ck('link.request_cannot_be_reassigned', (SELECT society_id FROM public.custom_plan_requests WHERE id = v_req) = (ids->>'SC')::uuid, r);
  PERFORM pg_temp.qa_ck('link.email_body_has_no_message_text',
    NOT EXISTS (SELECT 1 FROM public.message_deliveries WHERE body ILIKE '%QA society message%' OR body ILIKE '%QA platform reply%'), NULL);

  -- Result --------------------------------------------------------------------------------------
  pass := current_setting('qa.pass')::int; fail := current_setting('qa.fail')::int;
  failures := current_setting('qa.failures'); groups := current_setting('qa.groups');
  RAISE EXCEPTION 'P0110B_RESULT|pass=%|fail=%|%|groups=%', pass, fail,
    CASE WHEN fail = 0 THEN 'OK' ELSE failures END, groups;
END $p0110b$;
