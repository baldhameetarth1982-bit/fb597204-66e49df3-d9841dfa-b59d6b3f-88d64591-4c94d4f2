
CREATE OR REPLACE FUNCTION public._community_member_society()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid;
BEGIN
  SELECT society_id INTO _soc FROM public.profiles WHERE id = auth.uid();
  IF auth.uid() IS NULL OR _soc IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.society_id = _soc
      AND COALESCE(ur.is_active,true) AND ur.role IN ('resident','society_admin','block_admin')
  ) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  RETURN _soc;
END $$;
REVOKE ALL ON FUNCTION public._community_member_society() FROM public, anon;

CREATE TABLE public.community_listing_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid REFERENCES public.societies(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(label) BETWEEN 2 AND 40 AND label !~ '[<>{}]'),
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.community_listing_categories TO authenticated;
GRANT ALL ON public.community_listing_categories TO service_role;
ALTER TABLE public.community_listing_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read categories" ON public.community_listing_categories FOR SELECT TO authenticated
  USING (society_id IS NULL OR society_id = (SELECT society_id FROM public.profiles WHERE id = auth.uid()));

CREATE TABLE public.community_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  category_id uuid REFERENCES public.community_listing_categories(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'offer' CHECK (kind IN ('offer','request','help','opportunity')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 80 AND title !~ '[<>{}]'),
  description text CHECK (description IS NULL OR (char_length(description) <= 800 AND description !~ '[<>{}]')),
  price_inr numeric(12,2) CHECK (price_inr IS NULL OR (price_inr >= 0 AND price_inr <= 10000000)),
  image_path text CHECK (image_path IS NULL OR image_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$'),
  contact_method text NOT NULL DEFAULT 'in_app' CHECK (contact_method IN ('in_app','phone','whatsapp','link')),
  contact_phone text CHECK (contact_phone IS NULL OR contact_phone ~ '^\+?[0-9]{8,15}$'),
  contact_link text CHECK (contact_link IS NULL OR (char_length(contact_link) <= 300 AND contact_link ~ '^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(/[^\s<>"]*)?$')),
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('published','paused','archived','removed')),
  expires_at timestamptz,
  removed_reason text,
  removed_by uuid,
  report_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (contact_method <> 'phone' OR contact_phone IS NOT NULL),
  CHECK (contact_method <> 'whatsapp' OR contact_phone IS NOT NULL),
  CHECK (contact_method <> 'link' OR contact_link IS NOT NULL)
);
CREATE INDEX community_listings_soc_idx ON public.community_listings(society_id, status, created_at DESC);
CREATE INDEX community_listings_owner_idx ON public.community_listings(owner_id);
GRANT SELECT ON public.community_listings TO authenticated;
GRANT ALL ON public.community_listings TO service_role;
ALTER TABLE public.community_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads own listings" ON public.community_listings FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "admins read society listings" ON public.community_listings FOR SELECT TO authenticated USING (public.is_society_admin_for(auth.uid(), society_id));

CREATE TABLE public.community_listing_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.community_listings(id) ON DELETE CASCADE,
  society_id uuid NOT NULL,
  reporter_id uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 300 AND reason !~ '[<>{}]'),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','actioned')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, reporter_id)
);
GRANT SELECT ON public.community_listing_reports TO authenticated;
GRANT ALL ON public.community_listing_reports TO service_role;
ALTER TABLE public.community_listing_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read reports" ON public.community_listing_reports FOR SELECT TO authenticated USING (public.is_society_admin_for(auth.uid(), society_id));
CREATE POLICY "reporter reads own reports" ON public.community_listing_reports FOR SELECT TO authenticated USING (reporter_id = auth.uid());

CREATE TABLE public.community_listing_events (
  id bigserial PRIMARY KEY,
  listing_id uuid NOT NULL REFERENCES public.community_listings(id) ON DELETE CASCADE,
  society_id uuid NOT NULL,
  actor_id uuid,
  action text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.community_listing_events TO authenticated;
GRANT ALL ON public.community_listing_events TO service_role;
ALTER TABLE public.community_listing_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner or admin reads history" ON public.community_listing_events FOR SELECT TO authenticated USING (
  public.is_society_admin_for(auth.uid(), society_id)
  OR EXISTS (SELECT 1 FROM public.community_listings l WHERE l.id = listing_id AND l.owner_id = auth.uid()));
CREATE TRIGGER community_listing_events_append_only BEFORE UPDATE ON public.community_listing_events
  FOR EACH ROW EXECUTE FUNCTION public._append_only();

INSERT INTO public.community_listing_categories (society_id, label, sort_order) VALUES
 (NULL,'Services by residents',10),(NULL,'Items for sale',20),(NULL,'Free / giveaway',30),
 (NULL,'Community help',40),(NULL,'Tuition & classes',50),(NULL,'Opportunities',60),(NULL,'Lost & found',70);

