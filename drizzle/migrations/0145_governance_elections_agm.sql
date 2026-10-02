-- Governance: Elections + dedicated AGM record. Reuses meetings/attendance/documents/notices/audit/notifications.

CREATE OR REPLACE FUNCTION public._gov_active_resident(_user uuid, _sid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
    WHERE fr.user_id = _user AND f.society_id = _sid AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL
      AND fr.archived_at IS NULL AND (fr.access_expires_at IS NULL OR fr.access_expires_at > now()))
$$;

CREATE OR REPLACE FUNCTION public._gov_active_owner(_user uuid, _sid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
    WHERE fr.user_id = _user AND f.society_id = _sid AND fr.relationship = 'owner' AND fr.is_active IS NOT FALSE
      AND fr.moved_out_at IS NULL AND fr.archived_at IS NULL AND (fr.access_expires_at IS NULL OR fr.access_expires_at > now()))
$$;

CREATE TABLE public.elections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 140),
  purpose text NOT NULL DEFAULT 'committee' CHECK (purpose IN ('committee','office_bearers','by_election','other')),
  instructions text CHECK (instructions IS NULL OR char_length(instructions) <= 4000),
  eligibility text NOT NULL DEFAULT 'home' CHECK (eligibility IN ('home','person')),
  secret_ballot boolean NOT NULL DEFAULT true,
  nomination_opens_at timestamptz NOT NULL,
  nomination_closes_at timestamptz NOT NULL,
  voting_opens_at timestamptz NOT NULL,
  voting_closes_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','nomination_open','nomination_review','voting_open','voting_closed','results_published','archived')),
  rules_source_id uuid REFERENCES public.society_knowledge_sources(id) ON DELETE SET NULL,
  agm_id uuid,
  results jsonb,
  results_hash text,
  results_published_at timestamptz,
  archive_reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (nomination_closes_at > nomination_opens_at AND voting_opens_at >= nomination_closes_at AND voting_closes_at > voting_opens_at)
);
CREATE INDEX elections_society_idx ON public.elections (society_id, status);

CREATE TABLE public.election_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id uuid NOT NULL REFERENCES public.elections(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  seq int NOT NULL DEFAULT 1,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  seats int NOT NULL DEFAULT 1 CHECK (seats BETWEEN 1 AND 25),
  description text CHECK (description IS NULL OR char_length(description) <= 1000),
  candidate_rule text NOT NULL DEFAULT 'resident' CHECK (candidate_rule IN ('resident','owner')),
  requirements text CHECK (requirements IS NULL OR char_length(requirements) <= 1000),
  UNIQUE (election_id, name)
);

CREATE TABLE public.election_nominations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id uuid NOT NULL REFERENCES public.elections(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.election_posts(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL,
  candidate_name text NOT NULL,
  statement text CHECK (statement IS NULL OR char_length(statement) <= 2000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  review_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX election_nominations_live_uq ON public.election_nominations (post_id, candidate_id) WHERE status IN ('pending','approved');

CREATE TABLE public.election_voters (
  election_id uuid NOT NULL REFERENCES public.elections(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  flat_id uuid,
  request_id uuid NOT NULL,
  voted_on date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  PRIMARY KEY (election_id, user_id)
);
CREATE UNIQUE INDEX election_voters_flat_uq ON public.election_voters (election_id, flat_id) WHERE flat_id IS NOT NULL;

CREATE TABLE public.election_ballot_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id uuid NOT NULL REFERENCES public.elections(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.election_posts(id) ON DELETE CASCADE,
  nomination_id uuid NOT NULL REFERENCES public.election_nominations(id) ON DELETE CASCADE,
  open_voter_id uuid
);
CREATE INDEX election_ballot_choices_idx ON public.election_ballot_choices (election_id, post_id);

CREATE TABLE public.agms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL UNIQUE REFERENCES public.meetings(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 140),
  financial_year text NOT NULL CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  notice_date date,
  quorum_basis text NOT NULL DEFAULT 'home' CHECK (quorum_basis IN ('home','person')),
  quorum_type text NOT NULL DEFAULT 'percent' CHECK (quorum_type IN ('percent','count')),
  quorum_value numeric NOT NULL CHECK (quorum_value > 0 AND quorum_value <= 100000),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','notice_published','scheduled','in_progress','completed','minutes_pending','minutes_published','archived')),
  quorum_snapshot jsonb,
  archive_reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (quorum_type <> 'percent' OR quorum_value <= 100)
);
CREATE INDEX agms_society_idx ON public.agms (society_id, status);
ALTER TABLE public.elections ADD CONSTRAINT elections_agm_fk FOREIGN KEY (agm_id) REFERENCES public.agms(id) ON DELETE SET NULL;

CREATE TABLE public.agm_agenda_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agm_id uuid NOT NULL REFERENCES public.agms(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  seq int NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  description text CHECK (description IS NULL OR char_length(description) <= 3000),
  kind text NOT NULL DEFAULT 'discussion' CHECK (kind IN ('discussion','resolution','vote','election')),
  poll_id uuid REFERENCES public.polls(id) ON DELETE SET NULL,
  election_id uuid REFERENCES public.elections(id) ON DELETE SET NULL,
  source_id uuid REFERENCES public.society_knowledge_sources(id) ON DELETE SET NULL
);

CREATE TABLE public.agm_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agm_id uuid NOT NULL REFERENCES public.agms(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  agenda_item_id uuid REFERENCES public.agm_agenda_items(id) ON DELETE SET NULL,
  seq int NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  body text NOT NULL CHECK (char_length(body) BETWEEN 5 AND 5000),
  poll_id uuid REFERENCES public.polls(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','passed','rejected','deferred','withdrawn')),
  decided_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.agm_minutes_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agm_id uuid NOT NULL REFERENCES public.agms(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  version int NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 10 AND 50000),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  correction_reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid,
  published_at timestamptz,
  UNIQUE (agm_id, version)
);
CREATE UNIQUE INDEX agm_minutes_one_draft ON public.agm_minutes_versions (agm_id) WHERE status = 'draft';

GRANT SELECT ON public.elections, public.election_posts, public.election_nominations, public.agms, public.agm_agenda_items, public.agm_resolutions, public.agm_minutes_versions TO authenticated;
GRANT ALL ON public.elections, public.election_posts, public.election_nominations, public.election_voters, public.election_ballot_choices, public.agms, public.agm_agenda_items, public.agm_resolutions, public.agm_minutes_versions TO service_role;
ALTER TABLE public.elections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.election_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.election_nominations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.election_voters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.election_ballot_choices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agm_agenda_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agm_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agm_minutes_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY elections_read ON public.elections FOR SELECT TO authenticated USING (
  society_id = public.get_user_society_id(auth.uid())
  AND (public.is_society_admin_for(auth.uid(), society_id) OR (status <> 'draft' AND public._gov_active_resident(auth.uid(), society_id))));
CREATE POLICY election_posts_read ON public.election_posts FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.elections e WHERE e.id = election_id));
CREATE POLICY election_nominations_read ON public.election_nominations FOR SELECT TO authenticated USING (
  society_id = public.get_user_society_id(auth.uid()) AND (
    public.is_society_admin_for(auth.uid(), society_id) OR candidate_id = auth.uid()
    OR (status = 'approved' AND EXISTS (SELECT 1 FROM public.elections e WHERE e.id = election_id AND e.status IN ('nomination_review','voting_open','voting_closed','results_published','archived')))));
CREATE POLICY agms_read ON public.agms FOR SELECT TO authenticated USING (
  society_id = public.get_user_society_id(auth.uid())
  AND (public.is_society_admin_for(auth.uid(), society_id) OR (status <> 'draft' AND public._gov_active_resident(auth.uid(), society_id))));
CREATE POLICY agm_agenda_read ON public.agm_agenda_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.agms a WHERE a.id = agm_id));
CREATE POLICY agm_resolutions_read ON public.agm_resolutions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.agms a WHERE a.id = agm_id));
CREATE POLICY agm_minutes_read ON public.agm_minutes_versions FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.agms a WHERE a.id = agm_id) AND (status = 'published' OR public.is_society_admin_for(auth.uid(), society_id)));

