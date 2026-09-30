-- ===================== helpers =====================
CREATE OR REPLACE FUNCTION public._gov_admin_society()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid;
BEGIN
  SELECT society_id INTO _soc FROM public.profiles WHERE id = auth.uid();
  IF auth.uid() IS NULL OR _soc IS NULL OR NOT public.is_society_admin_for(auth.uid(), _soc) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  RETURN _soc;
END $$;

CREATE OR REPLACE FUNCTION public._gov_member_society()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid;
BEGIN
  SELECT society_id INTO _soc FROM public.profiles WHERE id = auth.uid();
  IF auth.uid() IS NULL OR _soc IS NULL OR NOT (public._authorize_membership_internal(auth.uid(), _soc) OR public.is_society_admin_for(auth.uid(), _soc)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  RETURN _soc;
END $$;

-- ===================== 1. NOTICES =====================
ALTER TABLE public.notices
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS requires_ack boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS notified_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.notices ADD CONSTRAINT notices_priority_chk CHECK (priority IN ('normal','high','urgent'));

CREATE TABLE public.notice_acks (
  notice_id uuid NOT NULL REFERENCES public.notices(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  acked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notice_id, user_id)
);
GRANT SELECT ON public.notice_acks TO authenticated;
GRANT ALL ON public.notice_acks TO service_role;
ALTER TABLE public.notice_acks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own acks select" ON public.notice_acks FOR SELECT TO authenticated USING (user_id = auth.uid());

-- expired notices leave the resident feed
CREATE OR REPLACE FUNCTION public._notice_visible(_n notices)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _n.status = 'published' AND coalesce(_n.publish_at, _n.published_at) <= now()
    AND (_n.expires_at IS NULL OR _n.expires_at > now())
    AND EXISTS (
      SELECT 1 FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
      WHERE fr.user_id = auth.uid() AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL
        AND (fr.access_expires_at IS NULL OR fr.access_expires_at > now())
        AND f.society_id = _n.society_id
        AND (_n.audience = 'all' OR f.block_id = _n.block_id))
$$;

CREATE OR REPLACE FUNCTION public._notice_audience(_n notices)
RETURNS TABLE(user_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT fr.user_id FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
  WHERE fr.user_id IS NOT NULL AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL
    AND (fr.access_expires_at IS NULL OR fr.access_expires_at > now())
    AND f.society_id = _n.society_id AND (_n.audience = 'all' OR f.block_id = _n.block_id)
$$;
REVOKE ALL ON FUNCTION public._notice_audience(notices) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notice_set_controls(_id uuid, _priority text, _expires_at timestamptz, _requires_ack boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._notice_admin_society(); cur public.notices;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF coalesce(_priority,'normal') NOT IN ('normal','high','urgent') THEN RAISE EXCEPTION 'invalid_priority' USING ERRCODE='22023'; END IF;
  SELECT * INTO cur FROM public.notices WHERE id = _id AND society_id = sid FOR UPDATE;
  IF cur.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF cur.status = 'archived' THEN RAISE EXCEPTION 'notice_archived' USING ERRCODE='22023'; END IF;
  IF _expires_at IS NOT NULL AND (_expires_at <= greatest(now(), coalesce(cur.publish_at, cur.published_at, now())) OR _expires_at > now() + interval '366 days') THEN
    RAISE EXCEPTION 'invalid_expiry' USING ERRCODE='22023'; END IF;
  -- once people may have acknowledged, the requirement can't be silently dropped
  IF cur.requires_ack AND NOT coalesce(_requires_ack,false) AND EXISTS (SELECT 1 FROM public.notice_acks WHERE notice_id = _id) THEN
    RAISE EXCEPTION 'ack_locked' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('notice_save', auth.uid()::text, 30, interval '1 hour');
  UPDATE public.notices SET priority = coalesce(_priority,'normal'), expires_at = _expires_at, requires_ack = coalesce(_requires_ack,false), updated_at = now() WHERE id = _id;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'notice.controls_set', 'notices', _id::text, sid, jsonb_build_object('priority', coalesce(_priority,'normal'), 'expires_at', _expires_at, 'requires_ack', coalesce(_requires_ack,false)));
END $$;

CREATE OR REPLACE FUNCTION public.notice_acknowledge(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n public.notices;
BEGIN
  SELECT * INTO n FROM public.notices WHERE id = _id;
  IF auth.uid() IS NULL OR n.id IS NULL OR NOT public._notice_visible(n) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF NOT n.requires_ack THEN RAISE EXCEPTION 'ack_not_required' USING ERRCODE='22023'; END IF;
  INSERT INTO public.notice_acks (notice_id, user_id) VALUES (_id, auth.uid()) ON CONFLICT DO NOTHING;
  INSERT INTO public.notice_reads (notice_id, user_id) VALUES (_id, auth.uid()) ON CONFLICT DO NOTHING;
END $$;

-- truthful counts: audience, notified (in-app record exists), opened (read record), acknowledged. No "delivered" claim.
CREATE OR REPLACE FUNCTION public.notice_delivery_stats(_ids uuid[])
RETURNS TABLE(notice_id uuid, audience bigint, notified bigint, opened bigint, acknowledged bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT n.id,
    (SELECT count(*) FROM public._notice_audience(n)),
    n.notified_count::bigint,
    (SELECT count(*) FROM public.notice_reads r WHERE r.notice_id = n.id),
    (SELECT count(*) FROM public.notice_acks a WHERE a.notice_id = n.id)
  FROM public.notices n
  WHERE n.id = ANY(_ids) AND n.society_id = public._notice_admin_society()
$$;

-- scheduler: notify once when a notice goes live (idempotent claim via notified_at)
CREATE OR REPLACE FUNCTION public.publish_due_notices()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n public.notices; u uuid; c int; total int := 0;
BEGIN
  FOR n IN
    UPDATE public.notices SET notified_at = now()
    WHERE id IN (SELECT id FROM public.notices WHERE status = 'published' AND notified_at IS NULL
                   AND coalesce(publish_at, published_at) <= now() AND coalesce(publish_at, published_at) > now() - interval '7 days'
                   AND (expires_at IS NULL OR expires_at > now()) LIMIT 200 FOR UPDATE SKIP LOCKED)
    RETURNING *
  LOOP
    c := 0;
    FOR u IN SELECT a.user_id FROM public._notice_audience(n) a LOOP
      PERFORM public._notify_user(u, n.society_id, 'notice',
        CASE WHEN n.priority = 'urgent' OR n.category = 'emergency' THEN 'Urgent notice: ' ELSE 'New notice: ' END || left(n.title, 100),
        CASE WHEN n.requires_ack THEN 'Please read and acknowledge.' ELSE left(n.body, 140) END, '/app/notices');
      c := c + 1;
    END LOOP;
    UPDATE public.notices SET notified_count = c WHERE id = n.id;
    total := total + 1;
  END LOOP;
  RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.publish_due_notices() FROM PUBLIC, anon, authenticated;
-- existing notices published before this change are not retro-notified
UPDATE public.notices SET notified_at = coalesce(published_at, created_at) WHERE notified_at IS NULL AND status <> 'draft';

-- ===================== 2. MEETINGS =====================
CREATE TABLE public.meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 140),
  agenda text NOT NULL DEFAULT '' CHECK (char_length(agenda) <= 5000),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  location text CHECK (location IS NULL OR char_length(location) <= 200),
  meeting_link text CHECK (meeting_link IS NULL OR (char_length(meeting_link) <= 500 AND meeting_link ~ '^https://')),
  audience text NOT NULL DEFAULT 'all' CHECK (audience IN ('all','committee')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','held','minutes_published','cancelled')),
  minutes text CHECK (minutes IS NULL OR char_length(minutes) <= 20000),
  cancel_reason text,
  reminded_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX meetings_society_idx ON public.meetings(society_id, starts_at DESC);

CREATE TABLE public.meeting_rsvps (
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  response text NOT NULL CHECK (response IN ('yes','no','maybe')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, user_id)
);
CREATE TABLE public.meeting_attendance (
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  present boolean NOT NULL,
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, user_id)
);
CREATE TABLE public.meeting_action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  society_id uuid NOT NULL,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 200),
  owner_name text CHECK (owner_name IS NULL OR char_length(owner_name) <= 120),
  due_on date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dropped')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.meeting_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  society_id uuid NOT NULL,
  seq integer NOT NULL,
  text text NOT NULL CHECK (char_length(btrim(text)) BETWEEN 5 AND 2000),
  outcome text NOT NULL CHECK (outcome IN ('passed','rejected','deferred')),
  poll_id uuid REFERENCES public.polls(id),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, seq)
);
CREATE TABLE public.meeting_documents (
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.society_knowledge_sources(id) ON DELETE CASCADE,
  added_by uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, source_id)
);

