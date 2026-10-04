CREATE OR REPLACE FUNCTION public.sos_raise(_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); fid uuid; sid uuid; fl text; aid uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  SELECT fr.flat_id, f.society_id, f.flat_number INTO fid, sid, fl FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
   WHERE fr.user_id = uid AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL
   ORDER BY (fr.flat_id IS NOT DISTINCT FROM public.current_home_flat_id()) DESC, fr.is_primary DESC NULLS LAST LIMIT 1;
  IF fid IS NULL THEN RAISE EXCEPTION 'not_your_flat' USING ERRCODE='42501'; END IF;
  SELECT id INTO aid FROM public.sos_alerts WHERE raised_by=uid AND status <> 'resolved' AND created_at > now() - interval '15 minutes' ORDER BY created_at DESC LIMIT 1;
  IF aid IS NOT NULL THEN RETURN aid; END IF;
  PERFORM public._rate_hit('sos_raise', uid::text, 5, interval '1 hour');
  INSERT INTO public.sos_alerts (society_id, flat_id, raised_by, note) VALUES (sid, fid, uid, public._visitor_clean(_note, 200)) RETURNING id INTO aid;
  PERFORM public._notify_gate_staff(sid, 'sos', 'SOS from ' || coalesce(fl,'a home'), coalesce(public._visitor_clean(_note,200), 'Resident needs urgent help'), '/app/guard', false);
  BEGIN
    PERFORM public._notify_society_admins(sid, 'sos', 'SOS from ' || coalesce(fl,'a home'), coalesce(public._visitor_clean(_note,200), 'Resident needs urgent help'), '/society/visitors');
  EXCEPTION WHEN OTHERS THEN NULL; -- committee alert must never block the guard alert
  END;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'sos.raised', 'sos_alerts', aid::text, sid, '{}'::jsonb);
  RETURN aid;
END $function$;