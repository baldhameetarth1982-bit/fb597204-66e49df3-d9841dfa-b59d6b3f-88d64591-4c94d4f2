
ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_decay_date DATE;

ALTER TABLE public.societies
  ADD COLUMN IF NOT EXISTS signature_url TEXT,
  ADD COLUMN IF NOT EXISTS bill_theme TEXT NOT NULL DEFAULT 'classic';

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_method_chk;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_method_chk CHECK (method IN ('razorpay','manual','online')) NOT VALID;

CREATE TABLE IF NOT EXISTS public.custom_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id UUID NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_inr NUMERIC(10,2) NOT NULL CHECK (price_inr >= 0),
  duration_days INTEGER NOT NULL CHECK (duration_days BETWEEN 1 AND 3650),
  platform_fee_percent NUMERIC(5,2) NOT NULL DEFAULT 1.5 CHECK (platform_fee_percent >= 0 AND platform_fee_percent <= 100),
  notes TEXT,
  applied_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_plans TO authenticated;
GRANT ALL ON public.custom_plans TO service_role;
ALTER TABLE public.custom_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admin_all_custom_plans" ON public.custom_plans;
CREATE POLICY "super_admin_all_custom_plans" ON public.custom_plans
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.custom_plans_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS custom_plans_updated_at ON public.custom_plans;
CREATE TRIGGER custom_plans_updated_at
  BEFORE UPDATE ON public.custom_plans
  FOR EACH ROW EXECUTE FUNCTION public.custom_plans_touch_updated_at();

REVOKE SELECT (invite_code, razorpay_account_id, payout_holder_name, payout_bank_last4, payout_status)
  ON public.societies FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.society_payout_active(_society_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((SELECT payout_status = 'active' FROM public.societies WHERE id = _society_id), false)
  WHERE public.get_user_society_id(auth.uid()) = _society_id
     OR public.is_super_admin(auth.uid())
$$;
REVOKE ALL ON FUNCTION public.society_payout_active(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.society_payout_active(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_society_payout_admin(_society_id UUID)
RETURNS TABLE (payout_status TEXT, payout_bank_last4 TEXT, payout_holder_name TEXT, has_linked_account BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.payout_status, s.payout_bank_last4, s.payout_holder_name, (s.razorpay_account_id IS NOT NULL)
  FROM public.societies s
  WHERE s.id = _society_id
    AND (public.is_society_admin_for(auth.uid(), _society_id) OR public.is_super_admin(auth.uid()))
$$;
REVOKE ALL ON FUNCTION public.get_society_payout_admin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_society_payout_admin(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.award_points_on_bill_paid()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  resident RECORD;
  delta_days INTEGER;
  pts INTEGER;
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid') THEN
    IF NEW.paid_at IS NULL THEN NEW.paid_at := now(); END IF;
    delta_days := GREATEST(0, (NEW.paid_at::date - NEW.due_date));
    IF delta_days = 0 THEN pts := 10; ELSE pts := -delta_days; END IF;
    FOR resident IN SELECT user_id FROM public.flat_residents WHERE flat_id = NEW.flat_id LOOP
      INSERT INTO public.user_points (user_id, society_id, points, reason)
      VALUES (resident.user_id, NEW.society_id, pts,
        CASE WHEN delta_days = 0 THEN 'On-time payment: +10'
             ELSE 'Late payment: -' || delta_days || ' day(s)' END);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_award_points_on_bill_paid ON public.bills;
CREATE TRIGGER trg_award_points_on_bill_paid
  BEFORE UPDATE ON public.bills
  FOR EACH ROW EXECUTE FUNCTION public.award_points_on_bill_paid();

CREATE OR REPLACE FUNCTION public.apply_overdue_point_decay()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE affected INTEGER := 0;
BEGIN
  INSERT INTO public.user_points (user_id, society_id, points, reason)
  SELECT fr.user_id, b.society_id,
         -GREATEST(0, (CURRENT_DATE - COALESCE(b.last_decay_date, b.due_date)))::int,
         'Overdue decay'
  FROM public.bills b
  JOIN public.flat_residents fr ON fr.flat_id = b.flat_id
  WHERE b.status NOT IN ('paid','cancelled')
    AND b.due_date < CURRENT_DATE
    AND (b.last_decay_date IS NULL OR b.last_decay_date < CURRENT_DATE)
    AND (CURRENT_DATE - COALESCE(b.last_decay_date, b.due_date)) > 0;

  UPDATE public.bills b SET last_decay_date = CURRENT_DATE
  WHERE b.status NOT IN ('paid','cancelled')
    AND b.due_date < CURRENT_DATE
    AND (b.last_decay_date IS NULL OR b.last_decay_date < CURRENT_DATE);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END $$;
REVOKE ALL ON FUNCTION public.apply_overdue_point_decay() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_overdue_point_decay() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_global_metrics()
RETURNS TABLE (
  total_users BIGINT, total_societies BIGINT, active_societies BIGINT,
  trialing_societies BIGINT, paid_bills_30d BIGINT, paid_amount_30d NUMERIC, visitors_today BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    (SELECT count(*) FROM public.profiles),
    (SELECT count(*) FROM public.societies),
    (SELECT count(*) FROM public.societies WHERE plan_status = 'active'),
    (SELECT count(*) FROM public.societies WHERE plan_status = 'trialing'),
    (SELECT count(*) FROM public.bills WHERE status = 'paid' AND paid_at > now() - interval '30 days'),
    COALESCE((SELECT sum(amount) FROM public.bills WHERE status = 'paid' AND paid_at > now() - interval '30 days'), 0),
    (SELECT count(*) FROM public.visitors WHERE created_at::date = CURRENT_DATE)
  WHERE public.is_super_admin(auth.uid())
$$;
REVOKE ALL ON FUNCTION public.admin_global_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_global_metrics() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_apply_custom_plan(_custom_plan_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cp RECORD;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT * INTO cp FROM public.custom_plans WHERE id = _custom_plan_id;
  IF cp.id IS NULL THEN RAISE EXCEPTION 'Plan not found'; END IF;
  UPDATE public.societies
  SET plan_status = 'active', plan_selected_at = now(),
      plan_expires_at = now() + (cp.duration_days || ' days')::interval
  WHERE id = cp.society_id;
  UPDATE public.custom_plans SET applied_at = now() WHERE id = cp.id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.admin_apply_custom_plan(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_apply_custom_plan(UUID) TO authenticated;
