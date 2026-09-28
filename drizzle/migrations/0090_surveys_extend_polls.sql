ALTER TABLE public.polls ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'poll';
ALTER TABLE public.polls ADD CONSTRAINT polls_kind_check CHECK (kind IN ('poll','survey'));

CREATE OR REPLACE FUNCTION public._can_manage_polls(_society_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND public.current_user_has_society_permission(_society_id, 'polls.manage'::text, NULL::uuid)
$$;

CREATE TABLE public.survey_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  society_id uuid NOT NULL,
  position int NOT NULL,
  prompt text NOT NULL CHECK (char_length(btrim(prompt)) BETWEEN 3 AND 300),
  qtype text NOT NULL CHECK (qtype IN ('single','multi','rating','text')),
  options jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options)='array'),
  required boolean NOT NULL DEFAULT true,
  UNIQUE (poll_id, position)
);
CREATE TABLE public.survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  society_id uuid NOT NULL,
  user_id uuid NOT NULL,
  answers jsonb NOT NULL CHECK (jsonb_typeof(answers)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (poll_id, user_id)
);
CREATE INDEX survey_questions_poll_idx ON public.survey_questions(poll_id);
CREATE INDEX survey_responses_poll_idx ON public.survey_responses(poll_id);

GRANT SELECT ON public.survey_questions TO authenticated;
GRANT SELECT ON public.survey_responses TO authenticated;
GRANT ALL ON public.survey_questions, public.survey_responses TO service_role;
ALTER TABLE public.survey_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read survey questions" ON public.survey_questions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.polls p WHERE p.id = poll_id AND p.society_id = survey_questions.society_id
  AND ((p.status <> 'draft' AND p.society_id = public.get_user_society_id(auth.uid())) OR public._can_manage_polls(p.society_id))));
CREATE POLICY "users read own survey response" ON public.survey_responses FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "draft surveys admin only" ON public.polls AS RESTRICTIVE FOR SELECT TO authenticated
USING (kind = 'poll' OR status <> 'draft' OR public._can_manage_polls(society_id));

