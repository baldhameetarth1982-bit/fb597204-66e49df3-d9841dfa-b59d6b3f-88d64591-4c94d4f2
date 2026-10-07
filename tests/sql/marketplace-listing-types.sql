-- SociyoHub Marketplace listing types — database authorization/visibility harness.
--
-- Proves the three creator types (sociyohub / society / resident), server-side visibility,
-- house attribution, ID-tampering rejection and duplicate protection, acting as synthetic
-- signed-in users against the real RPCs and RLS.
--
-- Safety contract (same as phase4b): synthetic fixed IDs (prefix 7a7a0000-), *.invalid emails,
-- one DO block that ALWAYS ends with RAISE EXCEPTION, so everything rolls back.
-- Run only on a disposable local database:
--   psql "$DISPOSABLE_DB_URL" -f tests/sql/marketplace-listing-types.sql
-- Output: MKT_RESULT|pass=<n>|fail=<n>|<failures or OK>

CREATE OR REPLACE FUNCTION pg_temp.mkt_act(_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  IF _uid IS NULL THEN
    PERFORM set_config('request.jwt.claims', '', true);
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
  END IF;
END $$;

DO $mkt$
DECLARE
  ids jsonb := '{
    "SA":"7a7a0000-0000-4000-8000-00000000a001",
    "SB":"7a7a0000-0000-4000-8000-00000000b001",
    "BKA":"7a7a0000-0000-4000-8000-00000000a011",
    "BKB":"7a7a0000-0000-4000-8000-00000000b011",
    "FA1":"7a7a0000-0000-4000-8000-00000000a021",
    "FA2":"7a7a0000-0000-4000-8000-00000000a022",
    "FB1":"7a7a0000-0000-4000-8000-00000000b021",
    "SUP":"7a7a0000-0000-4000-8000-00000000c001",
    "ADMA":"7a7a0000-0000-4000-8000-00000000a101",
    "ADMA2":"7a7a0000-0000-4000-8000-00000000a106",
    "RESA":"7a7a0000-0000-4000-8000-00000000a102",
    "RESA2":"7a7a0000-0000-4000-8000-00000000a103",
    "BLKA":"7a7a0000-0000-4000-8000-00000000a104",
    "ADMB":"7a7a0000-0000-4000-8000-00000000b101",
    "RESB":"7a7a0000-0000-4000-8000-00000000b102"
  }'::jsonb;
  pass int := 0; fail int := 0; failures text[] := '{}';
  l_plat uuid; l_soc uuid; l_res uuid; l_tmp uuid; n int; t text; ok boolean;
