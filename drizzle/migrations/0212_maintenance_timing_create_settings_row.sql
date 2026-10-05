CREATE OR REPLACE FUNCTION public.set_maintenance_timing(_society_id uuid, _timing text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid; v_old text;
BEGIN
  v_uid := public._finance_require_admin(_society_id);
  IF _timing NOT IN ('post','current','pre') THEN RAISE EXCEPTION 'invalid_timing' USING ERRCODE='22023'; END IF;
  INSERT INTO public.society_settings(society_id) VALUES (_society_id) ON CONFLICT (society_id) DO NOTHING;
  SELECT maintenance_timing INTO v_old FROM public.society_settings WHERE society_id=_society_id FOR UPDATE;
  IF v_old IS NOT DISTINCT FROM _timing THEN RETURN; END IF;
  UPDATE public.society_settings SET maintenance_timing=_timing WHERE society_id=_society_id;
  INSERT INTO public.audit_log(actor_id,society_id,action,target_table,metadata) VALUES (v_uid,_society_id,'finance.maintenance_timing_changed','society_settings',jsonb_build_object('old',v_old,'new',_timing));
END $function$;