CREATE TRIGGER trg_election_ballots_append_only BEFORE UPDATE OR DELETE ON public.election_ballot_choices FOR EACH ROW EXECUTE FUNCTION public._append_only();
CREATE TRIGGER trg_election_voters_append_only BEFORE UPDATE OR DELETE ON public.election_voters FOR EACH ROW EXECUTE FUNCTION public._append_only();

CREATE OR REPLACE FUNCTION public._election_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'append_only' USING ERRCODE='22023'; END IF;
  IF OLD.results_hash IS NOT NULL AND (NEW.results IS DISTINCT FROM OLD.results OR NEW.results_hash IS DISTINCT FROM OLD.results_hash) THEN
    RAISE EXCEPTION 'results_locked' USING ERRCODE='22023'; END IF;
  IF OLD.status <> 'draft' AND (NEW.eligibility IS DISTINCT FROM OLD.eligibility OR NEW.secret_ballot IS DISTINCT FROM OLD.secret_ballot) THEN
    RAISE EXCEPTION 'vote_frozen' USING ERRCODE='22023'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_election_guard BEFORE UPDATE OR DELETE ON public.elections FOR EACH ROW EXECUTE FUNCTION public._election_guard();

CREATE OR REPLACE FUNCTION public._agm_resolution_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'append_only' USING ERRCODE='22023'; END IF;
  IF OLD.status <> 'proposed' THEN RAISE EXCEPTION 'resolution_locked' USING ERRCODE='22023'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_agm_resolution_guard BEFORE UPDATE OR DELETE ON public.agm_resolutions FOR EACH ROW EXECUTE FUNCTION public._agm_resolution_guard();

CREATE OR REPLACE FUNCTION public._agm_minutes_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'published' THEN RAISE EXCEPTION 'minutes_locked' USING ERRCODE='22023'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'published' THEN RAISE EXCEPTION 'minutes_locked' USING ERRCODE='22023'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_agm_minutes_guard BEFORE UPDATE OR DELETE ON public.agm_minutes_versions FOR EACH ROW EXECUTE FUNCTION public._agm_minutes_guard();

CREATE OR REPLACE FUNCTION public._meeting_agm_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND coalesce(current_setting('app.agm_write', true),'') <> '1'
     AND EXISTS (SELECT 1 FROM public.agms a WHERE a.meeting_id = NEW.id) THEN
    RAISE EXCEPTION 'use_agm' USING ERRCODE='22023'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_meeting_agm_guard BEFORE UPDATE ON public.meetings FOR EACH ROW EXECUTE FUNCTION public._meeting_agm_guard();

