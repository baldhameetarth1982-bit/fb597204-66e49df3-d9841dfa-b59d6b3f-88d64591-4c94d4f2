-- SociyoHub Phase 4B — database security boundary harness.
--
-- What it proves: tenant isolation, role boundaries, No-Dues authorization,
-- poll voting rules, document/meeting/notification access and guard limits,
-- tested against the REAL row-level security policies and server RPCs by
-- acting as synthetic signed-in users (request.jwt.claims + role
-- `authenticated` / `anon`).
--
-- Safety contract (enforced by tests/unit/phase4b-sql-harness.test.ts):
--   * One DO block. Every fixture row is created inside it and the block
--     ALWAYS ends with RAISE EXCEPTION, so the whole transaction rolls back.
--     Nothing is ever committed.
--   * Only synthetic fixed IDs (prefix 4b4b0000-) and *.invalid emails.
--   * No real society, resident, phone, address, document or credential is
--     read, counted or written. Every query is filtered to synthetic IDs.
--
-- Output: the final exception message is
--   P4B_RESULT|pass=<n>|fail=<n>|<failures or OK>
-- Run on a disposable database with scripts/run-phase4b-sql.sh.

DO $p4b$
DECLARE
  ids jsonb := '{
    "SA":"4b4b0000-0000-4000-8000-00000000a001",
    "SB":"4b4b0000-0000-4000-8000-00000000b001",
    "BKA1":"4b4b0000-0000-4000-8000-00000000a011",
    "BKA2":"4b4b0000-0000-4000-8000-00000000a012",
    "BKB1":"4b4b0000-0000-4000-8000-00000000b011",
    "FA1":"4b4b0000-0000-4000-8000-00000000a021",
    "FA2":"4b4b0000-0000-4000-8000-00000000a022",
    "FA3":"4b4b0000-0000-4000-8000-00000000a023",
    "FB1":"4b4b0000-0000-4000-8000-00000000b021",
    "ADMA":"4b4b0000-0000-4000-8000-00000000a101",
    "RESA":"4b4b0000-0000-4000-8000-00000000a102",
    "RESA2":"4b4b0000-0000-4000-8000-00000000a103",
    "BLKA":"4b4b0000-0000-4000-8000-00000000a104",
    "GRDA":"4b4b0000-0000-4000-8000-00000000a105",
    "AUDA":"4b4b0000-0000-4000-8000-00000000a106",
    "ADMB":"4b4b0000-0000-4000-8000-00000000b101",
    "RESB":"4b4b0000-0000-4000-8000-00000000b102",
    "BLKB":"4b4b0000-0000-4000-8000-00000000b104",
    "GRDB":"4b4b0000-0000-4000-8000-00000000b105",
    "AUDB":"4b4b0000-0000-4000-8000-00000000b106",
    "GSA":"4b4b0000-0000-4000-8000-00000000a5e5",
    "GSB":"4b4b0000-0000-4000-8000-00000000b5e5",
    "FRA":"4b4b0000-0000-4000-8000-00000000a031",
    "FRA2":"4b4b0000-0000-4000-8000-00000000a032",
    "FRB":"4b4b0000-0000-4000-8000-00000000b031",
    "BLA":"4b4b0000-0000-4000-8000-00000000a041",
    "BLA3":"4b4b0000-0000-4000-8000-00000000a043",
    "BLB":"4b4b0000-0000-4000-8000-00000000b041",
    "NA":"4b4b0000-0000-4000-8000-00000000a051",
    "NB":"4b4b0000-0000-4000-8000-00000000b051",
    "PA":"4b4b0000-0000-4000-8000-00000000a061",
    "PAC":"4b4b0000-0000-4000-8000-00000000a062",
    "PB":"4b4b0000-0000-4000-8000-00000000b061",
    "OA1":"4b4b0000-0000-4000-8000-00000000a071",
    "OA2":"4b4b0000-0000-4000-8000-00000000a072",
    "OAC1":"4b4b0000-0000-4000-8000-00000000a073",
    "OB1":"4b4b0000-0000-4000-8000-00000000b071",
    "MA":"4b4b0000-0000-4000-8000-00000000a081",
    "MAD":"4b4b0000-0000-4000-8000-00000000a082",
    "MAC":"4b4b0000-0000-4000-8000-00000000a083",
    "MB":"4b4b0000-0000-4000-8000-00000000b081",
    "TA":"4b4b0000-0000-4000-8000-00000000a091",
    "TB":"4b4b0000-0000-4000-8000-00000000b091",
    "VA":"4b4b0000-0000-4000-8000-00000000a0a1",
    "VA2":"4b4b0000-0000-4000-8000-00000000a0a2",
    "VB":"4b4b0000-0000-4000-8000-00000000b0a1",
    "VEA":"4b4b0000-0000-4000-8000-00000000a0b1",
    "VEB":"4b4b0000-0000-4000-8000-00000000b0b1",
    "MPA":"4b4b0000-0000-4000-8000-00000000a0c1",
    "MPA2":"4b4b0000-0000-4000-8000-00000000a0c2",
    "MPB":"4b4b0000-0000-4000-8000-00000000b0c1",
    "PVA":"4b4b0000-0000-4000-8000-00000000a0d1",
    "PVB":"4b4b0000-0000-4000-8000-00000000b0d1",
    "SOSA":"4b4b0000-0000-4000-8000-00000000a0e1",
    "SOSB":"4b4b0000-0000-4000-8000-00000000b0e1",
    "INA":"4b4b0000-0000-4000-8000-00000000a0f1",
    "INB":"4b4b0000-0000-4000-8000-00000000b0f1",
    "UNA":"4b4b0000-0000-4000-8000-00000000a111",
    "UNB":"4b4b0000-0000-4000-8000-00000000b111",
    "KDA":"4b4b0000-0000-4000-8000-00000000a121",
    "KDCA":"4b4b0000-0000-4000-8000-00000000a122",
    "KDB":"4b4b0000-0000-4000-8000-00000000b121",
    "LSA":"4b4b0000-0000-4000-8000-00000000a131",
    "RAND":"4b4b0000-0000-4000-8000-00000000ffff"
  }'::jsonb;
  k text;
  c record;
  q text;
  n bigint;
  outcome text;
  ok boolean;
  pass int := 0;
  fail int := 0;
  failures text[] := '{}';
  setup_err text;
  nd1 uuid; nd2 uuid; st text; cert uuid; elig jsonb; tok_hash text;
