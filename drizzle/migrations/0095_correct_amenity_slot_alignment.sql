CREATE OR REPLACE FUNCTION public.book_amenity(_amenity_id uuid, _starts_at timestamptz, _attendees integer, _idempotency_key uuid)
RETURNS TABLE(id uuid,status text) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid:=auth.uid(); a public.amenities; v_flat uuid; v_relationship text; v_end timestamptz; v_used integer; v_week_count integer; v_id uuid; v_status text; v_local timestamp; v_open_minutes integer; v_start_minutes integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF _idempotency_key IS NULL OR _attendees NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid_booking' USING ERRCODE='22023'; END IF;
  SELECT * INTO a FROM public.amenities WHERE amenities.id=_amenity_id AND is_active;
  IF a.id IS NULL OR a.society_id IS DISTINCT FROM public.get_user_society_id(v_uid) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  SELECT fr.flat_id,coalesce(fr.relationship,'resident') INTO v_flat,v_relationship FROM public.flat_residents fr JOIN public.flats f ON f.id=fr.flat_id
  WHERE fr.user_id=v_uid AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL AND f.society_id=a.society_id ORDER BY fr.is_primary DESC NULLS LAST LIMIT 1;
  IF v_flat IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF v_relationship='tenant' AND NOT a.tenant_allowed THEN RAISE EXCEPTION 'tenant_not_allowed' USING ERRCODE='42501'; END IF;
  IF v_relationship<>'tenant' AND NOT a.owner_allowed THEN RAISE EXCEPTION 'owner_not_allowed' USING ERRCODE='42501'; END IF;
  v_end:=_starts_at+make_interval(mins=>a.slot_minutes);
  v_local:=_starts_at AT TIME ZONE 'Asia/Kolkata';
  v_open_minutes:=extract(hour from a.opens_at)::integer*60+extract(minute from a.opens_at)::integer;
  v_start_minutes:=extract(hour from v_local)::integer*60+extract(minute from v_local)::integer;
  IF _starts_at<now() OR _starts_at>now()+make_interval(days=>a.advance_days)
     OR v_local::time<a.opens_at OR (v_end AT TIME ZONE 'Asia/Kolkata')::time>a.closes_at
     OR extract(second from v_local)<>0 OR mod(v_start_minutes-v_open_minutes,a.slot_minutes)<>0
     OR _attendees>a.capacity THEN RAISE EXCEPTION 'invalid_slot' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.amenity_blocked_dates b WHERE b.amenity_id=a.id AND b.blocked_date=v_local::date) THEN RAISE EXCEPTION 'blocked_date' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('amenity_book',v_uid::text,30,interval '1 hour');
  PERFORM pg_advisory_xact_lock(hashtextextended(a.id::text,0));
  SELECT b.id,b.status INTO v_id,v_status FROM public.amenity_bookings b WHERE b.user_id=v_uid AND b.idempotency_key=_idempotency_key;
  IF v_id IS NOT NULL THEN RETURN QUERY SELECT v_id,v_status; RETURN; END IF;
  IF a.weekly_household_limit IS NOT NULL THEN
    SELECT count(*) INTO v_week_count FROM public.amenity_bookings b WHERE b.amenity_id=a.id AND b.flat_id=v_flat AND b.status IN('confirmed','completed','no_show') AND b.starts_at>=date_trunc('week',_starts_at) AND b.starts_at<date_trunc('week',_starts_at)+interval '7 days';
    IF v_week_count>=a.weekly_household_limit THEN RAISE EXCEPTION 'weekly_limit' USING ERRCODE='22023'; END IF;
  END IF;
  SELECT coalesce(sum(b.attendees),0)::integer INTO v_used FROM public.amenity_bookings b WHERE b.amenity_id=a.id AND b.status='confirmed' AND b.starts_at<v_end AND b.ends_at>_starts_at;
  v_status:=CASE WHEN v_used+_attendees<=a.capacity THEN 'confirmed' ELSE 'waitlisted' END;
  INSERT INTO public.amenity_bookings(amenity_id,society_id,flat_id,user_id,starts_at,ends_at,attendees,status,idempotency_key)
  VALUES(a.id,a.society_id,v_flat,v_uid,_starts_at,v_end,_attendees,v_status,_idempotency_key) RETURNING amenity_bookings.id INTO v_id;
  INSERT INTO public.audit_log(actor_id,action,target_table,target_id,society_id,metadata)
  VALUES(v_uid,'amenity.booking_'||v_status,'amenity_bookings',v_id::text,a.society_id,jsonb_build_object('amenity_id',a.id,'starts_at',_starts_at,'attendees',_attendees));
  RETURN QUERY SELECT v_id,v_status;
END $$;
REVOKE ALL ON FUNCTION public.book_amenity(uuid,timestamptz,integer,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_amenity(uuid,timestamptz,integer,uuid) TO authenticated;