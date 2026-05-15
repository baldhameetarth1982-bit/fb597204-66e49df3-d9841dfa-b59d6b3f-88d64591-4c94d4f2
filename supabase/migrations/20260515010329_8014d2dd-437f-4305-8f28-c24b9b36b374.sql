
-- ============ REFERRAL CODES ON PROFILES ============
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Generator: 8-char alphanum
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
DECLARE chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; result TEXT := ''; i INT;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(chars, floor(random() * length(chars))::int + 1, 1);
  END LOOP;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.set_profile_referral_code()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE new_code text; tries int := 0;
BEGIN
  IF NEW.referral_code IS NOT NULL THEN RETURN NEW; END IF;
  LOOP
    new_code := public.generate_referral_code();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = new_code);
    tries := tries + 1;
    IF tries > 8 THEN RAISE EXCEPTION 'Could not allocate referral code'; END IF;
  END LOOP;
  NEW.referral_code := new_code;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_profiles_referral_code ON public.profiles;
CREATE TRIGGER trg_profiles_referral_code
BEFORE INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_profile_referral_code();

-- Backfill existing
UPDATE public.profiles SET referral_code = public.generate_referral_code()
WHERE referral_code IS NULL;

-- Lookup function (security definer so anyone can resolve a code -> referrer id)
CREATE OR REPLACE FUNCTION public.find_referrer_by_code(_code text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.profiles WHERE upper(referral_code) = upper(_code) LIMIT 1;
$$;

-- ============ REFERRAL EARNINGS ============
CREATE TABLE IF NOT EXISTS public.referral_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL,
  referred_user_id uuid NOT NULL,
  society_id uuid,
  amount numeric NOT NULL DEFAULT 0,
  rate numeric NOT NULL DEFAULT 0.10, -- 10% default
  status text NOT NULL DEFAULT 'pending', -- pending | paid
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.referral_earnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users view own earnings"
  ON public.referral_earnings FOR SELECT TO authenticated
  USING (referrer_id = auth.uid());

CREATE POLICY "super admin earnings full"
  ON public.referral_earnings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- Award trigger: when a society is created, if creator was referred, give referrer ₹500 placeholder + 10%
CREATE OR REPLACE FUNCTION public.award_society_referral()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ref uuid; signup_bonus numeric := 500;
BEGIN
  -- find creator (society_admin role row created right after society insert; we use most recent admin)
  SELECT p.referred_by INTO ref FROM public.profiles p
    WHERE p.id = (SELECT user_id FROM public.user_roles
                  WHERE society_id = NEW.id AND role = 'society_admin'
                  ORDER BY created_at DESC LIMIT 1);
  IF ref IS NOT NULL THEN
    INSERT INTO public.referral_earnings (referrer_id, referred_user_id, society_id, amount, rate, note)
    VALUES (ref,
            (SELECT user_id FROM public.user_roles WHERE society_id = NEW.id AND role = 'society_admin' ORDER BY created_at DESC LIMIT 1),
            NEW.id, signup_bonus, 0.10, 'Society signup commission');
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_award_society_referral ON public.user_roles;
CREATE TRIGGER trg_award_society_referral
AFTER INSERT ON public.user_roles
FOR EACH ROW
WHEN (NEW.role = 'society_admin' AND NEW.society_id IS NOT NULL)
EXECUTE FUNCTION public.award_society_referral();

-- ============ WITHDRAWALS ============
CREATE TABLE IF NOT EXISTS public.withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount numeric NOT NULL,
  method text NOT NULL DEFAULT 'upi', -- upi | bank
  upi_id text,
  bank_account text,
  bank_ifsc text,
  status text NOT NULL DEFAULT 'pending', -- pending | approved | rejected | paid
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own withdrawals"
  ON public.withdrawals FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "super admin withdrawals"
  ON public.withdrawals FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER trg_withdrawals_updated
BEFORE UPDATE ON public.withdrawals
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ SUPPORT TICKETS ============
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  society_id uuid,
  subject text NOT NULL,
  description text NOT NULL,
  ai_transcript jsonb,
  status text NOT NULL DEFAULT 'open', -- open | in_progress | resolved
  priority text NOT NULL DEFAULT 'normal',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own tickets"
  ON public.support_tickets FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "society admins view tickets in their society"
  ON public.support_tickets FOR SELECT TO authenticated
  USING (society_id IN (
    SELECT society_id FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'society_admin'
  ));

CREATE POLICY "super admin tickets"
  ON public.support_tickets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER trg_tickets_updated
BEFORE UPDATE ON public.support_tickets
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
