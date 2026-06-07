CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer uuid;
  v_ref_code text := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'referral_code', NEW.raw_user_meta_data->>'ref', '')), '');
BEGIN
  IF v_ref_code IS NOT NULL THEN
    SELECT public.find_referrer_by_code(v_ref_code) INTO v_referrer;
  END IF;

  INSERT INTO public.profiles (id, full_name, email, referred_by)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    CASE WHEN v_referrer IS DISTINCT FROM NEW.id THEN v_referrer ELSE NULL END
  )
  ON CONFLICT (id) DO UPDATE
  SET full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
      email = COALESCE(EXCLUDED.email, public.profiles.email),
      referred_by = COALESCE(public.profiles.referred_by, EXCLUDED.referred_by),
      updated_at = now();

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'resident')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_society_invite_code_trigger ON public.societies;
DROP TRIGGER IF EXISTS trg_award_society_referral ON public.user_roles;

CREATE OR REPLACE FUNCTION public.apply_referral_for_current_user(_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_code text := NULLIF(trim(_code), '');
  v_referrer uuid;
  v_own_code text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF v_code IS NULL OR length(v_code) > 16 THEN
    RAISE EXCEPTION 'Invalid referral code';
  END IF;

  SELECT p.referral_code, p.referred_by INTO v_own_code, v_referrer
  FROM public.profiles p
  WHERE p.id = v_user_id;

  IF v_referrer IS NOT NULL THEN
    RETURN true;
  END IF;

  IF upper(COALESCE(v_own_code, '')) = upper(v_code) THEN
    RAISE EXCEPTION 'You cannot refer yourself';
  END IF;

  SELECT public.find_referrer_by_code(v_code) INTO v_referrer;
  IF v_referrer IS NULL OR v_referrer = v_user_id THEN
    RAISE EXCEPTION 'Invalid referral code';
  END IF;

  UPDATE public.profiles p
  SET referred_by = v_referrer,
      updated_at = now()
  WHERE p.id = v_user_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_referral_for_current_user(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_referral_for_current_user(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_referral_for_current_user(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_referral_for_current_user(text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_partner_summary_for_current_user()
RETURNS TABLE(referral_code text, total_earnings numeric, pending_withdrawals numeric, available_balance numeric, referred_societies bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT auth.uid() AS uid
  ), earnings AS (
    SELECT COALESCE(sum(re.amount), 0)::numeric AS total,
           count(DISTINCT re.society_id)::bigint AS societies
    FROM public.referral_earnings re, me
    WHERE re.referrer_id = me.uid
  ), withdrawals_sum AS (
    SELECT COALESCE(sum(w.amount), 0)::numeric AS total
    FROM public.withdrawals w, me
    WHERE w.user_id = me.uid
      AND w.status IN ('pending', 'approved', 'paid')
  )
  SELECT p.referral_code,
         e.total,
         w.total,
         GREATEST(e.total - w.total, 0)::numeric,
         e.societies
  FROM public.profiles p, earnings e, withdrawals_sum w, me
  WHERE p.id = me.uid;
$$;

REVOKE ALL ON FUNCTION public.get_partner_summary_for_current_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_partner_summary_for_current_user() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_partner_summary_for_current_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_summary_for_current_user() TO service_role;

DROP POLICY IF EXISTS "society admins view tickets in their society" ON public.support_tickets;
CREATE POLICY "society admins view tickets in their society"
  ON public.support_tickets FOR SELECT TO authenticated
  USING (society_id IN (SELECT public.get_admin_society_ids(auth.uid())));