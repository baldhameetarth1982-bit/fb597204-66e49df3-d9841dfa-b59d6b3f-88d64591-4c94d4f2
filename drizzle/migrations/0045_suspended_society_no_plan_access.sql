CREATE OR REPLACE FUNCTION public.is_active_society_plan(_society_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.societies s
    WHERE s.id = _society_id
      AND COALESCE(s.status, 'active') = 'active'
      AND (
        (s.plan_status = 'active'
          AND COALESCE(NULLIF(s.plan_id, ''), '') <> ''
          AND COALESCE(s.plan_expires_at, now() + interval '100 years') > now())
        OR (s.plan_status = 'trialing' AND s.trial_ends_at IS NOT NULL AND s.trial_ends_at > now())
      )
  );
$function$;