GRANT SELECT ON public.meetings, public.meeting_rsvps, public.meeting_attendance, public.meeting_action_items, public.meeting_resolutions, public.meeting_documents TO authenticated;
GRANT ALL ON public.meetings, public.meeting_rsvps, public.meeting_attendance, public.meeting_action_items, public.meeting_resolutions, public.meeting_documents TO service_role;
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_rsvps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_action_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_documents ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._meeting_visible(_meeting uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = _meeting AND auth.uid() IS NOT NULL AND (
    public.is_society_admin_for(auth.uid(), m.society_id)
    OR (m.status <> 'draft' AND m.audience = 'all' AND public._authorize_membership_internal(auth.uid(), m.society_id))))
$$;
CREATE OR REPLACE FUNCTION public._meeting_is_admin(_meeting uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = _meeting AND public.is_society_admin_for(auth.uid(), m.society_id))
$$;

CREATE POLICY "meetings visible" ON public.meetings FOR SELECT TO authenticated USING (public._meeting_visible(id));
CREATE POLICY "rsvps own or admin" ON public.meeting_rsvps FOR SELECT TO authenticated USING (user_id = auth.uid() OR public._meeting_is_admin(meeting_id));
CREATE POLICY "attendance own or admin" ON public.meeting_attendance FOR SELECT TO authenticated USING (user_id = auth.uid() OR public._meeting_is_admin(meeting_id));
CREATE POLICY "actions visible" ON public.meeting_action_items FOR SELECT TO authenticated USING (public._meeting_visible(meeting_id));
CREATE POLICY "resolutions visible" ON public.meeting_resolutions FOR SELECT TO authenticated USING (public._meeting_visible(meeting_id));
CREATE POLICY "docs visible" ON public.meeting_documents FOR SELECT TO authenticated USING (public._meeting_visible(meeting_id));

CREATE OR REPLACE FUNCTION public._meeting_audience(_m meetings)
RETURNS TABLE(user_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT fr.user_id FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
  WHERE _m.audience = 'all' AND fr.user_id IS NOT NULL AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL
    AND (fr.access_expires_at IS NULL OR fr.access_expires_at > now()) AND f.society_id = _m.society_id
$$;
REVOKE ALL ON FUNCTION public._meeting_audience(meetings) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.meeting_save(_id uuid, _title text, _agenda text, _starts_at timestamptz, _ends_at timestamptz, _location text, _link text, _audience text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); cur public.meetings; mid uuid;
BEGIN
  _title := btrim(coalesce(_title,'')); _agenda := btrim(coalesce(_agenda,''));
  _location := nullif(btrim(coalesce(_location,'')),''); _link := nullif(btrim(coalesce(_link,'')),'');
  IF char_length(_title) NOT BETWEEN 3 AND 140 THEN RAISE EXCEPTION 'invalid_title' USING ERRCODE='22023'; END IF;
  IF _starts_at IS NULL OR _starts_at > now() + interval '366 days' THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE='22023'; END IF;
  IF _location IS NULL AND _link IS NULL THEN RAISE EXCEPTION 'place_required' USING ERRCODE='22023'; END IF;
  IF _link IS NOT NULL AND _link !~ '^https://' THEN RAISE EXCEPTION 'invalid_link' USING ERRCODE='22023'; END IF;
  IF coalesce(_audience,'all') NOT IN ('all','committee') THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('meeting_write', auth.uid()::text, 60, interval '1 hour');
  IF _id IS NULL THEN
    IF _starts_at < now() THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE='22023'; END IF;
    INSERT INTO public.meetings (society_id, title, agenda, starts_at, ends_at, location, meeting_link, audience, created_by)
    VALUES (sid, _title, _agenda, _starts_at, _ends_at, _location, _link, coalesce(_audience,'all'), auth.uid()) RETURNING id INTO mid;
  ELSE
    SELECT * INTO cur FROM public.meetings WHERE id = _id AND society_id = sid FOR UPDATE;
    IF cur.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
    IF cur.status NOT IN ('draft','scheduled') THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
    UPDATE public.meetings SET title=_title, agenda=_agenda, starts_at=_starts_at, ends_at=_ends_at, location=_location, meeting_link=_link,
      audience=coalesce(_audience,'all'), reminded_at = CASE WHEN _starts_at <> cur.starts_at THEN NULL ELSE reminded_at END, updated_at=now()
    WHERE id = _id RETURNING id INTO mid;
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), CASE WHEN _id IS NULL THEN 'meeting.created' ELSE 'meeting.edited' END, 'meetings', mid::text, sid, jsonb_build_object('starts_at', _starts_at, 'audience', coalesce(_audience,'all')));
  RETURN mid;
