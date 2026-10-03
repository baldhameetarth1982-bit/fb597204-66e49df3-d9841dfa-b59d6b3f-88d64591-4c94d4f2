CREATE TABLE public.community_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  description text CHECK (description IS NULL OR char_length(description) <= 2000),
  venue text CHECK (venue IS NULL OR char_length(venue) <= 120),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  capacity int CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 5000),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled')),
  cancel_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX community_events_society ON public.community_events(society_id, starts_at DESC);
CREATE TABLE public.community_event_rsvps (
  event_id uuid NOT NULL REFERENCES public.community_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('going','waitlist')),
  guests int NOT NULL DEFAULT 0 CHECK (guests BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
GRANT SELECT ON public.community_events, public.community_event_rsvps TO authenticated;
GRANT ALL ON public.community_events, public.community_event_rsvps TO service_role;
ALTER TABLE public.community_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_event_rsvps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read events" ON public.community_events FOR SELECT TO authenticated
  USING (society_id = public._community_member_society() OR public.current_user_has_society_permission(society_id,'society.settings',NULL));
CREATE POLICY "Own rsvps or committee" ON public.community_event_rsvps FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.community_events e WHERE e.id=event_id AND public.current_user_has_society_permission(e.society_id,'society.settings',NULL)));

CREATE OR REPLACE FUNCTION public.event_counts(_event_ids uuid[])
RETURNS TABLE(event_id uuid, going int, waitlist int) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT r.event_id, count(*) FILTER (WHERE r.status='going')::int, count(*) FILTER (WHERE r.status='waitlist')::int
  FROM community_event_rsvps r JOIN community_events e ON e.id=r.event_id
  WHERE r.event_id = ANY(_event_ids)
    AND (e.society_id = _community_member_society() OR current_user_has_society_permission(e.society_id,'society.settings',NULL))
  GROUP BY r.event_id $$;

CREATE OR REPLACE FUNCTION public.admin_create_event(_society_id uuid, _title text, _description text, _venue text, _starts_at timestamptz, _ends_at timestamptz, _capacity int)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _id uuid;
BEGIN
  IF NOT current_user_has_society_permission(_society_id,'society.settings',NULL) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  IF _starts_at < now() THEN RAISE EXCEPTION 'Event must start in the future'; END IF;
  INSERT INTO community_events(society_id,title,description,venue,starts_at,ends_at,capacity,created_by)
  VALUES (_society_id, trim(_title), NULLIF(trim(_description),''), NULLIF(trim(_venue),''), _starts_at, _ends_at, _capacity, auth.uid()) RETURNING id INTO _id;
  INSERT INTO audit_log(actor_id,action,target_table,target_id,society_id) VALUES (auth.uid(),'event.create','community_events',_id::text,_society_id);
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_cancel_event(_event_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _e community_events;
BEGIN
  SELECT * INTO _e FROM community_events WHERE id=_event_id FOR UPDATE;
  IF NOT FOUND OR NOT current_user_has_society_permission(_e.society_id,'society.settings',NULL) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  IF _e.status='cancelled' THEN RETURN; END IF;
  IF char_length(trim(coalesce(_reason,''))) < 3 THEN RAISE EXCEPTION 'A reason is required'; END IF;
  UPDATE community_events SET status='cancelled', cancel_reason=trim(_reason) WHERE id=_event_id;
  INSERT INTO audit_log(actor_id,action,target_table,target_id,society_id,metadata) VALUES (auth.uid(),'event.cancel','community_events',_event_id::text,_e.society_id,jsonb_build_object('reason',trim(_reason)));
END $$;

CREATE OR REPLACE FUNCTION public.event_rsvp(_event_id uuid, _going boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _e community_events; _n int; _promote uuid;
BEGIN
  SELECT * INTO _e FROM community_events WHERE id=_event_id FOR UPDATE;
  IF NOT FOUND OR _e.society_id IS DISTINCT FROM _community_member_society() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  IF _e.status<>'scheduled' OR _e.starts_at < now() THEN RAISE EXCEPTION 'RSVPs are closed for this event'; END IF;
  IF NOT _going THEN
    DELETE FROM community_event_rsvps WHERE event_id=_event_id AND user_id=auth.uid();
    IF _e.capacity IS NOT NULL THEN
      SELECT count(*) INTO _n FROM community_event_rsvps WHERE event_id=_event_id AND status='going';
      IF _n < _e.capacity THEN
        SELECT user_id INTO _promote FROM community_event_rsvps WHERE event_id=_event_id AND status='waitlist' ORDER BY created_at LIMIT 1;
        IF _promote IS NOT NULL THEN
          UPDATE community_event_rsvps SET status='going' WHERE event_id=_event_id AND user_id=_promote;
          PERFORM _notify_user(_promote, _e.society_id, 'event', 'You''re in: '||_e.title, 'A place opened up and you moved off the waitlist.', '/app/events');
        END IF;
      END IF;
    END IF;
    RETURN 'none';
  END IF;
  IF EXISTS (SELECT 1 FROM community_event_rsvps WHERE event_id=_event_id AND user_id=auth.uid()) THEN
    RETURN (SELECT status FROM community_event_rsvps WHERE event_id=_event_id AND user_id=auth.uid());
  END IF;
  SELECT count(*) INTO _n FROM community_event_rsvps WHERE event_id=_event_id AND status='going';
  INSERT INTO community_event_rsvps(event_id,user_id,status) VALUES (_event_id, auth.uid(), CASE WHEN _e.capacity IS NULL OR _n < _e.capacity THEN 'going' ELSE 'waitlist' END);
  RETURN (SELECT status FROM community_event_rsvps WHERE event_id=_event_id AND user_id=auth.uid());
END $$;

REVOKE ALL ON FUNCTION public.event_counts(uuid[]), public.admin_create_event(uuid,text,text,text,timestamptz,timestamptz,int), public.admin_cancel_event(uuid,text), public.event_rsvp(uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_counts(uuid[]), public.admin_create_event(uuid,text,text,text,timestamptz,timestamptz,int), public.admin_cancel_event(uuid,text), public.event_rsvp(uuid,boolean) TO authenticated;