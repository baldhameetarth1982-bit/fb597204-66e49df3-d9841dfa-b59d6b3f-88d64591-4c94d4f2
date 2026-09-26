CREATE OR REPLACE FUNCTION public.admin_cancel_society_plan(_society_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_caller uuid := auth.uid(); v_old record;
BEGIN
  IF v_caller IS NULL OR NOT public.is_super_admin(v_caller) THEN RETURN jsonb_build_object('status','not_authorized'); END IF;
  IF _reason IS NULL OR char_length(btrim(_reason)) < 3 OR char_length(_reason) > 300 THEN RETURN jsonb_build_object('status','reason_required'); END IF;
  SELECT plan_id, plan_status, plan_expires_at, trial_ends_at INTO v_old FROM public.societies WHERE id = _society_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
  IF lower(coalesce(v_old.plan_status,'')) = 'canceled' THEN RETURN jsonb_build_object('status','unchanged'); END IF;
  UPDATE public.societies SET plan_status = 'canceled', updated_at = now() WHERE id = _society_id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (v_caller, 'super_admin.plan_canceled', 'societies', _society_id::text, _society_id,
    jsonb_build_object('from_status', v_old.plan_status, 'plan_id', v_old.plan_id, 'plan_expires_at', v_old.plan_expires_at, 'trial_ends_at', v_old.trial_ends_at, 'reason', btrim(_reason)));
  RETURN jsonb_build_object('status','success');
END $$;
REVOKE ALL ON FUNCTION public.admin_cancel_society_plan(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_society_plan(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_society_access_status(_society_id uuid)
 RETURNS TABLE(status text, plan_id text, trial_ends_at timestamp with time zone, plan_expires_at timestamp with time zone, trial_consumed_at timestamp with time zone)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s RECORD;
BEGIN
  IF _society_id IS NULL OR auth.uid() IS NULL THEN
    RETURN QUERY SELECT 'none'::text, NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz; RETURN;
  END IF;
  IF NOT public.authorize_membership(auth.uid(), _society_id) AND NOT public.is_super_admin(auth.uid()) THEN
    RETURN QUERY SELECT 'forbidden'::text, NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz; RETURN;
  END IF;
  SELECT so.plan_id, so.plan_status, so.trial_ends_at, so.plan_expires_at, so.trial_consumed_at, so.status AS soc_status
    INTO s FROM public.societies so WHERE so.id = _society_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'none'::text, NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz; RETURN;
  END IF;
  IF lower(coalesce(s.soc_status,'')) = 'suspended' THEN
    RETURN QUERY SELECT 'suspended'::text, s.plan_id::text, s.trial_ends_at, s.plan_expires_at, s.trial_consumed_at;
  ELSIF s.plan_status = 'trialing' AND s.trial_ends_at IS NOT NULL AND s.trial_ends_at > now() THEN
    RETURN QUERY SELECT 'trial'::text, s.plan_id::text, s.trial_ends_at, s.plan_expires_at, s.trial_consumed_at;
  ELSIF s.plan_status = 'trialing' THEN
    RETURN QUERY SELECT 'trial_expired'::text, s.plan_id::text, s.trial_ends_at, s.plan_expires_at, s.trial_consumed_at;
  ELSIF s.plan_status = 'active' AND (s.plan_expires_at IS NULL OR s.plan_expires_at > now()) THEN
    RETURN QUERY SELECT 'active'::text, s.plan_id::text, s.trial_ends_at, s.plan_expires_at, s.trial_consumed_at;
  ELSIF s.plan_status = 'active' THEN
    RETURN QUERY SELECT 'past_due'::text, s.plan_id::text, s.trial_ends_at, s.plan_expires_at, s.trial_consumed_at;
  ELSE
    RETURN QUERY SELECT COALESCE(s.plan_status,'none')::text, s.plan_id::text, s.trial_ends_at, s.plan_expires_at, s.trial_consumed_at;
  END IF;
END $function$;