END $$;

CREATE OR REPLACE FUNCTION public.meeting_set_status(_id uuid, _status text, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); cur public.meetings; u uuid;
BEGIN
  SELECT * INTO cur FROM public.meetings WHERE id = _id AND society_id = sid FOR UPDATE;
  IF cur.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF NOT ((cur.status = 'draft' AND _status IN ('scheduled','cancelled'))
       OR (cur.status = 'scheduled' AND _status IN ('held','cancelled'))
       OR (cur.status = 'held' AND _status = 'minutes_published')) THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF _status = 'scheduled' AND cur.starts_at < now() THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE='22023'; END IF;
  IF _status = 'held' AND cur.starts_at > now() THEN RAISE EXCEPTION 'not_started' USING ERRCODE='22023'; END IF;
  IF _status = 'cancelled' AND char_length(btrim(coalesce(_reason,''))) < 5 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  IF _status = 'minutes_published' AND char_length(btrim(coalesce(cur.minutes,''))) < 10 THEN RAISE EXCEPTION 'minutes_required' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('meeting_write', auth.uid()::text, 60, interval '1 hour');
  UPDATE public.meetings SET status = _status, cancel_reason = CASE WHEN _status='cancelled' THEN btrim(_reason) ELSE cancel_reason END, updated_at = now() WHERE id = _id;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'meeting.' || _status, 'meetings', _id::text, sid, jsonb_build_object('from', cur.status, 'reason', nullif(btrim(coalesce(_reason,'')),'')));
  IF _status IN ('scheduled','minutes_published') OR (_status = 'cancelled' AND cur.status = 'scheduled') THEN
    FOR u IN SELECT a.user_id FROM public._meeting_audience(cur) a LOOP
      PERFORM public._notify_user(u, sid, 'meeting',
        CASE _status WHEN 'scheduled' THEN 'Meeting: ' WHEN 'cancelled' THEN 'Meeting cancelled: ' ELSE 'Minutes published: ' END || left(cur.title, 100),
        to_char(cur.starts_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM'), '/app/meetings');
    END LOOP;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.meeting_rsvp(_id uuid, _response text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.meetings;
BEGIN
  SELECT * INTO m FROM public.meetings WHERE id = _id;
  IF m.id IS NULL OR NOT public._meeting_visible(_id) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF m.status <> 'scheduled' OR m.starts_at < now() THEN RAISE EXCEPTION 'rsvp_closed' USING ERRCODE='22023'; END IF;
  IF _response NOT IN ('yes','no','maybe') THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('meeting_rsvp', auth.uid()::text, 30, interval '1 hour');
  INSERT INTO public.meeting_rsvps (meeting_id, user_id, response) VALUES (_id, auth.uid(), _response)
  ON CONFLICT (meeting_id, user_id) DO UPDATE SET response = excluded.response, updated_at = now();
END $$;

CREATE OR REPLACE FUNCTION public.meeting_record_attendance(_id uuid, _user uuid, _present boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); m public.meetings;
BEGIN
  SELECT * INTO m FROM public.meetings WHERE id = _id AND society_id = sid;
  IF m.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF m.status <> 'held' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF NOT (public._authorize_membership_internal(_user, sid) OR public.is_society_admin_for(_user, sid)) THEN RAISE EXCEPTION 'not_member' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('meeting_write', auth.uid()::text, 300, interval '1 hour');
  INSERT INTO public.meeting_attendance (meeting_id, user_id, present, recorded_by) VALUES (_id, _user, coalesce(_present,false), auth.uid())
  ON CONFLICT (meeting_id, user_id) DO UPDATE SET present = excluded.present, recorded_by = auth.uid(), recorded_at = now();
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'meeting.attendance', 'meetings', _id::text, sid, jsonb_build_object('user', _user, 'present', coalesce(_present,false)));
END $$;

-- members list for the attendance sheet (committee only, names only)
CREATE OR REPLACE FUNCTION public.meeting_member_roster(_id uuid)
RETURNS TABLE(user_id uuid, full_name text, homes text, rsvp text, present boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.meetings WHERE id = _id AND society_id = sid) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  RETURN QUERY
  SELECT fr.user_id, coalesce(p.full_name,'Resident'), string_agg(DISTINCT f.flat_number::text, ', '),
    (SELECT r.response FROM public.meeting_rsvps r WHERE r.meeting_id = _id AND r.user_id = fr.user_id),
    (SELECT a.present FROM public.meeting_attendance a WHERE a.meeting_id = _id AND a.user_id = fr.user_id)
  FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id LEFT JOIN public.profiles p ON p.id = fr.user_id
  WHERE f.society_id = sid AND fr.user_id IS NOT NULL AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL
  GROUP BY fr.user_id, p.full_name ORDER BY 2 LIMIT 1000;
END $$;

CREATE OR REPLACE FUNCTION public.meeting_save_minutes(_id uuid, _minutes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); m public.meetings;
BEGIN
  SELECT * INTO m FROM public.meetings WHERE id = _id AND society_id = sid FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF m.status <> 'held' THEN RAISE EXCEPTION 'minutes_locked' USING ERRCODE='22023'; END IF;
  IF char_length(coalesce(_minutes,'')) > 20000 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('meeting_write', auth.uid()::text, 60, interval '1 hour');
  UPDATE public.meetings SET minutes = btrim(_minutes), updated_at = now() WHERE id = _id;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'meeting.minutes_saved', 'meetings', _id::text, sid, jsonb_build_object('chars', char_length(btrim(_minutes))));
END $$;

CREATE OR REPLACE FUNCTION public.meeting_add_action(_meeting uuid, _title text, _owner text, _due date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); m public.meetings; aid uuid;
BEGIN
  SELECT * INTO m FROM public.meetings WHERE id = _meeting AND society_id = sid;
  IF m.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF m.status NOT IN ('held','minutes_published') THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF char_length(btrim(coalesce(_title,''))) NOT BETWEEN 3 AND 200 THEN RAISE EXCEPTION 'invalid_title' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('meeting_write', auth.uid()::text, 60, interval '1 hour');
  INSERT INTO public.meeting_action_items (meeting_id, society_id, title, owner_name, due_on, created_by)
  VALUES (_meeting, sid, btrim(_title), nullif(btrim(coalesce(_owner,'')),''), _due, auth.uid()) RETURNING id INTO aid;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'meeting.action_added', 'meeting_action_items', aid::text, sid, jsonb_build_object('meeting', _meeting));
  RETURN aid;