CREATE OR REPLACE FUNCTION public._election_audit(_e public.elections, _action text, _meta jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'election.' || _action, 'elections', _e.id::text, _e.society_id, coalesce(_meta, '{}'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public._election_eligible_users(_sid uuid)
RETURNS TABLE(user_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT fr.user_id FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
  WHERE f.society_id = _sid AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL AND fr.archived_at IS NULL
    AND (fr.access_expires_at IS NULL OR fr.access_expires_at > now())
$$;

CREATE OR REPLACE FUNCTION public._election_eligible_count(_e public.elections)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN _e.eligibility = 'home' THEN
    (SELECT count(DISTINCT fr.flat_id)::int FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
      WHERE f.society_id = _e.society_id AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL AND fr.archived_at IS NULL
        AND (fr.access_expires_at IS NULL OR fr.access_expires_at > now()))
  ELSE (SELECT count(*)::int FROM public._election_eligible_users(_e.society_id)) END
$$;

CREATE OR REPLACE FUNCTION public._election_notify(_e public.elections, _key text, _title text, _body text, _only_non_voters boolean DEFAULT false)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid; n int := 0;
BEGIN
  FOR u IN SELECT x.user_id FROM public._election_eligible_users(_e.society_id) x
           WHERE NOT _only_non_voters OR NOT EXISTS (SELECT 1 FROM public.election_voters v WHERE v.election_id = _e.id AND v.user_id = x.user_id) LOOP
    IF public._notify_user_once(u, _e.society_id, 'election', _title, _body, '/app/elections', 'election:' || _e.id || ':' || _key, 'high') THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public._election_tally(_e public.elections)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; out jsonb := '[]'::jsonb; cands jsonb; boundary int; next_votes int; unresolved boolean;
BEGIN
  FOR p IN SELECT * FROM public.election_posts WHERE election_id = _e.id ORDER BY seq, name LOOP
    WITH c AS (
      SELECT n.id, n.candidate_name, (SELECT count(*) FROM public.election_ballot_choices b WHERE b.nomination_id = n.id)::int AS votes
      FROM public.election_nominations n WHERE n.post_id = p.id AND n.status = 'approved'
    ), r AS (SELECT c.*, rank() OVER (ORDER BY votes DESC) AS rk FROM c)
    SELECT coalesce(jsonb_agg(jsonb_build_object('nomination_id', id, 'name', candidate_name, 'votes', votes, 'rank', rk) ORDER BY votes DESC, candidate_name), '[]'::jsonb)
    INTO cands FROM r;
    boundary := NULL; next_votes := NULL;
    SELECT (x->>'votes')::int INTO boundary FROM jsonb_array_elements(cands) WITH ORDINALITY t(x, i) WHERE i = p.seats;
    SELECT (x->>'votes')::int INTO next_votes FROM jsonb_array_elements(cands) WITH ORDINALITY t(x, i) WHERE i = p.seats + 1;
    unresolved := boundary IS NOT NULL AND next_votes IS NOT NULL AND boundary = next_votes;
    SELECT coalesce(jsonb_agg(x || jsonb_build_object('outcome',
      CASE WHEN jsonb_array_length(cands) <= p.seats AND (x->>'votes')::int > 0 THEN 'elected'
           WHEN jsonb_array_length(cands) <= p.seats THEN 'unresolved'
           WHEN unresolved AND (x->>'votes')::int = boundary THEN 'tied'
           WHEN (x->>'votes')::int > coalesce(next_votes, -1) AND i <= p.seats THEN 'elected'
           ELSE 'not_elected' END) ORDER BY i), '[]'::jsonb)
    INTO cands FROM jsonb_array_elements(cands) WITH ORDINALITY t(x, i);
    out := out || jsonb_build_object('post_id', p.id, 'post', p.name, 'seats', p.seats,
      'valid_votes', (SELECT count(*) FROM public.election_ballot_choices b WHERE b.post_id = p.id),
      'state', CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(cands) y WHERE y->>'outcome' IN ('tied','unresolved')) THEN 'unresolved' ELSE 'decided' END,
      'candidates', cands);
  END LOOP;
  RETURN jsonb_build_object('eligible', public._election_eligible_count(_e),
    'participated', (SELECT count(*) FROM public.election_voters v WHERE v.election_id = _e.id), 'posts', out);
END $$;

CREATE OR REPLACE FUNCTION public.election_save(_id uuid, _title text, _purpose text, _instructions text, _eligibility text, _secret boolean,
  _nom_open timestamptz, _nom_close timestamptz, _vote_open timestamptz, _vote_close timestamptz, _rules_source uuid, _agm uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); cur public.elections;
BEGIN
  IF char_length(btrim(coalesce(_title,''))) < 3 THEN RAISE EXCEPTION 'invalid_title' USING ERRCODE='22023'; END IF;
  IF _nom_open IS NULL OR _nom_close IS NULL OR _vote_open IS NULL OR _vote_close IS NULL
     OR NOT (_nom_close > _nom_open AND _vote_open >= _nom_close AND _vote_close > _vote_open) OR _vote_close < now() THEN
    RAISE EXCEPTION 'invalid_window' USING ERRCODE='22023'; END IF;
  IF _rules_source IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.society_knowledge_sources s WHERE s.id = _rules_source AND s.society_id = sid AND s.archived_at IS NULL) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF _agm IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.agms a WHERE a.id = _agm AND a.society_id = sid) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  PERFORM public._rate_hit('election_write', auth.uid()::text, 120, interval '1 hour');
  IF _id IS NULL THEN
    INSERT INTO public.elections (society_id, title, purpose, instructions, eligibility, secret_ballot, nomination_opens_at, nomination_closes_at, voting_opens_at, voting_closes_at, rules_source_id, agm_id, created_by)
    VALUES (sid, btrim(_title), coalesce(_purpose,'committee'), nullif(btrim(coalesce(_instructions,'')),''), coalesce(_eligibility,'home'), coalesce(_secret,true),
      _nom_open, _nom_close, _vote_open, _vote_close, _rules_source, _agm, auth.uid()) RETURNING * INTO cur;
    PERFORM public._election_audit(cur, 'created', jsonb_build_object('eligibility', cur.eligibility, 'secret', cur.secret_ballot));
    RETURN cur.id;
  END IF;
  SELECT * INTO cur FROM public.elections WHERE id = _id AND society_id = sid FOR UPDATE;
  IF cur.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF cur.status <> 'draft' THEN RAISE EXCEPTION 'vote_frozen' USING ERRCODE='22023'; END IF;
  UPDATE public.elections SET title = btrim(_title), purpose = coalesce(_purpose, purpose), instructions = nullif(btrim(coalesce(_instructions,'')),''),
    eligibility = coalesce(_eligibility, eligibility), secret_ballot = coalesce(_secret, secret_ballot), nomination_opens_at = _nom_open, nomination_closes_at = _nom_close,
    voting_opens_at = _vote_open, voting_closes_at = _vote_close, rules_source_id = _rules_source, agm_id = _agm, updated_at = now() WHERE id = _id RETURNING * INTO cur;
  PERFORM public._election_audit(cur, 'configured', '{}'::jsonb);
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.election_post_save(_election uuid, _post uuid, _name text, _seats int, _description text, _rule text, _requirements text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); e public.elections; pid uuid;
BEGIN
  SELECT * INTO e FROM public.elections WHERE id = _election AND society_id = sid FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF e.status <> 'draft' THEN RAISE EXCEPTION 'vote_frozen' USING ERRCODE='22023'; END IF;
  IF char_length(btrim(coalesce(_name,''))) < 2 OR coalesce(_seats,0) NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('election_write', auth.uid()::text, 120, interval '1 hour');
  IF _post IS NULL THEN
    INSERT INTO public.election_posts (election_id, society_id, seq, name, seats, description, candidate_rule, requirements)
    VALUES (_election, sid, coalesce((SELECT max(seq) FROM public.election_posts WHERE election_id = _election),0) + 1, btrim(_name), _seats,
      nullif(btrim(coalesce(_description,'')),''), coalesce(_rule,'resident'), nullif(btrim(coalesce(_requirements,'')),'')) RETURNING id INTO pid;
  ELSE
    UPDATE public.election_posts SET name = btrim(_name), seats = _seats, description = nullif(btrim(coalesce(_description,'')),''),
      candidate_rule = coalesce(_rule, candidate_rule), requirements = nullif(btrim(coalesce(_requirements,'')),'')
    WHERE id = _post AND election_id = _election RETURNING id INTO pid;
    IF pid IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  END IF;
  PERFORM public._election_audit(e, 'post_saved', jsonb_build_object('post', pid, 'name', btrim(_name), 'seats', _seats));
  RETURN pid;
END $$;

CREATE OR REPLACE FUNCTION public.election_post_remove(_post uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); e public.elections;
BEGIN
  SELECT el.* INTO e FROM public.election_posts p JOIN public.elections el ON el.id = p.election_id WHERE p.id = _post AND el.society_id = sid;
  IF e.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF e.status <> 'draft' THEN RAISE EXCEPTION 'vote_frozen' USING ERRCODE='22023'; END IF;
  DELETE FROM public.election_posts WHERE id = _post;
  PERFORM public._election_audit(e, 'post_removed', jsonb_build_object('post', _post));
END $$;

