-- ============ 1. Multi-home: server-validated active home ============
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS active_flat_id uuid REFERENCES public.flats(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public._home_link_valid(_uid uuid, _flat uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND _flat IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.flat_residents fr
    WHERE fr.user_id = _uid AND fr.flat_id = _flat AND fr.is_active AND fr.moved_out_at IS NULL
      AND (fr.access_expires_at IS NULL OR fr.access_expires_at > now())
      AND (fr.moved_in_at IS NULL OR fr.moved_in_at <= current_date))
$$;
REVOKE ALL ON FUNCTION public._home_link_valid(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.current_home_flat_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT p.active_flat_id FROM public.profiles p JOIN public.flats f ON f.id = p.active_flat_id
      WHERE p.id = auth.uid() AND f.society_id = p.society_id AND public._home_link_valid(auth.uid(), p.active_flat_id)),
    (SELECT fr.flat_id FROM public.flat_residents fr
       JOIN public.flats f ON f.id = fr.flat_id
       JOIN public.profiles p ON p.id = auth.uid()
      WHERE fr.user_id = auth.uid() AND f.society_id = p.society_id
        AND public._home_link_valid(auth.uid(), fr.flat_id)
      ORDER BY fr.is_primary DESC NULLS LAST, fr.created_at, fr.flat_id LIMIT 1))