END $$;

CREATE OR REPLACE FUNCTION public.meeting_set_action_status(_id uuid, _status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); a public.meeting_action_items;
BEGIN
  SELECT * INTO a FROM public.meeting_action_items WHERE id = _id AND society_id = sid FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF _status NOT IN ('open','done','dropped') THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  UPDATE public.meeting_action_items SET status = _status, updated_at = now() WHERE id = _id;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'meeting.action_status', 'meeting_action_items', _id::text, sid, jsonb_build_object('from', a.status, 'to', _status));
END $$;

-- resolutions are append-only records
CREATE OR REPLACE FUNCTION public.meeting_add_resolution(_meeting uuid, _text text, _outcome text, _poll uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); m public.meetings; rid uuid; n int;
BEGIN
  SELECT * INTO m FROM public.meetings WHERE id = _meeting AND society_id = sid FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF m.status <> 'held' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF char_length(btrim(coalesce(_text,''))) NOT BETWEEN 5 AND 2000 OR _outcome NOT IN ('passed','rejected','deferred') THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  IF _poll IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.polls WHERE id = _poll AND society_id = sid AND kind = 'vote' AND status = 'closed') THEN
    RAISE EXCEPTION 'invalid_vote' USING ERRCODE='22023'; END IF;
  SELECT coalesce(max(seq),0) + 1 INTO n FROM public.meeting_resolutions WHERE meeting_id = _meeting;
  INSERT INTO public.meeting_resolutions (meeting_id, society_id, seq, text, outcome, poll_id, created_by)
  VALUES (_meeting, sid, n, btrim(_text), _outcome, _poll, auth.uid()) RETURNING id INTO rid;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'meeting.resolution_recorded', 'meeting_resolutions', rid::text, sid, jsonb_build_object('meeting', _meeting, 'seq', n, 'outcome', _outcome));
  RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION public.meeting_link_document(_meeting uuid, _source uuid, _linked boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); m public.meetings;
BEGIN
  SELECT * INTO m FROM public.meetings WHERE id = _meeting AND society_id = sid;
  IF m.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF m.status IN ('cancelled') THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.society_knowledge_sources WHERE id = _source AND society_id = sid AND kind = 'document') THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF _linked THEN
    INSERT INTO public.meeting_documents (meeting_id, source_id, added_by) VALUES (_meeting, _source, auth.uid()) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.meeting_documents WHERE meeting_id = _meeting AND source_id = _source;
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), CASE WHEN _linked THEN 'meeting.document_linked' ELSE 'meeting.document_unlinked' END, 'meetings', _meeting::text, sid, jsonb_build_object('source', _source));
END $$;

CREATE OR REPLACE FUNCTION public.send_meeting_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.meetings; u uuid; total int := 0;
BEGIN
  FOR m IN
    UPDATE public.meetings SET reminded_at = now()
    WHERE id IN (SELECT id FROM public.meetings WHERE status = 'scheduled' AND reminded_at IS NULL
                   AND starts_at BETWEEN now() AND now() + interval '24 hours' LIMIT 200 FOR UPDATE SKIP LOCKED)
    RETURNING *
  LOOP
    FOR u IN SELECT a.user_id FROM public._meeting_audience(m) a LOOP
      PERFORM public._notify_user(u, m.society_id, 'meeting', 'Reminder: ' || left(m.title, 100),
        to_char(m.starts_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM'), '/app/meetings');
    END LOOP;
    total := total + 1;
  END LOOP;
  RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.send_meeting_reminders() FROM PUBLIC, anon, authenticated;

-- ===================== 3. FORMAL VOTES (extend polls) =====================
ALTER TABLE public.polls DROP CONSTRAINT polls_kind_check;
ALTER TABLE public.polls ADD CONSTRAINT polls_kind_check CHECK (kind IN ('poll','survey','vote'));
ALTER TABLE public.polls
  ADD COLUMN IF NOT EXISTS eligibility text CHECK (eligibility IS NULL OR eligibility IN ('person','home','committee')),
  ADD COLUMN IF NOT EXISTS secret_ballot boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS frozen_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE public.poll_votes ADD COLUMN IF NOT EXISTS flat_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS poll_votes_one_per_home ON public.poll_votes(poll_id, flat_id) WHERE flat_id IS NOT NULL;

-- direct vote inserts never allowed for formal votes (must go through vote_cast)
CREATE POLICY "no direct formal votes" ON public.poll_votes AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT EXISTS (SELECT 1 FROM public.polls p WHERE p.id = poll_id AND p.kind = 'vote'));

CREATE OR REPLACE FUNCTION public._vote_freeze_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.kind = 'vote' THEN
    IF NEW.kind <> 'vote' OR NEW.society_id <> OLD.society_id THEN RAISE EXCEPTION 'vote_frozen' USING ERRCODE='22023'; END IF;
    IF OLD.frozen_at IS NOT NULL AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.description IS DISTINCT FROM OLD.description
        OR NEW.eligibility IS DISTINCT FROM OLD.eligibility OR NEW.secret_ballot IS DISTINCT FROM OLD.secret_ballot
        OR NEW.closes_at IS DISTINCT FROM OLD.closes_at OR NEW.frozen_at IS DISTINCT FROM OLD.frozen_at) THEN
      RAISE EXCEPTION 'vote_frozen' USING ERRCODE='22023'; END IF;
    IF OLD.status = 'closed' AND NEW.status <> 'closed' THEN RAISE EXCEPTION 'vote_closed' USING ERRCODE='22023'; END IF;
    IF OLD.status = 'open' AND NEW.status NOT IN ('open','closed') THEN RAISE EXCEPTION 'vote_frozen' USING ERRCODE='22023'; END IF;
    IF NEW.status = 'open' AND NEW.frozen_at IS NULL THEN RAISE EXCEPTION 'vote_frozen' USING ERRCODE='22023'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_vote_freeze BEFORE UPDATE ON public.polls FOR EACH ROW EXECUTE FUNCTION public._vote_freeze_guard();

