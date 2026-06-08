
ALTER TABLE public.societies
  ADD COLUMN IF NOT EXISTS property_type text NOT NULL DEFAULT 'apartment'
    CHECK (property_type IN ('apartment','bungalow','mixed'));

ALTER TABLE public.flats
  ADD COLUMN IF NOT EXISTS unit_type text NOT NULL DEFAULT 'flat'
    CHECK (unit_type IN ('flat','bungalow','villa','shop','office'));

CREATE TABLE IF NOT EXISTS public.billing_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL UNIQUE REFERENCES public.societies(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'flat' CHECK (mode IN ('flat','per_sqft','per_bhk')),
  amount numeric NOT NULL CHECK (amount >= 0),
  cycle text NOT NULL DEFAULT 'monthly' CHECK (cycle IN ('weekly','monthly','quarterly')),
  anchor_day int NOT NULL DEFAULT 1 CHECK (anchor_day BETWEEN 1 AND 31),
  due_offset_days int NOT NULL DEFAULT 10 CHECK (due_offset_days BETWEEN 0 AND 60),
  late_fee_type text NOT NULL DEFAULT 'none' CHECK (late_fee_type IN ('none','flat','percent')),
  late_fee_value numeric NOT NULL DEFAULT 0 CHECK (late_fee_value >= 0),
  prorate boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  last_run_count int,
  last_run_total numeric,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_schedules TO authenticated;
GRANT ALL ON public.billing_schedules TO service_role;

ALTER TABLE public.billing_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "society admins manage their billing schedule"
ON public.billing_schedules FOR ALL TO authenticated
USING (society_id IN (SELECT public.get_admin_society_ids(auth.uid())))
WITH CHECK (society_id IN (SELECT public.get_admin_society_ids(auth.uid())));

CREATE POLICY "residents view their society billing schedule"
ON public.billing_schedules FOR SELECT TO authenticated
USING (society_id = public.get_user_society_id(auth.uid()));

CREATE POLICY "super admins full access billing schedules"
ON public.billing_schedules FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER trg_billing_schedules_touch
BEFORE UPDATE ON public.billing_schedules
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.unit_billing_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flat_id uuid NOT NULL UNIQUE REFERENCES public.flats(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount >= 0),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.unit_billing_overrides TO authenticated;
GRANT ALL ON public.unit_billing_overrides TO service_role;

ALTER TABLE public.unit_billing_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "society admins manage unit overrides"
ON public.unit_billing_overrides FOR ALL TO authenticated
USING (society_id IN (SELECT public.get_admin_society_ids(auth.uid())))
WITH CHECK (society_id IN (SELECT public.get_admin_society_ids(auth.uid())));

CREATE POLICY "residents view unit overrides in their society"
ON public.unit_billing_overrides FOR SELECT TO authenticated
USING (society_id = public.get_user_society_id(auth.uid()));

CREATE POLICY "super admins full access unit overrides"
ON public.unit_billing_overrides FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER trg_unit_billing_overrides_touch
BEFORE UPDATE ON public.unit_billing_overrides
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
