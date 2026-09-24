CREATE TABLE public.notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  audience text NOT NULL DEFAULT 'all',
  block_id uuid REFERENCES public.blocks(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft',
  publish_at timestamptz,
  published_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  CONSTRAINT notices_category_chk CHECK (category IN ('general','important','emergency','event','billing','maintenance')),
  CONSTRAINT notices_audience_chk CHECK (audience IN ('all','block')),
  CONSTRAINT notices_status_chk CHECK (status IN ('draft','published','archived')),
  CONSTRAINT notices_title_len CHECK (char_length(title) BETWEEN 3 AND 140),
  CONSTRAINT notices_body_len CHECK (char_length(body) BETWEEN 1 AND 5000)
);
CREATE INDEX idx_notices_society ON public.notices (society_id, status, publish_at DESC);

CREATE TABLE public.notice_reads (
  notice_id uuid NOT NULL REFERENCES public.notices(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notice_id, user_id)
);

-- Can the caller see this notice as a resident? (society + audience + live)
CREATE OR REPLACE FUNCTION public._notice_visible(_n public.notices)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _n.status = 'published' AND coalesce(_n.publish_at, _n.published_at) <= now()
    AND EXISTS (
      SELECT 1 FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
      WHERE fr.user_id = auth.uid() AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL
        AND f.society_id = _n.society_id
        AND (_n.audience = 'all' OR f.block_id = _n.block_id))
$$;
CREATE OR REPLACE FUNCTION public._notice_admin_society()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT society_id FROM public.user_roles
  WHERE user_id = auth.uid() AND role = 'society_admin' AND is_active IS NOT FALSE AND society_id IS NOT NULL
  ORDER BY created_at LIMIT 1
$$;
REVOKE ALL ON FUNCTION public._notice_admin_society() FROM PUBLIC, anon;

GRANT SELECT ON public.notices TO authenticated;
GRANT ALL ON public.notices TO service_role;
ALTER TABLE public.notices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "residents read live notices meant for them" ON public.notices FOR SELECT TO authenticated USING (public._notice_visible(notices));
CREATE POLICY "society admins read own society notices" ON public.notices FOR SELECT TO authenticated USING (society_id = public._notice_admin_society());
CREATE POLICY "super admins read notices" ON public.notices FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));

GRANT SELECT, INSERT ON public.notice_reads TO authenticated;
GRANT ALL ON public.notice_reads TO service_role;
ALTER TABLE public.notice_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own reads select" ON public.notice_reads FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own reads insert" ON public.notice_reads FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.notices n WHERE n.id = notice_id));

-- Admin: create / edit / publish / schedule / archive
CREATE OR REPLACE FUNCTION public.notice_save(_id uuid, _title text, _body text, _category text, _audience text, _block_id uuid, _publish boolean, _publish_at timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); sid uuid := public._notice_admin_society(); nid uuid; cur public.notices; pat timestamptz;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  _title := btrim(coalesce(_title,'')); _body := btrim(coalesce(_body,''));
  IF char_length(_title) NOT BETWEEN 3 AND 140 THEN RAISE EXCEPTION 'invalid_title' USING ERRCODE='22023'; END IF;
  IF char_length(_body) NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'invalid_body' USING ERRCODE='22023'; END IF;
  IF coalesce(_category,'general') NOT IN ('general','important','emergency','event','billing','maintenance') THEN RAISE EXCEPTION 'invalid_category' USING ERRCODE='22023'; END IF;
  IF coalesce(_audience,'all') = 'block' AND NOT EXISTS (SELECT 1 FROM public.blocks WHERE id = _block_id AND society_id = sid) THEN RAISE EXCEPTION 'invalid_block' USING ERRCODE='22023'; END IF;
  IF _publish_at IS NOT NULL AND (_publish_at < now() - interval '5 minutes' OR _publish_at > now() + interval '60 days') THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE='22023'; END IF;
  IF coalesce(_category,'general') = 'emergency' THEN _publish_at := NULL; END IF;
  PERFORM public._rate_hit('notice_save', uid::text, 30, interval '1 hour');
  pat := CASE WHEN _publish THEN coalesce(_publish_at, now()) ELSE NULL END;
  IF _id IS NULL THEN
    INSERT INTO public.notices (society_id, title, body, category, audience, block_id, status, publish_at, published_at, created_by)
    VALUES (sid, _title, _body, coalesce(_category,'general'), coalesce(_audience,'all'), CASE WHEN _audience='block' THEN _block_id END,
            CASE WHEN _publish THEN 'published' ELSE 'draft' END, pat, CASE WHEN _publish THEN now() END, uid)
    RETURNING id INTO nid;
  ELSE
    SELECT * INTO cur FROM public.notices WHERE id = _id AND society_id = sid FOR UPDATE;
    IF cur.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
    IF cur.status = 'archived' THEN RAISE EXCEPTION 'notice_archived' USING ERRCODE='22023'; END IF;
    -- published notices stay editable for 7 days so history stays trustworthy
    IF cur.status = 'published' AND coalesce(cur.publish_at, cur.published_at) <= now() - interval '7 days' THEN RAISE EXCEPTION 'edit_window_closed' USING ERRCODE='22023'; END IF;
    UPDATE public.notices SET title=_title, body=_body, category=coalesce(_category,'general'), audience=coalesce(_audience,'all'),
      block_id = CASE WHEN _audience='block' THEN _block_id END,
      status = CASE WHEN _publish OR cur.status='published' THEN 'published' ELSE 'draft' END,
      publish_at = CASE WHEN cur.status='published' AND coalesce(cur.publish_at, cur.published_at) <= now() THEN cur.publish_at ELSE coalesce(pat, cur.publish_at) END,
      published_at = coalesce(cur.published_at, CASE WHEN _publish THEN now() END),
      edited_at = CASE WHEN cur.status='published' THEN now() ELSE NULL END, updated_at = now()
    WHERE id = _id RETURNING id INTO nid;
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, CASE WHEN _id IS NULL AND _publish THEN 'notice_published' WHEN _id IS NULL THEN 'notice.drafted' WHEN _publish THEN 'notice_published' ELSE 'notice.edited' END,
          'notices', nid::text, sid, jsonb_build_object('category', coalesce(_category,'general'), 'audience', coalesce(_audience,'all'), 'scheduled', _publish_at IS NOT NULL));
  RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.notice_archive(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); sid uuid := public._notice_admin_society();
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  UPDATE public.notices SET status='archived', updated_at=now() WHERE id=_id AND society_id=sid AND status <> 'archived';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'notice.archived', 'notices', _id::text, sid, '{}'::jsonb);
END $$;