CREATE OR REPLACE FUNCTION public._vote_block_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.kind = 'vote' AND OLD.status <> 'draft' THEN RAISE EXCEPTION 'vote_frozen' USING ERRCODE='22023'; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_vote_no_delete BEFORE DELETE ON public.polls FOR EACH ROW EXECUTE FUNCTION public._vote_block_delete();

CREATE OR REPLACE FUNCTION public._vote_options_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE pid uuid := coalesce(NEW.poll_id, OLD.poll_id);
BEGIN
  IF EXISTS (SELECT 1 FROM public.polls WHERE id = pid AND kind = 'vote' AND frozen_at IS NOT NULL) THEN RAISE EXCEPTION 'vote_frozen' USING ERRCODE='22023'; END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER trg_vote_options_freeze BEFORE INSERT OR UPDATE OR DELETE ON public.poll_options FOR EACH ROW EXECUTE FUNCTION public._vote_options_guard();

CREATE OR REPLACE FUNCTION public._vote_votes_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.polls WHERE id = OLD.poll_id AND kind = 'vote') THEN RAISE EXCEPTION 'vote_immutable' USING ERRCODE='22023'; END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER trg_vote_votes_immutable BEFORE UPDATE OR DELETE ON public.poll_votes FOR EACH ROW EXECUTE FUNCTION public._vote_votes_guard();

-- ordinary poll voting keeps working for polls only
CREATE OR REPLACE FUNCTION public.poll_cast_vote(_poll uuid, _option uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); p public.polls;
BEGIN
  SELECT * INTO p FROM public.polls WHERE id = _poll;
  IF uid IS NULL OR p.id IS NULL OR p.kind <> 'poll' OR p.society_id IS DISTINCT FROM public.get_user_society_id(uid) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF p.status <> 'open' OR (p.closes_at IS NOT NULL AND p.closes_at < now()) THEN RAISE EXCEPTION 'poll_closed' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.poll_options WHERE id = _option AND poll_id = _poll) THEN RAISE EXCEPTION 'invalid_option' USING ERRCODE='22023'; END IF;
  INSERT INTO public.poll_votes (poll_id, option_id, user_id) VALUES (_poll, _option, uid)
  ON CONFLICT (poll_id, user_id) DO NOTHING;
  IF NOT FOUND THEN RAISE EXCEPTION 'already_voted' USING ERRCODE='23505'; END IF;
END $$;

-- community poll results never include formal votes
CREATE OR REPLACE FUNCTION public.poll_results(_poll_ids uuid[])
RETURNS TABLE(poll_id uuid, option_id uuid, votes bigint) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.poll_id, v.option_id, count(*) FROM public.poll_votes v JOIN public.polls p ON p.id = v.poll_id
  WHERE v.poll_id = ANY(_poll_ids) AND p.kind <> 'vote'
    AND (p.society_id = public._notice_admin_society()
         OR (p.society_id = public.get_user_society_id(auth.uid())
             AND (p.status <> 'open' OR (p.closes_at IS NOT NULL AND p.closes_at < now())
                  OR EXISTS (SELECT 1 FROM public.poll_votes mv WHERE mv.poll_id = p.id AND mv.user_id = auth.uid()))))
  GROUP BY v.poll_id, v.option_id
$$;

CREATE OR REPLACE FUNCTION public._vote_eligible_flat(_p polls, _user uuid)
RETURNS TABLE(eligible boolean, flat_id uuid) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _p.eligibility = 'committee' THEN
    RETURN QUERY SELECT public.is_society_admin_for(_user, _p.society_id), NULL::uuid; RETURN;
  END IF;
  IF _p.eligibility = 'home' THEN
    RETURN QUERY
      SELECT true, fr.flat_id FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
      WHERE fr.user_id = _user AND f.society_id = _p.society_id AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL
        AND (fr.access_expires_at IS NULL OR fr.access_expires_at > now())
        AND NOT EXISTS (SELECT 1 FROM public.poll_votes v WHERE v.poll_id = _p.id AND v.flat_id = fr.flat_id)
      ORDER BY fr.is_primary DESC NULLS LAST, fr.created_at LIMIT 1;
    IF NOT FOUND THEN RETURN QUERY SELECT false, NULL::uuid; END IF;
    RETURN;
  END IF;
  RETURN QUERY SELECT public._authorize_membership_internal(_user, _p.society_id), NULL::uuid;
END $$;
REVOKE ALL ON FUNCTION public._vote_eligible_flat(polls, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.vote_create(_title text, _description text, _options text[], _eligibility text, _secret boolean, _closes_at timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); pid uuid; o text; i int := 0;
BEGIN
  IF NOT public._can_manage_polls(sid) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF char_length(btrim(coalesce(_title,''))) NOT BETWEEN 3 AND 200 THEN RAISE EXCEPTION 'invalid_title' USING ERRCODE='22023'; END IF;
  IF _eligibility NOT IN ('person','home','committee') THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  IF _options IS NULL OR array_length(_options,1) NOT BETWEEN 2 AND 10 THEN RAISE EXCEPTION 'invalid_option' USING ERRCODE='22023'; END IF;
  IF _closes_at IS NULL OR _closes_at <= now() + interval '10 minutes' OR _closes_at > now() + interval '90 days' THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('vote_write', auth.uid()::text, 30, interval '1 hour');
  INSERT INTO public.polls (society_id, title, description, status, closes_at, created_by, kind, eligibility, secret_ballot)
  VALUES (sid, btrim(_title), nullif(btrim(coalesce(_description,'')),''), 'draft', _closes_at, auth.uid(), 'vote', _eligibility, coalesce(_secret,false)) RETURNING id INTO pid;
  FOREACH o IN ARRAY _options LOOP
    IF char_length(btrim(coalesce(o,''))) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'invalid_option' USING ERRCODE='22023'; END IF;
    INSERT INTO public.poll_options (poll_id, label, position) VALUES (pid, btrim(o), i); i := i + 1;
  END LOOP;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'vote.created', 'polls', pid::text, sid, jsonb_build_object('eligibility', _eligibility, 'secret', coalesce(_secret,false), 'options', i));
  RETURN pid;
