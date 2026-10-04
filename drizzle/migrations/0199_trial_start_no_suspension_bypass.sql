CREATE OR REPLACE FUNCTION public.start_society_trial(_society_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_days integer; v_consumed timestamptz; v_status text; v_plan_status text; v_ends timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.is_society_admin_for(auth.uid(), _society_id) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT trial_days INTO v_days FROM public.pricing_settings WHERE id = 1;
  v_days := COALESCE(v_days, 14);
  SELECT trial_consumed_at, status, plan_status INTO v_consumed, v_status, v_plan_status
    FROM public.societies WHERE id = _society_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not authorized'; END IF;
  -- A trial never lifts a Super Admin suspension and never replaces a paid plan.
  IF v_status = 'suspended' THEN RAISE EXCEPTION 'This society is suspended. Please contact SociyoHub support.'; END IF;
  IF v_consumed IS NOT NULL THEN RAISE EXCEPTION 'Trial already used for this society'; END IF;
  IF COALESCE(v_plan_status, 'none') NOT IN ('none', 'expired', 'cancelled', 'canceled') THEN
    RAISE EXCEPTION 'This society already has a plan.';
  END IF;
  v_ends := now() + make_interval(days => v_days);
  UPDATE public.societies
     SET plan_id = 'trial', plan_status = 'trialing', trial_ends_at = v_ends,
         trial_consumed_at = now(), plan_selected_at = now(), updated_at = now()
   WHERE id = _society_id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'society.trial_started', 'societies', _society_id::text, _society_id, jsonb_build_object('days', v_days));
  RETURN v_ends;
END $function$;

-- Legacy trial starter: unused by the app and it skipped the one-trial-per-society record.
REVOKE EXECUTE ON FUNCTION public.start_trial_for_society(uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.start_trial_for_society(uuid) IS 'DEPRECATED: use start_society_trial';