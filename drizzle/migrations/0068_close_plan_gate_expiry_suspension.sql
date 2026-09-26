-- Stage 16: server plan gates must mirror normalizePlan(): suspended societies,
-- expired paid plans and unknown statuses never unlock paid features.
CREATE OR REPLACE FUNCTION public._finance_plan_enabled(_society_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.societies s
    WHERE s.id=_society_id
      AND lower(btrim(coalesce(s.status,'active'))) = 'active'
      AND CASE
        WHEN lower(coalesce(s.plan_status,'')) IN ('trial','trialing') THEN s.trial_ends_at IS NOT NULL AND s.trial_ends_at > now()
        ELSE lower(coalesce(s.plan_id,'')) IN ('pro','premium')
             AND lower(coalesce(s.plan_status,'')) = 'active'
             AND (s.plan_expires_at IS NULL OR s.plan_expires_at > now())
      END
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_non_member_income_enabled_internal(_society_id uuid)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s record;
BEGIN
  IF _society_id IS NULL THEN RETURN false; END IF;
  SELECT lower(btrim(coalesce(plan_id,''))) AS plan, lower(btrim(coalesce(plan_status,''))) AS pst,
         lower(btrim(coalesce(status,'active'))) AS soc, trial_ends_at, plan_expires_at
    INTO s FROM public.societies WHERE id = _society_id;
  IF NOT FOUND OR s.soc <> 'active' THEN RETURN false; END IF;
  IF s.pst IN ('trial','trialing') THEN
    RETURN s.trial_ends_at IS NOT NULL AND s.trial_ends_at > now();
  END IF;
  IF s.pst <> '' AND s.pst <> 'active' THEN RETURN false; END IF;
  IF s.plan_expires_at IS NOT NULL AND s.plan_expires_at <= now() THEN RETURN false; END IF;
  RETURN s.plan IN ('pro','standard','growth','premium','business','enterprise');
END;
$function$;