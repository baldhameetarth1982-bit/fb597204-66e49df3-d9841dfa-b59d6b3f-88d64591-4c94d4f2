-- Wave 1: Services & Discovery reuses public.ads (one campaign system for
-- banners, service listings and sponsored/custom campaigns).
CREATE TABLE public.service_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 2 AND 40 AND label !~ '[<>{}]'),
  icon text NOT NULL DEFAULT 'wrench' CHECK (icon ~ '^[a-z0-9-]{1,30}$'),
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.service_categories TO authenticated;
GRANT INSERT, UPDATE ON public.service_categories TO authenticated;
GRANT ALL ON public.service_categories TO service_role;
ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "categories readable when active" ON public.service_categories FOR SELECT TO authenticated
  USING (active OR public.is_super_admin(auth.uid()));
CREATE POLICY "super admin insert categories" ON public.service_categories FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY "super admin update categories" ON public.service_categories FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

INSERT INTO public.service_categories (slug, label, icon, sort_order) VALUES
 ('electrician','Electrician','zap',10),('plumber','Plumber','droplets',20),('carpenter','Carpenter','hammer',30),
 ('ac-repair','AC Repair','snowflake',40),('appliance-repair','Appliance Repair','refrigerator',50),
 ('cleaning','Cleaning','sparkles',60),('pest-control','Pest Control','bug',70),('painting','Painting','paintbrush',80),
 ('ro-water','RO / Water','glass-water',90),('internet-cable','Internet / Cable','wifi',100),('movers','Movers','truck',110),
 ('tutors','Tutors','graduation-cap',120),('home-maintenance','Home Maintenance','wrench',130),('events','Events & Offers','calendar',140);

ALTER TABLE public.ads
  ADD COLUMN kind text NOT NULL DEFAULT 'banner',
  ADD COLUMN category_id uuid REFERENCES public.service_categories(id),
  ADD COLUMN description text,
  ADD COLUMN business_name text,
  ADD COLUMN phone text,
  ADD COLUMN whatsapp text,
  ADD COLUMN cta_label text,
  ADD COLUMN sponsored boolean NOT NULL DEFAULT true,
  ADD COLUMN starts_at timestamptz,
  ADD COLUMN ends_at timestamptz,
  ADD COLUMN target_cities text[] NOT NULL DEFAULT '{}',
  ADD COLUMN target_society_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN target_plans text[] NOT NULL DEFAULT '{}',
  ADD COLUMN archived_at timestamptz;

ALTER TABLE public.ads
  ADD CONSTRAINT ads_kind_chk CHECK (kind IN ('banner','service','campaign')),
  ADD CONSTRAINT ads_no_interstitial CHECK (placement <> 'interstitial'),
  ADD CONSTRAINT ads_title_chk CHECK (char_length(btrim(title)) BETWEEN 2 AND 80 AND title !~ '[<>{}]'),
  ADD CONSTRAINT ads_desc_chk CHECK (description IS NULL OR (char_length(description) <= 600 AND description !~ '[<>{}]')),
  ADD CONSTRAINT ads_business_chk CHECK (business_name IS NULL OR (char_length(btrim(business_name)) BETWEEN 2 AND 80 AND business_name !~ '[<>{}]')),
  ADD CONSTRAINT ads_cta_chk CHECK (cta_label IS NULL OR (char_length(btrim(cta_label)) BETWEEN 2 AND 24 AND cta_label !~ '[<>{}]')),
  ADD CONSTRAINT ads_phone_chk CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{8,15}$'),
  ADD CONSTRAINT ads_whatsapp_chk CHECK (whatsapp IS NULL OR whatsapp ~ '^\+?[0-9]{8,15}$'),
  ADD CONSTRAINT ads_link_chk CHECK (link_url IS NULL OR link_url = '' OR (link_url ~ '^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(/[^\s<>"]*)?$' AND char_length(link_url) <= 500)),
  ADD CONSTRAINT ads_window_chk CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  ADD CONSTRAINT ads_plans_chk CHECK (target_plans <@ ARRAY['basic','pro','premium']::text[]),
  ADD CONSTRAINT ads_cities_chk CHECK (cardinality(target_cities) <= 20),
  ADD CONSTRAINT ads_societies_chk CHECK (cardinality(target_society_ids) <= 50),
  ADD CONSTRAINT ads_image_path_chk CHECK (image_path IS NULL OR image_path ~ '^[A-Za-z0-9/_.-]{1,200}$'),
  ADD CONSTRAINT ads_service_contact_chk CHECK (kind = 'banner' OR phone IS NOT NULL OR whatsapp IS NOT NULL OR (link_url IS NOT NULL AND link_url <> ''));