-- Admin: how many residents opened a notice (count only, no names)
CREATE OR REPLACE FUNCTION public.notice_read_counts()
RETURNS TABLE(notice_id uuid, reads bigint) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.notice_id, count(*) FROM public.notice_reads r JOIN public.notices n ON n.id = r.notice_id
  WHERE n.society_id = public._notice_admin_society() GROUP BY r.notice_id
$$;

-- ===== Polls: one vote per person, only while open, aggregate results only =====
CREATE OR REPLACE FUNCTION public.poll_cast_vote(_poll uuid, _option uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); p public.polls;
BEGIN
  SELECT * INTO p FROM public.polls WHERE id = _poll;
  IF uid IS NULL OR p.id IS NULL OR p.society_id IS DISTINCT FROM public.get_user_society_id(uid) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF p.status <> 'open' OR (p.closes_at IS NOT NULL AND p.closes_at < now()) THEN RAISE EXCEPTION 'poll_closed' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.poll_options WHERE id = _option AND poll_id = _poll) THEN RAISE EXCEPTION 'invalid_option' USING ERRCODE='22023'; END IF;
  INSERT INTO public.poll_votes (poll_id, option_id, user_id) VALUES (_poll, _option, uid)
  ON CONFLICT (poll_id, user_id) DO NOTHING;
  IF NOT FOUND THEN RAISE EXCEPTION 'already_voted' USING ERRCODE='23505'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.poll_results(_poll_ids uuid[])
RETURNS TABLE(poll_id uuid, option_id uuid, votes bigint) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.poll_id, v.option_id, count(*) FROM public.poll_votes v JOIN public.polls p ON p.id = v.poll_id
  WHERE v.poll_id = ANY(_poll_ids)
    AND (p.society_id = public._notice_admin_society()
         OR (p.society_id = public.get_user_society_id(auth.uid())
             AND (p.status <> 'open' OR (p.closes_at IS NOT NULL AND p.closes_at < now())
                  OR EXISTS (SELECT 1 FROM public.poll_votes mv WHERE mv.poll_id = p.id AND mv.user_id = auth.uid()))))
  GROUP BY v.poll_id, v.option_id
$$;

REVOKE INSERT ON public.poll_votes FROM authenticated, anon;
REVOKE ALL ON FUNCTION public.notice_save(uuid,text,text,text,text,uuid,boolean,timestamptz), public.notice_archive(uuid), public.notice_read_counts(),
  public.poll_cast_vote(uuid,uuid), public.poll_results(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notice_save(uuid,text,text,text,text,uuid,boolean,timestamptz), public.notice_archive(uuid), public.notice_read_counts(),
  public.poll_cast_vote(uuid,uuid), public.poll_results(uuid[]) TO authenticated;