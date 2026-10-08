-- SociyoHub P01–P07 database harness: role/tenant access, subscription-free billing boundaries,
-- bill lifecycle (Manual Bill Studio), offline payment/receipt lifecycle and missing-bill recovery.
--
-- Acts as synthetic signed-in users against the real RPCs, triggers and RLS (RLS is never disabled).
-- Safety contract (same as phase4b / governance / marketplace): synthetic fixed IDs (prefix 5d5d0000-),
-- *.invalid emails, "[QA]" society names, one DO block that ALWAYS ends with RAISE EXCEPTION, so every
-- row it creates is rolled back. Run only on a disposable local database:
--   HARNESS_DB_URL=... bash scripts/run-sql-harness.sh tests/sql/p01-p10-access-billing.sql P0110A_RESULT <min>
-- Output: P0110A_RESULT|pass=<n>|fail=<n>|<OK or failures>|groups=<per-group pass counts>

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

DO $p0110a$
DECLARE
  ids jsonb := '{
    "SA":"5d5d0000-0000-4000-8000-00000000a001", "SB":"5d5d0000-0000-4000-8000-00000000b001",
    "SP":"5d5d0000-0000-4000-8000-00000000c001", "SL":"5d5d0000-0000-4000-8000-00000000d001",
    "SN":"5d5d0000-0000-4000-8000-00000000e001",
    "BKA":"5d5d0000-0000-4000-8000-00000000a011", "BKB":"5d5d0000-0000-4000-8000-00000000b011",
    "BKP":"5d5d0000-0000-4000-8000-00000000c011", "BKL":"5d5d0000-0000-4000-8000-00000000d011",
    "BKN":"5d5d0000-0000-4000-8000-00000000e011",
    "FA1":"5d5d0000-0000-4000-8000-00000000a021", "FA2":"5d5d0000-0000-4000-8000-00000000a022",
    "FB1":"5d5d0000-0000-4000-8000-00000000b021",
    "FP1":"5d5d0000-0000-4000-8000-00000000c021", "FP2":"5d5d0000-0000-4000-8000-00000000c022",
    "FP3":"5d5d0000-0000-4000-8000-00000000c023", "FP4":"5d5d0000-0000-4000-8000-00000000c024",
    "FP5":"5d5d0000-0000-4000-8000-00000000c025", "FP6":"5d5d0000-0000-4000-8000-00000000c026",
    "FL1":"5d5d0000-0000-4000-8000-00000000d021", "FN1":"5d5d0000-0000-4000-8000-00000000e021",
    "ADMA":"5d5d0000-0000-4000-8000-00000000a101", "RESA":"5d5d0000-0000-4000-8000-00000000a102",
    "RESA2":"5d5d0000-0000-4000-8000-00000000a103", "GRDA":"5d5d0000-0000-4000-8000-00000000a104",
    "ADMB":"5d5d0000-0000-4000-8000-00000000b101", "RESB":"5d5d0000-0000-4000-8000-00000000b102",
    "ADMP":"5d5d0000-0000-4000-8000-00000000c101", "ADML":"5d5d0000-0000-4000-8000-00000000d101",
    "ADMN":"5d5d0000-0000-4000-8000-00000000e101",
    "BLA":"5d5d0000-0000-4000-8000-00000000a301", "BLA2":"5d5d0000-0000-4000-8000-00000000a302",
    "BLB":"5d5d0000-0000-4000-8000-00000000b301", "BLP6":"5d5d0000-0000-4000-8000-00000000c306",
    "MPA":"5d5d0000-0000-4000-8000-00000000a401",
    "H1":"5d5d0000-0000-4000-8000-00000000c501", "H2":"5d5d0000-0000-4000-8000-00000000c502",
    "H3":"5d5d0000-0000-4000-8000-00000000c503", "H4":"5d5d0000-0000-4000-8000-00000000c504",
    "H5":"5d5d0000-0000-4000-8000-00000000c505", "H6":"5d5d0000-0000-4000-8000-00000000c506",
    "H7":"5d5d0000-0000-4000-8000-00000000c507", "H8":"5d5d0000-0000-4000-8000-00000000d508",
    "H9":"5d5d0000-0000-4000-8000-00000000e509",
    "RP1":"5d5d0000-0000-4000-8000-00000000c201", "RP2":"5d5d0000-0000-4000-8000-00000000c202",
    "RP3":"5d5d0000-0000-4000-8000-00000000c203", "RP4":"5d5d0000-0000-4000-8000-00000000c204",
    "RP5":"5d5d0000-0000-4000-8000-00000000c205", "RP6":"5d5d0000-0000-4000-8000-00000000c206",
    "RL1":"5d5d0000-0000-4000-8000-00000000d201", "RN1":"5d5d0000-0000-4000-8000-00000000e201"
  }'::jsonb;
  r text; r2 text; v_bill uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid;
  d0 date := date '2025-01-15'; m0 date := date '2025-01-01';
  pass int; fail int; failures text; groups text;
