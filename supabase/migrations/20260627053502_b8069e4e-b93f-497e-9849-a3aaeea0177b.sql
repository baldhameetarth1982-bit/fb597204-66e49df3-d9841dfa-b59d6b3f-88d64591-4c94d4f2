
CREATE TABLE IF NOT EXISTS public.ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  image_url text NOT NULL,
  image_path text,
  link_url text NOT NULL,
  placement text NOT NULL DEFAULT 'dashboard_bottom',
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ads TO authenticated;
GRANT ALL ON public.ads TO service_role;

ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ads readable by authenticated" ON public.ads;
CREATE POLICY "ads readable by authenticated" ON public.ads
  FOR SELECT TO authenticated USING (active = true OR public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "ads super admin insert" ON public.ads;
CREATE POLICY "ads super admin insert" ON public.ads
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "ads super admin update" ON public.ads;
CREATE POLICY "ads super admin update" ON public.ads
  FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "ads super admin delete" ON public.ads;
CREATE POLICY "ads super admin delete" ON public.ads
  FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()));

DROP TRIGGER IF EXISTS ads_touch_updated_at ON public.ads;
CREATE TRIGGER ads_touch_updated_at BEFORE UPDATE ON public.ads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP POLICY IF EXISTS "ads bucket read" ON storage.objects;
CREATE POLICY "ads bucket read" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'ads');

DROP POLICY IF EXISTS "ads bucket super admin insert" ON storage.objects;
CREATE POLICY "ads bucket super admin insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'ads' AND public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "ads bucket super admin update" ON storage.objects;
CREATE POLICY "ads bucket super admin update" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'ads' AND public.is_super_admin(auth.uid()))
  WITH CHECK (bucket_id = 'ads' AND public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "ads bucket super admin delete" ON storage.objects;
CREATE POLICY "ads bucket super admin delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'ads' AND public.is_super_admin(auth.uid()));

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.award_post_points() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.award_payment_points() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.award_society_referral() FROM PUBLIC, anon, authenticated;