END $$;

CREATE OR REPLACE FUNCTION public.vote_set_status(_id uuid, _status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); p public.polls; u uuid;
BEGIN
  IF NOT public._can_manage_polls(sid) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO p FROM public.polls WHERE id = _id AND society_id = sid AND kind = 'vote' FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF NOT ((p.status = 'draft' AND _status = 'open') OR (p.status = 'open' AND _status = 'closed')) THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF _status = 'open' AND p.closes_at <= now() THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('vote_write', auth.uid()::text, 30, interval '1 hour');
  IF _status = 'open' THEN
    UPDATE public.polls SET frozen_at = now(), status = 'open' WHERE id = _id;
  ELSE
    UPDATE public.polls SET status = 'closed', closed_at = now() WHERE id = _id;
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'vote.' || _status, 'polls', _id::text, sid, jsonb_build_object('eligibility', p.eligibility, 'secret', p.secret_ballot));
  IF _status = 'open' AND p.eligibility <> 'committee' THEN
    FOR u IN SELECT DISTINCT fr.user_id FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
             WHERE f.society_id = sid AND fr.user_id IS NOT NULL AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL
               AND (fr.access_expires_at IS NULL OR fr.access_expires_at > now()) LOOP
      PERFORM public._notify_user(u, sid, 'vote', 'Voting open: ' || left(p.title, 100), 'Cast your vote before it closes.', '/app/votes');
    END LOOP;
  END IF;
END $$;

-- votes auto-close when their window ends (scheduler)
CREATE OR REPLACE FUNCTION public.close_expired_votes()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  UPDATE public.polls SET status = 'closed', closed_at = now() WHERE kind = 'vote' AND status = 'open' AND closes_at <= now();
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.close_expired_votes() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.vote_cast(_poll uuid, _option uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.polls; e record;
BEGIN
  SELECT * INTO p FROM public.polls WHERE id = _poll AND kind = 'vote' FOR SHARE;
  IF auth.uid() IS NULL OR p.id IS NULL OR p.society_id IS DISTINCT FROM public.get_user_society_id(auth.uid()) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF p.status <> 'open' OR p.closes_at <= now() THEN RAISE EXCEPTION 'poll_closed' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.poll_options WHERE id = _option AND poll_id = _poll) THEN RAISE EXCEPTION 'invalid_option' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.poll_votes WHERE poll_id = _poll AND user_id = auth.uid()) THEN RAISE EXCEPTION 'already_voted' USING ERRCODE='23505'; END IF;
  SELECT * INTO e FROM public._vote_eligible_flat(p, auth.uid());
  IF NOT coalesce(e.eligible,false) THEN
    IF p.eligibility = 'home' THEN RAISE EXCEPTION 'home_already_voted' USING ERRCODE='23505'; END IF;
    RAISE EXCEPTION 'not_eligible' USING ERRCODE='42501';
  END IF;
  PERFORM public._rate_hit('vote_cast', auth.uid()::text, 30, interval '1 hour');
  BEGIN
    INSERT INTO public.poll_votes (poll_id, option_id, user_id, flat_id) VALUES (_poll, _option, auth.uid(), e.flat_id);
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'already_voted' USING ERRCODE='23505';
  END;
  -- audit records participation only, never the choice
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'vote.cast', 'polls', _poll::text, p.society_id, jsonb_build_object('eligibility', p.eligibility));
END $$;

CREATE OR REPLACE FUNCTION public.vote_status_for_me(_poll_ids uuid[])
RETURNS TABLE(poll_id uuid, voted boolean, eligible boolean, my_option uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.polls; e record; v public.poll_votes;
BEGIN
  FOR p IN SELECT * FROM public.polls WHERE id = ANY(_poll_ids) AND kind = 'vote' AND society_id = public.get_user_society_id(auth.uid()) LOOP
    SELECT * INTO v FROM public.poll_votes WHERE poll_votes.poll_id = p.id AND user_id = auth.uid();
    SELECT * INTO e FROM public._vote_eligible_flat(p, auth.uid());
    poll_id := p.id; voted := v.id IS NOT NULL; eligible := coalesce(e.eligible,false); my_option := v.option_id;
    RETURN NEXT;
  END LOOP;
END $$;

-- totals only; secret ballots reveal totals only after close; never individual choices
CREATE OR REPLACE FUNCTION public.vote_results(_poll uuid)
RETURNS TABLE(option_id uuid, label text, votes bigint, total_cast bigint, eligible_count bigint, visible boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.polls; is_admin boolean; show boolean; elig bigint; cast_n bigint;
BEGIN
  SELECT * INTO p FROM public.polls WHERE id = _poll AND kind = 'vote';
  IF p.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  is_admin := public.is_society_admin_for(auth.uid(), p.society_id);
  IF NOT is_admin AND (p.society_id IS DISTINCT FROM public.get_user_society_id(auth.uid()) OR p.status = 'draft') THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  show := p.status = 'closed' OR (NOT p.secret_ballot AND is_admin);
  SELECT count(*) INTO cast_n FROM public.poll_votes WHERE poll_votes.poll_id = _poll;
  SELECT CASE p.eligibility
    WHEN 'committee' THEN (SELECT count(DISTINCT ur.user_id) FROM public.user_roles ur WHERE ur.society_id = p.society_id AND ur.role = 'society_admin' AND ur.is_active IS NOT FALSE)
    WHEN 'home' THEN (SELECT count(DISTINCT fr.flat_id) FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id WHERE f.society_id = p.society_id AND fr.user_id IS NOT NULL AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL)
    ELSE (SELECT count(DISTINCT fr.user_id) FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id WHERE f.society_id = p.society_id AND fr.user_id IS NOT NULL AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL)
  END INTO elig;
  RETURN QUERY SELECT o.id, o.label,
    CASE WHEN show THEN (SELECT count(*) FROM public.poll_votes v WHERE v.poll_id = _poll AND v.option_id = o.id) ELSE NULL END,
    cast_n, elig, show
  FROM public.poll_options o WHERE o.poll_id = _poll ORDER BY o.position;
END $$;

-- ===================== 4. DOCUMENT VAULT =====================
ALTER TABLE public.society_knowledge_sources ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'records';
ALTER TABLE public.society_knowledge_sources ADD CONSTRAINT skc_category_chk CHECK (category IN ('bylaws','rules','notices','minutes','resolutions','policies','records','faq'));
UPDATE public.society_knowledge_sources SET category = 'faq' WHERE kind = 'faq';

CREATE TABLE public.society_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.society_knowledge_sources(id) ON DELETE RESTRICT,
  society_id uuid NOT NULL,
  version integer NOT NULL,
  storage_path text NOT NULL,
  file_name text,
  mime_type text,
  size_bytes integer,
  superseded_by uuid NOT NULL,
  superseded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, version)
);
GRANT SELECT ON public.society_document_versions TO authenticated;
GRANT ALL ON public.society_document_versions TO service_role;
ALTER TABLE public.society_document_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read versions" ON public.society_document_versions FOR SELECT TO authenticated USING (public.is_society_admin_for(auth.uid(), society_id));
CREATE TRIGGER trg_doc_versions_append_only BEFORE UPDATE OR DELETE ON public.society_document_versions FOR EACH ROW EXECUTE FUNCTION public._append_only();