CREATE OR REPLACE FUNCTION public.election_set_status(_id uuid, _status text, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); cur public.elections; t jsonb; reopen boolean := false; renom boolean := false;
BEGIN
  SELECT * INTO cur FROM public.elections WHERE id = _id AND society_id = sid FOR UPDATE;
  IF cur.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  reopen := cur.status = 'voting_closed' AND _status = 'voting_open';
  renom := cur.status = 'nomination_review' AND _status = 'nomination_open';
  IF NOT ((cur.status = 'draft' AND _status IN ('nomination_open','archived'))
       OR (cur.status = 'nomination_open' AND _status = 'nomination_review')
       OR (cur.status = 'nomination_review' AND _status IN ('voting_open','nomination_open'))
       OR (cur.status = 'voting_open' AND _status = 'voting_closed')
       OR reopen
       OR (cur.status = 'voting_closed' AND _status = 'results_published')
       OR (cur.status = 'results_published' AND _status = 'archived')) THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF (reopen OR renom OR (cur.status = 'draft' AND _status = 'archived'))
     AND char_length(btrim(coalesce(_reason,''))) < 10 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  IF _status = 'nomination_open' AND NOT EXISTS (SELECT 1 FROM public.election_posts WHERE election_id = _id) THEN RAISE EXCEPTION 'posts_required' USING ERRCODE='22023'; END IF;
  IF _status = 'voting_open' THEN
    IF cur.voting_closes_at <= now() THEN RAISE EXCEPTION 'invalid_window' USING ERRCODE='22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.election_nominations WHERE election_id = _id AND status = 'pending') THEN RAISE EXCEPTION 'pending_nominations' USING ERRCODE='22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.election_posts p WHERE p.election_id = _id AND NOT EXISTS (SELECT 1 FROM public.election_nominations n WHERE n.post_id = p.id AND n.status = 'approved')) THEN
      RAISE EXCEPTION 'candidates_required' USING ERRCODE='22023'; END IF;
  END IF;
  PERFORM public._rate_hit('election_write', auth.uid()::text, 60, interval '1 hour');
  IF _status = 'results_published' THEN
    t := public._election_tally(cur);
    UPDATE public.elections SET status = _status, results = t, results_hash = md5(t::text), results_published_at = now(), updated_at = now() WHERE id = _id;
  ELSE
    UPDATE public.elections SET status = _status, archive_reason = CASE WHEN _status = 'archived' THEN nullif(btrim(coalesce(_reason,'')),'') ELSE archive_reason END, updated_at = now() WHERE id = _id;
  END IF;
  SELECT * INTO cur FROM public.elections WHERE id = _id;
  PERFORM public._election_audit(cur, CASE WHEN reopen THEN 'reopened' WHEN renom THEN 'nominations_reopened' ELSE _status END,
    jsonb_build_object('reason', nullif(btrim(coalesce(_reason,'')),''), 'results_hash', cur.results_hash,
      'participated', (SELECT count(*) FROM public.election_voters v WHERE v.election_id = _id)));
  IF _status = 'nomination_open' THEN
    PERFORM public._election_notify(cur, CASE WHEN renom THEN 'nominations:' || md5(_reason) ELSE 'nominations' END, 'Nominations open: ' || left(cur.title, 90),
      'Nominations close ' || to_char(cur.nomination_closes_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM'));
    IF NOT renom THEN
      INSERT INTO public.notices (society_id, title, body, category, audience, status, published_at, notified_at, created_by, priority)
      VALUES (sid, left('Election: ' || cur.title, 140),
        left('Nominations are open until ' || to_char(cur.nomination_closes_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')
          || '. Voting runs ' || to_char(cur.voting_opens_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon') || ' to ' || to_char(cur.voting_closes_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY')
          || '. Open Elections in the app to see the posts and submit a nomination.', 5000), 'important', 'all', 'published', now(), now(), auth.uid(), 'high');
    END IF;
  ELSIF _status = 'voting_open' THEN
    PERFORM public._election_notify(cur, CASE WHEN reopen THEN 'voting:reopen:' || md5(_reason) ELSE 'voting' END, 'Voting open: ' || left(cur.title, 90),
      'Voting closes ' || to_char(cur.voting_closes_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM'));
  ELSIF _status = 'voting_closed' THEN
    PERFORM public._election_notify(cur, 'closed', 'Voting closed: ' || left(cur.title, 90), 'Results will be shared once the committee publishes them.');
  ELSIF _status = 'results_published' THEN
    PERFORM public._election_notify(cur, 'results', 'Election results: ' || left(cur.title, 90), 'Results are now published.');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.election_nominate(_post uuid, _statement text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.election_posts; e public.elections; nid uuid; nm text; sid uuid := public.get_user_society_id(auth.uid());
BEGIN
  SELECT * INTO p FROM public.election_posts WHERE id = _post;
  SELECT * INTO e FROM public.elections WHERE id = p.election_id FOR SHARE;
  IF auth.uid() IS NULL OR e.id IS NULL OR e.society_id IS DISTINCT FROM sid THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF e.status <> 'nomination_open' THEN RAISE EXCEPTION 'nominations_closed' USING ERRCODE='22023'; END IF;
  IF NOT public._gov_active_resident(auth.uid(), sid) OR (p.candidate_rule = 'owner' AND NOT public._gov_active_owner(auth.uid(), sid)) THEN
    RAISE EXCEPTION 'not_eligible' USING ERRCODE='42501'; END IF;
  PERFORM public._rate_hit('election_nominate', auth.uid()::text, 20, interval '1 hour');
  SELECT coalesce(nullif(btrim(full_name),''), 'Resident') INTO nm FROM public.profiles WHERE id = auth.uid();
  BEGIN
    INSERT INTO public.election_nominations (election_id, post_id, society_id, candidate_id, candidate_name, statement)
    VALUES (e.id, p.id, sid, auth.uid(), left(coalesce(nm,'Resident'),120), nullif(left(btrim(coalesce(_statement,'')),2000),'')) RETURNING id INTO nid;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'already_nominated' USING ERRCODE='23505';
  END;
  PERFORM public._election_audit(e, 'nomination_submitted', jsonb_build_object('nomination', nid, 'post', p.id));
  PERFORM public._notify_society_admins(sid, 'election', 'New nomination: ' || left(p.name, 60), left(e.title, 120), '/society/elections');
  RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.election_review_nomination(_nomination uuid, _approve boolean, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); n public.election_nominations; e public.elections; p public.election_posts;
BEGIN
  SELECT * INTO n FROM public.election_nominations WHERE id = _nomination AND society_id = sid FOR UPDATE;
  IF n.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO e FROM public.elections WHERE id = n.election_id;
  SELECT * INTO p FROM public.election_posts WHERE id = n.post_id;
  IF n.candidate_id = auth.uid() THEN RAISE EXCEPTION 'self_review' USING ERRCODE='42501'; END IF;
  IF n.status <> 'pending' OR e.status NOT IN ('nomination_open','nomination_review') THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF NOT coalesce(_approve,false) AND char_length(btrim(coalesce(_reason,''))) < 5 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  IF coalesce(_approve,false) AND (NOT public._gov_active_resident(n.candidate_id, sid) OR (p.candidate_rule = 'owner' AND NOT public._gov_active_owner(n.candidate_id, sid))) THEN
    RAISE EXCEPTION 'candidate_not_eligible' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('election_write', auth.uid()::text, 200, interval '1 hour');
  UPDATE public.election_nominations SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END, review_reason = nullif(btrim(coalesce(_reason,'')),''),
    reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now() WHERE id = _nomination;
  PERFORM public._election_audit(e, CASE WHEN _approve THEN 'nomination_approved' ELSE 'nomination_rejected' END, jsonb_build_object('nomination', n.id, 'post', n.post_id));
  PERFORM public._notify_user_once(n.candidate_id, sid, 'election', CASE WHEN _approve THEN 'Nomination approved: ' ELSE 'Nomination not accepted: ' END || left(p.name, 60),
    coalesce(nullif(btrim(coalesce(_reason,'')),''), left(e.title,120)), '/app/elections', 'election-nom:' || n.id || ':' || CASE WHEN _approve THEN 'a' ELSE 'r' END, 'normal');
END $$;

CREATE OR REPLACE FUNCTION public.election_withdraw_nomination(_nomination uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n public.election_nominations; e public.elections;
BEGIN
  SELECT * INTO n FROM public.election_nominations WHERE id = _nomination FOR UPDATE;
  IF auth.uid() IS NULL OR n.id IS NULL OR n.candidate_id <> auth.uid() THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO e FROM public.elections WHERE id = n.election_id;
  IF n.status NOT IN ('pending','approved') OR e.status NOT IN ('nomination_open','nomination_review') THEN RAISE EXCEPTION 'withdraw_closed' USING ERRCODE='22023'; END IF;
  UPDATE public.election_nominations SET status = 'withdrawn', updated_at = now() WHERE id = _nomination;
  PERFORM public._election_audit(e, 'candidate_withdrawn', jsonb_build_object('nomination', n.id, 'post', n.post_id));
END $$;

CREATE OR REPLACE FUNCTION public.election_cast_ballot(_election uuid, _choices uuid[], _request uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.elections; sid uuid := public.get_user_society_id(auth.uid()); fid uuid; prev uuid; c uuid; n public.election_nominations;
  p record; picked int;
BEGIN
  SELECT * INTO e FROM public.elections WHERE id = _election FOR SHARE;
  IF auth.uid() IS NULL OR e.id IS NULL OR e.society_id IS DISTINCT FROM sid THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF _request IS NULL THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  SELECT request_id INTO prev FROM public.election_voters WHERE election_id = _election AND user_id = auth.uid();
  IF prev IS NOT NULL THEN
    IF prev = _request THEN RETURN 'already_recorded'; END IF;
    RAISE EXCEPTION 'already_voted' USING ERRCODE='23505';
  END IF;
  IF e.status <> 'voting_open' OR now() >= e.voting_closes_at THEN RAISE EXCEPTION 'poll_closed' USING ERRCODE='22023'; END IF;
  IF NOT public._gov_active_resident(auth.uid(), sid) THEN RAISE EXCEPTION 'not_eligible' USING ERRCODE='42501'; END IF;
  IF e.eligibility = 'home' THEN
    SELECT fr.flat_id INTO fid FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
    WHERE fr.user_id = auth.uid() AND f.society_id = sid AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL AND fr.archived_at IS NULL
      AND (fr.access_expires_at IS NULL OR fr.access_expires_at > now())
      AND NOT EXISTS (SELECT 1 FROM public.election_voters v WHERE v.election_id = _election AND v.flat_id = fr.flat_id)
    ORDER BY fr.is_primary DESC, fr.created_at LIMIT 1;
    IF fid IS NULL THEN RAISE EXCEPTION 'home_already_voted' USING ERRCODE='23505'; END IF;
  END IF;
  IF _choices IS NULL OR cardinality(_choices) = 0 OR cardinality(_choices) <> (SELECT count(DISTINCT x) FROM unnest(_choices) x) THEN
    RAISE EXCEPTION 'invalid_option' USING ERRCODE='22023'; END IF;
  FOREACH c IN ARRAY _choices LOOP
    SELECT * INTO n FROM public.election_nominations WHERE id = c AND election_id = _election AND status = 'approved';
    IF n.id IS NULL THEN RAISE EXCEPTION 'invalid_option' USING ERRCODE='22023'; END IF;
  END LOOP;
  FOR p IN SELECT ep.id, ep.seats FROM public.election_posts ep WHERE ep.election_id = _election LOOP
    SELECT count(*) INTO picked FROM public.election_nominations WHERE id = ANY(_choices) AND post_id = p.id;
    IF picked > p.seats THEN RAISE EXCEPTION 'too_many_choices' USING ERRCODE='22023'; END IF;
  END LOOP;
  PERFORM public._rate_hit('election_vote', auth.uid()::text, 20, interval '1 hour');
  BEGIN
    INSERT INTO public.election_voters (election_id, user_id, flat_id, request_id) VALUES (_election, auth.uid(), fid, _request);
  EXCEPTION WHEN unique_violation THEN
    IF e.eligibility = 'home' THEN RAISE EXCEPTION 'home_already_voted' USING ERRCODE='23505'; END IF;
    RAISE EXCEPTION 'already_voted' USING ERRCODE='23505';
  END;
  INSERT INTO public.election_ballot_choices (election_id, post_id, nomination_id, open_voter_id)
  SELECT _election, en.post_id, en.id, CASE WHEN e.secret_ballot THEN NULL ELSE auth.uid() END
  FROM public.election_nominations en WHERE en.id = ANY(_choices) ORDER BY random();
  PERFORM public._election_audit(e, 'vote_submitted', jsonb_build_object('eligibility', e.eligibility));
  RETURN 'recorded';
END $$;

CREATE OR REPLACE FUNCTION public.election_my_state(_election uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.elections; sid uuid := public.get_user_society_id(auth.uid()); home_voted boolean := false; elig boolean;
BEGIN
  SELECT * INTO e FROM public.elections WHERE id = _election;
  IF auth.uid() IS NULL OR e.id IS NULL OR e.society_id IS DISTINCT FROM sid THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  elig := public._gov_active_resident(auth.uid(), sid);
  IF e.eligibility = 'home' AND elig THEN
    home_voted := NOT EXISTS (
      SELECT 1 FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
      WHERE fr.user_id = auth.uid() AND f.society_id = sid AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL AND fr.archived_at IS NULL
        AND (fr.access_expires_at IS NULL OR fr.access_expires_at > now())
        AND NOT EXISTS (SELECT 1 FROM public.election_voters v WHERE v.election_id = e.id AND v.flat_id = fr.flat_id));
  END IF;
  RETURN jsonb_build_object('eligible', elig,
    'voted', EXISTS (SELECT 1 FROM public.election_voters v WHERE v.election_id = e.id AND v.user_id = auth.uid()),
    'home_voted', home_voted);
END $$;

CREATE OR REPLACE FUNCTION public.election_results(_election uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.elections; sid uuid := public.get_user_society_id(auth.uid()); adm boolean;
BEGIN
  SELECT * INTO e FROM public.elections WHERE id = _election;
  IF auth.uid() IS NULL OR e.id IS NULL OR e.society_id IS DISTINCT FROM sid THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  adm := public.is_society_admin_for(auth.uid(), sid);
  IF NOT adm AND NOT public._gov_active_resident(auth.uid(), sid) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF e.results_hash IS NOT NULL THEN
    RETURN e.results || jsonb_build_object('published', true, 'hash', e.results_hash, 'published_at', e.results_published_at);
  END IF;
  IF e.status = 'voting_closed' AND adm THEN
    RETURN public._election_tally(e) || jsonb_build_object('published', false);
  END IF;
  RETURN jsonb_build_object('published', false, 'hidden', true,
    'eligible', CASE WHEN adm THEN public._election_eligible_count(e) END,
    'participated', CASE WHEN adm THEN (SELECT count(*) FROM public.election_voters v WHERE v.election_id = e.id) END);
END $$;

CREATE OR REPLACE FUNCTION public.election_reminders()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.elections; total int := 0;
BEGIN
  FOR e IN SELECT * FROM public.elections WHERE status = 'voting_open' AND voting_closes_at > now() AND voting_closes_at <= now() + interval '24 hours' LOOP
    total := total + public._election_notify(e, 'reminder', 'Voting closes soon: ' || left(e.title, 80),
      'Voting closes ' || to_char(e.voting_closes_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon, HH12:MI AM'), true);
  END LOOP;
  RETURN total;
END $$;

CREATE OR REPLACE FUNCTION public._agm_audit(_a public.agms, _action text, _meta jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'agm.' || _action, 'agms', _a.id::text, _a.society_id, coalesce(_meta,'{}'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public._agm_quorum(_a public.agms)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE eligible int; present int; required int;
BEGIN
  IF _a.quorum_basis = 'home' THEN
    SELECT count(DISTINCT fr.flat_id) INTO eligible FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
      WHERE f.society_id = _a.society_id AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL AND fr.archived_at IS NULL AND (fr.access_expires_at IS NULL OR fr.access_expires_at > now());
    SELECT count(DISTINCT fr.flat_id) INTO present FROM public.meeting_attendance ma
      JOIN public.flat_residents fr ON fr.user_id = ma.user_id JOIN public.flats f ON f.id = fr.flat_id
      WHERE ma.meeting_id = _a.meeting_id AND ma.present AND f.society_id = _a.society_id AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL AND fr.archived_at IS NULL;
  ELSE
    SELECT count(*) INTO eligible FROM public._election_eligible_users(_a.society_id);
    SELECT count(*) INTO present FROM public.meeting_attendance ma WHERE ma.meeting_id = _a.meeting_id AND ma.present
      AND ma.user_id IN (SELECT user_id FROM public._election_eligible_users(_a.society_id));
  END IF;
  required := greatest(CASE WHEN _a.quorum_type = 'percent' THEN ceil(eligible * _a.quorum_value / 100.0)::int ELSE _a.quorum_value::int END, 1);
  RETURN jsonb_build_object('basis', _a.quorum_basis, 'eligible', eligible, 'present', present, 'required', required,
    'met', present >= required, 'calculated_at', now());
END $$;

CREATE OR REPLACE FUNCTION public.agm_quorum(_agm uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.agms; sid uuid := public.get_user_society_id(auth.uid());
BEGIN
  SELECT * INTO a FROM public.agms WHERE id = _agm;
  IF auth.uid() IS NULL OR a.id IS NULL OR a.society_id IS DISTINCT FROM sid
     OR NOT (public.is_society_admin_for(auth.uid(), sid) OR (a.status <> 'draft' AND public._gov_active_resident(auth.uid(), sid))) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  RETURN coalesce(a.quorum_snapshot || jsonb_build_object('frozen', true), public._agm_quorum(a) || jsonb_build_object('frozen', false));
END $$;

CREATE OR REPLACE FUNCTION public.agm_save(_id uuid, _title text, _fy text, _starts timestamptz, _location text, _link text, _agenda text,
  _basis text, _qtype text, _qvalue numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); a public.agms; mid uuid;
BEGIN
  IF char_length(btrim(coalesce(_title,''))) < 3 THEN RAISE EXCEPTION 'invalid_title' USING ERRCODE='22023'; END IF;
  IF coalesce(_fy,'') !~ '^[0-9]{4}-[0-9]{2}$' THEN RAISE EXCEPTION 'invalid_fy' USING ERRCODE='22023'; END IF;
  IF _starts IS NULL OR _starts < now() THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE='22023'; END IF;
  IF nullif(btrim(coalesce(_location,'')),'') IS NULL AND nullif(btrim(coalesce(_link,'')),'') IS NULL THEN RAISE EXCEPTION 'place_required' USING ERRCODE='22023'; END IF;
  IF nullif(btrim(coalesce(_link,'')),'') IS NOT NULL AND btrim(_link) !~ '^https://' THEN RAISE EXCEPTION 'invalid_link' USING ERRCODE='22023'; END IF;
  IF _qvalue IS NULL OR _qvalue <= 0 OR (coalesce(_qtype,'percent') = 'percent' AND _qvalue > 100) THEN RAISE EXCEPTION 'invalid_quorum' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('agm_write', auth.uid()::text, 120, interval '1 hour');
  IF _id IS NULL THEN
    INSERT INTO public.meetings (society_id, title, agenda, starts_at, location, meeting_link, audience, status, created_by)
    VALUES (sid, left('AGM: ' || btrim(_title), 140), nullif(btrim(coalesce(_agenda,'')),''), _starts, nullif(btrim(coalesce(_location,'')),''), nullif(btrim(coalesce(_link,'')),''), 'all', 'draft', auth.uid())
    RETURNING id INTO mid;
    INSERT INTO public.agms (society_id, meeting_id, title, financial_year, quorum_basis, quorum_type, quorum_value, created_by)
    VALUES (sid, mid, btrim(_title), _fy, coalesce(_basis,'home'), coalesce(_qtype,'percent'), _qvalue, auth.uid()) RETURNING * INTO a;
    PERFORM public._agm_audit(a, 'created', jsonb_build_object('financial_year', _fy, 'meeting', mid));
    RETURN a.id;
  END IF;
  SELECT * INTO a FROM public.agms WHERE id = _id AND society_id = sid FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF a.status <> 'draft' THEN RAISE EXCEPTION 'agm_locked' USING ERRCODE='22023'; END IF;
  UPDATE public.agms SET title = btrim(_title), financial_year = _fy, quorum_basis = coalesce(_basis, quorum_basis), quorum_type = coalesce(_qtype, quorum_type), quorum_value = _qvalue, updated_at = now() WHERE id = _id;
  UPDATE public.meetings SET title = left('AGM: ' || btrim(_title), 140), agenda = nullif(btrim(coalesce(_agenda,'')),''), starts_at = _starts,
    location = nullif(btrim(coalesce(_location,'')),''), meeting_link = nullif(btrim(coalesce(_link,'')),''), updated_at = now() WHERE id = a.meeting_id;
  PERFORM public._agm_audit(a, 'configured', '{}'::jsonb);
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.agm_agenda_save(_agm uuid, _item uuid, _title text, _description text, _kind text, _poll uuid, _election uuid, _source uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); a public.agms; iid uuid;
BEGIN
  SELECT * INTO a FROM public.agms WHERE id = _agm AND society_id = sid FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF a.status NOT IN ('draft','notice_published','scheduled') THEN RAISE EXCEPTION 'agm_locked' USING ERRCODE='22023'; END IF;
  IF char_length(btrim(coalesce(_title,''))) < 3 THEN RAISE EXCEPTION 'invalid_title' USING ERRCODE='22023'; END IF;
  IF _poll IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.polls WHERE id = _poll AND society_id = sid AND kind = 'vote') THEN RAISE EXCEPTION 'invalid_vote' USING ERRCODE='22023'; END IF;
  IF _election IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.elections WHERE id = _election AND society_id = sid) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF _source IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.society_knowledge_sources WHERE id = _source AND society_id = sid AND archived_at IS NULL) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  PERFORM public._rate_hit('agm_write', auth.uid()::text, 200, interval '1 hour');
  IF _item IS NULL THEN
    INSERT INTO public.agm_agenda_items (agm_id, society_id, seq, title, description, kind, poll_id, election_id, source_id)
    VALUES (_agm, sid, coalesce((SELECT max(seq) FROM public.agm_agenda_items WHERE agm_id = _agm),0) + 1, btrim(_title), nullif(btrim(coalesce(_description,'')),''),
      coalesce(_kind,'discussion'), _poll, _election, _source) RETURNING id INTO iid;
  ELSE
    UPDATE public.agm_agenda_items SET title = btrim(_title), description = nullif(btrim(coalesce(_description,'')),''), kind = coalesce(_kind, kind),
      poll_id = _poll, election_id = _election, source_id = _source WHERE id = _item AND agm_id = _agm RETURNING id INTO iid;
    IF iid IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  END IF;
  PERFORM public._agm_audit(a, 'agenda_saved', jsonb_build_object('item', iid));
  RETURN iid;
END $$;

CREATE OR REPLACE FUNCTION public.agm_agenda_move(_item uuid, _dir int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); it public.agm_agenda_items; other public.agm_agenda_items; a public.agms;
BEGIN
  SELECT * INTO it FROM public.agm_agenda_items WHERE id = _item AND society_id = sid;
  IF it.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO a FROM public.agms WHERE id = it.agm_id FOR UPDATE;
  IF a.status NOT IN ('draft','notice_published','scheduled') THEN RAISE EXCEPTION 'agm_locked' USING ERRCODE='22023'; END IF;
  IF _dir < 0 THEN
    SELECT * INTO other FROM public.agm_agenda_items WHERE agm_id = it.agm_id AND seq < it.seq ORDER BY seq DESC LIMIT 1;
  ELSE
    SELECT * INTO other FROM public.agm_agenda_items WHERE agm_id = it.agm_id AND seq > it.seq ORDER BY seq ASC LIMIT 1;
  END IF;
  IF other.id IS NULL THEN RETURN; END IF;
  UPDATE public.agm_agenda_items SET seq = other.seq WHERE id = it.id;
  UPDATE public.agm_agenda_items SET seq = it.seq WHERE id = other.id;
END $$;

CREATE OR REPLACE FUNCTION public.agm_agenda_remove(_item uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); it public.agm_agenda_items; a public.agms;
BEGIN
  SELECT * INTO it FROM public.agm_agenda_items WHERE id = _item AND society_id = sid;
  IF it.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO a FROM public.agms WHERE id = it.agm_id;
  IF a.status <> 'draft' THEN RAISE EXCEPTION 'agm_locked' USING ERRCODE='22023'; END IF;
  DELETE FROM public.agm_agenda_items WHERE id = _item;
  PERFORM public._agm_audit(a, 'agenda_removed', jsonb_build_object('item', _item));
END $$;

CREATE OR REPLACE FUNCTION public.agm_set_status(_id uuid, _status text, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); a public.agms; m public.meetings; u uuid; q jsonb; d public.agm_minutes_versions;
BEGIN
  SELECT * INTO a FROM public.agms WHERE id = _id AND society_id = sid FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO m FROM public.meetings WHERE id = a.meeting_id;
  IF NOT ((a.status = 'draft' AND _status IN ('notice_published','archived'))
       OR (a.status = 'notice_published' AND _status IN ('scheduled','archived'))
       OR (a.status = 'scheduled' AND _status IN ('in_progress','archived'))
       OR (a.status = 'in_progress' AND _status = 'completed')
       OR (a.status = 'completed' AND _status = 'minutes_pending')
       OR (a.status = 'minutes_pending' AND _status = 'minutes_published')
       OR (a.status = 'minutes_published' AND _status IN ('minutes_pending','archived'))) THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF (_status = 'archived' AND a.status <> 'minutes_published') AND char_length(btrim(coalesce(_reason,''))) < 10 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  IF _status = 'notice_published' THEN
    IF m.starts_at < now() THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE='22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.agm_agenda_items WHERE agm_id = _id) THEN RAISE EXCEPTION 'agenda_required' USING ERRCODE='22023'; END IF;
  END IF;
  IF _status = 'in_progress' AND m.starts_at > now() + interval '30 minutes' THEN RAISE EXCEPTION 'not_started' USING ERRCODE='22023'; END IF;
  SELECT * INTO d FROM public.agm_minutes_versions WHERE agm_id = _id AND status = 'draft';
  IF _status IN ('minutes_pending','minutes_published') AND d.id IS NULL THEN RAISE EXCEPTION 'minutes_required' USING ERRCODE='22023'; END IF;
  IF a.status = 'minutes_published' AND _status = 'minutes_pending' AND d.correction_reason IS NULL THEN RAISE EXCEPTION 'correction_required' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('agm_write', auth.uid()::text, 60, interval '1 hour');
  PERFORM set_config('app.agm_write', '1', true);
  IF _status = 'notice_published' THEN
    UPDATE public.meetings SET status = 'scheduled', updated_at = now() WHERE id = m.id;
    UPDATE public.agms SET notice_date = (now() AT TIME ZONE 'Asia/Kolkata')::date WHERE id = _id;
    INSERT INTO public.notices (society_id, title, body, category, audience, status, published_at, notified_at, created_by, priority)
    VALUES (sid, left('Notice of AGM ' || a.financial_year || ': ' || a.title, 140),
      left('The Annual General Meeting will be held on ' || to_char(m.starts_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')
        || coalesce(' at ' || m.location, '') || coalesce(' (online: ' || m.meeting_link || ')', '') || E'.\n\nAgenda:\n'
        || coalesce((SELECT string_agg(seq || '. ' || title, E'\n' ORDER BY seq) FROM public.agm_agenda_items WHERE agm_id = _id), ''), 5000),
      'event', 'all', 'published', now(), now(), auth.uid(), 'high');
    FOR u IN SELECT x.user_id FROM public._meeting_audience(m) x LOOP
      PERFORM public._notify_user_once(u, sid, 'meeting', 'AGM notice: ' || left(a.title, 90), to_char(m.starts_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM'), '/app/agm', 'agm:' || _id || ':notice', 'high');
    END LOOP;
  ELSIF _status = 'in_progress' THEN
    UPDATE public.meetings SET status = 'held', updated_at = now() WHERE id = m.id;
  ELSIF _status = 'completed' THEN
    q := public._agm_quorum(a);
    UPDATE public.agms SET quorum_snapshot = q WHERE id = _id;
  ELSIF _status = 'minutes_published' THEN
    UPDATE public.agm_minutes_versions SET status = 'published', published_by = auth.uid(), published_at = now() WHERE id = d.id;
    UPDATE public.meetings SET status = 'minutes_published', minutes = left(d.body, 20000), updated_at = now() WHERE id = m.id;
    FOR u IN SELECT x.user_id FROM public._meeting_audience(m) x LOOP
      PERFORM public._notify_user_once(u, sid, 'meeting', 'AGM minutes published: ' || left(a.title, 80), 'Version ' || d.version, '/app/agm', 'agm:' || _id || ':minutes:' || d.version, 'normal');
    END LOOP;
  ELSIF _status = 'archived' AND m.status IN ('draft','scheduled') THEN
    UPDATE public.meetings SET status = 'cancelled', cancel_reason = left(btrim(_reason), 500), updated_at = now() WHERE id = m.id;
  END IF;
  UPDATE public.agms SET status = _status, archive_reason = CASE WHEN _status = 'archived' THEN nullif(btrim(coalesce(_reason,'')),'') ELSE archive_reason END, updated_at = now() WHERE id = _id;
  PERFORM public._agm_audit(a, _status, jsonb_build_object('from', a.status, 'reason', nullif(btrim(coalesce(_reason,'')),''), 'quorum', q));
END $$;

CREATE OR REPLACE FUNCTION public.agm_record_attendance(_agm uuid, _user uuid, _present boolean, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); a public.agms;
BEGIN
  SELECT * INTO a FROM public.agms WHERE id = _agm AND society_id = sid FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF a.status NOT IN ('in_progress','completed','minutes_pending') THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF a.status <> 'in_progress' AND char_length(btrim(coalesce(_reason,''))) < 10 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  IF NOT (public._gov_active_resident(_user, sid) OR public.is_society_admin_for(_user, sid)) THEN RAISE EXCEPTION 'not_member' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('meeting_write', auth.uid()::text, 400, interval '1 hour');
  INSERT INTO public.meeting_attendance (meeting_id, user_id, present, recorded_by) VALUES (a.meeting_id, _user, coalesce(_present,false), auth.uid())
  ON CONFLICT (meeting_id, user_id) DO UPDATE SET present = excluded.present, recorded_by = auth.uid(), recorded_at = now();
  IF a.status <> 'in_progress' THEN
    UPDATE public.agms SET quorum_snapshot = public._agm_quorum(a) || jsonb_build_object('corrected', true) WHERE id = _agm;
  END IF;
  PERFORM public._agm_audit(a, CASE WHEN a.status = 'in_progress' THEN 'attendance' ELSE 'attendance_corrected' END,
    jsonb_build_object('user', _user, 'present', coalesce(_present,false), 'reason', nullif(btrim(coalesce(_reason,'')),'')));
END $$;

CREATE OR REPLACE FUNCTION public.agm_resolution_add(_agm uuid, _agenda_item uuid, _title text, _body text, _poll uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); a public.agms; rid uuid;
BEGIN
  SELECT * INTO a FROM public.agms WHERE id = _agm AND society_id = sid FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF a.status IN ('minutes_published','archived') THEN RAISE EXCEPTION 'agm_locked' USING ERRCODE='22023'; END IF;
  IF char_length(btrim(coalesce(_title,''))) < 3 OR char_length(btrim(coalesce(_body,''))) < 5 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  IF _agenda_item IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.agm_agenda_items WHERE id = _agenda_item AND agm_id = _agm) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF _poll IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.polls WHERE id = _poll AND society_id = sid AND kind = 'vote') THEN RAISE EXCEPTION 'invalid_vote' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('agm_write', auth.uid()::text, 200, interval '1 hour');
  INSERT INTO public.agm_resolutions (agm_id, society_id, agenda_item_id, seq, title, body, poll_id, created_by)
  VALUES (_agm, sid, _agenda_item, coalesce((SELECT max(seq) FROM public.agm_resolutions WHERE agm_id = _agm),0) + 1, btrim(_title), btrim(_body), _poll, auth.uid()) RETURNING id INTO rid;
  PERFORM public._agm_audit(a, 'resolution_proposed', jsonb_build_object('resolution', rid));
  RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION public.agm_resolution_decide(_resolution uuid, _status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); r public.agm_resolutions; a public.agms; pst text;
BEGIN
  SELECT * INTO r FROM public.agm_resolutions WHERE id = _resolution AND society_id = sid FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO a FROM public.agms WHERE id = r.agm_id;
  IF _status NOT IN ('passed','rejected','deferred','withdrawn') THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  IF a.status IN ('minutes_published','archived') THEN RAISE EXCEPTION 'agm_locked' USING ERRCODE='22023'; END IF;
  IF a.status NOT IN ('in_progress','completed','minutes_pending') AND _status <> 'withdrawn' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF r.poll_id IS NOT NULL AND _status IN ('passed','rejected') THEN
    SELECT status INTO pst FROM public.polls WHERE id = r.poll_id;
    IF pst IS DISTINCT FROM 'closed' THEN RAISE EXCEPTION 'vote_not_closed' USING ERRCODE='22023'; END IF;
  END IF;
  UPDATE public.agm_resolutions SET status = _status, decided_at = now() WHERE id = _resolution;
  PERFORM public._agm_audit(a, 'resolution_' || _status, jsonb_build_object('resolution', r.id));
END $$;

CREATE OR REPLACE FUNCTION public.agm_minutes_save(_agm uuid, _body text, _correction_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); a public.agms; d public.agm_minutes_versions; vid uuid; has_pub boolean;
BEGIN
  SELECT * INTO a FROM public.agms WHERE id = _agm AND society_id = sid FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF a.status NOT IN ('completed','minutes_pending','minutes_published') THEN RAISE EXCEPTION 'minutes_locked' USING ERRCODE='22023'; END IF;
  IF char_length(btrim(coalesce(_body,''))) < 10 THEN RAISE EXCEPTION 'minutes_required' USING ERRCODE='22023'; END IF;
  has_pub := EXISTS (SELECT 1 FROM public.agm_minutes_versions WHERE agm_id = _agm AND status = 'published');
  IF has_pub AND char_length(btrim(coalesce(_correction_reason,''))) < 10 THEN RAISE EXCEPTION 'correction_required' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('agm_write', auth.uid()::text, 200, interval '1 hour');
  SELECT * INTO d FROM public.agm_minutes_versions WHERE agm_id = _agm AND status = 'draft' FOR UPDATE;
  IF d.id IS NOT NULL THEN
    UPDATE public.agm_minutes_versions SET body = btrim(_body), correction_reason = coalesce(nullif(btrim(coalesce(_correction_reason,'')),''), correction_reason) WHERE id = d.id RETURNING id INTO vid;
  ELSE
    INSERT INTO public.agm_minutes_versions (agm_id, society_id, version, body, correction_reason, created_by)
    VALUES (_agm, sid, coalesce((SELECT max(version) FROM public.agm_minutes_versions WHERE agm_id = _agm),0) + 1, btrim(_body), nullif(btrim(coalesce(_correction_reason,'')),''), auth.uid())
    RETURNING id INTO vid;
  END IF;
  PERFORM public._agm_audit(a, CASE WHEN has_pub THEN 'minutes_correction_drafted' ELSE 'minutes_drafted' END, jsonb_build_object('version_id', vid));
  RETURN vid;
END $$;

REVOKE ALL ON FUNCTION public._gov_active_owner(uuid,uuid), public._election_audit(public.elections,text,jsonb),
  public._election_eligible_users(uuid), public._election_eligible_count(public.elections), public._election_notify(public.elections,text,text,text,boolean),
  public._election_tally(public.elections), public.election_reminders(), public._agm_audit(public.agms,text,jsonb), public._agm_quorum(public.agms) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._gov_active_resident(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._gov_active_resident(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.election_save(uuid,text,text,text,text,boolean,timestamptz,timestamptz,timestamptz,timestamptz,uuid,uuid),
  public.election_post_save(uuid,uuid,text,int,text,text,text), public.election_post_remove(uuid), public.election_set_status(uuid,text,text),
  public.election_nominate(uuid,text), public.election_review_nomination(uuid,boolean,text), public.election_withdraw_nomination(uuid),
  public.election_cast_ballot(uuid,uuid[],uuid), public.election_my_state(uuid), public.election_results(uuid),
  public.agm_quorum(uuid), public.agm_save(uuid,text,text,timestamptz,text,text,text,text,text,numeric), public.agm_agenda_save(uuid,uuid,text,text,text,uuid,uuid,uuid),
  public.agm_agenda_move(uuid,int), public.agm_agenda_remove(uuid), public.agm_set_status(uuid,text,text), public.agm_record_attendance(uuid,uuid,boolean,text),
  public.agm_resolution_add(uuid,uuid,text,text,uuid), public.agm_resolution_decide(uuid,text), public.agm_minutes_save(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.election_save(uuid,text,text,text,text,boolean,timestamptz,timestamptz,timestamptz,timestamptz,uuid,uuid),
  public.election_post_save(uuid,uuid,text,int,text,text,text), public.election_post_remove(uuid), public.election_set_status(uuid,text,text),
  public.election_nominate(uuid,text), public.election_review_nomination(uuid,boolean,text), public.election_withdraw_nomination(uuid),
  public.election_cast_ballot(uuid,uuid[],uuid), public.election_my_state(uuid), public.election_results(uuid),
  public.agm_quorum(uuid), public.agm_save(uuid,text,text,timestamptz,text,text,text,text,text,numeric), public.agm_agenda_save(uuid,uuid,text,text,text,uuid,uuid,uuid),
  public.agm_agenda_move(uuid,int), public.agm_agenda_remove(uuid), public.agm_set_status(uuid,text,text), public.agm_record_attendance(uuid,uuid,boolean,text),
  public.agm_resolution_add(uuid,uuid,text,text,uuid), public.agm_resolution_decide(uuid,text), public.agm_minutes_save(uuid,text,text) TO authenticated;

SELECT cron.schedule('election-reminders-hourly', '25 * * * *', 'SELECT public.election_reminders();');
