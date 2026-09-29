CREATE OR REPLACE FUNCTION public.switch_active_society(_society_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_from uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  IF NOT public.authorize_membership(v_uid,_society_id) OR NOT public.society_has_access(_society_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  -- _rate_hit raises rate_limited itself when the limit is exceeded.
  PERFORM public._rate_hit('society_switch',v_uid::text,30,interval '1 hour');
  SELECT p.society_id INTO v_from FROM public.profiles p WHERE p.id=v_uid FOR UPDATE;
  IF v_from IS NOT DISTINCT FROM _society_id THEN RETURN; END IF;
  UPDATE public.profiles SET society_id=_society_id,updated_at=now() WHERE id=v_uid;
  INSERT INTO public.audit_log(actor_id,society_id,target_table,target_id,action,metadata)
  VALUES(v_uid,_society_id,'profiles',v_uid::text,'society.switched',jsonb_build_object('from_society_id',v_from));
END;
$function$;