CREATE INDEX ads_discovery_idx ON public.ads (kind, active, category_id) WHERE archived_at IS NULL;

-- Residents never read ads directly any more: targeting is enforced by the RPC below.
DROP POLICY IF EXISTS "ads readable by authenticated" ON public.ads;
CREATE POLICY "ads readable by super admin" ON public.ads FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- Private media: only super admins read raw objects; residents get server-signed URLs.
DROP POLICY IF EXISTS "ads bucket read" ON storage.objects;
CREATE POLICY "ads bucket read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ads' AND public.is_super_admin(auth.uid()));

-- Audit every change to ads, whichever path writes it.
CREATE OR REPLACE FUNCTION public._audit_ads()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.ads := coalesce(NEW, OLD); act text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    PERFORM public._rate_hit('ads_admin', coalesce(auth.uid()::text,'system'), 120, interval '1 hour');
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM public._rate_hit('ads_admin', coalesce(auth.uid()::text,'system'), 120, interval '1 hour');
  END IF;
  act := CASE
    WHEN TG_OP = 'INSERT' THEN 'ads.create'
    WHEN TG_OP = 'DELETE' THEN 'ads.delete'
    WHEN NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL THEN 'ads.archive'
    WHEN NEW.active IS DISTINCT FROM OLD.active THEN CASE WHEN NEW.active THEN 'ads.activate' ELSE 'ads.deactivate' END
    ELSE 'ads.update' END;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, metadata)
  VALUES (auth.uid(), act, 'ads', r.id::text, jsonb_build_object('kind', r.kind, 'title', left(r.title, 80), 'active', r.active));
  IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
  RETURN coalesce(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_audit_ads ON public.ads;
CREATE TRIGGER trg_audit_ads BEFORE INSERT OR UPDATE OR DELETE ON public.ads
  FOR EACH ROW EXECUTE FUNCTION public._audit_ads();

-- One server-authoritative read path for residents (banners, services, campaigns).
CREATE OR REPLACE FUNCTION public.list_discovery_items(_kind text DEFAULT NULL, _placement text DEFAULT NULL)
RETURNS TABLE (
  id uuid, kind text, title text, description text, business_name text, category_id uuid,
  phone text, whatsapp text, link_url text, cta_label text, sponsored boolean,
  placement text, image_path text, sort_order integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); sid uuid; s record; plan text; ad_free boolean := false;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT p.society_id INTO sid FROM public.profiles p WHERE p.id = uid;
  IF sid IS NOT NULL THEN
    SELECT so.plan_id, so.plan_status, so.trial_ends_at, lower(btrim(coalesce(so.city, ''))) AS city INTO s
    FROM public.societies so WHERE so.id = sid;
    plan := s.plan_id;
    IF s.plan_status = 'trialing' AND (s.trial_ends_at IS NULL OR s.trial_ends_at > now()) THEN plan := 'premium'; END IF;
    ad_free := coalesce((SELECT NOT pl.ads_enabled FROM public.plans pl WHERE pl.id = plan), false);
  END IF;
  ad_free := ad_free OR EXISTS (SELECT 1 FROM public.resident_subscriptions rs
    WHERE rs.user_id = uid AND rs.status = 'active' AND rs.expires_at > now());

  RETURN QUERY
  SELECT a.id, a.kind, a.title, a.description, a.business_name, a.category_id,
         a.phone, a.whatsapp, nullif(a.link_url, ''), a.cta_label, (a.kind = 'banner' OR a.sponsored),
         a.placement, a.image_path, a.sort_order
  FROM public.ads a
  LEFT JOIN public.service_categories c ON c.id = a.category_id
  WHERE a.active AND a.archived_at IS NULL
    AND (a.starts_at IS NULL OR a.starts_at <= now())
    AND (a.ends_at IS NULL OR a.ends_at > now())
    AND (_kind IS NULL OR a.kind = _kind)
    AND (_placement IS NULL OR a.placement = _placement)
    AND (a.category_id IS NULL OR c.active)
    AND (cardinality(a.target_society_ids) = 0 OR sid = ANY (a.target_society_ids))
    AND (cardinality(a.target_cities) = 0 OR (s.city IS NOT NULL AND s.city = ANY (SELECT lower(btrim(x)) FROM unnest(a.target_cities) x)))
    AND (cardinality(a.target_plans) = 0 OR plan = ANY (a.target_plans))
    -- Pro / ad-free: no banners and no sponsored cards.
    AND NOT (ad_free AND (a.kind = 'banner' OR a.sponsored))
  ORDER BY a.sort_order, a.created_at DESC
  LIMIT 200;
END $$;
REVOKE ALL ON FUNCTION public.list_discovery_items(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_discovery_items(text, text) TO authenticated, service_role;