BEGIN
  -- Fixtures -----------------------------------------------------------------
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT (ids->>u)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'qa-mkt-' || lower(u) || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()
  FROM unnest(ARRAY['SUP','ADMA','ADMA2','RESA','RESA2','BLKA','ADMB','RESB']) u;
  INSERT INTO public.societies (id, name, city, plan, plan_id, plan_status, plan_expires_at, status, structure_mode)
  VALUES ((ids->>'SA')::uuid, '[QA] MKT Society A', 'Testville', 'pro', 'pro', 'active', now() + interval '30 days', 'active', 'structured'),
         ((ids->>'SB')::uuid, '[QA] MKT Society B', 'Testville', 'pro', 'pro', 'active', now() + interval '30 days', 'active', 'structured');
  INSERT INTO public.blocks (id, society_id, name) VALUES ((ids->>'BKA')::uuid, (ids->>'SA')::uuid, 'QA'), ((ids->>'BKB')::uuid, (ids->>'SB')::uuid, 'QB');
  INSERT INTO public.flats (id, society_id, block_id, flat_number, unit_type) VALUES
    ((ids->>'FA1')::uuid, (ids->>'SA')::uuid, (ids->>'BKA')::uuid, '204', 'flat'),
    ((ids->>'FA2')::uuid, (ids->>'SA')::uuid, (ids->>'BKA')::uuid, '305', 'flat'),
    ((ids->>'FB1')::uuid, (ids->>'SB')::uuid, (ids->>'BKB')::uuid, '101', 'flat');
  PERFORM set_config('app.allow_society_change', 'on', true);
  INSERT INTO public.profiles (id, full_name, society_id)
  SELECT (ids->>u)::uuid, 'Zebulon QA ' || u, CASE WHEN s IS NULL THEN NULL ELSE (ids->>s)::uuid END
  FROM (VALUES ('SUP',NULL),('ADMA','SA'),('ADMA2','SA'),('RESA','SA'),('RESA2','SA'),('BLKA','SA'),('ADMB','SB'),('RESB','SB')) v(u, s)
  ON CONFLICT (id) DO UPDATE SET society_id = excluded.society_id, full_name = excluded.full_name;
  INSERT INTO public.user_roles (user_id, role, society_id, block_id, is_active)
  SELECT (ids->>u)::uuid, r::public.app_role, CASE WHEN s IS NULL THEN NULL ELSE (ids->>s)::uuid END, CASE WHEN b IS NULL THEN NULL ELSE (ids->>b)::uuid END, true
  FROM (VALUES ('SUP','super_admin',NULL,NULL),('ADMA','society_admin','SA',NULL),('ADMA2','society_admin','SA',NULL),('RESA','resident','SA',NULL),('RESA2','resident','SA',NULL),
               ('BLKA','block_admin','SA','BKA'),('ADMB','society_admin','SB',NULL),('RESB','resident','SB',NULL)) v(u, r, s, b);
  INSERT INTO public.flat_residents (flat_id, user_id, relationship, is_primary, is_active) VALUES
    ((ids->>'FA1')::uuid, (ids->>'RESA')::uuid, 'owner', true, true),
    ((ids->>'FA2')::uuid, (ids->>'RESA2')::uuid, 'owner', true, true),
    ((ids->>'FB1')::uuid, (ids->>'RESB')::uuid, 'owner', true, true);
  UPDATE public.platform_settings SET market_society_global_enabled = false WHERE id = 1;
  IF NOT FOUND THEN INSERT INTO public.platform_settings (id, market_society_global_enabled) VALUES (1, false); END IF;

  -- A. SociyoHub listing ----------------------------------------------------
  -- Unauthorized creators.
  FOR t IN SELECT unnest(ARRAY['RESA','ADMA','BLKA']) LOOP
    BEGIN
      PERFORM pg_temp.mkt_act((ids->>t)::uuid);
      PERFORM public.admin_market_save(NULL, NULL, 'offer', 'QA platform offer', 'x', NULL, 'link', NULL, 'https://example.invalid', 30);
      fail := fail + 1; failures := failures || ('A.create_rejected.' || t);
    EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
  END LOOP;
  -- Society admin cannot impersonate platform via the society RPC.
  BEGIN
    PERFORM pg_temp.mkt_act((ids->>'ADMA')::uuid);
    PERFORM public.market_save_listing(NULL, NULL, 'offer', 'QA fake platform', 'x', NULL, 'in_app', NULL, NULL, 30, 'sociyohub', 'all');
    fail := fail + 1; failures := failures || 'A.society_rpc_as_sociyohub_rejected'::text;
  EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
  -- Authorized creation.
  PERFORM pg_temp.mkt_act((ids->>'SUP')::uuid);
  l_plat := public.admin_market_save(NULL, NULL, 'offer', 'QA platform offer', 'Platform deal', 0, 'link', NULL, 'https://example.invalid', 30);
  IF EXISTS (SELECT 1 FROM public.community_listings WHERE id = l_plat AND creator_type = 'sociyohub' AND society_id IS NULL AND visibility = 'all')
  THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'A.created'::text; END IF;
  -- Duplicate create returns same id.
  IF public.admin_market_save(NULL, NULL, 'offer', 'QA platform offer', 'Platform deal', 0, 'link', NULL, 'https://example.invalid', 30) = l_plat
  THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'E.platform_duplicate_returns_same'::text; END IF;
  -- Visible to A and B.
  FOR t IN SELECT unnest(ARRAY['RESA','RESB']) LOOP
    PERFORM pg_temp.mkt_act((ids->>t)::uuid);
    SELECT count(*) INTO n FROM public.list_market_listings(NULL) x WHERE x.id = l_plat AND x.creator_type = 'sociyohub' AND x.house_label IS NULL AND x.society_name IS NULL;
    IF n = 1 THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('A.visible.' || t); END IF;
  END LOOP;
  -- Unauthorized edit/status/image.
  FOR t IN SELECT unnest(ARRAY['RESA','ADMA','ADMB']) LOOP
    BEGIN PERFORM pg_temp.mkt_act((ids->>t)::uuid);
      PERFORM public.admin_market_save(l_plat, NULL, 'offer', 'hijack', 'x', NULL, 'link', NULL, 'https://example.invalid', NULL);
      fail := fail + 1; failures := failures || ('A.admin_edit_rejected.' || t);
    EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
    BEGIN PERFORM pg_temp.mkt_act((ids->>t)::uuid);
      PERFORM public.market_save_listing(l_plat, NULL, 'offer', 'hijack', 'x', NULL, 'in_app', NULL, NULL, NULL, 'resident', 'society');
      fail := fail + 1; failures := failures || ('A.member_edit_rejected.' || t);
    EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
    BEGIN PERFORM pg_temp.mkt_act((ids->>t)::uuid);
      PERFORM public.market_set_status(l_plat, 'archived');
      fail := fail + 1; failures := failures || ('A.status_rejected.' || t);
    EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
    BEGIN PERFORM pg_temp.mkt_act((ids->>t)::uuid);
      PERFORM public.market_set_image(l_plat, 'platform/' || l_plat || '/7a7a0000-0000-4000-8000-0000000000a2.png');
      fail := fail + 1; failures := failures || ('A.image_rejected.' || t);
    EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
    BEGIN PERFORM pg_temp.mkt_act((ids->>t)::uuid);
      PERFORM public.market_moderate(l_plat, 'remove', 'not allowed');
      fail := fail + 1; failures := failures || ('A.moderate_rejected.' || t);
    EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
  END LOOP;
  -- Super admin image path rules.
  PERFORM pg_temp.mkt_act((ids->>'SUP')::uuid);
  PERFORM public.market_set_image(l_plat, 'platform/' || l_plat || '/7a7a0000-0000-4000-8000-0000000000a1.png'); pass := pass + 1;
  BEGIN PERFORM public.market_set_image(l_plat, (ids->>'SA') || '/' || l_plat || '/7a7a0000-0000-4000-8000-0000000000a1.png');
    fail := fail + 1; failures := failures || 'A.image_bad_prefix_rejected'::text;
  EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
  BEGIN PERFORM public.market_set_image(l_plat, 'platform/' || l_plat || '/../x.png');
    fail := fail + 1; failures := failures || 'A.image_traversal_rejected'::text;
  EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
  -- Residents of any society can contact & report a SociyoHub listing; notifications go to platform.
  PERFORM pg_temp.mkt_act((ids->>'RESB')::uuid);
  PERFORM public.market_contact(l_plat, 'Interested in this');
  PERFORM public.market_report(l_plat, 'Looks wrong');
  PERFORM public.market_report(l_plat, 'Looks wrong again');
  PERFORM pg_temp.mkt_act(NULL);
  IF EXISTS (SELECT 1 FROM public.user_notifications WHERE user_id = (ids->>'SUP')::uuid AND society_id IS NULL AND link = '/admin/marketplace' AND dedupe_key LIKE 'mkt-contact:%')
  THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'A.contact_notifies_platform_owner'::text; END IF;
  SELECT count(*) INTO n FROM public.community_listing_reports WHERE listing_id = l_plat;
  IF n = 1 AND (SELECT report_count FROM public.community_listings WHERE id = l_plat) = 1
  THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('E.report_duplicate_prevented n=' || n); END IF;
  -- Society B admin must not see the platform report in their queue.
  PERFORM pg_temp.mkt_act((ids->>'ADMB')::uuid);
  SELECT count(*) INTO n FROM public.community_listing_reports WHERE listing_id = l_plat;
  IF n = 0 THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'A.platform_report_hidden_from_society_admin'::text; END IF;
  PERFORM pg_temp.mkt_act((ids->>'SUP')::uuid);
  SELECT count(*) INTO n FROM public.admin_market_reports(l_plat);
  IF n = 1 THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'A.super_admin_sees_report'::text; END IF;
  PERFORM public.admin_market_dismiss_reports(l_plat);
  PERFORM public.admin_market_set_status(l_plat, 'paused');
  PERFORM pg_temp.mkt_act((ids->>'RESA')::uuid);
  SELECT count(*) INTO n FROM public.list_market_listings(NULL) x WHERE x.id = l_plat;
  IF n = 0 THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'A.paused_hidden'::text; END IF;
  PERFORM pg_temp.mkt_act((ids->>'SUP')::uuid);
  PERFORM public.admin_market_set_status(l_plat, 'published');
  -- Platform listing must not accept in-app contact (owner is an internal account).
  BEGIN PERFORM public.admin_market_save(NULL, NULL, 'offer', 'QA in-app', 'x', NULL, 'in_app', NULL, NULL, 30);
    fail := fail + 1; failures := failures || 'A.in_app_contact_rejected'::text;
  EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;

  -- B. Society listing ------------------------------------------------------
  FOR t IN SELECT unnest(ARRAY['RESA','BLKA']) LOOP
    BEGIN PERFORM pg_temp.mkt_act((ids->>t)::uuid);
      PERFORM public.market_save_listing(NULL, NULL, 'offer', 'QA society hall', 'x', NULL, 'in_app', NULL, NULL, 30, 'society', 'society');
      fail := fail + 1; failures := failures || ('B.create_rejected.' || t);
    EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
  END LOOP;
  PERFORM pg_temp.mkt_act((ids->>'ADMA')::uuid);
  l_soc := public.market_save_listing(NULL, NULL, 'offer', 'QA society hall', 'Hall booking', 500, 'in_app', NULL, NULL, 30, 'society', 'society');
  IF EXISTS (SELECT 1 FROM public.community_listings WHERE id = l_soc AND creator_type = 'society' AND society_id = (ids->>'SA')::uuid AND visibility = 'society' AND flat_id IS NULL)
  THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'B.created_as_society_A'::text; END IF;
  IF public.market_save_listing(NULL, NULL, 'offer', 'QA society hall', 'Hall booking', 500, 'in_app', NULL, NULL, 30, 'society', 'society') = l_soc
  THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'E.society_duplicate_returns_same'::text; END IF;
  -- Society B admin cannot create "as Society A": the society always comes from the server.
  PERFORM pg_temp.mkt_act((ids->>'ADMB')::uuid);
  l_tmp := public.market_save_listing(NULL, NULL, 'offer', 'QA B listing', 'x', NULL, 'in_app', NULL, NULL, 30, 'society', 'society');
  IF (SELECT society_id FROM public.community_listings WHERE id = l_tmp) = (ids->>'SB')::uuid
  THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'B.society_from_server'::text; END IF;
  -- Visible to A members (with society badge data), hidden from B by default.
  PERFORM pg_temp.mkt_act((ids->>'RESA')::uuid);
  SELECT count(*) INTO n FROM public.list_market_listings(NULL) x WHERE x.id = l_soc AND x.society_name = '[QA] MKT Society A' AND x.is_mine = false;
  IF n = 1 THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'B.visible_to_A'::text; END IF;
  PERFORM pg_temp.mkt_act((ids->>'RESB')::uuid);
  SELECT count(*) INTO n FROM public.list_market_listings(NULL) x WHERE x.id = l_soc;
  IF n = 0 THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'B.hidden_from_B_default'::text; END IF;
  BEGIN PERFORM public.market_report(l_soc, 'probing'); fail := fail + 1; failures := failures || 'B.B_cannot_report_hidden'::text;
  EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
  BEGIN PERFORM public.market_contact(l_soc, 'probing'); fail := fail + 1; failures := failures || 'B.B_cannot_contact_hidden'::text;
  EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
  -- Global visibility refused while platform policy is off.
  PERFORM pg_temp.mkt_act((ids->>'ADMA')::uuid);
  BEGIN PERFORM public.market_save_listing(l_soc, NULL, 'offer', 'QA society hall', 'Hall booking', 500, 'in_app', NULL, NULL, NULL, 'society', 'all');
    fail := fail + 1; failures := failures || 'B.global_refused_when_policy_off'::text;
  EXCEPTION WHEN OTHERS THEN IF SQLERRM ~ 'global_not_allowed' THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('B.global_refused ' || SQLERRM); END IF; END;
  -- Society admin cannot flip the platform policy.
  PERFORM public.market_global_allowed();
  BEGIN
    UPDATE public.platform_settings SET market_society_global_enabled = true WHERE id = 1;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'B.admin_cannot_change_policy'::text; END IF;
  EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
  PERFORM pg_temp.mkt_act((ids->>'RESA')::uuid);
  BEGIN
    UPDATE public.platform_settings SET market_society_global_enabled = true WHERE id = 1;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'B.resident_cannot_change_policy'::text; END IF;
  EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
  -- Super admin enables it; change is audited.
  PERFORM pg_temp.mkt_act((ids->>'SUP')::uuid);
  UPDATE public.platform_settings SET market_society_global_enabled = true WHERE id = 1;
  PERFORM pg_temp.mkt_act(NULL);
  IF EXISTS (SELECT 1 FROM public.audit_log WHERE actor_id = (ids->>'SUP')::uuid AND action = 'platform.marketplace_global.enabled')
  THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'B.policy_change_audited'::text; END IF;
  -- Still hidden from B until the admin explicitly selects All societies.
  PERFORM pg_temp.mkt_act((ids->>'RESB')::uuid);
  SELECT count(*) INTO n FROM public.list_market_listings(NULL) x WHERE x.id = l_soc;
  IF n = 0 THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'B.policy_on_but_not_selected_hidden'::text; END IF;
  PERFORM pg_temp.mkt_act((ids->>'ADMA')::uuid);
  PERFORM public.market_save_listing(l_soc, NULL, 'offer', 'QA society hall', 'Hall booking', 500, 'in_app', NULL, NULL, NULL, 'society', 'all');
  PERFORM pg_temp.mkt_act((ids->>'RESB')::uuid);
  SELECT count(*) INTO n FROM public.list_market_listings(NULL) x WHERE x.id = l_soc AND x.is_local = false AND x.is_mine = false;
  IF n = 1 THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'B.global_visible_to_B'::text; END IF;
  -- B may report it (filed under Society A); B's admin cannot see or moderate it.
  PERFORM public.market_report(l_soc, 'Reporting from B');
  PERFORM pg_temp.mkt_act(NULL);
  IF EXISTS (SELECT 1 FROM public.community_listing_reports WHERE listing_id = l_soc AND society_id = (ids->>'SA')::uuid)
  THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'B.report_routed_to_owning_society'::text; END IF;
  PERFORM pg_temp.mkt_act((ids->>'ADMB')::uuid);
  SELECT count(*) INTO n FROM public.community_listing_reports WHERE listing_id = l_soc;
  IF n = 0 THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'B.B_admin_cannot_read_A_reports'::text; END IF;
  BEGIN PERFORM public.market_moderate(l_soc, 'remove', 'cross society'); fail := fail + 1; failures := failures || 'B.B_admin_cannot_moderate'::text;
  EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
  -- Unauthorized edits.
  FOR t IN SELECT unnest(ARRAY['ADMB','RESA','BLKA']) LOOP
    BEGIN PERFORM pg_temp.mkt_act((ids->>t)::uuid);
      PERFORM public.market_save_listing(l_soc, NULL, 'offer', 'hijack', 'x', NULL, 'in_app', NULL, NULL, NULL, 'society', 'society');
      fail := fail + 1; failures := failures || ('B.edit_rejected.' || t);
    EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
    BEGIN PERFORM pg_temp.mkt_act((ids->>t)::uuid);
      PERFORM public.market_set_status(l_soc, 'archived');
      fail := fail + 1; failures := failures || ('B.status_rejected.' || t);
    EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
  END LOOP;
  -- Any admin of Society A may manage it (it belongs to the society, not the person).
  PERFORM pg_temp.mkt_act((ids->>'ADMA2')::uuid);
  PERFORM public.market_set_status(l_soc, 'paused'); pass := pass + 1;
  -- Policy turned off again: global society listing disappears from B immediately.
  PERFORM public.market_set_status(l_soc, 'published');
  PERFORM pg_temp.mkt_act((ids->>'SUP')::uuid);
  UPDATE public.platform_settings SET market_society_global_enabled = false WHERE id = 1;
  PERFORM pg_temp.mkt_act((ids->>'RESB')::uuid);
  SELECT count(*) INTO n FROM public.list_market_listings(NULL) x WHERE x.id = l_soc;
  IF n = 0 THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'B.policy_off_hides_again'::text; END IF;

  -- C. Resident listing -----------------------------------------------------
  PERFORM pg_temp.mkt_act((ids->>'RESA')::uuid);
  l_res := public.market_save_listing(NULL, NULL, 'offer', 'QA cycle', 'Used cycle', 1500, 'in_app', NULL, NULL, 30, 'resident', 'all');
  IF EXISTS (SELECT 1 FROM public.community_listings WHERE id = l_res AND creator_type = 'resident' AND flat_id = (ids->>'FA1')::uuid AND visibility = 'society')
  THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'C.created_with_server_house_and_society_scope'::text; END IF;
  IF public.market_save_listing(NULL, NULL, 'offer', 'QA cycle', 'Used cycle', 1500, 'in_app', NULL, NULL, 30, 'resident', 'society') = l_res
  THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'E.resident_duplicate_returns_same'::text; END IF;
  PERFORM pg_temp.mkt_act((ids->>'RESA2')::uuid);
  SELECT count(*) INTO n FROM public.list_market_listings(NULL) x WHERE x.id = l_res AND x.house_label = 'QA-204'
    AND x.society_name IS NULL AND position('Zebulon' in coalesce(x.house_label,'')) = 0;
  IF n = 1 THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'C.house_label_shown_no_name'::text; END IF;
  -- Browse result carries no name/owner id columns at all.
  IF NOT EXISTS (SELECT 1 FROM information_schema.routines r JOIN information_schema.parameters p ON p.specific_name = r.specific_name
                 WHERE r.routine_schema = 'public' AND r.routine_name = 'list_market_listings' AND p.parameter_mode = 'OUT'
                   AND p.parameter_name IN ('owner_name','owner_id','full_name','phone','email','flat_id'))
  THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'C.no_personal_columns'::text; END IF;
  BEGIN PERFORM public.market_save_listing(l_res, NULL, 'offer', 'hijack', 'x', NULL, 'in_app', NULL, NULL, NULL, 'resident', 'society');
    fail := fail + 1; failures := failures || 'C.other_resident_edit_rejected'::text;
  EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
  BEGIN PERFORM public.market_set_status(l_res, 'archived'); fail := fail + 1; failures := failures || 'C.other_resident_status_rejected'::text;
  EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
  -- Society admin cannot convert a resident listing into a society one.
  PERFORM pg_temp.mkt_act((ids->>'ADMA')::uuid);
  BEGIN PERFORM public.market_save_listing(l_res, NULL, 'offer', 'hijack', 'x', NULL, 'in_app', NULL, NULL, NULL, 'society', 'all');
    fail := fail + 1; failures := failures || 'C.admin_convert_rejected'::text;
  EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
  -- Another society cannot see/contact/report/edit.
  PERFORM pg_temp.mkt_act((ids->>'RESB')::uuid);
  SELECT count(*) INTO n FROM public.list_market_listings(NULL) x WHERE x.id = l_res;
  IF n = 0 THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'C.hidden_from_B'::text; END IF;
  SELECT count(*) INTO n FROM public.community_listings WHERE id = l_res;
  IF n = 0 THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || 'C.table_hidden_from_B'::text; END IF;
  BEGIN PERFORM public.market_contact(l_res, 'cross society'); fail := fail + 1; failures := failures || 'C.B_contact_rejected'::text;
  EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
  BEGIN PERFORM public.market_report(l_res, 'cross society'); fail := fail + 1; failures := failures || 'C.B_report_rejected'::text;
  EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
  BEGIN PERFORM public.market_save_listing(l_res, NULL, 'offer', 'hijack', 'x', NULL, 'in_app', NULL, NULL, NULL, 'resident', 'society');
    fail := fail + 1; failures := failures || 'C.B_edit_rejected'::text;
  EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
  -- A resident with no current home cannot create (no arbitrary house).
  PERFORM pg_temp.mkt_act(NULL);
  UPDATE public.flat_residents SET is_active = false, moved_out_at = now() WHERE user_id = (ids->>'RESA2')::uuid;
  PERFORM pg_temp.mkt_act((ids->>'RESA2')::uuid);
  BEGIN PERFORM public.market_save_listing(NULL, NULL, 'offer', 'QA homeless', 'x', NULL, 'in_app', NULL, NULL, 30, 'resident', 'society');
    fail := fail + 1; failures := failures || 'C.no_home_rejected'::text;
  EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;

  -- D. Tampering -----------------------------------------------------------
  PERFORM pg_temp.mkt_act((ids->>'RESA')::uuid);
  FOR t IN SELECT unnest(ARRAY[
      format('UPDATE public.community_listings SET society_id = %L WHERE id = %L', ids->>'SB', l_res),
      format('UPDATE public.community_listings SET owner_id = %L WHERE id = %L', ids->>'RESA2', l_res),
      format('UPDATE public.community_listings SET creator_type = ''society'' WHERE id = %L', l_res),
      format('UPDATE public.community_listings SET flat_id = %L WHERE id = %L', ids->>'FA2', l_res),
      format('UPDATE public.community_listings SET visibility = ''all'' WHERE id = %L', l_res),
      format('INSERT INTO public.community_listings (society_id, owner_id, title, creator_type, visibility) VALUES (NULL, %L, ''x'', ''sociyohub'', ''all'')', ids->>'RESA')]) LOOP
    BEGIN
      EXECUTE t; GET DIAGNOSTICS n = ROW_COUNT;
      IF n = 0 THEN pass := pass + 1; ELSE fail := fail + 1; failures := failures || ('D.direct_write_blocked: ' || left(t, 60)); END IF;
    EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
  END LOOP;
  -- Ownership lock holds even for privileged writers.
  PERFORM pg_temp.mkt_act(NULL);
  BEGIN UPDATE public.community_listings SET flat_id = (ids->>'FA2')::uuid WHERE id = l_res;
    fail := fail + 1; failures := failures || 'D.ownership_lock'::text;
  EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
  BEGIN UPDATE public.community_listings SET creator_type = 'resident', society_id = (ids->>'SA')::uuid WHERE id = l_plat;
    fail := fail + 1; failures := failures || 'D.platform_lock'::text;
  EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
  -- Invalid creator type / unknown listing id.
  PERFORM pg_temp.mkt_act((ids->>'RESA')::uuid);
  BEGIN PERFORM public.market_save_listing(NULL, NULL, 'offer', 'x y z', 'x', NULL, 'in_app', NULL, NULL, 30, 'admin', 'society');
    fail := fail + 1; failures := failures || 'D.bad_creator_type'::text;
  EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
  BEGIN PERFORM public.market_save_listing('7a7a0000-0000-4000-8000-00000000ffff', NULL, 'offer', 'x y z', 'x', NULL, 'in_app', NULL, NULL, NULL, 'resident', 'society');
    fail := fail + 1; failures := failures || 'D.unknown_id'::text;
  EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
  -- Anonymous callers have no access.
  PERFORM set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  PERFORM set_config('role', 'anon', true);
  BEGIN PERFORM public.list_market_listings(NULL); fail := fail + 1; failures := failures || 'D.anon_list_rejected'::text;
  EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
  BEGIN PERFORM public.admin_market_list(); fail := fail + 1; failures := failures || 'D.anon_admin_rejected'::text;
  EXCEPTION WHEN OTHERS THEN pass := pass + 1; END;
  PERFORM pg_temp.mkt_act(NULL);

  RAISE EXCEPTION 'MKT_RESULT|pass=%|fail=%|%', pass, fail, CASE WHEN fail = 0 THEN 'OK' ELSE array_to_string(failures, ' ;; ') END;
END
$mkt$;
