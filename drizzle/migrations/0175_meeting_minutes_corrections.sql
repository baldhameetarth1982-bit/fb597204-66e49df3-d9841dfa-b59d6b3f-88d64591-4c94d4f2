CREATE TABLE public.meeting_minutes_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE RESTRICT,
  society_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 10 AND 5000),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 500),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meeting_minutes_corrections_meeting_idx ON public.meeting_minutes_corrections(meeting_id, created_at);
GRANT SELECT ON public.meeting_minutes_corrections TO authenticated;
GRANT ALL ON public.meeting_minutes_corrections TO service_role;
ALTER TABLE public.meeting_minutes_corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "minutes corrections visible" ON public.meeting_minutes_corrections FOR SELECT TO authenticated USING (public._meeting_visible(meeting_id));

CREATE OR REPLACE FUNCTION public.meeting_add_minutes_correction(_id uuid, _body text, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); m public.meetings; cid uuid;
BEGIN
  SELECT * INTO m FROM public.meetings WHERE id = _id AND society_id = sid FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF m.status <> 'minutes_published' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF char_length(btrim(coalesce(_body,''))) NOT BETWEEN 10 AND 5000 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  IF char_length(btrim(coalesce(_reason,''))) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'correction_required' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('meeting_write', auth.uid()::text, 60, interval '1 hour');
  INSERT INTO public.meeting_minutes_corrections (meeting_id, society_id, body, reason, created_by)
  VALUES (_id, sid, btrim(_body), btrim(_reason), auth.uid()) RETURNING id INTO cid;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'meeting.minutes_corrected', 'meeting_minutes_corrections', cid::text, sid, jsonb_build_object('meeting', _id));
  RETURN cid;
END $$;
REVOKE ALL ON FUNCTION public.meeting_add_minutes_correction(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meeting_add_minutes_correction(uuid,text,text) TO authenticated;