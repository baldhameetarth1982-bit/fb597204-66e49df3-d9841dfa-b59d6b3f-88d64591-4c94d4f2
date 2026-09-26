CREATE OR REPLACE FUNCTION public.admin_apply_custom_plan(_custom_plan_id uuid, _reason text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE cp RECORD;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  IF length(btrim(coalesce(_reason,''))) < 5 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  SELECT * INTO cp FROM public.custom_plans WHERE id = _custom_plan_id;
  IF cp.id IS NULL THEN RAISE EXCEPTION 'Plan not found'; END IF;
  UPDATE public.societies
  SET plan_status = 'active', plan_selected_at = now(),
      plan_expires_at = now() + (cp.duration_days || ' days')::interval
  WHERE id = cp.society_id;
  UPDATE public.custom_plans SET applied_at = now() WHERE id = cp.id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'custom_plan.applied', 'custom_plans', cp.id::text, cp.society_id,
          jsonb_build_object('duration_days', cp.duration_days, 'reason', btrim(_reason)));
  RETURN true;
END $function$;
REVOKE EXECUTE ON FUNCTION public.admin_apply_custom_plan(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_apply_custom_plan(uuid, text) TO authenticated;
CREATE OR REPLACE FUNCTION public.admin_apply_custom_plan(_custom_plan_id uuid)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'reason_required' USING ERRCODE='22023';
END $function$;