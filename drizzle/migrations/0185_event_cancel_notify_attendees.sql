CREATE OR REPLACE FUNCTION public.admin_cancel_event(_event_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _e community_events; _r record;
BEGIN
  SELECT * INTO _e FROM community_events WHERE id=_event_id FOR UPDATE;
  IF NOT FOUND OR NOT current_user_has_society_permission(_e.society_id,'society.settings',NULL) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  IF _e.status='cancelled' THEN RETURN; END IF;
  IF char_length(trim(coalesce(_reason,''))) < 3 THEN RAISE EXCEPTION 'A reason is required'; END IF;
  UPDATE community_events SET status='cancelled', cancel_reason=trim(_reason) WHERE id=_event_id;
  INSERT INTO audit_log(actor_id,action,target_table,target_id,society_id,metadata) VALUES (auth.uid(),'event.cancel','community_events',_event_id::text,_e.society_id,jsonb_build_object('reason',trim(_reason)));
  FOR _r IN SELECT DISTINCT user_id FROM community_event_rsvps WHERE event_id=_event_id AND status IN ('going','waitlist') LOOP
    BEGIN
      PERFORM public._notify_user(_r.user_id, _e.society_id, 'event_cancelled', left('Event cancelled: '||_e.title,120), left('Reason: '||trim(_reason),300), '/app/community');
    EXCEPTION WHEN others THEN NULL;
    END;
  END LOOP;
END $function$;