BEGIN
  PERFORM set_config('qa.pass', '0', true); PERFORM set_config('qa.fail', '0', true);
  PERFORM set_config('qa.failures', '', true); PERFORM set_config('qa.groups', '{}', true);

  -- Fixtures (synthetic only) --------------------------------------------------------------
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT (ids->>u)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'qa-p0110a-' || lower(u) || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()
  FROM unnest(ARRAY['ADMA','RESA','RESA2','GRDA','ADMB','RESB','ADMP','ADML','ADMN','RP1','RP2','RP3','RP4','RP5','RP6','RL1','RN1']) u;
  INSERT INTO public.societies (id, name, city, plan, plan_id, plan_status, plan_expires_at, status, structure_mode) VALUES
    ((ids->>'SA')::uuid, '[QA] P0110A Society A', 'Testville', 'pro', 'pro', 'active', now() + interval '30 days', 'active', 'structured'),
    ((ids->>'SB')::uuid, '[QA] P0110A Society B', 'Testville', 'pro', 'pro', 'active', now() + interval '30 days', 'active', 'structured'),
    ((ids->>'SP')::uuid, '[QA] P0110A Highest plan', 'Testville', 'premium', 'premium', 'active', now() + interval '30 days', 'active', 'structured'),
    ((ids->>'SL')::uuid, '[QA] P0110A Lower plan', 'Testville', 'pro', 'pro', 'active', now() + interval '30 days', 'active', 'structured'),
    ((ids->>'SN')::uuid, '[QA] P0110A No amount', 'Testville', 'premium', 'premium', 'active', now() + interval '30 days', 'active', 'structured');
  INSERT INTO public.blocks (id, society_id, name)
  SELECT (ids->>b)::uuid, (ids->>s)::uuid, 'Q' || b
  FROM (VALUES ('BKA','SA'),('BKB','SB'),('BKP','SP'),('BKL','SL'),('BKN','SN')) v(b, s);
  INSERT INTO public.flats (id, society_id, block_id, flat_number, unit_type)
  SELECT (ids->>f)::uuid, (ids->>s)::uuid, (ids->>b)::uuid, 'Q-' || f, 'flat'
  FROM (VALUES ('FA1','SA','BKA'),('FA2','SA','BKA'),('FB1','SB','BKB'),
               ('FP1','SP','BKP'),('FP2','SP','BKP'),('FP3','SP','BKP'),('FP4','SP','BKP'),('FP5','SP','BKP'),('FP6','SP','BKP'),
               ('FL1','SL','BKL'),('FN1','SN','BKN')) v(f, s, b);
  PERFORM set_config('app.allow_society_change', 'on', true);
  INSERT INTO public.profiles (id, full_name, society_id)
  SELECT (ids->>u)::uuid, 'QA P0110A ' || u, (ids->>s)::uuid
  FROM (VALUES ('ADMA','SA'),('RESA','SA'),('RESA2','SA'),('GRDA','SA'),('ADMB','SB'),('RESB','SB'),
               ('ADMP','SP'),('ADML','SL'),('ADMN','SN'),('RP1','SP'),('RP2','SP'),('RP3','SP'),('RP4','SP'),
               ('RP5','SP'),('RP6','SP'),('RL1','SL'),('RN1','SN')) v(u, s)
  ON CONFLICT (id) DO UPDATE SET society_id = excluded.society_id, full_name = excluded.full_name;
  INSERT INTO public.user_roles (user_id, role, society_id, is_active)
  SELECT (ids->>u)::uuid, v.rl::public.app_role, (ids->>s)::uuid, true
  FROM (VALUES ('ADMA','society_admin','SA'),('RESA','resident','SA'),('RESA2','resident','SA'),('GRDA','security','SA'),
               ('ADMB','society_admin','SB'),('RESB','resident','SB'),('ADMP','society_admin','SP'),
               ('ADML','society_admin','SL'),('ADMN','society_admin','SN'),('RP1','resident','SP'),('RP2','resident','SP'),
               ('RP3','resident','SP'),('RP4','resident','SP'),('RP5','resident','SP'),('RP6','resident','SP'),
               ('RL1','resident','SL'),('RN1','resident','SN')) v(u, rl, s);
  INSERT INTO public.flat_residents (flat_id, user_id, relationship, is_primary, is_active) VALUES
    ((ids->>'FA1')::uuid, (ids->>'RESA')::uuid, 'owner', true, true),
    ((ids->>'FA2')::uuid, (ids->>'RESA2')::uuid, 'owner', true, true),
    ((ids->>'FB1')::uuid, (ids->>'RESB')::uuid, 'owner', true, true);
  INSERT INTO public.flat_residents (flat_id, user_id, relationship, is_primary, is_active)
  SELECT (ids->>f)::uuid, (ids->>u)::uuid, 'owner', true, true
  FROM (VALUES ('FP1','RP1'),('FP2','RP2'),('FP3','RP3'),('FP4','RP4'),('FP5','RP5'),('FP6','RP6'),('FL1','RL1'),('FN1','RN1')) v(f, u);

  PERFORM set_config('sociyohub.allow_unbatched_bill', 'on', true);
  INSERT INTO public.bills (id, society_id, flat_id, period_label, period_start, period_end, amount, due_date, status) VALUES
    ((ids->>'BLA')::uuid, (ids->>'SA')::uuid, (ids->>'FA1')::uuid, 'QA period', current_date - 60, current_date - 31, 1000, current_date - 20, 'unpaid'),
    ((ids->>'BLA2')::uuid, (ids->>'SA')::uuid, (ids->>'FA2')::uuid, 'QA period', current_date - 60, current_date - 31, 800, current_date - 20, 'unpaid'),
    ((ids->>'BLB')::uuid, (ids->>'SB')::uuid, (ids->>'FB1')::uuid, 'QB period', current_date - 60, current_date - 31, 900, current_date - 20, 'unpaid'),
    ((ids->>'BLP6')::uuid, (ids->>'SP')::uuid, (ids->>'FP6')::uuid, 'QA Jan', m0, m0 + 30, 1000, m0 + 10, 'unpaid');
  PERFORM set_config('sociyohub.allow_unbatched_bill', '', true);
  INSERT INTO public.maintenance_periods (id, society_id, flat_id, period_start, period_end, period_label, amount_due) VALUES
    ((ids->>'MPA')::uuid, (ids->>'SA')::uuid, (ids->>'FA1')::uuid, date_trunc('month', current_date)::date,
     (date_trunc('month', current_date) + interval '1 month - 1 day')::date, 'QA current month', 1500);
  INSERT INTO public.billing_schedules (society_id, mode, amount, cycle, anchor_day, due_offset_days, late_fee_type, late_fee_value, prorate, enabled, next_run_at)
  SELECT (ids->>s)::uuid, 'flat', 1000, 'monthly', 1, 10, 'none', 0, false, false, now() + interval '1 year'
  FROM unnest(ARRAY['SP','SL']) s;
  INSERT INTO public.historical_payments (id, society_id, flat_id, amount, payment_date, method, reference_no, request_id, row_number, created_by, status)
  SELECT (ids->>h)::uuid, (ids->>s)::uuid, (ids->>f)::uuid, amt, d0, 'bank_transfer', 'QA-HP-' || n, 'qa-p0110a', n, (ids->>a)::uuid, st
  FROM (VALUES ('H1','SP','FP1',1000,1,'ADMP','imported_unverified'), ('H2','SP','FP1',1000,2,'ADMP','imported_unverified'),
               ('H3','SP','FP2',999,3,'ADMP','imported_unverified'),  ('H4','SP','FP3',1000,4,'ADMP','imported_unverified'),
               ('H5','SP','FP4',1000,5,'ADMP','imported_unverified'), ('H6','SP','FP5',1000,6,'ADMP','reversed'),
               ('H7','SP','FP6',1000,7,'ADMP','imported_unverified'), ('H8','SL','FL1',1000,8,'ADML','imported_unverified'),
               ('H9','SN','FN1',1000,9,'ADMN','imported_unverified')) v(h, s, f, amt, n, a, st);

  -- P01 — role-aware, tenant-scoped authorization --------------------------------------------
  r := pg_temp.qa_run((ids->>'RESA')::uuid, format('select count(*)::text from public.bills where society_id=%L', ids->>'SB'));
  PERFORM pg_temp.qa_ck('p01.resA_cannot_read_socB_bills', r = '0', r);
  r := pg_temp.qa_run((ids->>'GRDA')::uuid, format('select count(*)::text from public.bills where society_id=%L', ids->>'SB'));
  PERFORM pg_temp.qa_ck('p01.guardA_cannot_read_socB_bills', r = '0', r);
  r := pg_temp.qa_run((ids->>'GRDA')::uuid, format('select count(*)::text from public.flat_residents where flat_id=%L', ids->>'FB1'));
  PERFORM pg_temp.qa_ck('p01.guardA_cannot_read_socB_residents', r = '0', r);
  r := pg_temp.qa_run((ids->>'ADMA')::uuid, format('select count(*)::text from public.flat_residents where flat_id=%L', ids->>'FB1'));
  PERFORM pg_temp.qa_ck('p01.admA_cannot_read_socB_residents', r = '0', r);
  r := pg_temp.qa_run((ids->>'ADMA')::uuid, format('select count(*)::text from public.bills where society_id=%L', ids->>'SB'));
  PERFORM pg_temp.qa_ck('p01.admA_cannot_read_socB_bills', r = '0', r);
  r := pg_temp.qa_run((ids->>'RESA')::uuid, format('select public.generate_flat_bill(%L, array[]::uuid[], %L::jsonb)::text', ids->>'FA1', '[{"amount":10}]'));
  PERFORM pg_temp.qa_ck('p01.resident_cannot_run_admin_bill_generation', r LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'GRDA')::uuid, format('select public.generate_flat_bill(%L, array[]::uuid[], %L::jsonb)::text', ids->>'FA1', '[{"amount":10}]'));
  PERFORM pg_temp.qa_ck('p01.guard_cannot_run_admin_bill_generation', r LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'ADMA')::uuid, format('insert into public.user_roles(user_id, role, society_id) values (%L, ''super_admin'', null) returning 1', ids->>'ADMA'));
  PERFORM pg_temp.qa_ck('p01.admA_cannot_grant_self_super_admin', r LIKE 'ERR:%' AND NOT public.is_super_admin((ids->>'ADMA')::uuid), r);
  r := pg_temp.qa_run((ids->>'ADMA')::uuid, format('insert into public.user_roles(user_id, role, society_id) values (%L, ''society_admin'', %L) returning 1', ids->>'ADMA', ids->>'SB'));
  PERFORM pg_temp.qa_ck('p01.admA_cannot_grant_self_admin_of_socB', r <> '1' AND NOT public.is_society_admin_for((ids->>'ADMA')::uuid, (ids->>'SB')::uuid), r);
  r := pg_temp.qa_run((ids->>'RESA')::uuid, format('insert into public.user_roles(user_id, role, society_id) values (%L, ''society_admin'', %L) returning 1', ids->>'RESA', ids->>'SA'));
  PERFORM pg_temp.qa_ck('p01.resident_cannot_self_escalate_to_admin', r <> '1' AND NOT public.is_society_admin_for((ids->>'RESA')::uuid, (ids->>'SA')::uuid), r);
  r := pg_temp.qa_run((ids->>'ADMA')::uuid, format('with u as (update public.bills set amount = 1 where id=%L returning 1) select count(*)::text from u', ids->>'BLB'));
  PERFORM pg_temp.qa_ck('p01.admA_cross_tenant_update_blocked', (SELECT amount FROM public.bills WHERE id = (ids->>'BLB')::uuid) = 900, r);
  r := pg_temp.qa_run((ids->>'ADMA')::uuid, format('with d as (delete from public.bills where id=%L returning 1) select count(*)::text from d', ids->>'BLB'));
  PERFORM pg_temp.qa_ck('p01.admA_cross_tenant_delete_blocked', EXISTS (SELECT 1 FROM public.bills WHERE id = (ids->>'BLB')::uuid), r);
  r := pg_temp.qa_run((ids->>'ADMA')::uuid, format('insert into public.bills(society_id, flat_id, period_label, period_start, period_end, amount, due_date, status) values (%L,%L,''x'',current_date,current_date,5,current_date,''unpaid'') returning 1', ids->>'SB', ids->>'FB1'));
  PERFORM pg_temp.qa_ck('p01.admA_cross_tenant_insert_blocked', NOT EXISTS (SELECT 1 FROM public.bills WHERE flat_id = (ids->>'FB1')::uuid AND amount = 5), r);
  r := pg_temp.qa_run((ids->>'ADMA')::uuid, format('select public.generate_flat_bill(%L, array[]::uuid[], %L::jsonb)::text', ids->>'FB1', '[{"amount":10}]'));
  PERFORM pg_temp.qa_ck('p01.client_supplied_foreign_flat_rejected', r LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'RESA')::uuid, format('select public.submit_offline_payment(%L,''bank_transfer'',100,current_date,''QAREF-ESC'',null,''qa-key-esc1'',''admin'')::text', ids->>'BLA'));
  PERFORM pg_temp.qa_ck('p01.client_supplied_actor_role_cannot_escalate', r LIKE 'ERR:%not_authorized%', r);
  r := pg_temp.qa_run((ids->>'ADMA')::uuid, format('with u as (update public.societies set name = ''hijack'' where id=%L returning 1) select count(*)::text from u', ids->>'SB'));
  PERFORM pg_temp.qa_ck('p01.admA_cannot_modify_socB_society', (SELECT name FROM public.societies WHERE id = (ids->>'SB')::uuid) = '[QA] P0110A Society B', r);
  r := pg_temp.qa_run_anon('select count(*)::text from public.bills');
  PERFORM pg_temp.qa_ck('p01.anonymous_reads_no_bills', r = '0' OR r LIKE 'ERR:%', r);

  -- P03/P04 — resident/home ownership boundaries ----------------------------------------------
  r := pg_temp.qa_run((ids->>'RESA')::uuid, format('select count(*)::text from public.bills where id=%L', ids->>'BLA'));
  PERFORM pg_temp.qa_ck('p03.resident_reads_own_home_bill', r = '1', r);
  r := pg_temp.qa_run((ids->>'RESA')::uuid, format('select count(*)::text from public.bills where id=%L', ids->>'BLA2'));
  PERFORM pg_temp.qa_ck('p03.resident_cannot_read_neighbour_bill', r = '0', r);
  r := pg_temp.qa_run((ids->>'RESA')::uuid, format('select count(*)::text from public.flat_residents where flat_id=%L', ids->>'FB1'));
  PERFORM pg_temp.qa_ck('p03.resident_cannot_read_socB_residents', r = '0', r);
  r := pg_temp.qa_run((ids->>'RESA')::uuid, format('select count(*)::text from public.flat_residents where user_id=%L', ids->>'RESA'));
  PERFORM pg_temp.qa_ck('p03.resident_reads_own_home_link', r = '1', r);
  r := pg_temp.qa_run((ids->>'RESA')::uuid, format('with u as (update public.bills set amount = 1 where id=%L returning 1) select count(*)::text from u', ids->>'BLA'));
  PERFORM pg_temp.qa_ck('p04.resident_cannot_change_own_bill_amount', (SELECT amount FROM public.bills WHERE id = (ids->>'BLA')::uuid) = 1000, r);
  r := pg_temp.qa_run((ids->>'RESA')::uuid, format('with u as (update public.societies set name = ''x'' where id=%L returning 1) select count(*)::text from u', ids->>'SA'));
  PERFORM pg_temp.qa_ck('p04.resident_cannot_change_society_config', (SELECT name FROM public.societies WHERE id = (ids->>'SA')::uuid) = '[QA] P0110A Society A', r);
  r := pg_temp.qa_run((ids->>'GRDA')::uuid, format('with u as (update public.flat_residents set is_active = false where flat_id=%L returning 1) select count(*)::text from u', ids->>'FA1'));
  PERFORM pg_temp.qa_ck('p04.guard_cannot_change_home_membership', (SELECT is_active FROM public.flat_residents WHERE flat_id = (ids->>'FA1')::uuid AND user_id = (ids->>'RESA')::uuid), r);
  r := pg_temp.qa_run((ids->>'RESA')::uuid, format('select count(*)::text from public.historical_payments where society_id=%L', ids->>'SP'));
  PERFORM pg_temp.qa_ck('p04.resident_cannot_read_other_society_payment_history', r = '0', r);
  r := pg_temp.qa_run((ids->>'RESB')::uuid, format('select count(*)::text from public.bills where society_id=%L', ids->>'SA'));
  PERFORM pg_temp.qa_ck('p03.resB_cannot_read_socA_bills', r = '0', r);

  -- P05 + Manual Bill Studio — explicit admin bill generation -------------------------------
  r := pg_temp.qa_run((ids->>'ADMA')::uuid, format('select public.generate_flat_bill(%L, array[%L]::uuid[], %L::jsonb)::text',
         ids->>'FA1', ids->>'MPA', '[{"description":"QA extra","amount":250,"total":1}]'));
  PERFORM pg_temp.qa_ck('p05.admin_generates_bill', r NOT LIKE 'ERR:%', r);
  IF r NOT LIKE 'ERR:%' THEN v_bill := r::uuid; END IF;
  PERFORM pg_temp.qa_ck('p05.server_calculates_total', (SELECT amount FROM public.bills WHERE id = v_bill) = 1750,
    (SELECT amount::text FROM public.bills WHERE id = v_bill));
  PERFORM pg_temp.qa_ck('p05.bill_belongs_to_canonical_home', (SELECT society_id = (ids->>'SA')::uuid AND flat_id = (ids->>'FA1')::uuid FROM public.bills WHERE id = v_bill), v_bill::text);
  PERFORM pg_temp.qa_ck('p05.line_items_recorded', (SELECT count(*) FROM public.bill_line_items WHERE bill_id = v_bill) = 2, NULL);
  PERFORM pg_temp.qa_ck('p05.period_linked_to_bill', (SELECT bill_id FROM public.maintenance_periods WHERE id = (ids->>'MPA')::uuid) = v_bill, NULL);
  PERFORM pg_temp.qa_ck('p05.generated_bill_is_unpaid', (SELECT status FROM public.bills WHERE id = v_bill) = 'unpaid', NULL);
  PERFORM pg_temp.qa_ck('p05.bill_is_not_a_payment', NOT EXISTS (SELECT 1 FROM public.payments WHERE bill_id = v_bill), NULL);
  PERFORM pg_temp.qa_ck('p05.bill_creates_no_receipt', NOT EXISTS (SELECT 1 FROM public.payment_receipts pr JOIN public.payments p ON p.id = pr.payment_id WHERE p.bill_id = v_bill), NULL);
  r := pg_temp.qa_run((ids->>'ADMA')::uuid, format('select public.generate_flat_bill(%L, array[%L]::uuid[])::text', ids->>'FA1', ids->>'MPA'));
  PERFORM pg_temp.qa_ck('p05.same_period_not_billed_twice', r LIKE 'ERR:%' AND (SELECT count(*) FROM public.bills WHERE flat_id = (ids->>'FA1')::uuid) = 2, r);
  r := pg_temp.qa_run((ids->>'ADMB')::uuid, format('select public.generate_flat_bill(%L, array[]::uuid[], %L::jsonb)::text', ids->>'FA1', '[{"amount":10}]'));
  PERFORM pg_temp.qa_ck('p05.other_society_admin_cannot_generate', r LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'RESA')::uuid, format('insert into public.bills(society_id, flat_id, period_label, period_start, period_end, amount, due_date, status) values (%L,%L,''x'',current_date,current_date,7,current_date,''paid'') returning 1', ids->>'SA', ids->>'FA1'));
  PERFORM pg_temp.qa_ck('p05.resident_cannot_insert_bill', NOT EXISTS (SELECT 1 FROM public.bills WHERE flat_id = (ids->>'FA1')::uuid AND amount = 7), r);

  -- P06 — offline payment / receipt lifecycle -------------------------------------------------
  r := pg_temp.qa_run((ids->>'RESA')::uuid, format('select public.submit_offline_payment(%L,''bank_transfer'',400,current_date,''QAREF1'',null,''qa-key-0001'',''resident'')::text', ids->>'BLA'));
  PERFORM pg_temp.qa_ck('p06.resident_submits_bank_transfer', r NOT LIKE 'ERR:%', r);
  IF r NOT LIKE 'ERR:%' THEN p1 := r::uuid; END IF;
  PERFORM pg_temp.qa_ck('p06.submission_is_pending', (SELECT status FROM public.payments WHERE id = p1) = 'pending', NULL);
  PERFORM pg_temp.qa_ck('p06.pending_has_no_receipt', NOT EXISTS (SELECT 1 FROM public.payment_receipts WHERE payment_id = p1), NULL);
  r := pg_temp.qa_run((ids->>'RESA')::uuid, format('select public.submit_offline_payment(%L,''bank_transfer'',400,current_date,''QAREF1'',null,''qa-key-0001'',''resident'')::text', ids->>'BLA'));
  PERFORM pg_temp.qa_ck('p06.retry_is_idempotent', r = p1::text AND (SELECT count(*) FROM public.payments WHERE idempotency_key = 'qa-key-0001') = 1, r);
  r := pg_temp.qa_run((ids->>'RESA')::uuid, format('select public.submit_offline_payment(%L,''cash'',50,current_date,null,null,''qa-key-cash1'',''resident'')::text', ids->>'BLA'));
  PERFORM pg_temp.qa_ck('p06.resident_cash_rejected', r LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'RESA')::uuid, format('select public.submit_offline_payment(%L,''bank_transfer'',50,current_date,''QAREF-X'',null,''qa-key-xb01'',''resident'')::text', ids->>'BLB'));
  PERFORM pg_temp.qa_ck('p06.resident_cannot_pay_other_society_bill', r LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'RESA')::uuid, format('select public.submit_offline_payment(%L,''bank_transfer'',50,current_date,''QAREF-N'',null,''qa-key-nb01'',''resident'')::text', ids->>'BLA2'));
  PERFORM pg_temp.qa_ck('p06.resident_cannot_pay_neighbour_bill', r LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'RESA')::uuid, format('select public.verify_offline_payment(%L, null)::text', p1));
  PERFORM pg_temp.qa_ck('p06.resident_cannot_verify', r LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'GRDA')::uuid, format('select public.verify_offline_payment(%L, null)::text', p1));
  PERFORM pg_temp.qa_ck('p06.guard_cannot_verify', r LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'ADMB')::uuid, format('select public.verify_offline_payment(%L, null)::text', p1));
  PERFORM pg_temp.qa_ck('p06.other_society_admin_cannot_verify', r LIKE 'ERR:%' AND (SELECT status FROM public.payments WHERE id = p1) = 'pending', r);
  r := pg_temp.qa_run((ids->>'ADMA')::uuid, format('select public.reject_offline_payment(%L, ''QA wrong reference'')::text', p1));
  PERFORM pg_temp.qa_ck('p06.admin_rejects', (SELECT status FROM public.payments WHERE id = p1) = 'rejected', r);
  PERFORM pg_temp.qa_ck('p06.rejected_has_no_receipt', NOT EXISTS (SELECT 1 FROM public.payment_receipts WHERE payment_id = p1), NULL);

  r := pg_temp.qa_run((ids->>'RESA')::uuid, format('select public.submit_offline_payment(%L,''bank_transfer'',600,current_date,''QAREF2'',null,''qa-key-0002'',''resident'')::text', ids->>'BLA'));
  IF r NOT LIKE 'ERR:%' THEN p2 := r::uuid; END IF;
  r := pg_temp.qa_run((ids->>'RESA')::uuid, format('with u as (update public.payments set status = ''verified'' where id=%L returning 1) select count(*)::text from u', p2));
  PERFORM pg_temp.qa_ck('p06.client_cannot_self_mark_verified', (SELECT status FROM public.payments WHERE id = p2) = 'pending', r);
  r := pg_temp.qa_run((ids->>'RESA')::uuid, format('insert into public.payment_receipts(payment_id, society_id, receipt_number, status) values (%L,%L,''QA-FAKE'',''valid'') returning 1', p2, ids->>'SA'));
  PERFORM pg_temp.qa_ck('p06.client_cannot_fabricate_receipt', NOT EXISTS (SELECT 1 FROM public.payment_receipts WHERE payment_id = p2), r);
  r := pg_temp.qa_run((ids->>'ADMA')::uuid, format('select public.verify_offline_payment(%L, ''QA ok'')::text', p2));
  PERFORM pg_temp.qa_ck('p06.admin_verifies', r NOT LIKE 'ERR:%' AND (SELECT status FROM public.payments WHERE id = p2) = 'verified', r);
  PERFORM pg_temp.qa_ck('p06.verified_has_one_valid_receipt', (SELECT count(*) FROM public.payment_receipts WHERE payment_id = p2 AND status = 'valid') = 1, NULL);
  PERFORM pg_temp.qa_ck('p06.receipt_amount_matches_payment', (SELECT amount_snapshot FROM public.payment_receipts WHERE payment_id = p2) = 600, NULL);
  PERFORM pg_temp.qa_ck('p06.verification_audited', EXISTS (SELECT 1 FROM public.audit_log WHERE action = 'payment.verified' AND target_id::text = p2::text), NULL);
  r := pg_temp.qa_run((ids->>'ADMA')::uuid, format('select public.verify_offline_payment(%L, null)::text', p2));
  PERFORM pg_temp.qa_ck('p06.double_verify_rejected', r LIKE 'ERR:%' AND (SELECT count(*) FROM public.payment_receipts WHERE payment_id = p2) = 1, r);
  r := pg_temp.qa_run((ids->>'RESA')::uuid, format('select count(*)::text from public.payments where bill_id=%L', ids->>'BLB'));
  PERFORM pg_temp.qa_ck('p06.payments_isolated_by_society', r = '0', r);
  r := pg_temp.qa_run((ids->>'ADMA')::uuid, format('select public.reverse_offline_payment(%L, ''QA bounced'')::text', p2));
  PERFORM pg_temp.qa_ck('p06.admin_reverses', (SELECT status FROM public.payments WHERE id = p2) = 'reversed', r);
  PERFORM pg_temp.qa_ck('p06.reversed_receipt_voided', NOT EXISTS (SELECT 1 FROM public.payment_receipts WHERE payment_id = p2 AND status = 'valid'), NULL);
  r := pg_temp.qa_run((ids->>'ADMA')::uuid, format('select public.reverse_offline_payment(%L, ''again'')::text', p2));
  PERFORM pg_temp.qa_ck('p06.double_reverse_rejected', r LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'ADMA')::uuid, format('select public.submit_offline_payment(%L,''cash'',100,current_date,null,null,''qa-key-0004'',''admin'')::text', ids->>'BLA'));
  IF r NOT LIKE 'ERR:%' THEN p4 := r::uuid; END IF;
  r := pg_temp.qa_run((ids->>'ADMA')::uuid, format('select public.verify_offline_payment(%L, null)::text', p4));
  PERFORM pg_temp.qa_ck('p06.self_verification_blocked', p4 IS NOT NULL AND r LIKE 'ERR:%' AND (SELECT status FROM public.payments WHERE id = p4) = 'pending', r);

  -- P07 — automatic missing-bill recovery (highest plan only) ---------------------------------
  r := pg_temp.qa_run((ids->>'ADMP')::uuid, format('select public.review_historical_payment(%L, true, null)::text', ids->>'H1'));
  PERFORM pg_temp.qa_ck('p07.verified_payment_confirmed', r NOT LIKE 'ERR:%', r);
  PERFORM pg_temp.qa_ck('p07.exactly_one_bill_created',
    (SELECT count(*) FROM public.bills WHERE flat_id = (ids->>'FP1')::uuid AND period_start = m0) = 1, NULL);
  PERFORM pg_temp.qa_ck('p07.state_bill_created_paid', (SELECT reconciliation_state FROM public.historical_payments WHERE id = (ids->>'H1')::uuid) = 'bill_created_paid', NULL);
  PERFORM pg_temp.qa_ck('p07.reconciled_to_payment',
    (SELECT hp.reconciled_bill_id = b.id AND b.status = 'paid' AND b.amount = hp.amount FROM public.historical_payments hp
       JOIN public.bills b ON b.flat_id = hp.flat_id AND b.period_start = m0 WHERE hp.id = (ids->>'H1')::uuid), NULL);
  PERFORM pg_temp.qa_ck('p07.recovery_creates_no_payment_or_receipt', NOT EXISTS (SELECT 1 FROM public.payments WHERE flat_id = (ids->>'FP1')::uuid), NULL);
  r := pg_temp.qa_run((ids->>'ADMP')::uuid, format('select public.review_historical_payment(%L, true, null)::text', ids->>'H1'));
  r2 := public._reconcile_historical_payment((ids->>'H1')::uuid);
  PERFORM pg_temp.qa_ck('p07.retry_does_not_duplicate', r LIKE 'ERR:%' AND r2 = 'bill_created_paid'
    AND (SELECT count(*) FROM public.bills WHERE flat_id = (ids->>'FP1')::uuid AND period_start = m0) = 1, r || ' / ' || r2);
  r := pg_temp.qa_run((ids->>'ADMP')::uuid, format('select public.review_historical_payment(%L, true, null)::text', ids->>'H2'));
  PERFORM pg_temp.qa_ck('p07.second_payment_same_month_no_new_bill',
    (SELECT reconciliation_state FROM public.historical_payments WHERE id = (ids->>'H2')::uuid) = 'bill_exists'
    AND (SELECT count(*) FROM public.bills WHERE flat_id = (ids->>'FP1')::uuid AND period_start = m0) = 1, r);
  r := pg_temp.qa_run((ids->>'ADMP')::uuid, format('select public.review_historical_payment(%L, true, null)::text', ids->>'H3'));
  PERFORM pg_temp.qa_ck('p07.amount_mismatch_no_bill',
    (SELECT reconciliation_state FROM public.historical_payments WHERE id = (ids->>'H3')::uuid) = 'exception_amount_mismatch'
    AND NOT EXISTS (SELECT 1 FROM public.bills WHERE flat_id = (ids->>'FP2')::uuid), r);
  PERFORM pg_temp.qa_ck('p07.pending_payment_no_bill', NOT EXISTS (SELECT 1 FROM public.bills WHERE flat_id = (ids->>'FP3')::uuid)
    AND (SELECT reconciliation_state FROM public.historical_payments WHERE id = (ids->>'H4')::uuid) IS NULL, NULL);
  r := pg_temp.qa_run((ids->>'ADMP')::uuid, format('select public.review_historical_payment(%L, false, ''QA not ours'')::text', ids->>'H5'));
  PERFORM pg_temp.qa_ck('p07.rejected_payment_no_bill', (SELECT status FROM public.historical_payments WHERE id = (ids->>'H5')::uuid) = 'rejected'
    AND NOT EXISTS (SELECT 1 FROM public.bills WHERE flat_id = (ids->>'FP4')::uuid), r);
  r2 := public._reconcile_historical_payment((ids->>'H6')::uuid);
  PERFORM pg_temp.qa_ck('p07.reversed_payment_no_bill', NOT EXISTS (SELECT 1 FROM public.bills WHERE flat_id = (ids->>'FP5')::uuid), r2);
  r := pg_temp.qa_run((ids->>'ADMP')::uuid, format('select public.review_historical_payment(%L, true, null)::text', ids->>'H7'));
  PERFORM pg_temp.qa_ck('p07.existing_bill_not_duplicated', (SELECT reconciliation_state FROM public.historical_payments WHERE id = (ids->>'H7')::uuid) = 'bill_exists'
    AND (SELECT count(*) FROM public.bills WHERE flat_id = (ids->>'FP6')::uuid) = 1
    AND (SELECT status FROM public.bills WHERE id = (ids->>'BLP6')::uuid) = 'unpaid', r);
  -- Lower plan and missing amount: confirmation goes through the same trigger the review RPC fires.
  UPDATE public.historical_payments SET status = 'confirmed', reviewed_by = (ids->>'ADML')::uuid, reviewed_at = now() WHERE id = (ids->>'H8')::uuid;
  PERFORM pg_temp.qa_ck('p07.lower_plan_no_bill', (SELECT reconciliation_state FROM public.historical_payments WHERE id = (ids->>'H8')::uuid) = 'not_eligible_plan'
    AND NOT EXISTS (SELECT 1 FROM public.bills WHERE flat_id = (ids->>'FL1')::uuid), NULL);
  UPDATE public.historical_payments SET status = 'confirmed', reviewed_by = (ids->>'ADMN')::uuid, reviewed_at = now() WHERE id = (ids->>'H9')::uuid;
  PERFORM pg_temp.qa_ck('p07.missing_amount_no_bill', (SELECT reconciliation_state FROM public.historical_payments WHERE id = (ids->>'H9')::uuid) = 'exception_no_amount_source'
    AND NOT EXISTS (SELECT 1 FROM public.bills WHERE flat_id = (ids->>'FN1')::uuid), NULL);
  r := pg_temp.qa_run((ids->>'ADMB')::uuid, format('select public.review_historical_payment(%L, true, null)::text', ids->>'H4'));
  PERFORM pg_temp.qa_ck('p07.other_society_admin_cannot_confirm', r LIKE 'ERR:%' AND (SELECT status FROM public.historical_payments WHERE id = (ids->>'H4')::uuid) = 'imported_unverified', r);
  r := pg_temp.qa_run((ids->>'RESA')::uuid, format('select public._reconcile_historical_payment(%L)', ids->>'H4'));
  PERFORM pg_temp.qa_ck('p07.reconcile_not_callable_by_clients', r LIKE 'ERR:%', r);
  r := pg_temp.qa_run((ids->>'ADMA')::uuid, format('select public.bill_run_insert_period(%L, current_date, current_date, ''[]''::jsonb)::text', ids->>'SA'));
  r2 := pg_temp.qa_run(NULL, format('select public.bill_run_insert_period(%L, current_date, current_date, ''[]''::jsonb)::text', ids->>'SA'), true);
  PERFORM pg_temp.qa_ck('p07.blanket_billing_path_retired', r LIKE 'ERR:%' AND r2 LIKE 'ERR:%blanket_billing_retired%', r2);
  PERFORM pg_temp.qa_ck('p07.daily_blanket_job_not_scheduled',
    to_regclass('cron.job') IS NULL OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'run-billing-daily' OR command ILIKE '%run-billing%'), NULL);
  PERFORM pg_temp.qa_ck('p07.auto_bill_trigger_removed',
    NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE NOT t.tgisinternal AND p.proname = '_historical_payment_auto_bill'), NULL);

  -- Result --------------------------------------------------------------------------------------
  pass := current_setting('qa.pass')::int; fail := current_setting('qa.fail')::int;
  failures := current_setting('qa.failures'); groups := current_setting('qa.groups');
  RAISE EXCEPTION 'P0110A_RESULT|pass=%|fail=%|%|groups=%', pass, fail,
    CASE WHEN fail = 0 THEN 'OK' ELSE failures END, groups;
END $p0110a$;
