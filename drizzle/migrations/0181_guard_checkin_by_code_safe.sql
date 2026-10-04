CREATE OR REPLACE FUNCTION public.guard_checkin_by_code(_society_id uuid, _code text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE sid uuid := public._gate_society(); _vid uuid;
BEGIN
  IF sid IS NULL OR sid <> _society_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  -- Single canonical path: expiry, restricted-visitor block, rate limit, resident notification, audit.
  SELECT r.id INTO _vid FROM public.guard_checkin_code(_code) r;
  RETURN _vid;
END $function$;