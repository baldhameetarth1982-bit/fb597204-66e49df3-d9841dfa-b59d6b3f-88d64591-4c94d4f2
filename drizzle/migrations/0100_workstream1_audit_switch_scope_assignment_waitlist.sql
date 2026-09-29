CREATE OR REPLACE FUNCTION public.switch_active_society(_society_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_from uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  IF NOT public.authorize_membership(v_uid,_society_id) OR NOT public.society_has_access(_society_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF NOT public._rate_hit('society_switch',v_uid::text,30,interval '1 hour') THEN RAISE EXCEPTION 'rate_limited'; END IF;
  SELECT p.society_id INTO v_from FROM public.profiles p WHERE p.id=v_uid FOR UPDATE;
  IF v_from IS NOT DISTINCT FROM _society_id THEN RETURN; END IF;
  UPDATE public.profiles SET society_id=_society_id,updated_at=now() WHERE id=v_uid;
  INSERT INTO public.audit_log(actor_id,society_id,target_table,target_id,action,metadata)
  VALUES(v_uid,_society_id,'profiles',v_uid::text,'society.switched',jsonb_build_object('from_society_id',v_from));
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_resident_to_unit(_society_id uuid, _user_id uuid, _flat_id uuid, _relationship text, _is_primary boolean DEFAULT false, _moved_in_at timestamp with time zone DEFAULT now())
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_flat_society uuid; v_flat_active boolean; v_new_id uuid;
BEGIN
  IF NOT public.is_society_admin_for(_society_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _relationship NOT IN ('owner','co-owner','tenant','resident','family') THEN RAISE EXCEPTION 'invalid_relationship'; END IF;
  SELECT f.society_id, coalesce(f.is_active,true) INTO v_flat_society, v_flat_active FROM public.flats f WHERE f.id=_flat_id;
  IF v_flat_society IS NULL OR v_flat_society <> _society_id THEN RAISE EXCEPTION 'unit_not_in_society'; END IF;
  IF NOT v_flat_active THEN RAISE EXCEPTION 'unit_inactive'; END IF;
  IF NOT (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=_user_id AND p.society_id=_society_id)
          OR public.authorize_membership(_user_id,_society_id)) THEN
    RAISE EXCEPTION 'resident_not_in_society';
  END IF;
  IF EXISTS (SELECT 1 FROM public.flat_residents fr WHERE fr.flat_id=_flat_id AND fr.user_id=_user_id
             AND fr.relationship=_relationship AND fr.is_active) THEN
    RAISE EXCEPTION 'duplicate_active_assignment';
  END IF;
  IF _is_primary THEN
    UPDATE public.flat_residents fr SET is_primary=false
      FROM public.flats f
     WHERE f.id=fr.flat_id AND f.society_id=_society_id AND fr.user_id=_user_id AND fr.is_primary;
  END IF;
  INSERT INTO public.flat_residents(flat_id,user_id,relationship,is_primary,is_active,moved_in_at)
    VALUES (_flat_id,_user_id,_relationship,coalesce(_is_primary,false),true,coalesce(_moved_in_at,now()))
    RETURNING id INTO v_new_id;
  INSERT INTO public.audit_log(actor_id,society_id,target_table,target_id,action,metadata)
    VALUES (auth.uid(),_society_id,'flat_residents',v_new_id,'assign',
            jsonb_build_object('user_id',_user_id,'flat_id',_flat_id,'relationship',_relationship));
  RETURN v_new_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.cancel_amenity_booking(_booking_id uuid, _reason text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid:=auth.uid(); b public.amenity_bookings; a public.amenities; w public.amenity_bookings; v_used integer;
BEGIN
  SELECT * INTO b FROM public.amenity_bookings WHERE id=_booking_id FOR UPDATE;
  IF b.id IS NULL OR (b.user_id<>v_uid AND NOT public._amenity_admin(b.society_id)) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO a FROM public.amenities WHERE id=b.amenity_id;
  IF b.status NOT IN('confirmed','waitlisted') THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF b.user_id=v_uid AND b.starts_at<now()+make_interval(hours=>a.cancellation_hours) THEN RAISE EXCEPTION 'cancellation_closed' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(a.id::text,0));
  UPDATE public.amenity_bookings SET status='cancelled',cancelled_at=now(),cancellation_reason=nullif(left(btrim(coalesce(_reason,'')),300),''),updated_at=now() WHERE id=b.id;
  IF b.status='confirmed' THEN
    SELECT coalesce(sum(x.attendees),0)::integer INTO v_used FROM public.amenity_bookings x WHERE x.amenity_id=a.id AND x.status='confirmed' AND x.starts_at<b.ends_at AND x.ends_at>b.starts_at;
    -- Promote only a waitlisted household that still holds valid, unexpired membership.
    SELECT * INTO w FROM public.amenity_bookings x
     WHERE x.amenity_id=a.id AND x.status='waitlisted' AND x.starts_at=b.starts_at AND x.ends_at=b.ends_at
       AND v_used+x.attendees<=a.capacity AND x.starts_at>now()
       AND public.authorize_membership(x.user_id,x.society_id)
     ORDER BY x.created_at FOR UPDATE SKIP LOCKED LIMIT 1;
    IF w.id IS NOT NULL THEN
      UPDATE public.amenity_bookings SET status='confirmed',updated_at=now() WHERE id=w.id;
      PERFORM public._notify_user(w.user_id,w.society_id,'amenity','Amenity booking confirmed',a.name||' is now confirmed','/app/amenities');
    END IF;
  END IF;
  INSERT INTO public.audit_log(actor_id,action,target_table,target_id,society_id,metadata) VALUES(v_uid,'amenity.booking_cancelled','amenity_bookings',b.id::text,b.society_id,jsonb_build_object('reason',left(coalesce(_reason,''),300)));
END $function$;