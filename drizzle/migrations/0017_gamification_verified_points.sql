-- Canonical rule (plan-features: payment_points): 2 points per VERIFIED on-time maintenance payment.
CREATE OR REPLACE FUNCTION public.award_payment_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE bill_due date;
BEGIN
  IF NEW.user_id IS NULL OR NEW.bill_id IS NULL OR NEW.status <> 'success'
     OR NEW.verified_at IS NULL OR NEW.paid_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.verified_at IS NOT NULL AND OLD.status = 'success' THEN
    RETURN NEW;
  END IF;
  IF NOT public._finance_plan_enabled(NEW.society_id) THEN RETURN NEW; END IF;
  SELECT due_date INTO bill_due FROM public.bills WHERE id = NEW.bill_id AND society_id = NEW.society_id;
  IF bill_due IS NULL OR NEW.paid_at::date > bill_due THEN RETURN NEW; END IF;
  INSERT INTO public.user_points (user_id, society_id, points, reason, source_ref)
  VALUES (NEW.user_id, NEW.society_id, 2, 'on_time_payment', NEW.id::text)
  ON CONFLICT (society_id, user_id, reason, source_ref) WHERE source_ref IS NOT NULL DO NOTHING;
  INSERT INTO public.achievements (user_id, society_id, code, title, description)
  VALUES (NEW.user_id, NEW.society_id, 'on_time_payer', 'On-Time Payer', 'Verified maintenance payment on or before the due date')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payment_points ON public.payments;
CREATE TRIGGER trg_payment_points AFTER INSERT OR UPDATE OF status, verified_at ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.award_payment_points();

-- Retired: awarded unverified bill status changes to every flat resident with a conflicting rule.
CREATE OR REPLACE FUNCTION public.award_points_on_bill_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid') AND NEW.paid_at IS NULL THEN
    NEW.paid_at := now();
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.award_points_on_bill_paid() IS 'DEPRECATED points logic: points now come only from verified payments (award_payment_points). Keeps paid_at default only.';

CREATE OR REPLACE FUNCTION public.award_post_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.author_id IS NULL OR NOT public._finance_plan_enabled(NEW.society_id) THEN RETURN NEW; END IF;
  INSERT INTO public.user_points (user_id, society_id, points, reason, source_ref)
  VALUES (NEW.author_id, NEW.society_id, 2, 'post_created', NEW.id::text)
  ON CONFLICT (society_id, user_id, reason, source_ref) WHERE source_ref IS NOT NULL DO NOTHING;
  RETURN NEW;
END $$;

-- Society-scoped leaderboard; society derived from the caller, never from the client.
CREATE OR REPLACE FUNCTION public.get_society_leaderboard(_limit integer DEFAULT 20)
RETURNS TABLE(rank integer, display_name text, avatar_url text, total_points integer, badge_count integer, is_me boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sid uuid := public.get_user_society_id(auth.uid());
BEGIN
  IF auth.uid() IS NULL OR sid IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF NOT public._finance_plan_enabled(sid) THEN RAISE EXCEPTION 'plan_locked' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH pts AS (
    SELECT up.user_id, sum(up.points)::int AS total FROM public.user_points up
    WHERE up.society_id = sid GROUP BY up.user_id HAVING sum(up.points) > 0
  ), b AS (
    SELECT a.user_id, count(*)::int AS n FROM public.achievements a WHERE a.society_id = sid GROUP BY a.user_id
  )
  SELECT (row_number() OVER (ORDER BY pts.total DESC, p.full_name NULLS LAST))::int,
         coalesce(nullif(split_part(p.full_name,' ',1),''),'Resident'),
         p.avatar_url, pts.total, coalesce(b.n,0), pts.user_id = auth.uid()
  FROM pts JOIN public.profiles p ON p.id = pts.user_id AND p.society_id = sid
  LEFT JOIN b ON b.user_id = pts.user_id
  ORDER BY 1 LIMIT greatest(1, least(coalesce(_limit,20), 100));
END $$;
REVOKE ALL ON FUNCTION public.get_society_leaderboard(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_society_leaderboard(integer) TO authenticated;