BEGIN
  -- -------------------------------------------------------------------------
  -- Synthetic fixtures (rolled back at the end).
  -- -------------------------------------------------------------------------
  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    SELECT (ids->>u)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
           'qa-p4b-' || lower(u) || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()
    FROM unnest(ARRAY['ADMA','RESA','RESA2','BLKA','GRDA','AUDA','ADMB','RESB','BLKB','GRDB','AUDB']) u;

    INSERT INTO public.societies (id, name, city, plan, plan_id, plan_status, plan_expires_at, status, structure_mode)
    VALUES ((ids->>'SA')::uuid, '[QA] P4B Society A', 'Testville', 'pro', 'pro', 'active', now() + interval '30 days', 'active', 'structured'),
           ((ids->>'SB')::uuid, '[QA] P4B Society B', 'Testville', 'pro', 'pro', 'active', now() + interval '30 days', 'active', 'structured');

    INSERT INTO public.blocks (id, society_id, name) VALUES
      ((ids->>'BKA1')::uuid, (ids->>'SA')::uuid, 'QA-A1'), ((ids->>'BKA2')::uuid, (ids->>'SA')::uuid, 'QA-A2'),
      ((ids->>'BKB1')::uuid, (ids->>'SB')::uuid, 'QA-B1');
    INSERT INTO public.flats (id, society_id, block_id, flat_number, unit_type) VALUES
      ((ids->>'FA1')::uuid, (ids->>'SA')::uuid, (ids->>'BKA1')::uuid, 'QA-101', 'flat'),
      ((ids->>'FA2')::uuid, (ids->>'SA')::uuid, (ids->>'BKA2')::uuid, 'QA-201', 'flat'),
      ((ids->>'FA3')::uuid, (ids->>'SA')::uuid, (ids->>'BKA2')::uuid, 'QA-202', 'flat'),
      ((ids->>'FB1')::uuid, (ids->>'SB')::uuid, (ids->>'BKB1')::uuid, 'QB-101', 'flat');

    -- Same trusted-setup switch the join/create RPCs use; local to this transaction.
    PERFORM set_config('app.allow_society_change', 'on', true);
    INSERT INTO public.profiles (id, full_name, society_id)
    SELECT (ids->>u)::uuid, 'QA P4B ' || u, (ids->>s)::uuid
    FROM (VALUES ('ADMA','SA'),('RESA','SA'),('RESA2','SA'),('BLKA','SA'),('GRDA','SA'),('AUDA','SA'),
                 ('ADMB','SB'),('RESB','SB'),('BLKB','SB'),('GRDB','SB'),('AUDB','SB')) v(u, s)
    ON CONFLICT (id) DO UPDATE SET society_id = excluded.society_id, full_name = excluded.full_name;

    INSERT INTO public.user_roles (user_id, role, society_id, block_id, is_active)
    SELECT (ids->>u)::uuid, r::public.app_role, (ids->>s)::uuid, (ids->>b)::uuid, true
    FROM (VALUES ('ADMA','society_admin','SA',NULL),('RESA','resident','SA',NULL),('RESA2','resident','SA',NULL),
                 ('BLKA','block_admin','SA','BKA1'),('GRDA','security','SA',NULL),('AUDA','auditor','SA',NULL),
                 ('ADMB','society_admin','SB',NULL),('RESB','resident','SB',NULL),('BLKB','block_admin','SB','BKB1'),
                 ('GRDB','security','SB',NULL),('AUDB','auditor','SB',NULL)) v(u, r, s, b);

    INSERT INTO public.flat_residents (id, flat_id, user_id, relationship, is_primary, is_active) VALUES
      ((ids->>'FRA')::uuid, (ids->>'FA1')::uuid, (ids->>'RESA')::uuid, 'owner', true, true),
      ((ids->>'FRA2')::uuid, (ids->>'FA2')::uuid, (ids->>'RESA2')::uuid, 'owner', true, true),
      ((ids->>'FRB')::uuid, (ids->>'FB1')::uuid, (ids->>'RESB')::uuid, 'owner', true, true);

    INSERT INTO public.guard_sessions (society_id, user_id, auth_session_id, method, status, expires_at) VALUES
      ((ids->>'SA')::uuid, (ids->>'GRDA')::uuid, (ids->>'GSA')::uuid, 'self', 'active', now() + interval '2 hours'),
      ((ids->>'SB')::uuid, (ids->>'GRDB')::uuid, (ids->>'GSB')::uuid, 'self', 'active', now() + interval '2 hours');

    PERFORM set_config('sociyohub.allow_unbatched_bill', 'on', true);
    INSERT INTO public.bills (id, society_id, flat_id, period_label, period_start, period_end, amount, due_date, status) VALUES
      ((ids->>'BLA')::uuid, (ids->>'SA')::uuid, (ids->>'FA1')::uuid, 'QA period', current_date - 60, current_date - 31, 1000, current_date - 20, 'unpaid'),
      ((ids->>'BLA3')::uuid, (ids->>'SA')::uuid, (ids->>'FA3')::uuid, 'QA period', current_date - 60, current_date - 31, 700, current_date - 20, 'unpaid'),
      ((ids->>'BLB')::uuid, (ids->>'SB')::uuid, (ids->>'FB1')::uuid, 'QB period', current_date - 60, current_date - 31, 900, current_date - 20, 'unpaid');

    INSERT INTO public.notices (id, society_id, title, body, category, audience, status, published_at, created_by, requires_ack) VALUES
      ((ids->>'NA')::uuid, (ids->>'SA')::uuid, 'QA notice A', 'Synthetic notice', 'general', 'all', 'published', now() - interval '1 hour', (ids->>'ADMA')::uuid, true),
      ((ids->>'NB')::uuid, (ids->>'SB')::uuid, 'QB notice B', 'Synthetic notice', 'general', 'all', 'published', now() - interval '1 hour', (ids->>'ADMB')::uuid, true);

    INSERT INTO public.polls (id, society_id, title, status, kind, created_by, closes_at) VALUES
      ((ids->>'PA')::uuid, (ids->>'SA')::uuid, 'QA poll A', 'open', 'poll', (ids->>'ADMA')::uuid, now() + interval '7 days'),
      ((ids->>'PAC')::uuid, (ids->>'SA')::uuid, 'QA closed poll A', 'closed', 'poll', (ids->>'ADMA')::uuid, now() - interval '1 day'),
      ((ids->>'PB')::uuid, (ids->>'SB')::uuid, 'QB poll B', 'open', 'poll', (ids->>'ADMB')::uuid, now() + interval '7 days');
    INSERT INTO public.poll_options (id, poll_id, label, position) VALUES
      ((ids->>'OA1')::uuid, (ids->>'PA')::uuid, 'Option one', 1), ((ids->>'OA2')::uuid, (ids->>'PA')::uuid, 'Option two', 2),
      ((ids->>'OAC1')::uuid, (ids->>'PAC')::uuid, 'Closed option', 1), ((ids->>'OB1')::uuid, (ids->>'PB')::uuid, 'Option B', 1);

    INSERT INTO public.meetings (id, society_id, title, starts_at, audience, status, created_by) VALUES
      ((ids->>'MA')::uuid, (ids->>'SA')::uuid, 'QA meeting A', now() + interval '3 days', 'all', 'scheduled', (ids->>'ADMA')::uuid),
      ((ids->>'MAD')::uuid, (ids->>'SA')::uuid, 'QA draft meeting', now() + interval '3 days', 'all', 'draft', (ids->>'ADMA')::uuid),
      ((ids->>'MAC')::uuid, (ids->>'SA')::uuid, 'QA committee meeting', now() + interval '3 days', 'committee', 'scheduled', (ids->>'ADMA')::uuid),
      ((ids->>'MB')::uuid, (ids->>'SB')::uuid, 'QB meeting B', now() + interval '3 days', 'all', 'scheduled', (ids->>'ADMB')::uuid);

    INSERT INTO public.support_tickets (id, user_id, society_id, subject, description, category) VALUES
      ((ids->>'TA')::uuid, (ids->>'RESA')::uuid, (ids->>'SA')::uuid, 'QA ticket', 'Synthetic complaint', 'complaint'),
      ((ids->>'TB')::uuid, (ids->>'RESB')::uuid, (ids->>'SB')::uuid, 'QB ticket', 'Synthetic complaint', 'complaint');

    INSERT INTO public.visitors (id, society_id, flat_id, flat_number, visitor_name, logged_by, status, valid_until) VALUES
      ((ids->>'VA')::uuid, (ids->>'SA')::uuid, (ids->>'FA1')::uuid, 'QA-101', 'QA Visitor A', (ids->>'RESA')::uuid, 'expected', now() + interval '1 day'),
      ((ids->>'VA2')::uuid, (ids->>'SA')::uuid, (ids->>'FA1')::uuid, 'QA-101', 'QA Visitor A2', (ids->>'RESA')::uuid, 'expected', now() + interval '1 day'),
      ((ids->>'VB')::uuid, (ids->>'SB')::uuid, (ids->>'FB1')::uuid, 'QB-101', 'QB Visitor B', (ids->>'RESB')::uuid, 'expected', now() + interval '1 day');

    INSERT INTO public.vehicles (id, user_id, society_id, flat_id, plate_number, is_active) VALUES
      ((ids->>'VEA')::uuid, (ids->>'RESA')::uuid, (ids->>'SA')::uuid, (ids->>'FA1')::uuid, 'QA4B00A1', true),
      ((ids->>'VEB')::uuid, (ids->>'RESB')::uuid, (ids->>'SB')::uuid, (ids->>'FB1')::uuid, 'QA4B00B1', true);

    INSERT INTO public.material_passes (id, society_id, flat_id, requested_by, kind, description, valid_from, valid_until, status) VALUES
      ((ids->>'MPA')::uuid, (ids->>'SA')::uuid, (ids->>'FA1')::uuid, (ids->>'RESA')::uuid, 'material_in', 'QA synthetic pass', now(), now() + interval '1 day', 'pending'),
      ((ids->>'MPA2')::uuid, (ids->>'SA')::uuid, (ids->>'FA1')::uuid, (ids->>'RESA')::uuid, 'material_in', 'QA approved pass', now(), now() + interval '1 day', 'approved'),
      ((ids->>'MPB')::uuid, (ids->>'SB')::uuid, (ids->>'FB1')::uuid, (ids->>'RESB')::uuid, 'material_in', 'QB approved pass', now(), now() + interval '1 day', 'approved');

    INSERT INTO public.parking_violations (id, society_id, violation_type, flat_id, reported_by, status) VALUES
      ((ids->>'PVA')::uuid, (ids->>'SA')::uuid, 'wrong_slot', (ids->>'FA1')::uuid, (ids->>'GRDA')::uuid, 'open'),
      ((ids->>'PVB')::uuid, (ids->>'SB')::uuid, 'wrong_slot', (ids->>'FB1')::uuid, (ids->>'GRDB')::uuid, 'open');

    INSERT INTO public.sos_alerts (id, society_id, flat_id, raised_by, status) VALUES
      ((ids->>'SOSA')::uuid, (ids->>'SA')::uuid, (ids->>'FA1')::uuid, (ids->>'RESA')::uuid, 'raised'),
      ((ids->>'SOSB')::uuid, (ids->>'SB')::uuid, (ids->>'FB1')::uuid, (ids->>'RESB')::uuid, 'raised');

    INSERT INTO public.security_incidents (id, society_id, kind, severity, note, status, reported_by) VALUES
      ((ids->>'INA')::uuid, (ids->>'SA')::uuid, 'suspicious', 'low', 'QA synthetic incident', 'open', (ids->>'GRDA')::uuid),
      ((ids->>'INB')::uuid, (ids->>'SB')::uuid, 'suspicious', 'low', 'QB synthetic incident', 'open', (ids->>'GRDB')::uuid);

    INSERT INTO public.user_notifications (id, user_id, society_id, kind, title, body, link) VALUES
      ((ids->>'UNA')::uuid, (ids->>'RESA')::uuid, (ids->>'SA')::uuid, 'meeting', 'QA meeting', 'Synthetic', '/app/meetings'),
      ((ids->>'UNB')::uuid, (ids->>'RESB')::uuid, (ids->>'SB')::uuid, 'meeting', 'QB meeting', 'Synthetic', '/app/meetings');

    INSERT INTO public.society_knowledge_sources (id, society_id, kind, title, audience, status, storage_path, category, flat_resident_id) VALUES
      ((ids->>'KDA')::uuid, (ids->>'SA')::uuid, 'document', 'QA resident rules', 'residents', 'ready', (ids->>'SA') || '/qa-rules.pdf', 'rules', NULL),
      ((ids->>'KDCA')::uuid, (ids->>'SA')::uuid, 'document', 'QA committee only', 'committee', 'ready', (ids->>'SA') || '/qa-committee.pdf', 'records', NULL),
      ((ids->>'KDB')::uuid, (ids->>'SB')::uuid, 'document', 'QB resident rules', 'residents', 'ready', (ids->>'SB') || '/qb-rules.pdf', 'rules', NULL),
      ((ids->>'LSA')::uuid, (ids->>'SA')::uuid, 'document', 'QA lease A', 'committee', 'ready', (ids->>'SA') || '/lease-a.pdf', 'lease', (ids->>'FRA')::uuid);
  EXCEPTION WHEN OTHERS THEN
    setup_err := SQLSTATE || ' ' || SQLERRM;
  END;

  IF setup_err IS NOT NULL THEN
    RAISE EXCEPTION 'P4B_RESULT|pass=0|fail=1|FIXTURE_SETUP_FAILED: %', setup_err;
  END IF;

  -- -------------------------------------------------------------------------
  -- Checks executed AS the synthetic user (RLS + RPC authorization apply).
  -- expect: rows  = no error and a positive count
  --         none  = zero rows, or a permission error (row hidden / denied)
  --         ok    = no error
  --         err:<regex> = must fail with a matching error message
  -- -------------------------------------------------------------------------
  FOR c IN
    SELECT * FROM (VALUES
      -- Positive controls: fixtures are reachable by the right people.
      (1,'ctl.resA.own_bill','RESA',NULL,'select count(*) from public.bills where id={BLA}','rows'),
      (2,'ctl.resA.notice','RESA',NULL,'select count(*) from public.notices where id={NA}','rows'),
      (3,'ctl.resA.poll','RESA',NULL,'select count(*) from public.polls where id={PA}','rows'),
      (4,'ctl.resA.meeting','RESA',NULL,'select count(*) from public.meetings where id={MA}','rows'),
      (5,'ctl.resA.own_ticket','RESA',NULL,'select count(*) from public.support_tickets where id={TA}','rows'),
      (6,'ctl.resA.own_visitor','RESA',NULL,'select count(*) from public.visitors where id={VA}','rows'),
      (7,'ctl.resA.own_notification','RESA',NULL,'select count(*) from public.user_notifications where id={UNA}','rows'),
      (8,'ctl.resA.society_document','RESA',NULL,'select count(p) from (select public.knowledge_document_path({KDA}) p) x','rows'),
      (9,'ctl.resA.own_lease','RESA',NULL,'select count(p) from (select public.my_lease_document_path({LSA}) p) x','rows'),
      (10,'ctl.admA.bill','ADMA',NULL,'select count(*) from public.bills where id={BLA}','rows'),
      (11,'ctl.admA.ticket','ADMA',NULL,'select count(*) from public.support_tickets where id={TA}','rows'),
      (12,'ctl.blkA.bill_in_own_block','BLKA',NULL,'select count(*) from public.bills where id={BLA}','rows'),
      (13,'ctl.grdA.vehicle_lookup','GRDA','GSA','select count(*) from public.guard_verify_vehicle(''QA4B00A1'')','rows'),
      (14,'ctl.grdA.sos_visible','GRDA','GSA','select count(*) from public.sos_alerts where id={SOSA}','rows'),
      (15,'ctl.grdA.approved_pass_visible','GRDA','GSA','select count(*) from public.material_passes where id={MPA2}','rows'),
      (16,'ctl.admA.committee_meeting','ADMA',NULL,'select count(*) from public.meetings where id={MAC}','rows'),

      -- Cross-society: resident of B against Society A records.
      (100,'xs.resB.bill','RESB',NULL,'select count(*) from public.bills where id={BLA}','none'),
      (101,'xs.resB.notice','RESB',NULL,'select count(*) from public.notices where id={NA}','none'),
      (102,'xs.resB.poll','RESB',NULL,'select count(*) from public.polls where id={PA}','none'),
      (103,'xs.resB.poll_options','RESB',NULL,'select count(*) from public.poll_options where id={OA1}','none'),
      (104,'xs.resB.meeting','RESB',NULL,'select count(*) from public.meetings where id={MA}','none'),
      (105,'xs.resB.ticket','RESB',NULL,'select count(*) from public.support_tickets where id={TA}','none'),
      (106,'xs.resB.ticket_access_rpc','RESB',NULL,'select count(*) from public.helpdesk_ticket_access({TA}) where can_view','none'),
      (107,'xs.resB.visitor','RESB',NULL,'select count(*) from public.visitors where id={VA}','none'),
      (108,'xs.resB.vehicle','RESB',NULL,'select count(*) from public.vehicles where id={VEA}','none'),
      (109,'xs.resB.material_pass','RESB',NULL,'select count(*) from public.material_passes where id={MPA}','none'),
      (110,'xs.resB.sos','RESB',NULL,'select count(*) from public.sos_alerts where id={SOSA}','none'),
      (111,'xs.resB.notification','RESB',NULL,'select count(*) from public.user_notifications where id={UNA}','none'),
      (112,'xs.resB.flat_residents','RESB',NULL,'select count(*) from public.flat_residents where flat_id={FA1}','none'),
      (113,'xs.resB.profile','RESB',NULL,'select count(*) from public.profiles where id={RESA}','none'),
      (114,'xs.resB.document_row','RESB',NULL,'select count(*) from public.society_knowledge_sources where id={KDA}','none'),
      (115,'xs.resB.document_path','RESB',NULL,'select count(p) from (select public.knowledge_document_path({KDA}) p) x','none'),
      (116,'xs.resB.lease_path','RESB',NULL,'select count(p) from (select public.my_lease_document_path({LSA}) p) x','err:not_found'),
      (117,'xs.resB.vote_other_society_poll','RESB',NULL,'select 1 from (select public.poll_cast_vote({PA},{OA1})) x','err:not_found'),
      (118,'xs.resB.poll_results','RESB',NULL,'select count(*) from public.poll_results(array[{PA}]::uuid[])','none'),
      (119,'xs.resB.meeting_rsvp','RESB',NULL,'select 1 from (select public.meeting_rsvp({MA},''yes'')) x','err:not_found'),
      (120,'xs.resB.notice_ack','RESB',NULL,'select 1 from (select public.notice_acknowledge({NA})) x','err:not_found'),
      (121,'xs.resB.parking_violation','RESB',NULL,'select count(*) from public.parking_violations where id={PVA}','none'),
      (122,'xs.resB.payments','RESB',NULL,'select count(*) from public.payments where society_id={SA}','none'),

      -- Cross-society: society admin of B.
      (200,'xs.admB.bill','ADMB',NULL,'select count(*) from public.bills where id={BLA}','none'),
      (201,'xs.admB.bill_update','ADMB',NULL,'with u as (update public.bills set notes=''x'' where id={BLA} returning 1) select count(*) from u','none'),
      (202,'xs.admB.ticket','ADMB',NULL,'select count(*) from public.support_tickets where id={TA}','none'),
      (203,'xs.admB.visitor','ADMB',NULL,'select count(*) from public.visitors where id={VA}','none'),
      (204,'xs.admB.vehicle','ADMB',NULL,'select count(*) from public.vehicles where id={VEA}','none'),
      (205,'xs.admB.profile','ADMB',NULL,'select count(*) from public.profiles where id={RESA}','none'),
      (206,'xs.admB.flat','ADMB',NULL,'select count(*) from public.flats where id={FA1}','none'),
      (207,'xs.admB.flat_update','ADMB',NULL,'with u as (update public.flats set flat_number=''X'' where id={FA1} returning 1) select count(*) from u','none'),
      (208,'xs.admB.visitor_action','ADMB',NULL,'select 1 from (select public.guard_visitor_action({VA},''deny'')) x','err:not_found'),
      (209,'xs.admB.decide_material_pass','ADMB',NULL,'select 1 from (select public.decide_material_pass({MPA},true,null)) x','err:Not allowed'),
      (210,'xs.admB.incident_resolve','ADMB',NULL,'select 1 from (select public.incident_resolve({INA},''Synthetic close note'')) x','err:invalid_transition'),
      (211,'xs.admB.sos_update','ADMB',NULL,'select 1 from (select public.sos_update({SOSA},''acknowledge'')) x','err:not_found'),
      (212,'xs.admB.parking_violation_update','ADMB',NULL,'select 1 from (select public.admin_parking_violation_update({PVA},''resolved'',''Synthetic note'')) x','err:not_found'),
      (213,'xs.admB.document_row','ADMB',NULL,'select count(*) from public.society_knowledge_sources where id={KDCA}','none'),
      (214,'xs.admB.document_path','ADMB',NULL,'select count(p) from (select public.knowledge_document_path({KDCA}) p) x','none'),
      (215,'xs.admB.poll_results','ADMB',NULL,'select count(*) from public.poll_results(array[{PA}]::uuid[])','none'),
      (216,'xs.admB.meeting','ADMB',NULL,'select count(*) from public.meetings where id={MAC}','none'),
      (217,'xs.admB.meeting_set_status','ADMB',NULL,'select 1 from (select public.meeting_set_status({MA},''cancelled'',''Synthetic reason'')) x','err:.'),
      (218,'xs.admB.grant_role_in_A','ADMB',NULL,'insert into public.user_roles(user_id,role,society_id) values ({ADMB},''society_admin'',{SA}) returning 1','err:.'),
      (219,'xs.admB.notice_insert_in_A','ADMB',NULL,'insert into public.notices(society_id,title,body,created_by) values ({SA},''QA injected'',''x'',{ADMB}) returning 1','err:.'),
      (220,'xs.admB.no_dues_rows','ADMB',NULL,'select count(*) from public.no_dues_requests where society_id={SA}','none'),
      (221,'xs.admB.audit_log','ADMB',NULL,'select count(*) from public.audit_log where society_id={SA}','none'),
      (222,'xs.admB.payments','ADMB',NULL,'select count(*) from public.payments where society_id={SA}','none'),

      -- Cross-society: block admin of B.
      (300,'xs.blkB.bill','BLKB',NULL,'select count(*) from public.bills where id={BLA}','none'),
      (301,'xs.blkB.flat_residents','BLKB',NULL,'select count(*) from public.flat_residents where flat_id={FA1}','none'),
      (302,'xs.blkB.profile','BLKB',NULL,'select count(*) from public.profiles where id={RESA}','none'),
      (303,'xs.blkB.visitor','BLKB',NULL,'select count(*) from public.visitors where id={VA}','none'),
      (304,'xs.blkB.visitor_action','BLKB',NULL,'select 1 from (select public.guard_visitor_action({VA},''deny'')) x','err:not_found'),
      (305,'xs.blkB.vehicle','BLKB',NULL,'select count(*) from public.vehicles where id={VEA}','none'),

      -- Cross-society: guard of B (with an active guard session).
      (400,'xs.grdB.visitor_checkin','GRDB','GSB','select 1 from (select public.guard_visitor_action({VA},''checkin'')) x','err:not_found'),
      (401,'xs.grdB.vehicle_lookup','GRDB','GSB','select count(*) from public.guard_verify_vehicle(''QA4B00A1'')','none'),
      (402,'xs.grdB.material_pass_mark','GRDB','GSB','select 1 from (select public.guard_mark_material_pass({MPA2},''in'')) x','err:Not allowed'),
      (403,'xs.grdB.sos_update','GRDB','GSB','select 1 from (select public.sos_update({SOSA},''acknowledge'')) x','err:not_found'),
      (404,'xs.grdB.visitor_row','GRDB','GSB','select count(*) from public.visitors where id={VA}','none'),
      (405,'xs.grdB.parking_violation','GRDB','GSB','select count(*) from public.parking_violations where id={PVA}','none'),
      (406,'xs.grdB.incident','GRDB','GSB','select count(*) from public.security_incidents where id={INA}','none'),
      (407,'xs.grdB.sos_row','GRDB','GSB','select count(*) from public.sos_alerts where id={SOSA}','none'),
      (408,'xs.grdB.material_pass_row','GRDB','GSB','select count(*) from public.material_passes where id={MPA2}','none'),

      -- Cross-society: auditor (committee finance reader) of B.
      (500,'xs.audB.bill','AUDB',NULL,'select count(*) from public.bills where id={BLA}','none'),
      (501,'xs.audB.payments','AUDB',NULL,'select count(*) from public.payments where society_id={SA}','none'),
      (502,'xs.audB.no_dues','AUDB',NULL,'select count(*) from public.no_dues_requests where society_id={SA}','none'),

      -- Role boundaries inside Society A: resident.
      (600,'role.resA.other_resident_profile','RESA',NULL,'select count(*) from public.profiles where id={RESA2}','none'),
      (601,'role.resA.other_home_bill','RESA',NULL,'select count(*) from public.bills where id={BLA3}','none'),
      (602,'role.resA.mark_own_bill_paid','RESA',NULL,'with u as (update public.bills set status=''paid'' where id={BLA} returning 1) select count(*) from u','none'),
      (603,'role.resA.self_promote','RESA',NULL,'insert into public.user_roles(user_id,role,society_id) values ({RESA},''society_admin'',{SA}) returning 1','err:.'),
      (604,'role.resA.insert_notice','RESA',NULL,'insert into public.notices(society_id,title,body,created_by) values ({SA},''QA injected'',''x'',{RESA}) returning 1','err:.'),
      (605,'role.resA.insert_poll','RESA',NULL,'insert into public.polls(society_id,title,created_by) values ({SA},''QA injected'',{RESA}) returning 1','err:.'),
      (606,'role.resA.decide_material_pass','RESA',NULL,'select 1 from (select public.decide_material_pass({MPA},true,null)) x','err:Not allowed'),
      (607,'role.resA.parking_violation_update','RESA',NULL,'select 1 from (select public.admin_parking_violation_update({PVA},''resolved'',''Synthetic note'')) x','err:forbidden'),
      (608,'role.resA.incident_resolve','RESA',NULL,'select 1 from (select public.incident_resolve({INA},''Synthetic close note'')) x','err:forbidden'),
      (609,'role.resA.sos_update','RESA',NULL,'select 1 from (select public.sos_update({SOSA},''resolve'')) x','err:forbidden'),
      (610,'role.resA.guard_visitor_action','RESA',NULL,'select 1 from (select public.guard_visitor_action({VA},''checkin'')) x','err:forbidden'),
      (611,'role.resA.guard_vehicle_lookup','RESA',NULL,'select count(*) from public.guard_verify_vehicle(''QA4B00A1'')','err:forbidden'),
      (612,'role.resA.audit_log','RESA',NULL,'select count(*) from public.audit_log where society_id={SA}','none'),
      (613,'role.resA.meeting_set_status','RESA',NULL,'select 1 from (select public.meeting_set_status({MA},''cancelled'',''Synthetic reason'')) x','err:.'),
      (614,'role.resA.survey_status','RESA',NULL,'select 1 from (select public.admin_set_survey_status({PA},''closed'')) x','err:.'),
      (615,'role.resA.committee_document','RESA',NULL,'select count(p) from (select public.knowledge_document_path({KDCA}) p) x','none'),
      (616,'role.resA.incidents','RESA',NULL,'select count(*) from public.security_incidents where id={INA}','none'),
      (617,'role.resA.other_resident_ticket_access','RESA2',NULL,'select count(*) from public.helpdesk_ticket_access({TA}) where can_view','none'),
      (618,'role.resA2.other_resident_lease','RESA2',NULL,'select count(p) from (select public.my_lease_document_path({LSA}) p) x','err:not_found'),
      (619,'role.resA2.other_resident_notification','RESA2',NULL,'select count(*) from public.user_notifications where id={UNA}','none'),
      (620,'role.resA.notification_for_other','RESA',NULL,'insert into public.user_notifications(user_id,society_id,kind,title) values ({RESA2},{SA},''meeting'',''QA forged'') returning 1','err:.'),
      (621,'role.resA.notification_edit_title','RESA',NULL,'with u as (update public.user_notifications set title=''QA forged'' where id={UNA} returning 1) select count(*) from u','err:.'),
      (622,'role.resA.lease_list_scoped','RESA2',NULL,'select count(*) from public.list_my_lease_documents() where id={LSA}','none'),

      -- Role boundaries: block admin of A1.
      (700,'role.blkA.other_block_bill','BLKA',NULL,'select count(*) from public.bills where id={BLA3}','none'),
      (701,'role.blkA.other_block_residents','BLKA',NULL,'select count(*) from public.flat_residents where flat_id={FA2}','none'),
      (702,'role.blkA.other_block_profile','BLKA',NULL,'select count(*) from public.profiles where id={RESA2}','none'),
      (703,'role.blkA.decide_material_pass','BLKA',NULL,'select 1 from (select public.decide_material_pass({MPA},true,null)) x','err:Not allowed'),
      (704,'role.blkA.parking_admin','BLKA',NULL,'select 1 from (select public.admin_parking_violation_update({PVA},''resolved'',''Synthetic note'')) x','err:forbidden'),
      (705,'role.blkA.grant_role','BLKA',NULL,'insert into public.user_roles(user_id,role,society_id) values ({RESA},''block_admin'',{SA}) returning 1','err:.'),
      (706,'role.blkA.notice_insert','BLKA',NULL,'insert into public.notices(society_id,title,body,created_by) values ({SA},''QA injected'',''x'',{BLKA}) returning 1','err:.'),
      (707,'role.blkA.committee_document','BLKA',NULL,'select count(p) from (select public.knowledge_document_path({KDCA}) p) x','none'),
      (708,'role.blkA.audit_log','BLKA',NULL,'select count(*) from public.audit_log where society_id={SA}','none'),

      -- Role boundaries: guard of A.
      (800,'role.grdA.bills','GRDA','GSA','select count(*) from public.bills where society_id={SA}','none'),
      (801,'role.grdA.payments','GRDA','GSA','select count(*) from public.payments where society_id={SA}','none'),
      (802,'role.grdA.resident_profile','GRDA','GSA','select count(*) from public.profiles where id={RESA}','none'),
      (803,'role.grdA.flat_residents','GRDA','GSA','select count(*) from public.flat_residents where flat_id={FA1}','none'),
      (804,'role.grdA.no_dues','GRDA','GSA','select count(*) from public.no_dues_requests where society_id={SA}','none'),
      (805,'role.grdA.tickets','GRDA','GSA','select count(*) from public.support_tickets where id={TA}','none'),
      (806,'role.grdA.audit_log','GRDA','GSA','select count(*) from public.audit_log where society_id={SA}','none'),
      (807,'role.grdA.committee_document','GRDA','GSA','select count(p) from (select public.knowledge_document_path({KDCA}) p) x','none'),
      (808,'role.grdA.decide_material_pass','GRDA','GSA','select 1 from (select public.decide_material_pass({MPA},true,null)) x','err:Not allowed'),
      (809,'role.grdA.parking_admin','GRDA','GSA','select 1 from (select public.admin_parking_violation_update({PVA},''resolved'',''Synthetic note'')) x','err:forbidden'),
      (810,'role.grdA.incident_resolve_admin_only','GRDA','GSA','select 1 from (select public.incident_resolve({INA},''Synthetic close note'')) x','err:forbidden'),
      (811,'role.grdA.no_session_visitor_action','GRDA',NULL,'select 1 from (select public.guard_visitor_action({VA},''checkin'')) x','err:forbidden'),
      (812,'role.grdA.no_session_vehicle_lookup','GRDA',NULL,'select count(*) from public.guard_verify_vehicle(''QA4B00A1'')','err:forbidden'),
      (813,'role.grdA.pending_pass_hidden','GRDA','GSA','select count(*) from public.material_passes where id={MPA}','none'),
      (814,'role.grdA.visitor_checkin_allowed','GRDA','GSA','select 1 from (select public.guard_visitor_action({VA},''checkin'')) x','ok'),
      (815,'role.grdA.material_pass_in_allowed','GRDA','GSA','select 1 from (select public.guard_mark_material_pass({MPA2},''in'')) x','ok'),
      (816,'role.grdA.sos_ack_allowed','GRDA','GSA','select 1 from (select public.sos_update({SOSA},''acknowledge'')) x','ok'),
      (817,'role.grdA.mark_pending_pass','GRDA','GSA','select 1 from (select public.guard_mark_material_pass({MPA},''in'')) x','err:invalid_transition'),

      -- Role boundaries: auditor (committee finance reader) of A.
      (900,'role.audA.bill_update','AUDA',NULL,'with u as (update public.bills set status=''paid'' where id={BLA} returning 1) select count(*) from u','none'),
      (901,'role.audA.bill_insert','AUDA',NULL,'insert into public.bills(society_id,flat_id,period_label,period_start,period_end,amount,due_date) values ({SA},{FA1},''x'',current_date,current_date,1,current_date) returning 1','err:.'),
      (902,'role.audA.decide_material_pass','AUDA',NULL,'select 1 from (select public.decide_material_pass({MPA},true,null)) x','err:Not allowed'),
      (903,'role.audA.grant_role','AUDA',NULL,'insert into public.user_roles(user_id,role,society_id) values ({AUDA},''society_admin'',{SA}) returning 1','err:.'),

      -- Ordinary roles cannot invoke Super Admin-only actions.
      (950,'sa.admA.active_people','ADMA',NULL,'select count(*) from public.admin_active_people()','err:.'),
      (951,'sa.admA.messaging_channel','ADMA',NULL,'select 1 from (select public.admin_set_messaging_channel(''sms'',false,''Synthetic reason'')) x','err:.'),
      (952,'sa.admA.grant_super_admin','ADMA',NULL,'insert into public.user_roles(user_id,role,society_id) values ({ADMA},''super_admin'',null) returning 1','err:.'),
      (953,'sa.resA.active_people','RESA',NULL,'select count(*) from public.admin_active_people()','err:.'),
      (954,'sa.grdA.active_people','GRDA','GSA','select count(*) from public.admin_active_people()','err:.'),
      (955,'sa.audA.active_people','AUDA',NULL,'select count(*) from public.admin_active_people()','err:.'),
      (956,'sa.blkA.active_people','BLKA',NULL,'select count(*) from public.admin_active_people()','err:.'),
      (957,'sa.admA.is_super_admin_false','ADMA',NULL,'select count(*) from (select 1 where public.current_user_is_super_admin()) x','none'),
      (958,'sa.admA.society_plan_columns','ADMA',NULL,'with u as (update public.societies set plan_id=''premium'' where id={SA} returning 1) select count(*) from u','err:.'),

      -- Society admin positive scope (own society only).
      (970,'scope.admA.decide_material_pass','ADMA',NULL,'select 1 from (select public.decide_material_pass({MPA},true,null)) x','ok'),
      (971,'scope.admA.parking_warn','ADMA',NULL,'select 1 from (select public.admin_parking_violation_update({PVA},''warned'',''Synthetic warning note'')) x','ok'),
      (972,'scope.admA.committee_document','ADMA',NULL,'select count(p) from (select public.knowledge_document_path({KDCA}) p) x','rows'),

      -- Polls / votes (identifiers only; option labels are never used).
      (1000,'poll.resA.results_hidden_before_vote','RESA',NULL,'select count(*) from public.poll_results(array[{PA}]::uuid[])','none'),
      (1001,'poll.resA.option_from_other_poll','RESA',NULL,'select 1 from (select public.poll_cast_vote({PA},{OB1})) x','err:invalid_option'),
      (1002,'poll.resA.unknown_option','RESA',NULL,'select 1 from (select public.poll_cast_vote({PA},{RAND})) x','err:invalid_option'),
      (1003,'poll.resA.closed_poll','RESA',NULL,'select 1 from (select public.poll_cast_vote({PAC},{OAC1})) x','err:poll_closed'),
      (1004,'poll.resA.other_society_poll','RESA',NULL,'select 1 from (select public.poll_cast_vote({PB},{OB1})) x','err:not_found'),
      (1005,'poll.resA.direct_insert_other_society','RESA',NULL,'insert into public.poll_votes(poll_id,option_id,user_id) values ({PB},{OB1},{RESA}) returning 1','err:.'),
      (1006,'poll.resA.direct_insert_as_other_user','RESA',NULL,'insert into public.poll_votes(poll_id,option_id,user_id) values ({PA},{OA1},{RESA2}) returning 1','err:.'),
      (1007,'poll.resA.vote','RESA',NULL,'select 1 from (select public.poll_cast_vote({PA},{OA1})) x','ok'),
      (1008,'poll.resA.second_vote','RESA',NULL,'select 1 from (select public.poll_cast_vote({PA},{OA2})) x','err:already_voted'),
      (1009,'poll.resA.change_vote_directly','RESA',NULL,'with u as (update public.poll_votes set option_id={OA2} where poll_id={PA} and user_id={RESA} returning 1) select count(*) from u','none'),
      (1010,'poll.resA.results_after_vote','RESA',NULL,'select coalesce(sum(votes),0) from public.poll_results(array[{PA}]::uuid[]) where option_id={OA1}','rows'),
      (1011,'poll.resA.result_not_inflated','RESA',NULL,'select coalesce(sum(votes),0) - 1 from public.poll_results(array[{PA}]::uuid[])','none'),
      (1012,'poll.anon.vote','-anon',NULL,'select 1 from (select public.poll_cast_vote({PA},{OA2})) x','err:.'),
      (1013,'poll.grdB.vote_other_society','GRDB','GSB','select 1 from (select public.poll_cast_vote({PA},{OA2})) x','err:not_found'),

      -- Meetings.
      (1100,'meet.resA.draft_hidden','RESA',NULL,'select count(*) from public.meetings where id={MAD}','none'),
      (1101,'meet.resA.committee_hidden','RESA',NULL,'select count(*) from public.meetings where id={MAC}','none'),
      (1102,'meet.resA.rsvp_draft','RESA',NULL,'select 1 from (select public.meeting_rsvp({MAD},''yes'')) x','err:not_found'),
      (1103,'meet.resA.rsvp_committee','RESA',NULL,'select 1 from (select public.meeting_rsvp({MAC},''yes'')) x','err:not_found'),
      (1104,'meet.resA.rsvp_own_society','RESA',NULL,'select 1 from (select public.meeting_rsvp({MA},''yes'')) x','ok'),
      (1105,'meet.resA.rsvp_other_society','RESA',NULL,'select 1 from (select public.meeting_rsvp({MB},''yes'')) x','err:not_found'),
      (1106,'meet.resA.other_society_row','RESA',NULL,'select count(*) from public.meetings where id={MB}','none'),
      (1107,'meet.anon.row','-anon',NULL,'select count(*) from public.meetings where id={MA}','none'),

      -- Documents (anon / unknown IDs).
      (1200,'doc.anon.path','-anon',NULL,'select count(p) from (select public.knowledge_document_path({KDA}) p) x','none'),
      (1201,'doc.resA.unknown_id','RESA',NULL,'select count(p) from (select public.knowledge_document_path({RAND}) p) x','none'),
      (1202,'doc.resA.unknown_lease','RESA',NULL,'select count(p) from (select public.my_lease_document_path({RAND}) p) x','err:^not_found$'),
      (1203,'doc.resA2.lease_error_is_generic','RESA2',NULL,'select count(p) from (select public.my_lease_document_path({LSA}) p) x','err:^not_found$'),
      (1204,'doc.resA.other_society_doc','RESA',NULL,'select count(p) from (select public.knowledge_document_path({KDB}) p) x','none'),

      -- Notifications.
      (1300,'notif.anon.rows','-anon',NULL,'select count(*) from public.user_notifications where id={UNA}','none'),
      (1301,'notif.admA.other_users_rows','ADMA',NULL,'select count(*) from public.user_notifications where id={UNA}','none'),
      (1302,'notif.admB.other_society_rows','ADMB',NULL,'select count(*) from public.user_notifications where id={UNA}','none'),

      -- Anonymous callers.
      (1400,'anon.bills','-anon',NULL,'select count(*) from public.bills where id={BLA}','none'),
      (1401,'anon.no_dues_certificates','-anon',NULL,'select count(*) from public.no_dues_certificates where society_id={SA}','none'),
      (1402,'anon.visitors','-anon',NULL,'select count(*) from public.visitors where id={VA}','none'),
      (1403,'anon.no_dues_internal','-anon',NULL,'select count(*) from public.compute_no_dues_eligibility_internal({SA},{FA2})','err:.'),

      -- Signed-in users cannot call No-Dues internal functions directly.
      (1500,'nd.resA.submit_internal_blocked','RESA',NULL,'select count(*) from public.submit_no_dues_request_internal({RESA},{SA},{FA1},''x'')','err:permission denied'),
      (1501,'nd.admA.transition_internal_blocked','ADMA',NULL,'select count(*) from public.transition_no_dues_request_internal({ADMA},{RAND},''approve'',null,null)','err:permission denied'),
      (1502,'nd.admA.revoke_internal_blocked','ADMA',NULL,'select 1 from (select public.revoke_no_dues_certificate_internal({ADMA},{RAND},''Synthetic reason'')) x','err:permission denied'),
      (1503,'nd.admA.compute_internal_blocked','ADMA',NULL,'select count(*) from public.compute_no_dues_eligibility_internal({SA},{FA1})','err:permission denied')
    ) AS t(seq, name, actor, sess, sql, expect)
    ORDER BY seq
  LOOP
    q := c.sql;
    FOR k IN SELECT jsonb_object_keys(ids) LOOP
      q := replace(q, '{' || k || '}', quote_literal(ids->>k) || '::uuid');
    END LOOP;

    outcome := NULL; n := NULL;
    BEGIN
      IF c.actor = '-anon' THEN
        PERFORM set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
        EXECUTE 'SET LOCAL ROLE anon';
      ELSE
        PERFORM set_config('request.jwt.claims', json_build_object(
          'sub', ids->>c.actor, 'role', 'authenticated', 'aud', 'authenticated',
          'session_id', CASE WHEN c.sess IS NULL THEN NULL ELSE ids->>c.sess END)::text, true);
        EXECUTE 'SET LOCAL ROLE authenticated';
      END IF;
      EXECUTE q INTO n;
      EXECUTE 'RESET ROLE';
      outcome := 'ok';
    EXCEPTION WHEN OTHERS THEN
      outcome := 'err:' || SQLERRM;
    END;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);

    IF c.expect = 'rows' THEN
      ok := outcome = 'ok' AND coalesce(n, 0) > 0;
    ELSIF c.expect = 'none' THEN
      ok := (outcome = 'ok' AND coalesce(n, 0) = 0) OR outcome ~* '^err:(permission denied|.*row-level security|forbidden|not_found)';
    ELSIF c.expect = 'ok' THEN
      ok := outcome = 'ok';
    ELSE
      ok := outcome LIKE 'err:%' AND substr(outcome, 5) ~ substr(c.expect, 5);
    END IF;

    IF ok THEN pass := pass + 1;
    ELSE fail := fail + 1; failures := failures || (c.name || ' => ' || coalesce(outcome, 'null') || ' n=' || coalesce(n::text, 'null'));
    END IF;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- No-Dues lifecycle through the server-only internal functions. These are
  -- what the authenticated server functions call with the verified caller ID.
  -- -------------------------------------------------------------------------
  -- Eligibility follows existing dues rules.
  elig := public.compute_no_dues_eligibility_internal((ids->>'SA')::uuid, (ids->>'FA1')::uuid);
  IF (elig->>'eligible')::boolean = false THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'nd.eligibility.unpaid_home_ineligible'::text; END IF;
  elig := public.compute_no_dues_eligibility_internal((ids->>'SA')::uuid, (ids->>'FA2')::uuid);
  IF (elig->>'eligible')::boolean = true THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'nd.eligibility.clear_home_eligible'::text; END IF;
  BEGIN
    elig := public.compute_no_dues_eligibility_internal((ids->>'SB')::uuid, (ids->>'FA2')::uuid);
    fail := fail + 1; failures := failures || 'nd.eligibility.cross_society_flat_rejected'::text;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ~ 'INVALID_FLAT_FOR_SOCIETY' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('nd.eligibility.cross_society_flat_rejected => ' || SQLERRM); END IF;
  END;

  -- Requests: only a resident of that home may submit.
  BEGIN
    PERFORM public.submit_no_dues_request_internal((ids->>'RESB')::uuid, (ids->>'SA')::uuid, (ids->>'FA2')::uuid, 'QA purpose');
    fail := fail + 1; failures := failures || 'nd.submit.other_society_resident_rejected'::text;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ~ 'NOT_AUTHORIZED' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('nd.submit.other_society_resident_rejected => ' || SQLERRM); END IF;
  END;
  BEGIN
    PERFORM public.submit_no_dues_request_internal((ids->>'RESA')::uuid, (ids->>'SA')::uuid, (ids->>'FA2')::uuid, 'QA purpose');
    fail := fail + 1; failures := failures || 'nd.submit.other_home_rejected'::text;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ~ 'NOT_AUTHORIZED' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('nd.submit.other_home_rejected => ' || SQLERRM); END IF;
  END;

  SELECT r.request_id, r.status::text INTO nd1, st FROM public.submit_no_dues_request_internal((ids->>'RESA')::uuid, (ids->>'SA')::uuid, (ids->>'FA1')::uuid, 'QA purpose') r;
  IF st = 'blocked_by_dues' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('nd.submit.ineligible_blocked => ' || coalesce(st,'null')); END IF;
  SELECT r.request_id, r.status::text INTO nd2, st FROM public.submit_no_dues_request_internal((ids->>'RESA2')::uuid, (ids->>'SA')::uuid, (ids->>'FA2')::uuid, 'QA purpose') r;
  IF st = 'submitted' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('nd.submit.eligible_submitted => ' || coalesce(st,'null')); END IF;

  -- Approval: only that society's admin.
  FOR c IN SELECT * FROM (VALUES ('nd.approve.resident_rejected','RESA2'),('nd.approve.block_admin_rejected','BLKA'),
                                 ('nd.approve.guard_rejected','GRDA'),('nd.approve.auditor_rejected','AUDA'),
                                 ('nd.approve.other_society_admin_rejected','ADMB')) v(name, actor) LOOP
    BEGIN
      PERFORM public.transition_no_dues_request_internal((ids->>c.actor)::uuid, nd2, 'approve', NULL, NULL);
      fail := fail + 1; failures := failures || c.name::text;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM ~ 'NOT_AUTHORIZED' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || (c.name || ' => ' || SQLERRM); END IF;
    END;
  END LOOP;
  BEGIN
    PERFORM public.transition_no_dues_request_internal((ids->>'ADMA')::uuid, nd1, 'approve', NULL, NULL);
    fail := fail + 1; failures := failures || 'nd.approve.blocked_request_cannot_be_approved'::text;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ~ 'INVALID_TRANSITION' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('nd.approve.blocked_request_cannot_be_approved => ' || SQLERRM); END IF;
  END;
  BEGIN
    PERFORM public.transition_no_dues_request_internal((ids->>'RESA2')::uuid, nd1, 'resubmit', NULL, NULL);
    fail := fail + 1; failures := failures || 'nd.resubmit.non_requester_rejected'::text;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ~ 'NOT_AUTHORIZED' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('nd.resubmit.non_requester_rejected => ' || SQLERRM); END IF;
  END;
  SELECT r.new_status::text INTO st FROM public.transition_no_dues_request_internal((ids->>'ADMA')::uuid, nd2, 'approve', NULL, NULL) r;
  IF st = 'approved' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('nd.approve.society_admin_approves => ' || coalesce(st,'null')); END IF;

  -- Issuance: only an admin of that home; follows eligibility.
  tok_hash := encode(sha256(convert_to('qa-p4b-synthetic-token-not-a-secret', 'UTF8')), 'hex');
  FOR c IN SELECT * FROM (VALUES ('nd.issue.other_society_admin_rejected','ADMB'),('nd.issue.resident_rejected','RESA2'),
                                 ('nd.issue.guard_rejected','GRDA')) v(name, actor) LOOP
    BEGIN
      PERFORM public.finalize_no_dues_issuance_internal((ids->>c.actor)::uuid, nd2, 'QA-ND-0001', tok_hash, 'qa-cipher', 'qa-iv', 1::smallint, (ids->>'SA') || '/qa-cert.pdf', current_date + 30);
      fail := fail + 1; failures := failures || c.name::text;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM ~ 'NOT_AUTHORIZED' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || (c.name || ' => ' || SQLERRM); END IF;
    END;
  END LOOP;
  BEGIN
    PERFORM public.finalize_no_dues_issuance_internal((ids->>'ADMA')::uuid, nd1, 'QA-ND-0002', tok_hash, 'qa-cipher', 'qa-iv', 1::smallint, (ids->>'SA') || '/qa-cert.pdf', current_date + 30);
    fail := fail + 1; failures := failures || 'nd.issue.unapproved_request_rejected'::text;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ~ 'INVALID_TRANSITION' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('nd.issue.unapproved_request_rejected => ' || SQLERRM); END IF;
  END;
  SELECT r.certificate_id INTO cert FROM public.finalize_no_dues_issuance_internal((ids->>'ADMA')::uuid, nd2, 'QA-ND-0001', tok_hash, 'qa-cipher', 'qa-iv', 1::smallint, (ids->>'SA') || '/qa-cert.pdf', current_date + 30) r;
  IF cert IS NOT NULL THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'nd.issue.society_admin_issues'::text; END IF;

  -- Certificate visibility: requester yes; other resident / other society / guard no.
  FOR c IN SELECT * FROM (VALUES ('nd.cert.requester_reads',  'RESA2','rows'), ('nd.cert.other_resident_hidden','RESA','none'),
                                 ('nd.cert.other_society_admin_hidden','ADMB','none'), ('nd.cert.guard_hidden','GRDA','none'),
                                 ('nd.cert.block_admin_other_block_hidden','BLKA','none')) v(name, actor, expect) LOOP
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', ids->>c.actor, 'role','authenticated')::text, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      EXECUTE format('select count(*) from public.no_dues_certificates where id = %L::uuid', cert) INTO n;
      EXECUTE 'RESET ROLE';
      outcome := 'ok';
    EXCEPTION WHEN OTHERS THEN outcome := 'err:' || SQLERRM; n := NULL;
    END;
    EXECUTE 'RESET ROLE';
    ok := (c.expect = 'rows' AND outcome = 'ok' AND n > 0) OR (c.expect = 'none' AND (outcome <> 'ok' OR n = 0));
    IF ok THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || (c.name || ' => ' || outcome || ' n=' || coalesce(n::text,'null')); END IF;
  END LOOP;

  -- Revocation: only that society's admin.
  FOR c IN SELECT * FROM (VALUES ('nd.revoke.other_society_admin_rejected','ADMB'),('nd.revoke.resident_rejected','RESA2'),
                                 ('nd.revoke.block_admin_rejected','BLKA')) v(name, actor) LOOP
    BEGIN
      PERFORM public.revoke_no_dues_certificate_internal((ids->>c.actor)::uuid, cert, 'Synthetic reason');
      fail := fail + 1; failures := failures || c.name::text;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM ~ 'NOT_AUTHORIZED' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || (c.name || ' => ' || SQLERRM); END IF;
    END;
  END LOOP;
  PERFORM public.revoke_no_dues_certificate_internal((ids->>'ADMA')::uuid, cert, 'Synthetic reason');
  IF EXISTS (SELECT 1 FROM public.no_dues_certificates WHERE id = cert AND revoked_at IS NOT NULL)
     AND EXISTS (SELECT 1 FROM public.no_dues_requests WHERE id = nd2 AND status = 'revoked') THEN
    pass := pass + 1;
  ELSE fail := fail + 1; failures := failures || 'nd.revoke.society_admin_revokes'::text;
  END IF;

  -- -------------------------------------------------------------------------
  -- Private storage buckets stay private (read-only metadata check).
  -- -------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id IN ('society-knowledge','no-dues-certificates','kyc-admin') AND public) THEN
    pass := pass + 1;
  ELSE fail := fail + 1; failures := failures || 'storage.private_buckets_not_public'::text;
  END IF;

  RAISE EXCEPTION 'P4B_RESULT|pass=%|fail=%|%', pass, fail,
    CASE WHEN fail = 0 THEN 'OK' ELSE array_to_string(failures, ' ;; ') END;
END
$p4b$;