$$;
REVOKE ALL ON FUNCTION public.current_home_flat_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_home_flat_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_homes()
RETURNS TABLE(flat_id uuid, flat_number text, block_name text, society_id uuid, society_name text, relationship text, is_active_home boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cur AS (SELECT public.current_home_flat_id() AS id)
  SELECT DISTINCT ON (f.id) f.id, f.flat_number, b.name, s.id, s.name, coalesce(fr.relationship, 'resident'), f.id = cur.id
  FROM public.flat_residents fr
  JOIN public.flats f ON f.id = fr.flat_id
  JOIN public.societies s ON s.id = f.society_id
  LEFT JOIN public.blocks b ON b.id = f.block_id
  CROSS JOIN cur
  WHERE fr.user_id = auth.uid() AND public._home_link_valid(auth.uid(), f.id) AND public.society_has_access(s.id)
  ORDER BY f.id
$$;
REVOKE ALL ON FUNCTION public.list_my_homes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_homes() TO authenticated;

CREATE OR REPLACE FUNCTION public.switch_active_home(_flat_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_soc uuid; v_from_soc uuid; v_from_flat uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  -- Server decides: only a current, valid occupancy of this very person may become active.
  IF NOT public._home_link_valid(v_uid, _flat_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  SELECT f.society_id INTO v_soc FROM public.flats f WHERE f.id = _flat_id;
  IF v_soc IS NULL OR NOT public.society_has_access(v_soc) OR NOT public.authorize_membership(v_uid, v_soc) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  PERFORM public._rate_hit('home_switch', v_uid::text, 30, interval '1 hour');
  SELECT p.society_id, p.active_flat_id INTO v_from_soc, v_from_flat FROM public.profiles p WHERE p.id = v_uid FOR UPDATE;
  IF v_from_soc IS DISTINCT FROM v_soc THEN
    PERFORM set_config('app.allow_society_change','on',true);
    UPDATE public.profiles SET society_id = v_soc, active_flat_id = _flat_id, updated_at = now() WHERE id = v_uid;
    PERFORM set_config('app.allow_society_change','off',true);
  ELSIF v_from_flat IS DISTINCT FROM _flat_id THEN
    UPDATE public.profiles SET active_flat_id = _flat_id, updated_at = now() WHERE id = v_uid;
  ELSE
    RETURN jsonb_build_object('flat_id', _flat_id, 'society_id', v_soc, 'changed', false);
  END IF;
  INSERT INTO public.audit_log(actor_id, society_id, target_table, target_id, action, metadata)
  VALUES (v_uid, v_soc, 'profiles', v_uid::text, 'home.switched',
          jsonb_build_object('from_flat_id', v_from_flat, 'to_flat_id', _flat_id, 'from_society_id', v_from_soc));
  RETURN jsonb_build_object('flat_id', _flat_id, 'society_id', v_soc, 'changed', true);
END $$;
REVOKE ALL ON FUNCTION public.switch_active_home(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.switch_active_home(uuid) TO authenticated;

-- Canonical "my flat" resolver now honours the selected home within the current society.
CREATE OR REPLACE FUNCTION public._my_active_flat()
RETURNS TABLE(flat_id uuid, society_id uuid, flat_number text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f.society_id, f.flat_number FROM public.flats f WHERE f.id = public.current_home_flat_id()
$$;

-- Resident actions that pick "my flat" inline now prefer the selected home.
DO $$
DECLARE fn text; def text; newdef text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['election_cast_ballot','resident_upsert_recurring_pass','sos_raise','visitor_invite'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = fn;
    newdef := regexp_replace(def, 'ORDER BY fr\.is_primary DESC( NULLS LAST)?',
      'ORDER BY (fr.flat_id IS NOT DISTINCT FROM public.current_home_flat_id()) DESC, fr.is_primary DESC NULLS LAST', 'g');
    IF newdef = def THEN RAISE EXCEPTION 'home_patch_missed:%', fn; END IF;
    EXECUTE newdef;
  END LOOP;
END $$;

-- ============ 2. Amenity eligibility (owner / tenant / household) ============
ALTER TABLE public.amenities ADD COLUMN IF NOT EXISTS household_allowed boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public._amenity_eligibility(_uid uuid, _flat uuid, _amenity_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.amenities; v_rel text; v_lease date;
BEGIN
  SELECT * INTO a FROM public.amenities WHERE id = _amenity_id;
  IF a.id IS NULL OR NOT a.is_active THEN RETURN 'amenity_closed'; END IF;
  SELECT coalesce(fr.relationship,'resident'), fr.lease_ends_on INTO v_rel, v_lease
    FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
   WHERE fr.user_id = _uid AND fr.flat_id = _flat AND f.society_id = a.society_id
     AND public._home_link_valid(_uid, _flat)
   ORDER BY fr.created_at DESC LIMIT 1;
  IF v_rel IS NULL THEN RETURN 'not_current_resident'; END IF;
  IF NOT public._authorize_membership_internal(_uid, a.society_id) THEN RETURN 'not_current_resident'; END IF;
  IF v_rel = 'tenant' THEN
    IF NOT a.tenant_allowed THEN RETURN 'tenant_not_allowed'; END IF;
    IF v_lease IS NOT NULL AND v_lease < current_date THEN RETURN 'tenancy_expired'; END IF;
  ELSIF v_rel = 'owner' THEN
    IF NOT a.owner_allowed THEN RETURN 'owner_not_allowed'; END IF;
  ELSE
    IF NOT a.household_allowed THEN RETURN 'household_not_allowed'; END IF;
  END IF;
  IF NOT a.defaulters_allowed AND EXISTS (
    SELECT 1 FROM public.maintenance_periods mp
     WHERE mp.society_id = a.society_id AND mp.flat_id = _flat
       AND mp.status IN ('pending','outstanding') AND mp.due_date < current_date AND mp.amount_due > 0)
  THEN RETURN 'dues_restricted'; END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._amenity_eligibility(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_amenity_household_policy(_amenity_id uuid, _household_allowed boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_soc uuid;
BEGIN
  SELECT society_id INTO v_soc FROM public.amenities WHERE id = _amenity_id;
  IF v_soc IS NULL OR NOT public._amenity_admin(v_soc) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  UPDATE public.amenities SET household_allowed = coalesce(_household_allowed, true), updated_at = now() WHERE id = _amenity_id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'amenity.policy_updated', 'amenities', _amenity_id::text, v_soc, jsonb_build_object('household_allowed', _household_allowed));
END $$;
REVOKE ALL ON FUNCTION public.admin_set_amenity_household_policy(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_amenity_household_policy(uuid, boolean) TO authenticated;

-- ============ 3. Waitlist promotion history ============
CREATE TABLE public.amenity_waitlist_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  amenity_id uuid NOT NULL REFERENCES public.amenities(id) ON DELETE CASCADE,
  freed_booking_id uuid REFERENCES public.amenity_bookings(id) ON DELETE SET NULL,
  candidate_booking_id uuid REFERENCES public.amenity_bookings(id) ON DELETE SET NULL,
  outcome text NOT NULL CHECK (outcome IN ('promoted','skipped_ineligible','skipped_capacity','no_eligible','eligibility_lost')),
  reason text CHECK (reason IS NULL OR char_length(reason) <= 120),
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.amenity_waitlist_events TO authenticated;
GRANT ALL ON public.amenity_waitlist_events TO service_role;
ALTER TABLE public.amenity_waitlist_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins and own household read waitlist events" ON public.amenity_waitlist_events FOR SELECT TO authenticated
USING (public._amenity_admin(society_id) OR EXISTS (SELECT 1 FROM public.amenity_bookings b WHERE b.id = candidate_booking_id AND b.user_id = auth.uid()));
CREATE UNIQUE INDEX amenity_waitlist_one_promotion ON public.amenity_waitlist_events(candidate_booking_id) WHERE outcome = 'promoted';
CREATE INDEX amenity_waitlist_events_amenity ON public.amenity_waitlist_events(amenity_id, created_at DESC);
CREATE TRIGGER trg_amenity_waitlist_events_append_only BEFORE UPDATE OR DELETE ON public.amenity_waitlist_events FOR EACH ROW EXECUTE FUNCTION public._append_only();

-- Deterministic promotion: oldest first (created_at, id), each candidate re-checked, every decision recorded.
CREATE OR REPLACE FUNCTION public._promote_amenity_waitlist(_freed_id uuid, _actor uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE fb public.amenity_bookings; a public.amenities; w public.amenity_bookings; v_used integer; v_reason text; v_promoted integer := 0;
BEGIN
  SELECT * INTO fb FROM public.amenity_bookings WHERE id = _freed_id;
  IF fb.id IS NULL THEN RETURN 0; END IF;
  SELECT * INTO a FROM public.amenities WHERE id = fb.amenity_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(a.id::text, 0));
  IF fb.starts_at <= now() THEN RETURN 0; END IF;
  SELECT coalesce(sum(x.attendees),0)::integer INTO v_used FROM public.amenity_bookings x
   WHERE x.amenity_id = a.id AND x.status = 'confirmed' AND x.starts_at < fb.ends_at AND x.ends_at > fb.starts_at;
  FOR w IN SELECT * FROM public.amenity_bookings x
            WHERE x.amenity_id = a.id AND x.status = 'waitlisted' AND x.starts_at = fb.starts_at AND x.ends_at = fb.ends_at
            ORDER BY x.created_at, x.id FOR UPDATE LOOP
    EXIT WHEN v_used >= a.capacity;
    v_reason := public._amenity_eligibility(w.user_id, w.flat_id, a.id);
    IF v_reason IS NOT NULL THEN
      INSERT INTO public.amenity_waitlist_events(society_id, amenity_id, freed_booking_id, candidate_booking_id, outcome, reason, actor_id)
      VALUES (a.society_id, a.id, fb.id, w.id, 'skipped_ineligible', v_reason, _actor);
      IF v_reason <> 'dues_restricted' THEN
        UPDATE public.amenity_bookings SET status='cancelled', cancelled_at=now(), cancellation_reason='eligibility_lost:'||v_reason, updated_at=now() WHERE id = w.id;
      END IF;
      CONTINUE;
    END IF;
    IF v_used + w.attendees > a.capacity THEN
      INSERT INTO public.amenity_waitlist_events(society_id, amenity_id, freed_booking_id, candidate_booking_id, outcome, reason, actor_id)
      VALUES (a.society_id, a.id, fb.id, w.id, 'skipped_capacity', 'party_larger_than_free_capacity', _actor);
      CONTINUE;
    END IF;
    UPDATE public.amenity_bookings SET status='confirmed', updated_at=now() WHERE id = w.id;
    INSERT INTO public.amenity_waitlist_events(society_id, amenity_id, freed_booking_id, candidate_booking_id, outcome, reason, actor_id)
    VALUES (a.society_id, a.id, fb.id, w.id, 'promoted', 'first_eligible_in_queue', _actor);
    INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (_actor, 'amenity.waitlist_promoted', 'amenity_bookings', w.id::text, a.society_id, jsonb_build_object('freed_booking_id', fb.id, 'flat_id', w.flat_id));
    PERFORM public._notify_user_once(w.user_id, w.society_id, 'amenity', 'Amenity booking confirmed',
      a.name || ' moved off the waitlist and is now confirmed', '/app/amenities', 'amenity-promoted:' || w.id::text, 'normal');
    v_used := v_used + w.attendees; v_promoted := v_promoted + 1;
  END LOOP;
  IF v_promoted = 0 THEN
    INSERT INTO public.amenity_waitlist_events(society_id, amenity_id, freed_booking_id, outcome, reason, actor_id)
    VALUES (a.society_id, a.id, fb.id, 'no_eligible', 'slot_left_available', _actor);
  END IF;
  RETURN v_promoted;
END $$;
REVOKE ALL ON FUNCTION public._promote_amenity_waitlist(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.book_amenity(_amenity_id uuid, _starts_at timestamp with time zone, _attendees integer, _idempotency_key uuid)
RETURNS TABLE(id uuid, status text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_uid uuid:=auth.uid(); a public.amenities; v_flat uuid; v_reason text; v_end timestamptz; v_used integer; v_week_count integer; v_id uuid; v_status text; v_local timestamp; v_open_minutes integer; v_start_minutes integer; v_home uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF _idempotency_key IS NULL OR _attendees NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid_booking' USING ERRCODE='22023'; END IF;
  SELECT * INTO a FROM public.amenities WHERE amenities.id=_amenity_id AND is_active;
  IF a.id IS NULL OR a.society_id IS DISTINCT FROM public.get_user_society_id(v_uid) OR NOT public.authorize_membership(v_uid,a.society_id) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  -- Household = the selected home (server-resolved), never a client-supplied flat.
  v_home := public.current_home_flat_id();
  SELECT fr.flat_id INTO v_flat FROM public.flat_residents fr JOIN public.flats f ON f.id=fr.flat_id
   WHERE fr.user_id=v_uid AND f.society_id=a.society_id AND public._home_link_valid(v_uid, fr.flat_id)
   ORDER BY (fr.flat_id IS NOT DISTINCT FROM v_home) DESC, fr.is_primary DESC NULLS LAST, fr.created_at LIMIT 1;
  IF v_flat IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  v_reason := public._amenity_eligibility(v_uid, v_flat, a.id);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION '%', CASE WHEN v_reason IN ('not_current_resident','amenity_closed') THEN 'not_authorized' ELSE v_reason END USING ERRCODE='42501';
  END IF;
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
  VALUES(v_uid,'amenity.booking_'||v_status,'amenity_bookings',v_id::text,a.society_id,jsonb_build_object('amenity_id',a.id,'starts_at',_starts_at,'attendees',_attendees,'flat_id',v_flat));
  RETURN QUERY SELECT v_id,v_status;
END $function$;

CREATE OR REPLACE FUNCTION public.cancel_amenity_booking(_booking_id uuid, _reason text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_uid uuid:=auth.uid(); b public.amenity_bookings; a public.amenities;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO b FROM public.amenity_bookings WHERE id=_booking_id FOR UPDATE;
  IF b.id IS NULL OR (b.user_id<>v_uid AND NOT public._amenity_admin(b.society_id)) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO a FROM public.amenities WHERE id=b.amenity_id;
  IF b.status NOT IN('confirmed','waitlisted') THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF b.user_id=v_uid AND NOT public._amenity_admin(b.society_id) AND b.starts_at<now()+make_interval(hours=>a.cancellation_hours) THEN RAISE EXCEPTION 'cancellation_closed' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(a.id::text,0));
  UPDATE public.amenity_bookings SET status='cancelled',cancelled_at=now(),cancellation_reason=nullif(left(btrim(coalesce(_reason,'')),300),''),updated_at=now() WHERE id=b.id;
  INSERT INTO public.audit_log(actor_id,action,target_table,target_id,society_id,metadata) VALUES(v_uid,'amenity.booking_cancelled','amenity_bookings',b.id::text,b.society_id,jsonb_build_object('reason',left(coalesce(_reason,''),300)));
  IF b.status='confirmed' THEN PERFORM public._promote_amenity_waitlist(b.id, v_uid); END IF;
END $function$;

-- Re-check future bookings when occupancy changes; never let an old booking keep access.
CREATE OR REPLACE FUNCTION public._amenity_revalidate_booking(_booking_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.amenity_bookings; v_reason text;
BEGIN
  SELECT * INTO b FROM public.amenity_bookings WHERE id = _booking_id FOR UPDATE;
  IF b.id IS NULL OR b.status NOT IN ('confirmed','waitlisted') OR b.starts_at <= now() THEN RETURN false; END IF;
  v_reason := public._amenity_eligibility(b.user_id, b.flat_id, b.amenity_id);
  IF v_reason IS NULL OR v_reason = 'dues_restricted' THEN RETURN false; END IF;
  UPDATE public.amenity_bookings SET status='cancelled', cancelled_at=now(), cancellation_reason='eligibility_lost:'||v_reason, updated_at=now() WHERE id = b.id;
  INSERT INTO public.amenity_waitlist_events(society_id, amenity_id, freed_booking_id, candidate_booking_id, outcome, reason)
  VALUES (b.society_id, b.amenity_id, b.id, b.id, 'eligibility_lost', v_reason);
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (NULL, 'amenity.booking_eligibility_lost', 'amenity_bookings', b.id::text, b.society_id, jsonb_build_object('reason', v_reason));
  PERFORM public._notify_user_once(b.user_id, b.society_id, 'amenity', 'Amenity booking cancelled',
    'Your booking was cancelled because you are no longer eligible for this amenity.', '/app/amenities', 'amenity-eligibility-lost:' || b.id::text, 'normal');
  IF b.status = 'confirmed' THEN PERFORM public._promote_amenity_waitlist(b.id, NULL); END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public._amenity_revalidate_booking(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.revalidate_amenity_bookings()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n integer := 0;
BEGIN
  IF current_user NOT IN ('postgres','service_role','supabase_admin') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  FOR r IN SELECT id FROM public.amenity_bookings WHERE status IN ('confirmed','waitlisted') AND starts_at > now() ORDER BY starts_at, id LOOP
    IF public._amenity_revalidate_booking(r.id) THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.revalidate_amenity_bookings() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.expire_stale_amenity_waitlist()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
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
  -- Hourly sweep also catches tenancies that expired by date.
  v_count := v_count + public.revalidate_amenity_bookings();
  RETURN v_count;
END $function$;

CREATE OR REPLACE FUNCTION public._amenity_on_resident_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF NOT public._home_link_valid(NEW.user_id, NEW.flat_id) THEN
    FOR r IN SELECT id FROM public.amenity_bookings
              WHERE user_id = NEW.user_id AND flat_id = NEW.flat_id AND status IN ('confirmed','waitlisted') AND starts_at > now() LOOP
      PERFORM public._amenity_revalidate_booking(r.id);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_amenity_on_resident_change AFTER UPDATE OF moved_out_at, is_active, access_expires_at, relationship, lease_ends_on ON public.flat_residents
FOR EACH ROW EXECUTE FUNCTION public._amenity_on_resident_change();

-- ============ 4. Lease documents in the existing document vault ============
ALTER TABLE public.society_knowledge_sources DROP CONSTRAINT IF EXISTS skc_category_chk;
ALTER TABLE public.society_knowledge_sources ADD CONSTRAINT skc_category_chk CHECK (category IN ('bylaws','rules','notices','minutes','resolutions','policies','records','faq','lease'));
ALTER TABLE public.society_knowledge_sources ADD COLUMN IF NOT EXISTS flat_resident_id uuid REFERENCES public.flat_residents(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS skc_flat_resident ON public.society_knowledge_sources(flat_resident_id) WHERE flat_resident_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public._lease_doc_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.flat_resident_id IS NOT NULL THEN NEW.category := 'lease'; END IF;
  IF NEW.category = 'lease' THEN
    NEW.audience := 'committee';  -- leases are private; never resident-wide
    IF NEW.flat_resident_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
       WHERE fr.id = NEW.flat_resident_id AND f.society_id = NEW.society_id) THEN
      RAISE EXCEPTION 'invalid_tenancy';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_lease_doc_guard BEFORE INSERT OR UPDATE ON public.society_knowledge_sources
FOR EACH ROW EXECUTE FUNCTION public._lease_doc_guard();

CREATE OR REPLACE FUNCTION public.knowledge_lease_candidates()
RETURNS TABLE(flat_resident_id uuid, flat_number text, block_name text, relationship text, resident_name text, lease_starts_on date, lease_ends_on date, is_current boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT fr.id, f.flat_number, b.name, coalesce(fr.relationship,'resident'), p.full_name, fr.lease_starts_on, fr.lease_ends_on,
         (fr.is_active AND fr.moved_out_at IS NULL)
  FROM public.flat_residents fr
  JOIN public.flats f ON f.id = fr.flat_id
  LEFT JOIN public.blocks b ON b.id = f.block_id
  LEFT JOIN public.profiles p ON p.id = fr.user_id
  WHERE f.society_id = public._knowledge_admin_society()
    AND (fr.relationship = 'tenant' OR fr.lease_starts_on IS NOT NULL OR fr.lease_ends_on IS NOT NULL)
  ORDER BY (fr.is_active AND fr.moved_out_at IS NULL) DESC, f.flat_number, fr.created_at DESC
  LIMIT 500
$$;
REVOKE ALL ON FUNCTION public.knowledge_lease_candidates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.knowledge_lease_candidates() TO authenticated;

CREATE OR REPLACE FUNCTION public.knowledge_link_lease(_id uuid, _flat_resident_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _soc uuid := public._knowledge_admin_society(); d public.society_knowledge_sources; v_end date;
BEGIN
  SELECT * INTO d FROM public.society_knowledge_sources WHERE id = _id AND society_id = _soc AND kind = 'document' FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT fr.lease_ends_on INTO v_end FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
   WHERE fr.id = _flat_resident_id AND f.society_id = _soc;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_tenancy'; END IF;
  UPDATE public.society_knowledge_sources
     SET flat_resident_id = _flat_resident_id, category = 'lease', audience = 'committee',
         expires_on = coalesce(expires_on, v_end), updated_by = auth.uid(), updated_at = now()
   WHERE id = _id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'knowledge.lease_linked', 'society_knowledge_sources', _id::text, _soc,
          jsonb_build_object('flat_resident_id', _flat_resident_id, 'previous_flat_resident_id', d.flat_resident_id));
END $$;
REVOKE ALL ON FUNCTION public.knowledge_link_lease(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.knowledge_link_lease(uuid, uuid) TO authenticated;

-- A resident sees only the lease of their own current tenancy; former residents get no new access.
CREATE OR REPLACE FUNCTION public.list_my_lease_documents()
RETURNS TABLE(id uuid, title text, version integer, file_name text, updated_at timestamptz, expires_on date, flat_number text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT k.id, k.title, k.version, k.file_name, k.updated_at, k.expires_on, f.flat_number
  FROM public.society_knowledge_sources k
  JOIN public.flat_residents fr ON fr.id = k.flat_resident_id
  JOIN public.flats f ON f.id = fr.flat_id
  WHERE fr.user_id = auth.uid() AND k.category = 'lease' AND k.status = 'ready'
    AND f.society_id = k.society_id AND public._home_link_valid(auth.uid(), fr.flat_id)
    AND fr.is_active AND fr.moved_out_at IS NULL
  ORDER BY k.updated_at DESC
$$;
REVOKE ALL ON FUNCTION public.list_my_lease_documents() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_lease_documents() TO authenticated;

CREATE OR REPLACE FUNCTION public.my_lease_document_path(_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_path text; v_soc uuid;
BEGIN
  SELECT k.storage_path, k.society_id INTO v_path, v_soc
  FROM public.society_knowledge_sources k
  JOIN public.flat_residents fr ON fr.id = k.flat_resident_id
  JOIN public.flats f ON f.id = fr.flat_id
  WHERE k.id = _id AND fr.user_id = auth.uid() AND k.category = 'lease' AND k.status = 'ready'
    AND f.society_id = k.society_id AND public._home_link_valid(auth.uid(), fr.flat_id)
    AND fr.is_active AND fr.moved_out_at IS NULL;
  IF v_path IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM public._rate_hit('lease_open', auth.uid()::text, 60, interval '1 hour');
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'knowledge.lease_opened', 'society_knowledge_sources', _id::text, v_soc, '{}'::jsonb);
  RETURN v_path;
END $$;
REVOKE ALL ON FUNCTION public.my_lease_document_path(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_lease_document_path(uuid) TO authenticated;