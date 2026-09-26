CREATE OR REPLACE FUNCTION public.admin_grant_society_plan(_society_id uuid, _plan_id text, _months integer, _extend boolean, _reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid(); v_base timestamptz;
  v_months integer := LEAST(GREATEST(COALESCE(_months, 1), 1), 120);
  v_plan text := NULLIF(trim(_plan_id), ''); v_old record;
  v_reason text := NULLIF(trim(COALESCE(_reason,'')), '');
BEGIN
  IF v_caller IS NULL OR NOT public.is_super_admin(v_caller) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF v_reason IS NULL OR length(v_reason) < 5 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF _society_id IS NULL OR v_plan IS NULL THEN RAISE EXCEPTION 'society_id and plan_id required'; END IF;
  IF v_plan IN ('trial','ad_free','resident') OR NOT EXISTS (SELECT 1 FROM public.plans WHERE id = v_plan) THEN RAISE EXCEPTION 'Unknown plan: %', v_plan; END IF;
  SELECT plan_id, plan_status, plan_expires_at INTO v_old FROM public.societies WHERE id = _society_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown society'; END IF;
  IF _extend THEN v_base := GREATEST(COALESCE(v_old.plan_expires_at, now()), now()); ELSE v_base := now(); END IF;
  UPDATE public.societies SET plan_id = v_plan, plan_status = 'active', plan_selected_at = now(),
    plan_expires_at = v_base + (v_months || ' months')::interval, status = 'active', updated_at = now()
  WHERE id = _society_id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (v_caller, 'super_admin.plan_granted', 'societies', _society_id::text, _society_id,
    jsonb_build_object('from_plan', v_old.plan_id, 'from_status', v_old.plan_status, 'to_plan', v_plan, 'months', v_months, 'extend', _extend, 'reason', left(v_reason, 500)));
END; $function$;
REVOKE ALL ON FUNCTION public.admin_grant_society_plan(uuid,text,integer,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_society_plan(uuid,text,integer,boolean,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_grant_society_plan(uuid,text,integer,boolean) FROM authenticated;
COMMENT ON FUNCTION public.admin_grant_society_plan(uuid,text,integer,boolean) IS 'DEPRECATED: use the 5-argument version that requires a reason';