CREATE OR REPLACE FUNCTION public._market_log(_l uuid, _soc uuid, _action text, _reason text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.community_listing_events(listing_id, society_id, actor_id, action, reason) VALUES (_l,_soc,auth.uid(),_action,_reason);
$$;
REVOKE ALL ON FUNCTION public._market_log(uuid,uuid,text,text) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.market_save_listing(
  _id uuid, _category_id uuid, _kind text, _title text, _description text, _price_inr numeric,
  _contact_method text, _contact_phone text, _contact_link text, _expires_days int)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid := public._community_member_society(); _row public.community_listings; _new uuid; _rl record;
BEGIN
  SELECT * INTO _rl FROM public.touch_rate_limit('market_save', auth.uid()::text, 20, 3600);
  IF NOT _rl.allowed THEN RAISE EXCEPTION 'rate_limited'; END IF;
  IF _category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.community_listing_categories c WHERE c.id=_category_id AND c.active AND (c.society_id IS NULL OR c.society_id=_soc)) THEN
    RAISE EXCEPTION 'invalid_category'; END IF;
  IF _expires_days IS NOT NULL AND (_expires_days < 1 OR _expires_days > 180) THEN RAISE EXCEPTION 'invalid_expiry'; END IF;
  _contact_phone := NULLIF(regexp_replace(coalesce(_contact_phone,''), '[\s()-]', '', 'g'), '');
  IF _contact_method IN ('in_app','link') THEN _contact_phone := NULL; END IF;
  IF _contact_method <> 'link' THEN _contact_link := NULL; END IF;
  IF _id IS NULL THEN
    INSERT INTO public.community_listings(society_id, owner_id, category_id, kind, title, description, price_inr, contact_method, contact_phone, contact_link, expires_at)
    VALUES (_soc, auth.uid(), _category_id, _kind, btrim(_title), NULLIF(btrim(_description),''), _price_inr, _contact_method, _contact_phone, NULLIF(btrim(_contact_link),''),
            now() + make_interval(days => coalesce(_expires_days, 30)))
    RETURNING id INTO _new;
    PERFORM public._market_log(_new, _soc, 'created', NULL);
    RETURN _new;
  END IF;
  SELECT * INTO _row FROM public.community_listings WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR _row.owner_id <> auth.uid() OR _row.society_id <> _soc THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _row.status = 'removed' THEN RAISE EXCEPTION 'listing_removed'; END IF;
  UPDATE public.community_listings SET category_id=_category_id, kind=_kind, title=btrim(_title), description=NULLIF(btrim(_description),''),
    price_inr=_price_inr, contact_method=_contact_method, contact_phone=_contact_phone, contact_link=NULLIF(btrim(_contact_link),''),
    expires_at = CASE WHEN _expires_days IS NULL THEN expires_at ELSE now() + make_interval(days => _expires_days) END, updated_at=now()
  WHERE id=_id;
  PERFORM public._market_log(_id, _soc, 'edited', NULL);
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.market_set_status(_id uuid, _status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row public.community_listings;
BEGIN
  IF _status NOT IN ('published','paused','archived') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  SELECT * INTO _row FROM public.community_listings WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR _row.owner_id <> auth.uid() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  PERFORM public._community_member_society();
  IF _row.status = 'removed' THEN RAISE EXCEPTION 'listing_removed'; END IF;
  UPDATE public.community_listings SET status=_status, updated_at=now(),
    expires_at = CASE WHEN _status='published' AND (expires_at IS NULL OR expires_at <= now()) THEN now() + interval '30 days' ELSE expires_at END
  WHERE id=_id;
  PERFORM public._market_log(_id, _row.society_id, _status, NULL);
END $$;

CREATE OR REPLACE FUNCTION public.market_set_image(_id uuid, _path text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row public.community_listings;
BEGIN
  SELECT * INTO _row FROM public.community_listings WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR _row.owner_id <> auth.uid() OR _row.status='removed' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _path IS NOT NULL AND _path NOT LIKE _row.society_id::text || '/' || _row.id::text || '/%' THEN RAISE EXCEPTION 'invalid_path'; END IF;
  UPDATE public.community_listings SET image_path=_path, updated_at=now() WHERE id=_id;
  PERFORM public._market_log(_id, _row.society_id, CASE WHEN _path IS NULL THEN 'image_removed' ELSE 'image_set' END, NULL);
END $$;

CREATE OR REPLACE FUNCTION public.list_market_listings(_category_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, category_id uuid, kind text, title text, description text, price_inr numeric, image_path text,
  contact_method text, contact_phone text, contact_link text, owner_name text, is_mine boolean, created_at timestamptz, expires_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid := public._community_member_society();
BEGIN
  RETURN QUERY SELECT l.id, l.category_id, l.kind, l.title, l.description, l.price_inr, l.image_path, l.contact_method,
    CASE WHEN l.contact_method IN ('phone','whatsapp') THEN l.contact_phone END,
    CASE WHEN l.contact_method = 'link' THEN l.contact_link END,
    split_part(coalesce(p.full_name,'Resident'),' ',1), l.owner_id = auth.uid(), l.created_at, l.expires_at
  FROM public.community_listings l LEFT JOIN public.profiles p ON p.id = l.owner_id
  WHERE l.society_id = _soc AND l.status='published' AND (l.expires_at IS NULL OR l.expires_at > now())
    AND (_category_id IS NULL OR l.category_id = _category_id)
  ORDER BY l.created_at DESC LIMIT 200;
END $$;

CREATE OR REPLACE FUNCTION public.market_report(_id uuid, _reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid := public._community_member_society(); _row public.community_listings; n int; _rl record;
BEGIN
  SELECT * INTO _rl FROM public.touch_rate_limit('market_report', auth.uid()::text, 10, 3600);
  IF NOT _rl.allowed THEN RAISE EXCEPTION 'rate_limited'; END IF;
  SELECT * INTO _row FROM public.community_listings WHERE id=_id;
  IF NOT FOUND OR _row.society_id <> _soc OR _row.status <> 'published' THEN RAISE EXCEPTION 'not_found'; END IF;
  IF _row.owner_id = auth.uid() THEN RAISE EXCEPTION 'cannot_report_own'; END IF;
  INSERT INTO public.community_listing_reports(listing_id, society_id, reporter_id, reason) VALUES (_id, _soc, auth.uid(), btrim(_reason))
  ON CONFLICT (listing_id, reporter_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    UPDATE public.community_listings SET report_count = report_count + 1 WHERE id=_id;
    PERFORM public._market_log(_id, _soc, 'reported', NULL);
    PERFORM public._notify_society_admins_once(_soc, 'community', 'Community listing reported', left(_row.title,80), '/society/community', 'mkt-report:'||_id::text||':'||(_row.report_count+1)::text, 'normal');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.market_moderate(_id uuid, _action text, _reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid := public._gov_admin_society(); _row public.community_listings;
BEGIN
  IF _action NOT IN ('remove','restore','dismiss_reports') THEN RAISE EXCEPTION 'invalid_action'; END IF;
  SELECT * INTO _row FROM public.community_listings WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR _row.society_id <> _soc THEN RAISE EXCEPTION 'not_found'; END IF;
  IF _action = 'remove' THEN
    IF coalesce(char_length(btrim(_reason)),0) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
    UPDATE public.community_listings SET status='removed', removed_reason=left(btrim(_reason),300), removed_by=auth.uid(), updated_at=now() WHERE id=_id;
    UPDATE public.community_listing_reports SET status='actioned' WHERE listing_id=_id AND status='open';
    PERFORM public._notify_user_once(_row.owner_id, _soc, 'community', 'Your listing was removed', left('“'||_row.title||'” — '||btrim(_reason),300), '/app/community', 'mkt-removed:'||_id::text||':'||extract(epoch from now())::bigint::text, 'normal');
  ELSIF _action = 'restore' THEN
    IF _row.status <> 'removed' THEN RAISE EXCEPTION 'not_removed'; END IF;
    UPDATE public.community_listings SET status='paused', removed_reason=NULL, removed_by=NULL, updated_at=now() WHERE id=_id;
    PERFORM public._notify_user_once(_row.owner_id, _soc, 'community', 'Your listing was restored', left('“'||_row.title||'” is paused — publish it again when ready.',300), '/app/community', 'mkt-restored:'||_id::text||':'||extract(epoch from now())::bigint::text, 'normal');
  ELSE
    UPDATE public.community_listing_reports SET status='dismissed' WHERE listing_id=_id AND status='open';
    UPDATE public.community_listings SET report_count = 0 WHERE id=_id;
  END IF;
  PERFORM public._market_log(_id, _soc, 'moderation_'||_action, _reason);
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'community.listing.'||_action, 'community_listings', _id::text, _soc, jsonb_build_object('reason', left(_reason,300)));
END $$;

CREATE OR REPLACE FUNCTION public.market_contact(_id uuid, _message text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid := public._community_member_society(); _row public.community_listings; _who text; _flat text; _rl record;
BEGIN
  IF _message IS NULL OR char_length(btrim(_message)) NOT BETWEEN 3 AND 200 OR _message ~ '[<>{}]' THEN RAISE EXCEPTION 'invalid_message'; END IF;
  SELECT * INTO _rl FROM public.touch_rate_limit('market_contact', auth.uid()::text, 15, 3600);
  IF NOT _rl.allowed THEN RAISE EXCEPTION 'rate_limited'; END IF;
  SELECT * INTO _row FROM public.community_listings WHERE id=_id;
  IF NOT FOUND OR _row.society_id <> _soc OR _row.status <> 'published' OR (_row.expires_at IS NOT NULL AND _row.expires_at <= now()) THEN RAISE EXCEPTION 'not_found'; END IF;
  IF _row.owner_id = auth.uid() THEN RAISE EXCEPTION 'own_listing'; END IF;
  SELECT split_part(coalesce(full_name,'A resident'),' ',1) INTO _who FROM public.profiles WHERE id = auth.uid();
  SELECT f.flat_number INTO _flat FROM public._my_active_flat() f LIMIT 1;
  PERFORM public._notify_user_once(_row.owner_id, _soc, 'community', left(coalesce(_who,'A resident') || coalesce(' ('||_flat||')','') || ' replied to your listing',120),
    left('“'||_row.title||'”: '||btrim(_message),300), '/app/community', 'mkt-contact:'||_id::text||':'||auth.uid()::text||':'||to_char(now(),'YYYYMMDDHH24MI'), 'normal');
  PERFORM public._market_log(_id, _soc, 'contacted', NULL);
END $$;

CREATE OR REPLACE FUNCTION public.market_set_category(_id uuid, _label text, _active boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid := public._gov_admin_society(); _new uuid;
BEGIN
  IF _id IS NULL THEN
    INSERT INTO public.community_listing_categories(society_id, label) VALUES (_soc, btrim(_label)) RETURNING id INTO _new;
  ELSE
    UPDATE public.community_listing_categories SET label=btrim(_label), active=coalesce(_active,active) WHERE id=_id AND society_id=_soc RETURNING id INTO _new;
    IF _new IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  END IF;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'community.category.save', 'community_listing_categories', _new::text, _soc, jsonb_build_object('label',_label,'active',_active));
  RETURN _new;
END $$;

CREATE TABLE public.emergency_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid REFERENCES public.societies(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(label) BETWEEN 2 AND 40 AND label !~ '[<>{}]'),
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.emergency_categories TO authenticated;
GRANT ALL ON public.emergency_categories TO service_role;
ALTER TABLE public.emergency_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read emergency categories" ON public.emergency_categories FOR SELECT TO authenticated
  USING (society_id IS NULL OR public.is_society_admin_for(auth.uid(), society_id));
INSERT INTO public.emergency_categories(society_id,label,sort_order) VALUES
 (NULL,'Fire',10),(NULL,'Security incident',20),(NULL,'Water emergency',30),(NULL,'Power emergency',40),(NULL,'Evacuation',50),(NULL,'Safety information',60);

CREATE TABLE public.emergency_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.emergency_categories(id) ON DELETE SET NULL,
  category_label text NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 100 AND title !~ '[<>{}]'),
  message text NOT NULL CHECK (char_length(message) BETWEEN 3 AND 1000 AND message !~ '[<>{}]'),
  audience text NOT NULL CHECK (audience IN ('everyone','residents','gate_staff','committee','block')),
  block_id uuid,
  sos_alert_id uuid REFERENCES public.sos_alerts(id) ON DELETE SET NULL,
  request_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  recipient_count int NOT NULL DEFAULT 0,
  in_app_delivered int NOT NULL DEFAULT 0,
  channel_status jsonb NOT NULL DEFAULT '{"in_app":"sent","push":"best_effort","sms":"not_configured","whatsapp":"not_configured","email":"not_configured"}'::jsonb,
  UNIQUE (society_id, request_id),
  CHECK (audience <> 'block' OR block_id IS NOT NULL)
);
CREATE INDEX emergency_broadcasts_soc_idx ON public.emergency_broadcasts(society_id, created_at DESC);
GRANT SELECT ON public.emergency_broadcasts TO authenticated;
GRANT ALL ON public.emergency_broadcasts TO service_role;
ALTER TABLE public.emergency_broadcasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read broadcasts" ON public.emergency_broadcasts FOR SELECT TO authenticated USING (public.is_society_admin_for(auth.uid(), society_id));

CREATE TABLE public.emergency_broadcast_recipients (
  broadcast_id uuid NOT NULL REFERENCES public.emergency_broadcasts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  notified boolean NOT NULL DEFAULT false,
  acknowledged_at timestamptz,
  PRIMARY KEY (broadcast_id, user_id)
);
GRANT SELECT ON public.emergency_broadcast_recipients TO authenticated;
GRANT ALL ON public.emergency_broadcast_recipients TO service_role;
ALTER TABLE public.emergency_broadcast_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recipient reads own" ON public.emergency_broadcast_recipients FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admins read recipients" ON public.emergency_broadcast_recipients FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.emergency_broadcasts b WHERE b.id = broadcast_id AND public.is_society_admin_for(auth.uid(), b.society_id)));

CREATE OR REPLACE FUNCTION public.emergency_broadcast_send(
  _category_id uuid, _title text, _message text, _audience text, _block_id uuid, _expires_minutes int, _sos_alert_id uuid, _request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid := public._gov_admin_society(); _id uuid; _label text; _total int; _sent int := 0; r record; _rl record;
BEGIN
  IF _request_id IS NULL THEN RAISE EXCEPTION 'request_id_required'; END IF;
  SELECT id INTO _id FROM public.emergency_broadcasts WHERE society_id=_soc AND request_id=_request_id;
  IF _id IS NOT NULL THEN RETURN _id; END IF;
  SELECT * INTO _rl FROM public.touch_rate_limit('emergency_send', _soc::text, 10, 3600);
  IF NOT _rl.allowed THEN RAISE EXCEPTION 'rate_limited'; END IF;
  SELECT label INTO _label FROM public.emergency_categories WHERE id=_category_id AND active AND (society_id IS NULL OR society_id=_soc);
  IF _label IS NULL THEN RAISE EXCEPTION 'invalid_category'; END IF;
  IF _expires_minutes IS NULL OR _expires_minutes < 15 OR _expires_minutes > 10080 THEN RAISE EXCEPTION 'invalid_expiry'; END IF;
  IF _audience = 'block' AND NOT EXISTS (SELECT 1 FROM public.blocks WHERE id=_block_id AND society_id=_soc) THEN RAISE EXCEPTION 'invalid_block'; END IF;
  IF _audience <> 'block' THEN _block_id := NULL; END IF;
  IF _sos_alert_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sos_alerts WHERE id=_sos_alert_id AND society_id=_soc) THEN RAISE EXCEPTION 'invalid_sos'; END IF;
  INSERT INTO public.emergency_broadcasts(society_id, category_id, category_label, title, message, audience, block_id, sos_alert_id, request_id, expires_at, created_by)
  VALUES (_soc, _category_id, _label, btrim(_title), btrim(_message), _audience, _block_id, _sos_alert_id, _request_id, now() + make_interval(mins => _expires_minutes), auth.uid())
  RETURNING id INTO _id;

  INSERT INTO public.emergency_broadcast_recipients(broadcast_id, user_id)
  SELECT DISTINCT _id, ur.user_id FROM public.user_roles ur
  WHERE ur.society_id = _soc AND COALESCE(ur.is_active,true) AND (
    (_audience = 'everyone' AND ur.role IN ('resident','society_admin','block_admin','security','staff'))
    OR (_audience = 'residents' AND ur.role = 'resident')
    OR (_audience = 'gate_staff' AND ur.role IN ('security','staff'))
    OR (_audience = 'committee' AND ur.role IN ('society_admin','block_admin'))
    OR (_audience = 'block' AND ur.role = 'resident' AND EXISTS (
         SELECT 1 FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
         WHERE fr.user_id = ur.user_id AND f.block_id = _block_id AND fr.is_active AND fr.moved_out_at IS NULL AND fr.archived_at IS NULL)));
  GET DIAGNOSTICS _total = ROW_COUNT;

  FOR r IN SELECT user_id FROM public.emergency_broadcast_recipients WHERE broadcast_id=_id LOOP
    BEGIN
      IF public._notify_user_once(r.user_id, _soc, 'emergency', left('EMERGENCY · '||_label||': '||btrim(_title),120), left(btrim(_message),300), '/app/emergency', 'emergency:'||_id::text, 'urgent') THEN
        _sent := _sent + 1;
      END IF;
      UPDATE public.emergency_broadcast_recipients SET notified = true WHERE broadcast_id=_id AND user_id=r.user_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
  UPDATE public.emergency_broadcasts SET recipient_count=_total, in_app_delivered=_sent,
    channel_status = jsonb_set(channel_status, '{in_app}', to_jsonb(CASE WHEN _total = 0 THEN 'no_recipients' WHEN _sent = _total THEN 'sent' ELSE 'partial' END))
  WHERE id=_id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'emergency.broadcast.send', 'emergency_broadcasts', _id::text, _soc,
    jsonb_build_object('category',_label,'audience',_audience,'recipients',_total,'in_app',_sent,'sos_alert_id',_sos_alert_id));
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.emergency_broadcast_cancel(_id uuid, _reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid := public._gov_admin_society(); n int;
BEGIN
  IF coalesce(char_length(btrim(_reason)),0) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  UPDATE public.emergency_broadcasts SET cancelled_at=now(), cancelled_by=auth.uid(), cancel_reason=left(btrim(_reason),300)
  WHERE id=_id AND society_id=_soc AND cancelled_at IS NULL AND expires_at > now();
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'not_active'; END IF;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'emergency.broadcast.cancel', 'emergency_broadcasts', _id::text, _soc, jsonb_build_object('reason', left(_reason,300)));
END $$;

CREATE OR REPLACE FUNCTION public.emergency_acknowledge(_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.emergency_broadcast_recipients SET acknowledged_at = coalesce(acknowledged_at, now())
  WHERE broadcast_id=_id AND user_id=auth.uid();
  UPDATE public.user_notifications SET read_at = coalesce(read_at, now()) WHERE user_id=auth.uid() AND dedupe_key='emergency:'||_id::text;
END $$;

CREATE OR REPLACE FUNCTION public.list_my_emergency_broadcasts()
RETURNS TABLE(id uuid, category_label text, title text, message text, created_at timestamptz, expires_at timestamptz,
  cancelled_at timestamptz, cancel_reason text, acknowledged_at timestamptz, state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, b.category_label, b.title, b.message, b.created_at, b.expires_at, b.cancelled_at, b.cancel_reason, r.acknowledged_at,
    CASE WHEN b.cancelled_at IS NOT NULL THEN 'cancelled' WHEN b.expires_at <= now() THEN 'expired' ELSE 'active' END
  FROM public.emergency_broadcast_recipients r JOIN public.emergency_broadcasts b ON b.id = r.broadcast_id
  WHERE r.user_id = auth.uid() AND b.society_id = (SELECT society_id FROM public.profiles WHERE id = auth.uid())
    AND b.created_at > now() - interval '30 days'
  ORDER BY (b.cancelled_at IS NULL AND b.expires_at > now()) DESC, b.created_at DESC LIMIT 30;
$$;

CREATE OR REPLACE FUNCTION public.emergency_set_category(_id uuid, _label text, _active boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid := public._gov_admin_society(); _new uuid;
BEGIN
  IF _id IS NULL THEN
    INSERT INTO public.emergency_categories(society_id,label) VALUES (_soc, btrim(_label)) RETURNING id INTO _new;
  ELSE
    UPDATE public.emergency_categories SET label=btrim(_label), active=coalesce(_active,active) WHERE id=_id AND society_id=_soc RETURNING id INTO _new;
    IF _new IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  END IF;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'emergency.category.save', 'emergency_categories', _new::text, _soc, jsonb_build_object('label',_label,'active',_active));
  RETURN _new;
END $$;

ALTER TABLE public.society_knowledge_sources
  ADD COLUMN IF NOT EXISTS expires_on date,
  ADD COLUMN IF NOT EXISTS reminder_days int[] NOT NULL DEFAULT '{30,7,1}',
  ADD COLUMN IF NOT EXISTS reminder_audience text NOT NULL DEFAULT 'committee';
ALTER TABLE public.society_knowledge_sources ADD CONSTRAINT knowledge_reminder_audience_chk CHECK (reminder_audience IN ('committee','committee_and_staff'));
ALTER TABLE public.society_knowledge_sources ADD CONSTRAINT knowledge_reminder_days_chk CHECK (cardinality(reminder_days) <= 6 AND 0 <= ALL(reminder_days) AND 365 >= ALL(reminder_days));

CREATE TABLE public.document_expiry_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.society_knowledge_sources(id) ON DELETE CASCADE,
  society_id uuid NOT NULL,
  expires_on date NOT NULL,
  threshold text NOT NULL,
  recipients int NOT NULL DEFAULT 0,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, expires_on, threshold)
);
GRANT SELECT ON public.document_expiry_reminders TO authenticated;
GRANT ALL ON public.document_expiry_reminders TO service_role;
ALTER TABLE public.document_expiry_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read reminder history" ON public.document_expiry_reminders FOR SELECT TO authenticated USING (public.is_society_admin_for(auth.uid(), society_id));

CREATE OR REPLACE FUNCTION public.doc_set_expiry(_id uuid, _expires_on date, _reminder_days int[], _audience text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid := public._gov_admin_society(); n int;
BEGIN
  IF _audience NOT IN ('committee','committee_and_staff') THEN RAISE EXCEPTION 'invalid_audience'; END IF;
  _reminder_days := (SELECT coalesce(array_agg(DISTINCT d ORDER BY d DESC), '{}') FROM unnest(coalesce(_reminder_days,'{}'::int[])) d);
  UPDATE public.society_knowledge_sources SET expires_on=_expires_on, reminder_days=_reminder_days, reminder_audience=_audience, updated_at=now()
  WHERE id=_id AND society_id=_soc AND kind='document';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'not_found'; END IF;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'document.expiry.configure', 'society_knowledge_sources', _id::text, _soc,
    jsonb_build_object('expires_on',_expires_on,'reminder_days',_reminder_days,'audience',_audience));
END $$;

CREATE OR REPLACE FUNCTION public.send_document_expiry_reminders(_today date DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d record; _thr text; _left int; _rid uuid; _cnt int; _total int := 0; u record;
BEGIN
  IF current_user NOT IN ('postgres','supabase_admin','service_role') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  FOR d IN SELECT s.* FROM public.society_knowledge_sources s
           WHERE s.kind='document' AND s.expires_on IS NOT NULL AND s.archived_at IS NULL AND s.status <> 'archived' LOOP
    _left := d.expires_on - _today;
    _thr := NULL;
    IF _left < 0 THEN _thr := 'expired';
    ELSE
      SELECT 'd'||min(x)::text INTO _thr FROM unnest(d.reminder_days) x WHERE _left <= x;
    END IF;
    CONTINUE WHEN _thr IS NULL;
    _rid := NULL;
    INSERT INTO public.document_expiry_reminders(source_id, society_id, expires_on, threshold) VALUES (d.id, d.society_id, d.expires_on, _thr)
    ON CONFLICT DO NOTHING RETURNING id INTO _rid;
    CONTINUE WHEN _rid IS NULL;
    _cnt := 0;
    FOR u IN SELECT DISTINCT ur.user_id FROM public.user_roles ur
             WHERE ur.society_id = d.society_id AND COALESCE(ur.is_active,true) AND (
               ur.role = 'society_admin'
               OR (d.reminder_audience = 'committee_and_staff' AND d.audience <> 'committee' AND ur.role='staff' AND 'staff.documents' = ANY(ur.permissions)
                   AND EXISTS (SELECT 1 FROM public.society_staff st WHERE st.user_id=ur.user_id AND st.society_id=ur.society_id AND st.is_active))) LOOP
      IF public._notify_user_once(u.user_id, d.society_id, 'document_expiry',
           left(CASE WHEN _thr='expired' THEN 'Document expired: ' ELSE 'Document expiring in '||_left||' day'||CASE WHEN _left=1 THEN '' ELSE 's' END||': ' END || d.title, 120),
           'Expiry date '||to_char(d.expires_on,'DD Mon YYYY')||'. Renew or replace the file in Documents.',
           '/society/knowledge', 'docexp:'||d.id::text||':'||d.expires_on::text||':'||_thr, CASE WHEN _thr='expired' THEN 'high' ELSE 'normal' END) THEN
        _cnt := _cnt + 1;
      END IF;
    END LOOP;
    UPDATE public.document_expiry_reminders SET recipients=_cnt WHERE id=_rid;
    _total := _total + 1;
  END LOOP;
  RETURN _total;
END $$;
REVOKE ALL ON FUNCTION public.send_document_expiry_reminders(date) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.run_logged_db_job(_job text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE run uuid; k text; n int := 0; daily boolean;
BEGIN
  IF current_user NOT IN ('postgres','supabase_admin','service_role') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  daily := _job IN ('tenancy-expiry','tenancy-renewal-reminders','ops-daily-reminders','document-expiry');
  IF _job NOT IN ('tenancy-expiry','tenancy-renewal-reminders','ops-daily-reminders','amenity-waitlist-expiry','visitor-overstays','notice-publishing','meeting-reminders','vote-closing','document-expiry') THEN
    RAISE EXCEPTION 'unknown_job';
  END IF;
  k := CASE WHEN daily THEN to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD') ELSE to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24') END;
  run := public.scheduler_run_begin(_job, k);
  IF run IS NULL THEN RETURN 'skipped'; END IF;
  BEGIN
    CASE _job
      WHEN 'tenancy-expiry' THEN n := public.expire_stale_tenancies(); PERFORM public.scheduler_prune_runs();
      WHEN 'tenancy-renewal-reminders' THEN n := public.send_tenancy_renewal_reminders();
      WHEN 'ops-daily-reminders' THEN PERFORM public.ops_daily_reminders();
      WHEN 'amenity-waitlist-expiry' THEN n := public.expire_stale_amenity_waitlist();
      WHEN 'visitor-overstays' THEN n := public.mark_visitor_overstays();
      WHEN 'notice-publishing' THEN n := public.publish_due_notices();
      WHEN 'meeting-reminders' THEN n := public.send_meeting_reminders();
      WHEN 'vote-closing' THEN n := public.close_expired_votes();
      WHEN 'document-expiry' THEN n := public.send_document_expiry_reminders();
    END CASE;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.scheduler_run_finish(run, 'failed', 0, 1, left(SQLSTATE || ' ' || SQLERRM, 300));
    RETURN 'failed';
  END;
  PERFORM public.scheduler_run_finish(run, 'succeeded', coalesce(n,0), 0, NULL);
  RETURN 'succeeded';
END $function$;

SELECT cron.schedule('document-expiry-daily', '45 2 * * *', $$SELECT public.run_logged_db_job('document-expiry');$$);

CREATE TABLE public.ad_event_daily (
  ad_id uuid NOT NULL REFERENCES public.ads(id) ON DELETE CASCADE,
  day date NOT NULL,
  placement text NOT NULL,
  views int NOT NULL DEFAULT 0,
  clicks int NOT NULL DEFAULT 0,
  cta int NOT NULL DEFAULT 0,
  PRIMARY KEY (ad_id, day, placement)
);
GRANT SELECT ON public.ad_event_daily TO authenticated;
GRANT ALL ON public.ad_event_daily TO service_role;
ALTER TABLE public.ad_event_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super admin reads ad metrics" ON public.ad_event_daily FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));

CREATE TABLE public.ad_event_dedupe (
  k text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ad_event_dedupe TO service_role;
ALTER TABLE public.ad_event_dedupe ENABLE ROW LEVEL SECURITY;
CREATE INDEX ad_event_dedupe_created_idx ON public.ad_event_dedupe(created_at);

CREATE OR REPLACE FUNCTION public.record_ad_event(_ad_id uuid, _event text, _placement text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _k text; n int; _rl record; _day date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _event NOT IN ('view','click','cta') OR _placement IS NULL OR _placement !~ '^[a-z_]{2,40}$' THEN RAISE EXCEPTION 'invalid_event'; END IF;
  SELECT * INTO _rl FROM public.touch_rate_limit('ad_event', auth.uid()::text, 120, 3600);
  IF NOT _rl.allowed THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.list_discovery_items(NULL, NULL) i WHERE i.id = _ad_id AND i.sponsored) THEN RETURN false; END IF;
  _k := md5(auth.uid()::text || ':' || _ad_id::text || ':' || _event || ':' || _placement || ':' || (extract(epoch from now())::bigint / 1800)::text);
  DELETE FROM public.ad_event_dedupe WHERE k IN (SELECT k FROM public.ad_event_dedupe WHERE created_at < now() - interval '2 hours' LIMIT 200);
  INSERT INTO public.ad_event_dedupe(k) VALUES (_k) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN false; END IF;
  INSERT INTO public.ad_event_daily(ad_id, day, placement, views, clicks, cta)
  VALUES (_ad_id, _day, _placement, (_event='view')::int, (_event='click')::int, (_event='cta')::int)
  ON CONFLICT (ad_id, day, placement) DO UPDATE SET views = ad_event_daily.views + EXCLUDED.views,
    clicks = ad_event_daily.clicks + EXCLUDED.clicks, cta = ad_event_daily.cta + EXCLUDED.cta;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.get_ad_report(_from date, _to date)
RETURNS TABLE(ad_id uuid, title text, kind text, placement text, views bigint, clicks bigint, cta bigint,
  target_cities text[], target_plans text[], target_society_count int, active boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _from IS NULL OR _to IS NULL OR _to < _from OR _to - _from > 366 THEN RAISE EXCEPTION 'invalid_range'; END IF;
  RETURN QUERY SELECT e.ad_id, a.title, a.kind, e.placement, sum(e.views)::bigint, sum(e.clicks)::bigint, sum(e.cta)::bigint,
    a.target_cities, a.target_plans, coalesce(cardinality(a.target_society_ids),0), a.active
  FROM public.ad_event_daily e JOIN public.ads a ON a.id = e.ad_id
  WHERE e.day BETWEEN _from AND _to
  GROUP BY e.ad_id, a.title, a.kind, e.placement, a.target_cities, a.target_plans, a.target_society_ids, a.active
  ORDER BY sum(e.views) DESC;
END $$;

REVOKE ALL ON FUNCTION public.market_save_listing(uuid,uuid,text,text,text,numeric,text,text,text,int), public.market_set_status(uuid,text),
  public.market_set_image(uuid,text), public.list_market_listings(uuid), public.market_report(uuid,text), public.market_moderate(uuid,text,text),
  public.market_contact(uuid,text), public.market_set_category(uuid,text,boolean), public.emergency_broadcast_send(uuid,text,text,text,uuid,int,uuid,uuid),
  public.emergency_broadcast_cancel(uuid,text), public.emergency_acknowledge(uuid), public.list_my_emergency_broadcasts(),
  public.emergency_set_category(uuid,text,boolean), public.doc_set_expiry(uuid,date,int[],text), public.record_ad_event(uuid,text,text),
  public.get_ad_report(date,date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.market_save_listing(uuid,uuid,text,text,text,numeric,text,text,text,int), public.market_set_status(uuid,text),
  public.market_set_image(uuid,text), public.list_market_listings(uuid), public.market_report(uuid,text), public.market_moderate(uuid,text,text),
  public.market_contact(uuid,text), public.market_set_category(uuid,text,boolean), public.emergency_broadcast_send(uuid,text,text,text,uuid,int,uuid,uuid),
  public.emergency_broadcast_cancel(uuid,text), public.emergency_acknowledge(uuid), public.list_my_emergency_broadcasts(),
  public.emergency_set_category(uuid,text,boolean), public.doc_set_expiry(uuid,date,int[],text), public.record_ad_event(uuid,text,text),
  public.get_ad_report(date,date) TO authenticated;
