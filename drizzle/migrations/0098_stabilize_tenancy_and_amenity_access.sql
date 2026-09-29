CREATE OR REPLACE FUNCTION public.authorize_membership(_user_id uuid, _society_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT _user_id IS NOT NULL AND _society_id IS NOT NULL AND (
    public.is_super_admin(_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = _user_id
        AND ur.society_id = _society_id
        AND ur.is_active
        AND (
          ur.role <> 'resident'::public.app_role
          OR EXISTS (
            SELECT 1
            FROM public.flat_residents fr
            JOIN public.flats f ON f.id = fr.flat_id
            WHERE fr.user_id = _user_id
              AND f.society_id = _society_id
              AND fr.is_active
              AND fr.moved_out_at IS NULL
              AND (fr.access_expires_at IS NULL OR fr.access_expires_at > now())
          )
          OR NOT EXISTS (
            SELECT 1
            FROM public.flat_residents fr
            JOIN public.flats f ON f.id = fr.flat_id
            WHERE fr.user_id = _user_id AND f.society_id = _society_id
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.flat_residents fr
      JOIN public.flats f ON f.id = fr.flat_id
      WHERE fr.user_id = _user_id
        AND f.society_id = _society_id
        AND fr.is_active
        AND fr.moved_out_at IS NULL
        AND (fr.access_expires_at IS NULL OR fr.access_expires_at > now())
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.expire_stale_tenancies()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_count integer;
BEGIN
  IF current_user NOT IN ('postgres','service_role','supabase_admin') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;

  WITH expired AS (
    UPDATE public.flat_residents fr
       SET is_active=false,
           moved_out_at=coalesce(fr.moved_out_at,current_date),
           ended_reason=coalesce(fr.ended_reason,'Lease expired'),
           termination_kind='lease_expired'
     WHERE fr.is_active
       AND fr.moved_out_at IS NULL
       AND fr.relationship='tenant'
       AND fr.access_expires_at IS NOT NULL
       AND fr.access_expires_at <= now()
    RETURNING fr.id,fr.user_id,fr.flat_id
  ), deactivated_roles AS (
    UPDATE public.user_roles ur
       SET is_active=false,deactivated_at=now(),updated_at=now()
     WHERE ur.role='resident'::public.app_role
       AND ur.is_active
       AND EXISTS (
         SELECT 1 FROM expired e JOIN public.flats ef ON ef.id=e.flat_id
         WHERE e.user_id=ur.user_id AND ef.society_id=ur.society_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.flat_residents active_fr
         JOIN public.flats active_f ON active_f.id=active_fr.flat_id
         WHERE active_fr.user_id=ur.user_id
           AND active_f.society_id=ur.society_id
           AND active_fr.is_active
           AND active_fr.moved_out_at IS NULL
           AND (active_fr.access_expires_at IS NULL OR active_fr.access_expires_at>now())
       )
    RETURNING ur.id
  ), audited AS (
    INSERT INTO public.audit_log(actor_id,society_id,target_table,target_id,action,metadata)
    SELECT NULL,f.society_id,'flat_residents',e.id,'tenancy.expired',jsonb_build_object('user_id',e.user_id,'flat_id',e.flat_id)
    FROM expired e JOIN public.flats f ON f.id=e.flat_id RETURNING 1
  ) SELECT count(*) INTO v_count FROM audited;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_assign_resident_to_flat(uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_resident_to_flat(uuid,uuid,text,boolean) TO service_role;
COMMENT ON FUNCTION public.admin_assign_resident_to_flat(uuid,uuid,text,boolean) IS 'DEPRECATED: authenticated callers must use the six-argument audited lease-aware overload.';

CREATE OR REPLACE FUNCTION public.book_amenity(_amenity_id uuid, _starts_at timestamptz, _attendees integer, _idempotency_key uuid)
RETURNS TABLE(id uuid,status text) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid:=auth.uid(); a public.amenities; v_flat uuid; v_relationship text; v_end timestamptz; v_used integer; v_week_count integer; v_id uuid; v_status text; v_local timestamp; v_open_minutes integer; v_start_minutes integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF _idempotency_key IS NULL OR _attendees NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid_booking' USING ERRCODE='22023'; END IF;
  SELECT * INTO a FROM public.amenities WHERE amenities.id=_amenity_id AND is_active;
  IF a.id IS NULL OR a.society_id IS DISTINCT FROM public.get_user_society_id(v_uid) OR NOT public.authorize_membership(v_uid,a.society_id) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  SELECT fr.flat_id,coalesce(fr.relationship,'resident') INTO v_flat,v_relationship
  FROM public.flat_residents fr JOIN public.flats f ON f.id=fr.flat_id
  WHERE fr.user_id=v_uid AND fr.is_active AND fr.moved_out_at IS NULL
    AND (fr.access_expires_at IS NULL OR fr.access_expires_at>now())
    AND f.society_id=a.society_id
  ORDER BY fr.is_primary DESC NULLS LAST LIMIT 1;
  IF v_flat IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF v_relationship='tenant' AND NOT a.tenant_allowed THEN RAISE EXCEPTION 'tenant_not_allowed' USING ERRCODE='42501'; END IF;
  IF v_relationship<>'tenant' AND NOT a.owner_allowed THEN RAISE EXCEPTION 'owner_not_allowed' USING ERRCODE='42501'; END IF;
  IF NOT a.defaulters_allowed AND EXISTS (
    SELECT 1 FROM public.maintenance_periods mp
    WHERE mp.society_id=a.society_id AND mp.flat_id=v_flat
      AND mp.status IN ('pending','outstanding') AND mp.due_date<current_date AND mp.amount_due>0
  ) THEN RAISE EXCEPTION 'dues_restricted' USING ERRCODE='42501'; END IF;
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

CREATE OR REPLACE FUNCTION public.expire_stale_amenity_waitlist()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_count integer;
BEGIN
  IF current_user NOT IN ('postgres','service_role','supabase_admin') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  WITH expired AS (
    UPDATE public.amenity_bookings
       SET status='cancelled',cancelled_at=now(),cancellation_reason='expired_unfulfilled',updated_at=now()
     WHERE status='waitlisted' AND ends_at<now()
    RETURNING id,society_id
  ), audited AS (
    INSERT INTO public.audit_log(actor_id,action,target_table,target_id,society_id,metadata)
    SELECT NULL,'amenity.waitlist_expired','amenity_bookings',id::text,society_id,'{}'::jsonb FROM expired RETURNING 1
  ) SELECT count(*) INTO v_count FROM audited;
  RETURN v_count;
END $$;

ALTER POLICY "members read active amenities" ON public.amenities
USING ((society_id=public.get_user_society_id(auth.uid()) AND is_active) OR public._amenity_admin(society_id));

REVOKE ALL ON FUNCTION public.expire_stale_amenity_waitlist() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_amenity_waitlist() TO service_role;

SELECT cron.schedule('expire-stale-tenancies-daily','15 0 * * *','SELECT public.expire_stale_tenancies();');
SELECT cron.schedule('expire-stale-amenity-waitlist-hourly','10 * * * *','SELECT public.expire_stale_amenity_waitlist();');