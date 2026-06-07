
-- Expenses table (society finance)
CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('cleaning','security','electricity','repair','water','salary','other')),
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  note text,
  spent_on date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
GRANT ALL ON public.expenses TO service_role;

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society admins view expenses"
  ON public.expenses FOR SELECT TO authenticated
  USING (public.is_society_admin_for(auth.uid(), society_id) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Society admins insert expenses"
  ON public.expenses FOR INSERT TO authenticated
  WITH CHECK (public.is_society_admin_for(auth.uid(), society_id));

CREATE POLICY "Society admins update expenses"
  ON public.expenses FOR UPDATE TO authenticated
  USING (public.is_society_admin_for(auth.uid(), society_id));

CREATE POLICY "Society admins delete expenses"
  ON public.expenses FOR DELETE TO authenticated
  USING (public.is_society_admin_for(auth.uid(), society_id));

CREATE TRIGGER touch_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_expenses_society_date ON public.expenses(society_id, spent_on DESC);

-- Platform settings (super admin only)
CREATE TABLE public.platform_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  razorpay_key_id text,
  razorpay_key_secret text,
  razorpay_configured boolean NOT NULL DEFAULT false,
  ads_banner_enabled boolean NOT NULL DEFAULT true,
  ads_interstitial_enabled boolean NOT NULL DEFAULT false,
  ads_interstitial_seconds int NOT NULL DEFAULT 15 CHECK (ads_interstitial_seconds BETWEEN 10 AND 30),
  ads_banner_placements text[] NOT NULL DEFAULT ARRAY['dashboard_bottom','feed_inline'],
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.platform_settings TO authenticated;
GRANT ALL ON public.platform_settings TO service_role;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- Only super admins see the settings row (which includes razorpay secret)
CREATE POLICY "Super admins read settings"
  ON public.platform_settings FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Super admins update settings"
  ON public.platform_settings FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Super admins insert settings"
  ON public.platform_settings FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TRIGGER touch_platform_settings_updated_at
  BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.platform_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Public-safe view: tells the app whether payments are live, WITHOUT exposing keys
CREATE OR REPLACE FUNCTION public.is_razorpay_live()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT razorpay_configured FROM public.platform_settings WHERE id = 1), false);
$$;

GRANT EXECUTE ON FUNCTION public.is_razorpay_live() TO authenticated, anon;
