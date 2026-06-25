
ALTER TABLE public.societies
  ADD COLUMN IF NOT EXISTS plan_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS plan_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS plan_selected_at timestamptz;

UPDATE public.societies
SET plan_status = CASE
  WHEN plan_id IS NOT NULL AND plan_id <> 'trial' THEN 'active'
  WHEN plan_id = 'trial' THEN 'trialing'
  ELSE 'none'
END,
trial_ends_at = COALESCE(trial_ends_at, CASE WHEN plan_id='trial' THEN now() + interval '14 days' END),
plan_selected_at = COALESCE(plan_selected_at, created_at)
WHERE plan_status = 'none';

CREATE OR REPLACE FUNCTION public.society_has_access(_society_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.societies s WHERE s.id = _society_id
      AND (s.plan_status = 'active'
        OR (s.plan_status = 'trialing' AND s.trial_ends_at > now())));
$$;
REVOKE EXECUTE ON FUNCTION public.society_has_access(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.society_has_access(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.start_trial_for_society(_society_id uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ends timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_society_admin_for(auth.uid(), _society_id) THEN
    RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT trial_ends_at INTO v_ends FROM public.societies WHERE id = _society_id;
  IF v_ends IS NOT NULL THEN RETURN v_ends; END IF;
  v_ends := now() + interval '14 days';
  UPDATE public.societies
    SET plan_id='trial', plan_status='trialing', trial_ends_at=v_ends, plan_selected_at=now()
  WHERE id = _society_id AND plan_status = 'none';
  RETURN v_ends;
END; $$;
REVOKE EXECUTE ON FUNCTION public.start_trial_for_society(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.start_trial_for_society(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.activate_society_plan(_society_id uuid, _plan_id text, _months int DEFAULT 1)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.societies
  SET plan_id=_plan_id, plan_status='active', plan_selected_at=now(),
      plan_expires_at = GREATEST(COALESCE(plan_expires_at, now()), now()) + (_months || ' months')::interval
  WHERE id = _society_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.activate_society_plan(uuid, text, int) FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.resident_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id text NOT NULL DEFAULT 'ad_free',
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.resident_subscriptions TO authenticated;
GRANT ALL ON public.resident_subscriptions TO service_role;
ALTER TABLE public.resident_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "residents read own subscription" ON public.resident_subscriptions;
CREATE POLICY "residents read own subscription" ON public.resident_subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.prevent_society_id_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.society_id IS DISTINCT FROM OLD.society_id
     AND NOT public.is_super_admin(auth.uid()) THEN
    IF NEW.society_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = NEW.id AND society_id = NEW.society_id
    ) THEN
      RAISE EXCEPTION 'society_id can only be changed via join_society_with_code';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS profiles_lock_society_id ON public.profiles;
CREATE TRIGGER profiles_lock_society_id BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_society_id_change();

INSERT INTO public.plans (id, name, price_monthly_inr, txn_fee_pct, ads_enabled, trial_days, is_recommended, features, sort_order)
VALUES ('ad_free', 'Ad-Free (Resident)', 50, 0, false, 0, false,
  '["Remove all ads in your society app"]'::jsonb, 100)
ON CONFLICT (id) DO NOTHING;
