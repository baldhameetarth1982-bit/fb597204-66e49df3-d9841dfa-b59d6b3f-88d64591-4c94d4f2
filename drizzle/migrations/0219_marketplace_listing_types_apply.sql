-- Marketplace listing types (verified on throwaway DB; see tests/sql/marketplace-listing-types.sql).
ALTER TABLE public.community_listings
  ADD COLUMN IF NOT EXISTS creator_type text NOT NULL DEFAULT 'resident',
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'society',
  ADD COLUMN IF NOT EXISTS flat_id uuid REFERENCES public.flats(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.community_listings.creator_type IS 'Stable creator type set once at creation: sociyohub | society | resident. Never derived from current role.';
COMMENT ON COLUMN public.community_listings.visibility IS 'society = own society only; all = every society (sociyohub always, society only when platform policy allows).';
COMMENT ON COLUMN public.community_listings.flat_id IS 'House the resident listed from, captured server-side at creation; used for house attribution.';

ALTER TABLE public.community_listings ALTER COLUMN society_id DROP NOT NULL;

DROP TRIGGER IF EXISTS trg_market_lock_ownership ON public.community_listings;

UPDATE public.community_listings l SET flat_id = x.flat_id
FROM (
  SELECT l2.id, min(fr.flat_id::text)::uuid AS flat_id
  FROM public.community_listings l2
  JOIN public.flat_residents fr ON fr.user_id = l2.owner_id
  JOIN public.flats f ON f.id = fr.flat_id AND f.society_id = l2.society_id
  WHERE l2.creator_type = 'resident' AND l2.flat_id IS NULL
    AND coalesce(fr.moved_in_at, fr.created_at) <= l2.created_at
    AND (fr.moved_out_at IS NULL OR fr.moved_out_at > l2.created_at)
  GROUP BY l2.id
  HAVING count(DISTINCT fr.flat_id) = 1
) x
WHERE l.id = x.id;

ALTER TABLE public.community_listings DROP CONSTRAINT IF EXISTS community_listings_creator_type_chk;
ALTER TABLE public.community_listings DROP CONSTRAINT IF EXISTS community_listings_visibility_chk;
ALTER TABLE public.community_listings DROP CONSTRAINT IF EXISTS community_listings_scope_chk;
ALTER TABLE public.community_listings
  ADD CONSTRAINT community_listings_creator_type_chk CHECK (creator_type IN ('sociyohub','society','resident')),
  ADD CONSTRAINT community_listings_visibility_chk CHECK (visibility IN ('society','all')),
  ADD CONSTRAINT community_listings_scope_chk CHECK (
    (creator_type = 'sociyohub' AND society_id IS NULL AND visibility = 'all' AND flat_id IS NULL)
    OR (creator_type = 'society' AND society_id IS NOT NULL AND flat_id IS NULL)
    OR (creator_type = 'resident' AND society_id IS NOT NULL AND visibility = 'society')
  );

ALTER TABLE public.community_listings DROP CONSTRAINT IF EXISTS community_listings_image_path_check;
ALTER TABLE public.community_listings ADD CONSTRAINT community_listings_image_path_check CHECK (
  image_path IS NULL OR image_path ~ '^([0-9a-f-]{36}|platform)/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$');

CREATE INDEX IF NOT EXISTS community_listings_global_idx ON public.community_listings (created_at DESC)
  WHERE visibility = 'all' AND status = 'published';

CREATE OR REPLACE FUNCTION public._market_lock_ownership() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.creator_type IS DISTINCT FROM OLD.creator_type OR NEW.society_id IS DISTINCT FROM OLD.society_id
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.flat_id IS DISTINCT FROM OLD.flat_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_market_lock_ownership ON public.community_listings;
CREATE TRIGGER trg_market_lock_ownership BEFORE UPDATE ON public.community_listings
  FOR EACH ROW EXECUTE FUNCTION public._market_lock_ownership();

ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS market_society_global_enabled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public._market_global_allowed() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT market_society_global_enabled FROM public.platform_settings WHERE id = 1), false)
$$;
REVOKE ALL ON FUNCTION public._market_global_allowed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._market_global_allowed() TO authenticated;

CREATE OR REPLACE FUNCTION public.market_global_allowed() RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._community_member_society();
  RETURN public._market_global_allowed();
END $$;
REVOKE ALL ON FUNCTION public.market_global_allowed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.market_global_allowed() TO authenticated;