CREATE OR REPLACE FUNCTION public._survey_notify(_poll_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE p record; u uuid;
BEGIN
  SELECT id, society_id, title INTO p FROM public.polls WHERE id=_poll_id;
  FOR u IN SELECT pr.id FROM public.profiles pr WHERE pr.society_id = p.society_id LOOP
    PERFORM public._notify_user(u, p.society_id, 'survey', 'New survey', left(p.title, 140), '/app/surveys');
  END LOOP;
END $fn$;

CREATE OR REPLACE FUNCTION public.admin_create_survey(_society_id uuid, _title text, _description text, _closes_at timestamptz, _questions jsonb, _publish boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_uid uuid := auth.uid(); v_id uuid; q jsonb; i int := 0; v_opts jsonb; v_type text;
BEGIN
  IF NOT public._can_manage_polls(_society_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  PERFORM public._rate_hit('survey_create', v_uid::text, 20, interval '1 hour');
  IF char_length(btrim(coalesce(_title,''))) NOT BETWEEN 3 AND 150 OR char_length(coalesce(_description,'')) > 1000 THEN
    RAISE EXCEPTION 'invalid_survey' USING ERRCODE='22023'; END IF;
  IF _closes_at IS NOT NULL AND _closes_at <= now() THEN RAISE EXCEPTION 'invalid_close_date' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(_questions) <> 'array' OR jsonb_array_length(_questions) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'invalid_questions' USING ERRCODE='22023'; END IF;

  INSERT INTO public.polls(society_id, title, description, status, closes_at, created_by, kind)
  VALUES (_society_id, btrim(_title), nullif(btrim(coalesce(_description,'')),''), CASE WHEN _publish THEN 'open' ELSE 'draft' END, _closes_at, v_uid, 'survey')
  RETURNING id INTO v_id;

  FOR q IN SELECT * FROM jsonb_array_elements(_questions) LOOP
    v_type := q->>'qtype';
    IF v_type IS NULL OR v_type NOT IN ('single','multi','rating','text') THEN RAISE EXCEPTION 'invalid_questions' USING ERRCODE='22023'; END IF;
    v_opts := CASE WHEN v_type IN ('single','multi') THEN coalesce(q->'options','[]'::jsonb) ELSE '[]'::jsonb END;
    IF v_type IN ('single','multi') AND (jsonb_typeof(v_opts) <> 'array' OR jsonb_array_length(v_opts) NOT BETWEEN 2 AND 10
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_opts) o WHERE jsonb_typeof(o) <> 'string' OR char_length(btrim(o #>> '{}')) NOT BETWEEN 1 AND 120)) THEN
      RAISE EXCEPTION 'invalid_questions' USING ERRCODE='22023'; END IF;
    INSERT INTO public.survey_questions(poll_id, society_id, position, prompt, qtype, options, required)
    VALUES (v_id, _society_id, i, btrim(coalesce(q->>'prompt','')), v_type, v_opts, coalesce((q->>'required')::boolean, true));
    i := i + 1;
  END LOOP;

  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (v_uid, 'survey.created', 'polls', v_id::text, _society_id, jsonb_build_object('questions', i, 'published', _publish));
  IF _publish THEN PERFORM public._survey_notify(v_id); END IF;
  RETURN v_id;
END $fn$;

CREATE OR REPLACE FUNCTION public.admin_set_survey_status(_poll_id uuid, _status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_uid uuid := auth.uid(); p record;
BEGIN
  SELECT id, society_id, status, kind INTO p FROM public.polls WHERE id=_poll_id FOR UPDATE;
  IF NOT FOUND OR p.kind <> 'survey' OR NOT public._can_manage_polls(p.society_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF NOT ((p.status='draft' AND _status='open') OR (p.status='open' AND _status='closed')) THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  UPDATE public.polls SET status=_status WHERE id=_poll_id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (v_uid, 'survey.'||_status, 'polls', _poll_id::text, p.society_id, jsonb_build_object('from', p.status));
  IF _status='open' THEN PERFORM public._survey_notify(_poll_id); END IF;
END $fn$;

CREATE OR REPLACE FUNCTION public.submit_survey_response(_poll_id uuid, _answers jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_uid uuid := auth.uid(); p record; q record; a jsonb; v_clean jsonb := '{}'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  SELECT id, society_id, status, kind, closes_at INTO p FROM public.polls WHERE id=_poll_id;
  IF NOT FOUND OR p.kind <> 'survey' OR p.society_id IS DISTINCT FROM public.get_user_society_id(v_uid) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF p.status <> 'open' OR (p.closes_at IS NOT NULL AND p.closes_at <= now()) THEN RAISE EXCEPTION 'survey_closed' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(_answers) <> 'object' THEN RAISE EXCEPTION 'invalid_answers' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('survey_submit', v_uid::text, 30, interval '1 hour');
  FOR q IN SELECT id, qtype, options, required FROM public.survey_questions WHERE poll_id=_poll_id LOOP
    a := _answers->(q.id::text);
    IF a IS NULL OR a = 'null'::jsonb OR a = '""'::jsonb OR a = '[]'::jsonb THEN
      IF q.required THEN RAISE EXCEPTION 'answer_required' USING ERRCODE='22023'; END IF;
      CONTINUE;
    END IF;
    IF q.qtype='single' AND NOT (jsonb_typeof(a)='number' AND a::text ~ '^\d+$' AND (a::text)::int < jsonb_array_length(q.options)) THEN
      RAISE EXCEPTION 'invalid_answers' USING ERRCODE='22023'; END IF;
    IF q.qtype='multi' AND NOT (jsonb_typeof(a)='array'
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(a) x WHERE jsonb_typeof(x) <> 'number' OR x::text !~ '^\d+$' OR (x::text)::int >= jsonb_array_length(q.options))
       AND (SELECT count(DISTINCT x) FROM jsonb_array_elements(a) x) = jsonb_array_length(a)) THEN
      RAISE EXCEPTION 'invalid_answers' USING ERRCODE='22023'; END IF;
    IF q.qtype='rating' AND NOT (jsonb_typeof(a)='number' AND a::text IN ('1','2','3','4','5')) THEN
      RAISE EXCEPTION 'invalid_answers' USING ERRCODE='22023'; END IF;
    IF q.qtype='text' AND NOT (jsonb_typeof(a)='string' AND char_length(btrim(a #>> '{}')) BETWEEN 1 AND 1000) THEN
      RAISE EXCEPTION 'invalid_answers' USING ERRCODE='22023'; END IF;
    v_clean := v_clean || jsonb_build_object(q.id::text, CASE WHEN q.qtype='text' THEN to_jsonb(btrim(a #>> '{}')) ELSE a END);
  END LOOP;
  BEGIN
    INSERT INTO public.survey_responses(poll_id, society_id, user_id, answers) VALUES (_poll_id, p.society_id, v_uid, v_clean);
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'already_responded' USING ERRCODE='22023';
  END;
END $fn$;

CREATE OR REPLACE FUNCTION public.get_survey_results(_poll_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE p record;
BEGIN
  SELECT id, society_id, kind INTO p FROM public.polls WHERE id=_poll_id;
  IF NOT FOUND OR p.kind <> 'survey' OR NOT public._can_manage_polls(p.society_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object(
    'responses', (SELECT count(*) FROM public.survey_responses WHERE poll_id=_poll_id),
    'questions', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', q.id, 'prompt', q.prompt, 'qtype', q.qtype, 'options', q.options,
        'answered', (SELECT count(*) FROM public.survey_responses r WHERE r.poll_id=_poll_id AND r.answers ? q.id::text),
        'counts', CASE WHEN q.qtype IN ('single','multi','rating') THEN (
            SELECT coalesce(jsonb_object_agg(k, c), '{}'::jsonb) FROM (
              SELECT v #>> '{}' AS k, count(*) c FROM public.survey_responses r,
                LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.answers->q.id::text)='array' THEN r.answers->q.id::text ELSE jsonb_build_array(r.answers->q.id::text) END) v
              WHERE r.poll_id=_poll_id AND r.answers ? q.id::text GROUP BY 1) s) ELSE NULL END,
        'texts', CASE WHEN q.qtype='text' THEN (
            SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM (
              SELECT r.answers->>q.id::text t FROM public.survey_responses r WHERE r.poll_id=_poll_id AND r.answers ? q.id::text ORDER BY md5(r.id::text) LIMIT 500) s) ELSE NULL END
      ) ORDER BY q.position), '[]'::jsonb) FROM public.survey_questions q WHERE q.poll_id=_poll_id)
  );
END $fn$;

REVOKE ALL ON FUNCTION public._survey_notify(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._can_manage_polls(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._can_manage_polls(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_create_survey(uuid,text,text,timestamptz,jsonb,boolean), public.admin_set_survey_status(uuid,text), public.submit_survey_response(uuid,jsonb), public.get_survey_results(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_survey(uuid,text,text,timestamptz,jsonb,boolean), public.admin_set_survey_status(uuid,text), public.submit_survey_response(uuid,jsonb), public.get_survey_results(uuid) TO authenticated;