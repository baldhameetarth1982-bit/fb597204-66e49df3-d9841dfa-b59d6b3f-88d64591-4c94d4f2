CREATE OR REPLACE FUNCTION public.safety_alert_update(_id uuid, _action text, _note text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE a public.safety_alerts; gsid uuid := public._gate_society(); own boolean; gate boolean;
BEGIN
  SELECT * INTO a FROM public.safety_alerts WHERE id = _id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  own := coalesce(EXISTS (SELECT 1 FROM public._my_active_flat() m WHERE m.flat_id = a.flat_id), false);
  gate := gsid IS NOT NULL AND a.society_id = gsid;
  IF NOT own AND NOT gate THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF _action = 'ack' THEN
    IF NOT gate THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
    IF a.status <> 'raised' THEN RETURN; END IF;
    UPDATE public.safety_alerts SET status='acknowledged', acknowledged_by=auth.uid(), acknowledged_at=now() WHERE id=_id;
    PERFORM public._notify_flat(a.society_id, a.flat_id, 'safety_alert', 'Guard is responding', 'Your safety alert was acknowledged by the gate.', '/app/emergency');
  ELSIF _action = 'resolve' THEN
    IF a.status = 'resolved' THEN RETURN; END IF;
    UPDATE public.safety_alerts SET status='resolved', resolved_by=auth.uid(), resolved_at=now(), resolution_note=public._visitor_clean(_note,300) WHERE id=_id;
    PERFORM public._notify_gate_staff(a.society_id, 'safety_alert', 'Safety alert resolved', coalesce(public._visitor_clean(_note,200),'Marked safe.'), '/app/guard', false);
  ELSE RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata) VALUES (auth.uid(), 'safety.alert_' || _action, 'safety_alerts', _id::text, a.society_id, '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.safety_alert_update(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.safety_alert_update(uuid,text,text) TO authenticated, service_role;