CREATE OR REPLACE FUNCTION public._market_house_label(_flat uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN b.name IS NULL OR btrim(b.name) = '' OR f.flat_number ILIKE b.name || '%' THEN f.flat_number
              ELSE b.name || '-' || f.flat_number END
  FROM public.flats f LEFT JOIN public.blocks b ON b.id = f.block_id WHERE f.id = _flat
$$;
REVOKE ALL ON FUNCTION public._market_house_label(uuid) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.list_market_listings(uuid);
CREATE OR REPLACE FUNCTION public.list_market_listings(_category_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, category_id uuid, kind text, title text, description text, price_inr numeric, image_path text,
  contact_method text, contact_phone text, contact_link text, creator_type text, house_label text, society_name text,
  is_local boolean, is_mine boolean, visibility text, created_at timestamptz, expires_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid := public._community_member_society(); _global boolean := public._market_global_allowed();
BEGIN
  RETURN QUERY SELECT l.id, l.category_id, l.kind, l.title, l.description, l.price_inr, l.image_path, l.contact_method,
    CASE WHEN l.contact_method IN ('phone','whatsapp') THEN l.contact_phone END,
    CASE WHEN l.contact_method = 'link' THEN l.contact_link END,
    l.creator_type,
    CASE WHEN l.creator_type = 'resident' THEN public._market_house_label(l.flat_id) END,
    CASE WHEN l.creator_type = 'society' THEN s.name END,
    l.society_id IS NOT DISTINCT FROM _soc,
    CASE l.creator_type WHEN 'resident' THEN l.owner_id = auth.uid()
                        WHEN 'society' THEN l.society_id = _soc AND public.is_society_admin_for(auth.uid(), _soc)
                        ELSE false END,
    l.visibility, l.created_at, l.expires_at
  FROM public.community_listings l LEFT JOIN public.societies s ON s.id = l.society_id
  WHERE l.status = 'published' AND (l.expires_at IS NULL OR l.expires_at > now())
    AND (_category_id IS NULL OR l.category_id = _category_id)
    AND (l.creator_type = 'sociyohub'
         OR l.society_id = _soc
         OR (l.creator_type = 'society' AND l.visibility = 'all' AND _global))
  ORDER BY (l.creator_type = 'sociyohub') DESC, l.created_at DESC LIMIT 200;
END $$;
REVOKE ALL ON FUNCTION public.list_market_listings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_market_listings(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.market_save_listing(uuid, uuid, text, text, text, numeric, text, text, text, integer);
CREATE OR REPLACE FUNCTION public.market_save_listing(_id uuid, _category_id uuid, _kind text, _title text, _description text,
  _price_inr numeric, _contact_method text, _contact_phone text, _contact_link text, _expires_days integer,
  _as text DEFAULT 'resident', _visibility text DEFAULT 'society')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid := public._community_member_society(); _row public.community_listings; _new uuid; _rl record; _flat uuid;
BEGIN
  IF _as NOT IN ('resident','society') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _as = 'resident' THEN _visibility := 'society'; END IF;
  IF _visibility NOT IN ('society','all') THEN RAISE EXCEPTION 'invalid_visibility'; END IF;
  IF _as = 'society' AND NOT public.is_society_admin_for(auth.uid(), _soc) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _as = 'society' AND _visibility = 'all' AND NOT public._market_global_allowed() THEN RAISE EXCEPTION 'global_not_allowed'; END IF;
  SELECT * INTO _rl FROM public.touch_rate_limit('market_save', auth.uid()::text, 20, 3600);
  IF NOT _rl.allowed THEN RAISE EXCEPTION 'rate_limited'; END IF;
  IF _category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.community_listing_categories c WHERE c.id=_category_id AND c.active AND (c.society_id IS NULL OR c.society_id=_soc)) THEN
    RAISE EXCEPTION 'invalid_category'; END IF;
  IF _expires_days IS NOT NULL AND (_expires_days < 1 OR _expires_days > 180) THEN RAISE EXCEPTION 'invalid_expiry'; END IF;
  _contact_phone := NULLIF(regexp_replace(coalesce(_contact_phone,''), '[\s()-]', '', 'g'), '');
  IF _contact_method IN ('in_app','link') THEN _contact_phone := NULL; END IF;
  IF _contact_method <> 'link' THEN _contact_link := NULL; END IF;

  IF _id IS NULL THEN
    IF _as = 'resident' THEN
      SELECT f.flat_id INTO _flat FROM public._my_active_flat() f WHERE f.society_id = _soc LIMIT 1;
      IF _flat IS NULL THEN RAISE EXCEPTION 'no_home'; END IF;
    END IF;
    SELECT l.id INTO _new FROM public.community_listings l
     WHERE l.owner_id = auth.uid() AND l.society_id = _soc AND l.creator_type = _as
       AND lower(btrim(l.title)) = lower(btrim(_title)) AND l.status <> 'removed'
       AND l.created_at > now() - interval '2 minutes'
     ORDER BY l.created_at DESC LIMIT 1;
    IF _new IS NOT NULL THEN RETURN _new; END IF;
    INSERT INTO public.community_listings(society_id, owner_id, creator_type, visibility, flat_id, category_id, kind, title, description, price_inr, contact_method, contact_phone, contact_link, expires_at)
    VALUES (_soc, auth.uid(), _as, _visibility, _flat, _category_id, _kind, btrim(_title), NULLIF(btrim(_description),''), _price_inr, _contact_method, _contact_phone, NULLIF(btrim(_contact_link),''),
            now() + make_interval(days => coalesce(_expires_days, 30)))
    RETURNING id INTO _new;
    PERFORM public._market_log(_new, _soc, 'created', NULL);
    RETURN _new;
  END IF;

  SELECT * INTO _row FROM public.community_listings WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR _row.society_id IS DISTINCT FROM _soc OR _row.creator_type <> _as
     OR (_as = 'resident' AND _row.owner_id <> auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _row.status = 'removed' THEN RAISE EXCEPTION 'listing_removed'; END IF;
  UPDATE public.community_listings SET category_id=_category_id, kind=_kind, title=btrim(_title), description=NULLIF(btrim(_description),''),
    price_inr=_price_inr, contact_method=_contact_method, contact_phone=_contact_phone, contact_link=NULLIF(btrim(_contact_link),''),
    visibility = _visibility,
    expires_at = CASE WHEN _expires_days IS NULL THEN expires_at ELSE now() + make_interval(days => _expires_days) END, updated_at=now()
  WHERE id=_id;
  PERFORM public._market_log(_id, _soc, 'edited', NULL);
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.market_save_listing(uuid, uuid, text, text, text, numeric, text, text, text, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.market_save_listing(uuid, uuid, text, text, text, numeric, text, text, text, integer, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.market_set_status(_id uuid, _status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row public.community_listings; _soc uuid;
BEGIN
  IF _status NOT IN ('published','paused','archived') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  _soc := public._community_member_society();
  SELECT * INTO _row FROM public.community_listings WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR _row.society_id IS DISTINCT FROM _soc
     OR NOT ((_row.creator_type = 'resident' AND _row.owner_id = auth.uid())
          OR (_row.creator_type = 'society' AND public.is_society_admin_for(auth.uid(), _soc))) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _row.status = 'removed' THEN RAISE EXCEPTION 'listing_removed'; END IF;
  UPDATE public.community_listings SET status=_status, updated_at=now(),
    expires_at = CASE WHEN _status='published' AND (expires_at IS NULL OR expires_at <= now()) THEN now() + interval '30 days' ELSE expires_at END
  WHERE id=_id;
  PERFORM public._market_log(_id, _row.society_id, _status, NULL);
END $$;

CREATE OR REPLACE FUNCTION public.market_moderate(_id uuid, _action text, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid := public._gov_admin_society(); _row public.community_listings;
BEGIN
  IF _action NOT IN ('remove','restore','dismiss_reports') THEN RAISE EXCEPTION 'invalid_action'; END IF;
  SELECT * INTO _row FROM public.community_listings WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR _row.society_id IS DISTINCT FROM _soc THEN RAISE EXCEPTION 'not_found'; END IF;
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

CREATE OR REPLACE FUNCTION public.admin_market_list()
RETURNS TABLE(id uuid, category_id uuid, kind text, title text, description text, price_inr numeric, contact_method text,
  contact_phone text, contact_link text, status text, expires_at timestamptz, created_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT l.id, l.category_id, l.kind, l.title, l.description, l.price_inr, l.contact_method, l.contact_phone, l.contact_link,
    l.status, l.expires_at, l.created_at, l.updated_at
  FROM public.community_listings l WHERE l.creator_type = 'sociyohub' ORDER BY l.updated_at DESC LIMIT 200;
END $$;
REVOKE ALL ON FUNCTION public.admin_market_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_market_list() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_market_save(_id uuid, _category_id uuid, _kind text, _title text, _description text,
  _price_inr numeric, _contact_method text, _contact_phone text, _contact_link text, _expires_days integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row public.community_listings; _new uuid; _rl record;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO _rl FROM public.touch_rate_limit('admin_market_save', auth.uid()::text, 30, 3600);
  IF NOT _rl.allowed THEN RAISE EXCEPTION 'rate_limited'; END IF;
  IF _contact_method NOT IN ('phone','whatsapp','link') THEN RAISE EXCEPTION 'invalid_contact'; END IF;
  IF _category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.community_listing_categories c WHERE c.id=_category_id AND c.active AND c.society_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_category'; END IF;
  IF _expires_days IS NOT NULL AND (_expires_days < 1 OR _expires_days > 180) THEN RAISE EXCEPTION 'invalid_expiry'; END IF;
  _contact_phone := NULLIF(regexp_replace(coalesce(_contact_phone,''), '[\s()-]', '', 'g'), '');
  IF _contact_method = 'link' THEN _contact_phone := NULL; ELSE _contact_link := NULL; END IF;
  IF _id IS NULL THEN
    SELECT l.id INTO _new FROM public.community_listings l
     WHERE l.creator_type = 'sociyohub' AND lower(btrim(l.title)) = lower(btrim(_title))
       AND l.created_at > now() - interval '2 minutes' ORDER BY l.created_at DESC LIMIT 1;
    IF _new IS NOT NULL THEN RETURN _new; END IF;
    INSERT INTO public.community_listings(society_id, owner_id, creator_type, visibility, category_id, kind, title, description, price_inr, contact_method, contact_phone, contact_link, expires_at)
    VALUES (NULL, auth.uid(), 'sociyohub', 'all', _category_id, _kind, btrim(_title), NULLIF(btrim(_description),''), _price_inr, _contact_method, _contact_phone, NULLIF(btrim(_contact_link),''),
            now() + make_interval(days => coalesce(_expires_days, 30)))
    RETURNING id INTO _new;
  ELSE
    SELECT * INTO _row FROM public.community_listings WHERE id=_id FOR UPDATE;
    IF NOT FOUND OR _row.creator_type <> 'sociyohub' THEN RAISE EXCEPTION 'not_found'; END IF;
    UPDATE public.community_listings SET category_id=_category_id, kind=_kind, title=btrim(_title), description=NULLIF(btrim(_description),''),
      price_inr=_price_inr, contact_method=_contact_method, contact_phone=_contact_phone, contact_link=NULLIF(btrim(_contact_link),''),
      expires_at = CASE WHEN _expires_days IS NULL THEN expires_at ELSE now() + make_interval(days => _expires_days) END, updated_at=now()
    WHERE id=_id;
    _new := _id;
  END IF;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), CASE WHEN _id IS NULL THEN 'marketplace.platform_listing.created' ELSE 'marketplace.platform_listing.edited' END, 'community_listings', _new::text, NULL, '{}'::jsonb);
  RETURN _new;
END $$;
REVOKE ALL ON FUNCTION public.admin_market_save(uuid, uuid, text, text, text, numeric, text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_market_save(uuid, uuid, text, text, text, numeric, text, text, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_market_set_status(_id uuid, _status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row public.community_listings;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _status NOT IN ('published','paused','archived') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  SELECT * INTO _row FROM public.community_listings WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR _row.creator_type <> 'sociyohub' THEN RAISE EXCEPTION 'not_found'; END IF;
  UPDATE public.community_listings SET status=_status, updated_at=now(),
    expires_at = CASE WHEN _status='published' AND (expires_at IS NULL OR expires_at <= now()) THEN now() + interval '30 days' ELSE expires_at END
  WHERE id=_id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'marketplace.platform_listing.'||_status, 'community_listings', _id::text, NULL, '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.admin_market_set_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_market_set_status(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public._market_visible_to(_l public.community_listings, _soc uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _l.status = 'published' AND (_l.expires_at IS NULL OR _l.expires_at > now()) AND _soc IS NOT NULL AND (
    _l.creator_type = 'sociyohub'
    OR _l.society_id = _soc
    OR (_l.creator_type = 'society' AND _l.visibility = 'all' AND public._market_global_allowed()))
$$;
REVOKE ALL ON FUNCTION public._market_visible_to(public.community_listings, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._notify_super_admins_once(_kind text, _title text, _body text, _link text, _dedupe_key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'super_admin'::public.app_role AND coalesce(ur.is_active, true) LOOP
    PERFORM public._notify_user_once(r.user_id, NULL, _kind, _title, _body, _link, _dedupe_key, 'normal');
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public._notify_super_admins_once(text, text, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.market_contact(_id uuid, _message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid := public._community_member_society(); _row public.community_listings; _who text; _flat text; _rl record;
BEGIN
  IF _message IS NULL OR char_length(btrim(_message)) NOT BETWEEN 3 AND 200 OR _message ~ '[<>{}]' THEN RAISE EXCEPTION 'invalid_message'; END IF;
  SELECT * INTO _rl FROM public.touch_rate_limit('market_contact', auth.uid()::text, 15, 3600);
  IF NOT _rl.allowed THEN RAISE EXCEPTION 'rate_limited'; END IF;
  SELECT * INTO _row FROM public.community_listings WHERE id=_id;
  IF NOT FOUND OR _row.status <> 'published' OR (_row.expires_at IS NOT NULL AND _row.expires_at <= now())
     OR NOT (_row.creator_type = 'sociyohub' OR _row.society_id = _soc) THEN RAISE EXCEPTION 'not_found'; END IF;
  IF _row.owner_id = auth.uid() THEN RAISE EXCEPTION 'own_listing'; END IF;
  SELECT split_part(coalesce(full_name,'A resident'),' ',1) INTO _who FROM public.profiles WHERE id = auth.uid();
  SELECT f.flat_number INTO _flat FROM public._my_active_flat() f LIMIT 1;
  IF _row.creator_type = 'sociyohub' THEN
    PERFORM public._notify_user_once(_row.owner_id, NULL, 'community', left(coalesce(_who,'A resident') || ' replied to a SociyoHub listing',120),
      left('“'||_row.title||'”: '||btrim(_message),300), '/admin/marketplace', 'mkt-contact:'||_id::text||':'||auth.uid()::text||':'||to_char(now(),'YYYYMMDDHH24MI'), 'normal');
    INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (auth.uid(), 'marketplace.platform_listing.contacted', 'community_listings', _id::text, _soc, '{}'::jsonb);
  ELSE
    PERFORM public._notify_user_once(_row.owner_id, _soc, 'community', left(coalesce(_who,'A resident') || coalesce(' ('||_flat||')','') || ' replied to your listing',120),
      left('“'||_row.title||'”: '||btrim(_message),300), '/app/community', 'mkt-contact:'||_id::text||':'||auth.uid()::text||':'||to_char(now(),'YYYYMMDDHH24MI'), 'normal');
    PERFORM public._market_log(_id, _soc, 'contacted', NULL);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.market_report(_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid := public._community_member_society(); _row public.community_listings; n int; _rl record; _dest uuid;
BEGIN
  IF _reason IS NULL OR char_length(btrim(_reason)) NOT BETWEEN 3 AND 200 OR _reason ~ '[<>{}]' THEN RAISE EXCEPTION 'invalid_message'; END IF;
  SELECT * INTO _rl FROM public.touch_rate_limit('market_report', auth.uid()::text, 10, 3600);
  IF NOT _rl.allowed THEN RAISE EXCEPTION 'rate_limited'; END IF;
  SELECT * INTO _row FROM public.community_listings WHERE id=_id;
  IF NOT FOUND OR NOT public._market_visible_to(_row, _soc) THEN RAISE EXCEPTION 'not_found'; END IF;
  IF _row.owner_id = auth.uid() THEN RAISE EXCEPTION 'cannot_report_own'; END IF;
  _dest := coalesce(_row.society_id, _soc);
  INSERT INTO public.community_listing_reports(listing_id, society_id, reporter_id, reason) VALUES (_id, _dest, auth.uid(), btrim(_reason))
  ON CONFLICT (listing_id, reporter_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    UPDATE public.community_listings SET report_count = report_count + 1 WHERE id=_id;
    IF _row.creator_type = 'sociyohub' THEN
      PERFORM public._notify_super_admins_once('community', 'SociyoHub listing reported', left(_row.title,80), '/admin/marketplace', 'mkt-report:'||_id::text||':'||(_row.report_count+1)::text);
    ELSE
      PERFORM public._market_log(_id, _row.society_id, 'reported', NULL);
      PERFORM public._notify_society_admins_once(_row.society_id, 'community', 'Community listing reported', left(_row.title,80), '/society/community', 'mkt-report:'||_id::text||':'||(_row.report_count+1)::text, 'normal');
    END IF;
  END IF;
END $$;

DROP POLICY IF EXISTS "admins read reports" ON public.community_listing_reports;
CREATE POLICY "admins read reports" ON public.community_listing_reports FOR SELECT TO authenticated
  USING (public.is_society_admin_for(auth.uid(), society_id)
         AND EXISTS (SELECT 1 FROM public.community_listings l WHERE l.id = listing_id AND l.society_id = community_listing_reports.society_id));

CREATE OR REPLACE FUNCTION public.market_set_image(_id uuid, _path text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row public.community_listings; _prefix text;
BEGIN
  SELECT * INTO _row FROM public.community_listings WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR _row.status='removed'
     OR NOT ((_row.creator_type = 'resident' AND _row.owner_id = auth.uid())
          OR (_row.creator_type = 'society' AND public.is_society_admin_for(auth.uid(), _row.society_id))
          OR (_row.creator_type = 'sociyohub' AND public.is_super_admin(auth.uid()))) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  _prefix := CASE WHEN _row.creator_type = 'sociyohub' THEN 'platform/' ELSE _row.society_id::text || '/' END || _row.id::text || '/';
  IF _path IS NOT NULL AND (left(_path, length(_prefix)) <> _prefix OR _path ~ '\.\.' OR _path !~ '^[A-Za-z0-9/_.-]+\.(png|jpg|webp)$') THEN
    RAISE EXCEPTION 'invalid_path'; END IF;
  UPDATE public.community_listings SET image_path=_path, updated_at=now() WHERE id=_id;
  IF _row.creator_type = 'sociyohub' THEN
    INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (auth.uid(), 'marketplace.platform_listing.'||CASE WHEN _path IS NULL THEN 'image_removed' ELSE 'image_set' END, 'community_listings', _id::text, NULL, '{}'::jsonb);
  ELSE
    PERFORM public._market_log(_id, _row.society_id, CASE WHEN _path IS NULL THEN 'image_removed' ELSE 'image_set' END, NULL);
  END IF;
END $$;

DROP POLICY IF EXISTS "super admins read platform listings" ON public.community_listings;
CREATE POLICY "super admins read platform listings" ON public.community_listings FOR SELECT TO authenticated
  USING (creator_type = 'sociyohub' AND public.is_super_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.admin_market_reports(_id uuid)
RETURNS TABLE(id uuid, reason text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT r.id, r.reason, r.created_at FROM public.community_listing_reports r
    JOIN public.community_listings l ON l.id = r.listing_id
   WHERE r.listing_id = _id AND l.creator_type = 'sociyohub' AND r.status = 'open' ORDER BY r.created_at DESC LIMIT 100;
END $$;
REVOKE ALL ON FUNCTION public.admin_market_reports(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_market_reports(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_market_dismiss_reports(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row public.community_listings;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO _row FROM public.community_listings WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR _row.creator_type <> 'sociyohub' THEN RAISE EXCEPTION 'not_found'; END IF;
  UPDATE public.community_listing_reports SET status='dismissed' WHERE listing_id=_id AND status='open';
  UPDATE public.community_listings SET report_count = 0 WHERE id=_id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'marketplace.platform_listing.reports_dismissed', 'community_listings', _id::text, NULL, '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.admin_market_dismiss_reports(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_market_dismiss_reports(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public._audit_market_global_setting() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.market_society_global_enabled IS DISTINCT FROM OLD.market_society_global_enabled THEN
    INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (auth.uid(), 'platform.marketplace_global.' || CASE WHEN NEW.market_society_global_enabled THEN 'enabled' ELSE 'disabled' END,
            'platform_settings', NEW.id::text, NULL, jsonb_build_object('from', OLD.market_society_global_enabled, 'to', NEW.market_society_global_enabled));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._audit_market_global_setting() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_audit_market_global_setting ON public.platform_settings;
CREATE TRIGGER trg_audit_market_global_setting AFTER UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public._audit_market_global_setting();