-- replacing a document archives the previous file as a version instead of overwriting it
CREATE OR REPLACE FUNCTION public.knowledge_begin_document(_title text, _audience text, _file_name text, _mime text, _size integer, _ext text, _replace_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid := public._knowledge_admin_society(); _id uuid; _ver int; _path text; cur public.society_knowledge_sources;
BEGIN
  IF _ext NOT IN ('pdf','txt','md') OR _mime NOT IN ('application/pdf','text/plain','text/markdown') THEN RAISE EXCEPTION 'invalid_file'; END IF;
  IF _audience NOT IN ('residents','committee') THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF _replace_id IS NULL THEN
    IF (SELECT count(*) FROM public.society_knowledge_sources WHERE society_id = _soc) >= 200 THEN RAISE EXCEPTION 'limit_reached'; END IF;
    _id := gen_random_uuid(); _ver := 1;
    _path := _soc::text || '/' || _id::text || '/v1.' || _ext;
    INSERT INTO public.society_knowledge_sources(id, society_id, kind, title, audience, storage_path, file_name, mime_type, size_bytes, status, created_by, updated_by)
    VALUES (_id, _soc, 'document', btrim(_title), _audience, _path, _file_name, _mime, _size, 'processing', auth.uid(), auth.uid());
  ELSE
    SELECT * INTO cur FROM public.society_knowledge_sources WHERE id = _replace_id AND society_id = _soc AND kind = 'document' FOR UPDATE;
    IF cur.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
    _id := _replace_id; _ver := cur.version + 1;
    IF cur.storage_path IS NOT NULL AND cur.status IN ('ready','archived','unsupported') THEN
      INSERT INTO public.society_document_versions (source_id, society_id, version, storage_path, file_name, mime_type, size_bytes, superseded_by)
      VALUES (_id, _soc, cur.version, cur.storage_path, cur.file_name, cur.mime_type, cur.size_bytes, auth.uid()) ON CONFLICT (source_id, version) DO NOTHING;
    END IF;
    _path := _soc::text || '/' || _id::text || '/v' || _ver || '.' || _ext;
    UPDATE public.society_knowledge_sources SET title = btrim(_title), audience = _audience, storage_path = _path, file_name = _file_name,
      mime_type = _mime, size_bytes = _size, status = 'processing', status_reason = NULL, extracted_text = NULL, text_chars = 0,
      version = _ver, archived_at = NULL, updated_by = auth.uid(), updated_at = now() WHERE id = _id;
  END IF;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), CASE WHEN _replace_id IS NULL THEN 'knowledge.uploaded' ELSE 'knowledge.replaced' END, 'society_knowledge_sources', _id::text, _soc, jsonb_build_object('version', _ver, 'mime', _mime));
  -- old_path is never returned: previous files are kept as versions
  RETURN jsonb_build_object('id', _id, 'version', _ver, 'path', _path, 'old_path', NULL);
END $$;

-- documents are archived, not deleted; only FAQs may be removed
CREATE OR REPLACE FUNCTION public.knowledge_delete(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid := public._knowledge_admin_society(); _title text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.society_knowledge_sources WHERE id = _id AND society_id = _soc AND kind = 'document') THEN
    RAISE EXCEPTION 'use_archive'; END IF;
  DELETE FROM public.society_knowledge_sources WHERE id = _id AND society_id = _soc AND kind = 'faq' RETURNING title INTO _title;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'knowledge.removed', 'society_knowledge_sources', _id::text, _soc, jsonb_build_object('title', _title));
  RETURN jsonb_build_object('path', NULL);
END $$;

CREATE OR REPLACE FUNCTION public.knowledge_set_category(_id uuid, _category text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid := public._knowledge_admin_society(); old text;
BEGIN
  IF _category NOT IN ('bylaws','rules','notices','minutes','resolutions','policies','records') THEN RAISE EXCEPTION 'invalid_input'; END IF;
  SELECT category INTO old FROM public.society_knowledge_sources WHERE id = _id AND society_id = _soc AND kind = 'document' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  UPDATE public.society_knowledge_sources SET category = _category, updated_at = now() WHERE id = _id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'knowledge.category_set', 'society_knowledge_sources', _id::text, _soc, jsonb_build_object('from', old, 'to', _category));
END $$;

