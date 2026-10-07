-- SociyoHub Polls + Elections end-to-end harness (results, lifecycle, isolation).
--
-- Acts as synthetic signed-in users against the real RPCs and RLS.
-- Safety contract (same as phase4b / marketplace): synthetic fixed IDs (prefix 6e6e0000-),
-- *.invalid emails, one DO block that ALWAYS ends with RAISE EXCEPTION, so everything rolls back.
-- Run only on a disposable local database:
--   psql "$DISPOSABLE_DB_URL" -f tests/sql/governance-e2e.sql
-- Output: GOV_RESULT|pass=<n>|fail=<n>|<failures or OK>

CREATE OR REPLACE FUNCTION pg_temp.gv_act(_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  IF _uid IS NULL THEN
    PERFORM set_config('request.jwt.claims', '', true);
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
  END IF;
END $$;

-- Runs one statement as _uid inside a subtransaction; returns its single text value, or 'ERR:<message>'.
CREATE OR REPLACE FUNCTION pg_temp.gv_run(_uid uuid, _q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  BEGIN
    PERFORM pg_temp.gv_act(_uid);
    EXECUTE _q INTO v;
    PERFORM pg_temp.gv_act(NULL);
    RETURN coalesce(v, '<null>');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.gv_act(NULL);
    RETURN 'ERR:' || SQLERRM;
  END;
END $$;

DO $gov$
DECLARE
  ids jsonb := '{
    "SA":"6e6e0000-0000-4000-8000-00000000a001",
    "SB":"6e6e0000-0000-4000-8000-00000000b001",
    "BKA":"6e6e0000-0000-4000-8000-00000000a011",
    "BKB":"6e6e0000-0000-4000-8000-00000000b011",
    "FA1":"6e6e0000-0000-4000-8000-00000000a021",
    "FA2":"6e6e0000-0000-4000-8000-00000000a022",
    "FA3":"6e6e0000-0000-4000-8000-00000000a023",
    "FB1":"6e6e0000-0000-4000-8000-00000000b021",
    "ADMA":"6e6e0000-0000-4000-8000-00000000a101",
    "RESA":"6e6e0000-0000-4000-8000-00000000a102",
    "RESA2":"6e6e0000-0000-4000-8000-00000000a103",
    "BLKA":"6e6e0000-0000-4000-8000-00000000a104",
    "RESX":"6e6e0000-0000-4000-8000-00000000a105",
    "ADMB":"6e6e0000-0000-4000-8000-00000000b101",
    "RESB":"6e6e0000-0000-4000-8000-00000000b102",
    "PA":"6e6e0000-0000-4000-8000-00000000a201",
    "PAE":"6e6e0000-0000-4000-8000-00000000a202",
    "OA1":"6e6e0000-0000-4000-8000-00000000a211",
    "OA2":"6e6e0000-0000-4000-8000-00000000a212",
    "OAE":"6e6e0000-0000-4000-8000-00000000a213",
    "PB":"6e6e0000-0000-4000-8000-00000000b201",
    "OB1":"6e6e0000-0000-4000-8000-00000000b211",
    "REQ1":"6e6e0000-0000-4000-8000-00000000c001",
    "REQ2":"6e6e0000-0000-4000-8000-00000000c002",
    "REQ3":"6e6e0000-0000-4000-8000-00000000c003",
    "RAND":"6e6e0000-0000-4000-8000-00000000ffff"
  }'::jsonb;
  pass int := 0; fail int := 0; failures text[] := '{}';
  el uuid; elb uuid; post uuid; nom_a uuid; nom_a2 uuid; r text; j jsonb;
  w timestamptz := now();
BEGIN
  -- Fixtures -----------------------------------------------------------------
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT (ids->>u)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'qa-gov-' || lower(u) || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()
  FROM unnest(ARRAY['ADMA','RESA','RESA2','BLKA','RESX','ADMB','RESB']) u;
  INSERT INTO public.societies (id, name, city, plan, plan_id, plan_status, plan_expires_at, status, structure_mode)
  VALUES ((ids->>'SA')::uuid, '[QA] GOV Society A', 'Testville', 'pro', 'pro', 'active', now() + interval '30 days', 'active', 'structured'),
         ((ids->>'SB')::uuid, '[QA] GOV Society B', 'Testville', 'pro', 'pro', 'active', now() + interval '30 days', 'active', 'structured');
  INSERT INTO public.blocks (id, society_id, name) VALUES ((ids->>'BKA')::uuid, (ids->>'SA')::uuid, 'QA'), ((ids->>'BKB')::uuid, (ids->>'SB')::uuid, 'QB');
  INSERT INTO public.flats (id, society_id, block_id, flat_number, unit_type) VALUES
    ((ids->>'FA1')::uuid, (ids->>'SA')::uuid, (ids->>'BKA')::uuid, 'G-101', 'flat'),
    ((ids->>'FA2')::uuid, (ids->>'SA')::uuid, (ids->>'BKA')::uuid, 'G-102', 'flat'),
    ((ids->>'FA3')::uuid, (ids->>'SA')::uuid, (ids->>'BKA')::uuid, 'G-103', 'flat'),
    ((ids->>'FB1')::uuid, (ids->>'SB')::uuid, (ids->>'BKB')::uuid, 'G-201', 'flat');
  PERFORM set_config('app.allow_society_change', 'on', true);
  INSERT INTO public.profiles (id, full_name, society_id)
  SELECT (ids->>u)::uuid, 'QA GOV ' || u, (ids->>s)::uuid
  FROM (VALUES ('ADMA','SA'),('RESA','SA'),('RESA2','SA'),('BLKA','SA'),('RESX','SA'),('ADMB','SB'),('RESB','SB')) v(u, s)
  ON CONFLICT (id) DO UPDATE SET society_id = excluded.society_id, full_name = excluded.full_name;
  INSERT INTO public.user_roles (user_id, role, society_id, block_id, is_active)
  SELECT (ids->>u)::uuid, v.rl::public.app_role, (ids->>s)::uuid, CASE WHEN b IS NULL THEN NULL ELSE (ids->>b)::uuid END, true
  FROM (VALUES ('ADMA','society_admin','SA',NULL),('RESA','resident','SA',NULL),('RESA2','resident','SA',NULL),('BLKA','block_admin','SA','BKA'),
               ('RESX','resident','SA',NULL),('ADMB','society_admin','SB',NULL),('RESB','resident','SB',NULL)) v(u, rl, s, b);
  INSERT INTO public.flat_residents (flat_id, user_id, relationship, is_primary, is_active) VALUES
    ((ids->>'FA1')::uuid, (ids->>'RESA')::uuid, 'owner', true, true),
    ((ids->>'FA2')::uuid, (ids->>'RESA2')::uuid, 'owner', true, true),
    ((ids->>'FB1')::uuid, (ids->>'RESB')::uuid, 'owner', true, true);
  -- RESX keeps a resident role but has moved out.
  INSERT INTO public.flat_residents (flat_id, user_id, relationship, is_primary, is_active, moved_out_at) VALUES
    ((ids->>'FA3')::uuid, (ids->>'RESX')::uuid, 'tenant', false, false, now() - interval '5 days');

  INSERT INTO public.polls (id, society_id, title, status, kind, created_by, closes_at) VALUES
    ((ids->>'PA')::uuid, (ids->>'SA')::uuid, 'QA GOV poll', 'open', 'poll', (ids->>'ADMA')::uuid, now() + interval '7 days'),
    ((ids->>'PAE')::uuid, (ids->>'SA')::uuid, 'QA GOV empty closed poll', 'closed', 'poll', (ids->>'ADMA')::uuid, now() - interval '1 day'),
    ((ids->>'PB')::uuid, (ids->>'SB')::uuid, 'QB GOV poll', 'open', 'poll', (ids->>'ADMB')::uuid, now() + interval '7 days');
  INSERT INTO public.poll_options (id, poll_id, label, position) VALUES
    ((ids->>'OA1')::uuid, (ids->>'PA')::uuid, 'One', 1), ((ids->>'OA2')::uuid, (ids->>'PA')::uuid, 'Two', 2),
    ((ids->>'OAE')::uuid, (ids->>'PAE')::uuid, 'Only', 1), ((ids->>'OB1')::uuid, (ids->>'PB')::uuid, 'B', 1);

  -- Small assertion helper (inline): record pass/fail.
  -- 1. POLLS -------------------------------------------------------------------
  r := pg_temp.gv_run((ids->>'RESA')::uuid, format('select count(*)::text from public.poll_results(array[%L]::uuid[])', ids->>'PA'));
  IF r = '0' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('poll.results_hidden_before_vote=' || r); END IF;

  r := pg_temp.gv_run((ids->>'RESA')::uuid, format('select public.poll_cast_vote(%L,%L)::text', ids->>'PA', ids->>'OA1'));
  IF r NOT LIKE 'ERR:%' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('poll.vote_ok=' || r); END IF;
  r := pg_temp.gv_run((ids->>'RESA')::uuid, format('select public.poll_cast_vote(%L,%L)::text', ids->>'PA', ids->>'OA1'));
  r := r || '|' || pg_temp.gv_run((ids->>'RESA')::uuid, format('select public.poll_cast_vote(%L,%L)::text', ids->>'PA', ids->>'OA2'));
  IF (SELECT count(*) FROM public.poll_votes WHERE poll_id = (ids->>'PA')::uuid AND user_id = (ids->>'RESA')::uuid) = 1 THEN pass := pass + 1;
  ELSE fail := fail + 1; failures := failures || ('poll.repeat_vote_single_row=' || r); END IF;

  r := pg_temp.gv_run((ids->>'RESA')::uuid, format('select string_agg(option_id::text||'':''||votes, '','') from public.poll_results(array[%L]::uuid[])', ids->>'PA'));
  IF r = (ids->>'OA1') || ':1' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('poll.results_after_vote=' || r); END IF;

  r := pg_temp.gv_run((ids->>'ADMA')::uuid, format('select coalesce(sum(votes),0)::text from public.poll_results(array[%L]::uuid[])', ids->>'PA'));
  IF r = (SELECT count(*)::text FROM public.poll_votes WHERE poll_id = (ids->>'PA')::uuid) THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('poll.admin_counts_canonical=' || r); END IF;

  r := pg_temp.gv_run((ids->>'RESB')::uuid, format('select count(*)::text from public.poll_results(array[%L]::uuid[])', ids->>'PA'));
  IF r = '0' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('poll.cross_society_results=' || r); END IF;
  r := pg_temp.gv_run((ids->>'ADMB')::uuid, format('select count(*)::text from public.poll_results(array[%L]::uuid[])', ids->>'PA'));
  IF r = '0' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('poll.cross_society_admin_results=' || r); END IF;
  r := pg_temp.gv_run((ids->>'RESB')::uuid, format('select public.poll_cast_vote(%L,%L)::text', ids->>'PA', ids->>'OA1'));
  IF r LIKE 'ERR:%' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('poll.cross_society_vote=' || r); END IF;

  r := pg_temp.gv_run((ids->>'RESA2')::uuid, format('select count(*)::text from public.poll_results(array[%L]::uuid[])', ids->>'PAE'));
  IF r = '0' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('poll.closed_empty_results=' || r); END IF;
  r := pg_temp.gv_run((ids->>'RESA2')::uuid, format('select public.poll_cast_vote(%L,%L)::text', ids->>'PAE', ids->>'OAE'));
  IF r LIKE 'ERR:%' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('poll.closed_rejects_vote=' || r); END IF;
  r := pg_temp.gv_run((ids->>'RESA2')::uuid, format('select public.poll_cast_vote(%L,%L)::text', ids->>'PA', ids->>'OAE'));
  IF r LIKE 'ERR:%' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('poll.foreign_option_rejected=' || r); END IF;

  -- 2. ELECTIONS: creation -------------------------------------------------------
  FOREACH r IN ARRAY ARRAY['RESA','BLKA'] LOOP
    IF pg_temp.gv_run((ids->>r)::uuid, format('select public.election_save(null,%L,null,null,%L,true,%L,%L,%L,%L,null,null)::text',
         'QA GOV election', 'person', w, w + interval '1 hour', w + interval '1 hour', w + interval '2 hours')) LIKE 'ERR:%' THEN pass := pass + 1;
    ELSE fail := fail + 1; failures := failures || ('election.create_denied.' || r); END IF;
  END LOOP;
  el := pg_temp.gv_run((ids->>'ADMA')::uuid, format('select public.election_save(null,%L,null,null,%L,true,%L,%L,%L,%L,null,null)::text',
         'QA GOV election', 'person', w, w + interval '1 hour', w + interval '1 hour', w + interval '2 hours'))::uuid;
  IF (SELECT society_id FROM public.elections WHERE id = el) = (ids->>'SA')::uuid THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'election.create_admin_own_society'::text; END IF;
  elb := pg_temp.gv_run((ids->>'ADMB')::uuid, format('select public.election_save(null,%L,null,null,%L,true,%L,%L,%L,%L,null,null)::text',
         'QB GOV election', 'person', w, w + interval '1 hour', w + interval '1 hour', w + interval '2 hours'))::uuid;
  IF (SELECT society_id FROM public.elections WHERE id = elb) = (ids->>'SB')::uuid THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'election.other_admin_lands_in_own_society'::text; END IF;
  r := pg_temp.gv_run((ids->>'ADMB')::uuid, format('select public.election_post_save(%L,null,%L,1,null,null,null)::text', el, 'Secretary'));
  IF r LIKE 'ERR:%' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.cross_admin_post=' || r); END IF;
  post := pg_temp.gv_run((ids->>'ADMA')::uuid, format('select public.election_post_save(%L,null,%L,1,null,null,null)::text', el, 'Secretary'))::uuid;
  r := pg_temp.gv_run((ids->>'RESA')::uuid, format('select public.election_set_status(%L,%L,null)::text', el, 'nomination_open'));
  IF r LIKE 'ERR:%' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.resident_cannot_open=' || r); END IF;
  r := pg_temp.gv_run((ids->>'ADMA')::uuid, format('select public.election_set_status(%L,%L,null)::text', el, 'nomination_open'));
  IF r NOT LIKE 'ERR:%' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.admin_open=' || r); END IF;

  -- Nominations ------------------------------------------------------------------
  nom_a := nullif(pg_temp.gv_run((ids->>'RESA')::uuid, format('select public.election_nominate(%L,%L)::text', post, 'QA statement')), '')::uuid;
  IF nom_a IS NOT NULL THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'election.nominate_ok'::text; END IF;
  r := pg_temp.gv_run((ids->>'RESA')::uuid, format('select public.election_nominate(%L,%L)::text', post, 'again'));
  IF r LIKE 'ERR:%already_nominated%' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.duplicate_nomination=' || r); END IF;
  r := pg_temp.gv_run((ids->>'RESB')::uuid, format('select public.election_nominate(%L,%L)::text', post, 'x'));
  IF r LIKE 'ERR:%' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.cross_society_nominate=' || r); END IF;
  r := pg_temp.gv_run((ids->>'RESX')::uuid, format('select public.election_nominate(%L,%L)::text', post, 'x'));
  IF r LIKE 'ERR:%' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.moved_out_nominate=' || r); END IF;
  nom_a2 := pg_temp.gv_run((ids->>'RESA2')::uuid, format('select public.election_nominate(%L,%L)::text', post, 'QA statement 2'))::uuid;
  r := pg_temp.gv_run((ids->>'RESA2')::uuid, format('select public.election_withdraw_nomination(%L)::text', nom_a));
  IF r LIKE 'ERR:%' AND (SELECT status FROM public.election_nominations WHERE id = nom_a) = 'pending' THEN pass := pass + 1;
  ELSE fail := fail + 1; failures := failures || ('election.withdraw_others=' || r); END IF;
  r := pg_temp.gv_run((ids->>'RESA2')::uuid, format('update public.election_nominations set status = %L where id = %L returning status', 'approved', nom_a2));
  IF (SELECT status FROM public.election_nominations WHERE id = nom_a2) = 'pending' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.direct_self_approve=' || r); END IF;

  -- Approval -----------------------------------------------------------------------
  r := pg_temp.gv_run((ids->>'RESA')::uuid, format('select public.election_review_nomination(%L,true,null)::text', nom_a2));
  IF r LIKE 'ERR:%' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.resident_review=' || r); END IF;
  r := pg_temp.gv_run((ids->>'ADMB')::uuid, format('select public.election_review_nomination(%L,true,null)::text', nom_a2));
  IF r LIKE 'ERR:%' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.cross_admin_review=' || r); END IF;
  r := pg_temp.gv_run((ids->>'ADMA')::uuid, format('select public.election_review_nomination(%L,true,null)::text', nom_a))
    || pg_temp.gv_run((ids->>'ADMA')::uuid, format('select public.election_review_nomination(%L,true,null)::text', nom_a2));
  IF (SELECT count(*) FROM public.election_nominations WHERE id IN (nom_a, nom_a2) AND status = 'approved') = 2 THEN pass := pass + 1;
  ELSE fail := fail + 1; failures := failures || ('election.admin_approve=' || r); END IF;
  r := pg_temp.gv_run((ids->>'ADMA')::uuid, format('select public.election_set_status(%L,%L,null)::text', el, 'nomination_review'))
    || pg_temp.gv_run((ids->>'ADMA')::uuid, format('select public.election_set_status(%L,%L,null)::text', el, 'voting_open'));
  IF (SELECT status FROM public.elections WHERE id = el) = 'voting_open' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.open_voting=' || r); END IF;

  -- Voting -------------------------------------------------------------------------
  r := pg_temp.gv_run((ids->>'RESB')::uuid, format('select public.election_cast_ballot(%L,array[%L]::uuid[],%L)::text', el, nom_a2, ids->>'REQ3'));
  IF r LIKE 'ERR:%' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.cross_society_ballot=' || r); END IF;
  r := pg_temp.gv_run((ids->>'RESX')::uuid, format('select public.election_cast_ballot(%L,array[%L]::uuid[],%L)::text', el, nom_a2, ids->>'REQ3'));
  IF r LIKE 'ERR:%' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.moved_out_ballot=' || r); END IF;
  r := pg_temp.gv_run((ids->>'RESA')::uuid, format('select public.election_cast_ballot(%L,array[%L]::uuid[],%L)::text', el, ids->>'RAND', ids->>'REQ1'));
  IF r LIKE 'ERR:%invalid_option%' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.invalid_candidate=' || r); END IF;
  r := pg_temp.gv_run((ids->>'RESA')::uuid, format('select public.election_cast_ballot(%L,array[%L,%L]::uuid[],%L)::text', el, nom_a, nom_a2, ids->>'REQ1'));
  IF r LIKE 'ERR:%' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.too_many_choices=' || r); END IF;
  r := pg_temp.gv_run((ids->>'RESA')::uuid, format('select public.election_cast_ballot(%L,array[%L]::uuid[],%L)::text', el, nom_a2, ids->>'REQ1'));
  IF r NOT LIKE 'ERR:%' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.ballot_ok=' || r); END IF;
  r := pg_temp.gv_run((ids->>'RESA')::uuid, format('select public.election_cast_ballot(%L,array[%L]::uuid[],%L)::text', el, nom_a2, ids->>'REQ1'));
  IF r = 'already_recorded' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.retry_idempotent=' || r); END IF;
  r := pg_temp.gv_run((ids->>'RESA')::uuid, format('select public.election_cast_ballot(%L,array[%L]::uuid[],%L)::text', el, nom_a, ids->>'REQ2'));
  IF r LIKE 'ERR:%already_voted%' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.second_ballot=' || r); END IF;
  r := pg_temp.gv_run((ids->>'RESA2')::uuid, format('select public.election_cast_ballot(%L,array[%L]::uuid[],%L)::text', el, nom_a2, ids->>'REQ2'));
  IF (SELECT count(*) FROM public.election_ballot_choices WHERE nomination_id = nom_a2) = 2
     AND (SELECT count(*) FROM public.election_voters WHERE election_id = el) = 2 THEN pass := pass + 1;
  ELSE fail := fail + 1; failures := failures || ('election.canonical_ballots=' || r); END IF;
  r := pg_temp.gv_run((ids->>'RESA')::uuid, format('select count(*)::text from public.election_ballot_choices where election_id = %L', el));
  IF r IN ('0', '<null>') OR r LIKE 'ERR:%' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.ballots_not_readable=' || r); END IF;

  -- Counting + publication ---------------------------------------------------------
  j := pg_temp.gv_run((ids->>'RESA')::uuid, format('select public.election_results(%L)::text', el))::jsonb;
  IF (j->>'hidden')::boolean AND j->'posts' IS NULL THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.hidden_during_voting=' || j::text); END IF;
  r := pg_temp.gv_run((ids->>'RESA')::uuid, format('select public.election_set_status(%L,%L,null)::text', el, 'voting_closed'));
  IF r LIKE 'ERR:%' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.resident_cannot_close=' || r); END IF;
  r := pg_temp.gv_run((ids->>'ADMA')::uuid, format('select public.election_set_status(%L,%L,null)::text', el, 'voting_closed'));
  j := pg_temp.gv_run((ids->>'RESA')::uuid, format('select public.election_results(%L)::text', el))::jsonb;
  IF (j->>'hidden')::boolean AND j->'posts' IS NULL THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.hidden_before_publish=' || j::text); END IF;
  j := pg_temp.gv_run((ids->>'ADMA')::uuid, format('select public.election_results(%L)::text', el))::jsonb;
  IF j->'posts'->0->'candidates'->0->>'nomination_id' = nom_a2::text AND (j->'posts'->0->'candidates'->0->>'votes')::int = 2
     AND (j->'posts'->0->>'valid_votes')::int = 2 AND (j->>'published')::boolean = false THEN pass := pass + 1;
  ELSE fail := fail + 1; failures := failures || ('election.admin_preview_tally=' || coalesce(j::text,'null')); END IF;
  r := pg_temp.gv_run((ids->>'RESA')::uuid, format('select public.election_set_status(%L,%L,null)::text', el, 'results_published'));
  IF r LIKE 'ERR:%' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.resident_cannot_publish=' || r); END IF;
  r := pg_temp.gv_run((ids->>'RESA')::uuid, format('update public.elections set results_hash = %L where id = %L returning id', 'x', el));
  IF (SELECT results_hash FROM public.elections WHERE id = el) IS NULL THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.resident_force_publish=' || r); END IF;
  r := pg_temp.gv_run((ids->>'ADMA')::uuid, format('select public.election_set_status(%L,%L,null)::text', el, 'results_published'));
  j := pg_temp.gv_run((ids->>'RESA')::uuid, format('select public.election_results(%L)::text', el))::jsonb;
  IF (j->>'published')::boolean AND (j->'posts'->0->'candidates'->0->>'votes')::int = 2
     AND j->'posts'->0->'candidates'->0->>'outcome' = 'elected' THEN pass := pass + 1;
  ELSE fail := fail + 1; failures := failures || ('election.published_visible=' || coalesce(j::text, r)); END IF;
  r := pg_temp.gv_run((ids->>'RESB')::uuid, format('select public.election_results(%L)::text', el));
  IF r LIKE 'ERR:%' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.cross_society_results=' || r); END IF;
  r := pg_temp.gv_run((ids->>'ADMB')::uuid, format('select public.election_results(%L)::text', el));
  IF r LIKE 'ERR:%' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.cross_admin_results=' || r); END IF;
  r := pg_temp.gv_run(NULL, format('select public.election_results(%L)::text', el));
  IF r LIKE 'ERR:%' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('election.anon_results=' || r); END IF;
  r := pg_temp.gv_run((ids->>'ADMA')::uuid, format('select public.election_cast_ballot(%L,array[%L]::uuid[],%L)::text', el, nom_a, ids->>'REQ3'));
  IF r LIKE 'ERR:%' AND (SELECT count(*) FROM public.election_ballot_choices WHERE election_id = el) = 2 THEN pass := pass + 1;
  ELSE fail := fail + 1; failures := failures || ('election.no_ballot_after_publish=' || r); END IF;

  PERFORM pg_temp.gv_act(NULL);
  RAISE EXCEPTION 'GOV_RESULT|pass=%|fail=%|%', pass, fail,
    CASE WHEN fail = 0 THEN 'OK' ELSE array_to_string(failures, ';') END;
END $gov$;