CREATE OR REPLACE FUNCTION public.knowledge_version_path(_version_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.society_document_versions;
BEGIN
  SELECT * INTO r FROM public.society_document_versions WHERE id = _version_id;
  IF r.id IS NULL OR NOT public.is_society_admin_for(auth.uid(), r.society_id) THEN RETURN NULL; END IF;
  RETURN r.storage_path;
END $$;

-- ===================== 5. PRIVACY REQUESTS =====================
CREATE TABLE public.privacy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('export','correction','deletion')),
  details text NOT NULL DEFAULT '' CHECK (char_length(details) <= 2000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','under_review','completed','partially_completed','declined','withdrawn')),
  outcome text CHECK (outcome IS NULL OR char_length(outcome) <= 3000),
  retained jsonb NOT NULL DEFAULT '[]'::jsonb,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX privacy_requests_one_open ON public.privacy_requests(user_id, society_id, kind) WHERE status IN ('pending','under_review');
GRANT SELECT ON public.privacy_requests TO authenticated;
GRANT ALL ON public.privacy_requests TO service_role;
ALTER TABLE public.privacy_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own privacy requests" ON public.privacy_requests FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admins read privacy requests" ON public.privacy_requests FOR SELECT TO authenticated USING (public.is_society_admin_for(auth.uid(), society_id));

CREATE OR REPLACE FUNCTION public.privacy_request_create(_kind text, _details text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_member_society(); rid uuid;
BEGIN
  IF _kind NOT IN ('export','correction','deletion') THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  IF _kind = 'correction' AND char_length(btrim(coalesce(_details,''))) < 10 THEN RAISE EXCEPTION 'details_required' USING ERRCODE='22023'; END IF;
  IF char_length(coalesce(_details,'')) > 2000 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('privacy_request', auth.uid()::text, 5, interval '1 day');
  BEGIN
    INSERT INTO public.privacy_requests (society_id, user_id, kind, details) VALUES (sid, auth.uid(), _kind, btrim(coalesce(_details,''))) RETURNING id INTO rid;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'already_open' USING ERRCODE='23505';
  END;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'privacy.requested', 'privacy_requests', rid::text, sid, jsonb_build_object('kind', _kind));
  PERFORM public._notify_society_admins(sid, 'privacy', 'New privacy request', 'A resident submitted a ' || _kind || ' request.', '/society/privacy-requests');
  RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION public.privacy_request_withdraw(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.privacy_requests;
BEGIN
  SELECT * INTO r FROM public.privacy_requests WHERE id = _id AND user_id = auth.uid() FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  UPDATE public.privacy_requests SET status = 'withdrawn', updated_at = now() WHERE id = _id;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'privacy.withdrawn', 'privacy_requests', _id::text, r.society_id, jsonb_build_object('kind', r.kind));
END $$;

-- review: records must-keep categories; never deletes records itself
CREATE OR REPLACE FUNCTION public.privacy_request_review(_id uuid, _status text, _outcome text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); r public.privacy_requests; ret jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.current_user_has_society_permission(sid, 'residents.manage') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM public.privacy_requests WHERE id = _id AND society_id = sid FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF r.user_id = auth.uid() THEN RAISE EXCEPTION 'self_review' USING ERRCODE='42501'; END IF;
  IF NOT ((r.status = 'pending' AND _status IN ('under_review','completed','partially_completed','declined'))
       OR (r.status = 'under_review' AND _status IN ('completed','partially_completed','declined'))) THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF _status <> 'under_review' AND char_length(btrim(coalesce(_outcome,''))) < 10 THEN RAISE EXCEPTION 'outcome_required' USING ERRCODE='22023'; END IF;
  IF r.kind = 'deletion' AND _status IN ('completed','partially_completed','declined') THEN
    ret := '["Bills, payments and receipts (financial law)","Ledger and accounting entries","Gate and visitor security logs","Audit history"]'::jsonb;
    IF _status = 'completed' THEN _status := 'partially_completed'; END IF;
  END IF;
  PERFORM public._rate_hit('privacy_review', auth.uid()::text, 60, interval '1 hour');
  UPDATE public.privacy_requests SET status = _status, outcome = nullif(btrim(coalesce(_outcome,'')),''), retained = ret,
    reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now() WHERE id = _id;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'privacy.' || _status, 'privacy_requests', _id::text, sid, jsonb_build_object('kind', r.kind, 'retained', ret));
  PERFORM public._notify_user(r.user_id, sid, 'privacy', 'Privacy request update',
    'Your ' || r.kind || ' request is now ' || replace(_status,'_',' ') || '.', '/app/privacy-requests');
END $$;

-- personal data copy for the caller only, after the committee approved an export request
CREATE OR REPLACE FUNCTION public.privacy_personal_export()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); sid uuid; out jsonb;
BEGIN
  SELECT society_id INTO sid FROM public.profiles WHERE id = uid;
  IF uid IS NULL OR sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.privacy_requests WHERE user_id = uid AND society_id = sid AND kind = 'export'
                 AND status IN ('completed','partially_completed') AND reviewed_at > now() - interval '30 days') THEN
    RAISE EXCEPTION 'export_not_approved' USING ERRCODE='42501'; END IF;
  PERFORM public._rate_hit('privacy_export', uid::text, 5, interval '1 day');
  SELECT jsonb_build_object(
    'generated_at', now(),
    'profile', (SELECT jsonb_build_object('full_name', full_name, 'email', email, 'phone', phone, 'move_in_date', move_in_date, 'created_at', created_at) FROM public.profiles WHERE id = uid),
    'homes', coalesce((SELECT jsonb_agg(jsonb_build_object('flat', f.flat_number, 'relationship', fr.relationship, 'moved_in_at', fr.moved_in_at, 'moved_out_at', fr.moved_out_at, 'lease_ends_on', fr.lease_ends_on))
               FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id WHERE fr.user_id = uid AND f.society_id = sid), '[]'::jsonb),
    'vehicles', coalesce((SELECT jsonb_agg(jsonb_build_object('plate', plate_number, 'make_model', make_model, 'type', type, 'active', is_active)) FROM public.vehicles WHERE user_id = uid AND society_id = sid), '[]'::jsonb),
    'family_members', coalesce((SELECT jsonb_agg(jsonb_build_object('name', full_name, 'relation', relation, 'active', is_active)) FROM public.family_members WHERE user_id = uid AND society_id = sid), '[]'::jsonb),
    'privacy_requests', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', kind, 'status', status, 'created_at', created_at, 'outcome', outcome)) FROM public.privacy_requests WHERE user_id = uid AND society_id = sid), '[]'::jsonb)
  ) INTO out;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'privacy.export_downloaded', 'privacy_requests', uid::text, sid, '{}'::jsonb);
  RETURN out;
END $$;

REVOKE ALL ON FUNCTION public._gov_admin_society(), public._gov_member_society() FROM PUBLIC, anon;

-- ===================== scheduler (reuse hourly job) =====================
SELECT cron.unschedule('expire-stale-amenity-waitlist-hourly');
SELECT cron.schedule('expire-stale-amenity-waitlist-hourly','10 * * * *',
  'SELECT public.expire_stale_amenity_waitlist(); SELECT public.mark_visitor_overstays(); SELECT public.publish_due_notices(); SELECT public.send_meeting_reminders(); SELECT public.close_expired_votes();');
