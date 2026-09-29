CREATE TABLE public.amenities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 100),
  description text CHECK (description IS NULL OR char_length(description) <= 1000),
  amenity_type text NOT NULL DEFAULT 'other' CHECK (amenity_type IN ('clubhouse','court','pool','gym','guest_room','banquet','theatre','bbq','other')),
  opens_at time NOT NULL DEFAULT '06:00',
  closes_at time NOT NULL DEFAULT '22:00',
  slot_minutes integer NOT NULL DEFAULT 60 CHECK (slot_minutes BETWEEN 15 AND 720),
  capacity integer NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 500),
  advance_days integer NOT NULL DEFAULT 30 CHECK (advance_days BETWEEN 0 AND 365),
  cancellation_hours integer NOT NULL DEFAULT 2 CHECK (cancellation_hours BETWEEN 0 AND 720),
  weekly_household_limit integer CHECK (weekly_household_limit IS NULL OR weekly_household_limit BETWEEN 1 AND 100),
  owner_allowed boolean NOT NULL DEFAULT true,
  tenant_allowed boolean NOT NULL DEFAULT true,
  defaulters_allowed boolean NOT NULL DEFAULT true,
  deposit_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0 AND deposit_amount <= 10000000),
  fee_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0 AND fee_amount <= 10000000),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (opens_at < closes_at)
);
GRANT SELECT ON public.amenities TO authenticated;
GRANT ALL ON public.amenities TO service_role;
ALTER TABLE public.amenities ENABLE ROW LEVEL SECURITY;
CREATE INDEX amenities_society_active_idx ON public.amenities(society_id, is_active, name);
CREATE UNIQUE INDEX amenities_society_name_active_uidx ON public.amenities(society_id, lower(name)) WHERE is_active;

CREATE TABLE public.amenity_blocked_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amenity_id uuid NOT NULL REFERENCES public.amenities(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  blocked_date date NOT NULL,
  reason text CHECK (reason IS NULL OR char_length(reason) <= 300),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (amenity_id, blocked_date)
);
GRANT SELECT ON public.amenity_blocked_dates TO authenticated;
GRANT ALL ON public.amenity_blocked_dates TO service_role;
ALTER TABLE public.amenity_blocked_dates ENABLE ROW LEVEL SECURITY;
CREATE INDEX amenity_blocked_dates_society_idx ON public.amenity_blocked_dates(society_id, blocked_date);

CREATE TABLE public.amenity_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amenity_id uuid NOT NULL REFERENCES public.amenities(id) ON DELETE RESTRICT,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  flat_id uuid NOT NULL REFERENCES public.flats(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  attendees integer NOT NULL DEFAULT 1 CHECK (attendees BETWEEN 1 AND 500),
  status text NOT NULL CHECK (status IN ('confirmed','waitlisted','cancelled','completed','no_show')),
  idempotency_key uuid NOT NULL,
  cancellation_reason text CHECK (cancellation_reason IS NULL OR char_length(cancellation_reason) <= 300),
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  UNIQUE (user_id, idempotency_key)
);
GRANT SELECT ON public.amenity_bookings TO authenticated;
GRANT ALL ON public.amenity_bookings TO service_role;
ALTER TABLE public.amenity_bookings ENABLE ROW LEVEL SECURITY;
CREATE INDEX amenity_bookings_slot_idx ON public.amenity_bookings(amenity_id, starts_at, ends_at, status);
CREATE INDEX amenity_bookings_flat_idx ON public.amenity_bookings(flat_id, created_at DESC);
CREATE INDEX amenity_bookings_society_idx ON public.amenity_bookings(society_id, starts_at DESC);

CREATE POLICY "members read active amenities" ON public.amenities FOR SELECT TO authenticated
USING (society_id = public.get_user_society_id(auth.uid()) OR public.current_user_has_society_permission(society_id, 'society.settings'::text, NULL::uuid));
CREATE POLICY "members read amenity blocks" ON public.amenity_blocked_dates FOR SELECT TO authenticated
USING (society_id = public.get_user_society_id(auth.uid()) OR public.current_user_has_society_permission(society_id, 'society.settings'::text, NULL::uuid));
CREATE POLICY "residents read own amenity bookings" ON public.amenity_bookings FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.current_user_has_society_permission(society_id, 'society.settings'::text, NULL::uuid));

CREATE OR REPLACE FUNCTION public._amenity_admin(_society_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND public.current_user_has_society_permission(_society_id, 'society.settings'::text, NULL::uuid)
$$;
REVOKE ALL ON FUNCTION public._amenity_admin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._amenity_admin(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_upsert_amenity(
  _id uuid, _society_id uuid, _name text, _description text, _amenity_type text,
  _opens_at time, _closes_at time, _slot_minutes integer, _capacity integer,
  _advance_days integer, _cancellation_hours integer, _weekly_household_limit integer,
  _owner_allowed boolean, _tenant_allowed boolean, _defaulters_allowed boolean,
  _deposit_amount numeric, _fee_amount numeric, _is_active boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_before jsonb;
BEGIN
  IF NOT public._amenity_admin(_society_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  PERFORM public._rate_hit('amenity_admin', v_uid::text, 60, interval '1 hour');
  IF char_length(btrim(coalesce(_name,''))) NOT BETWEEN 2 AND 100 OR _amenity_type NOT IN ('clubhouse','court','pool','gym','guest_room','banquet','theatre','bbq','other')
     OR _opens_at IS NULL OR _closes_at IS NULL OR _opens_at >= _closes_at OR _slot_minutes NOT BETWEEN 15 AND 720
     OR _capacity NOT BETWEEN 1 AND 500 OR _advance_days NOT BETWEEN 0 AND 365 OR _cancellation_hours NOT BETWEEN 0 AND 720
     OR (_weekly_household_limit IS NOT NULL AND _weekly_household_limit NOT BETWEEN 1 AND 100)
     OR _deposit_amount < 0 OR _deposit_amount > 10000000 OR _fee_amount < 0 OR _fee_amount > 10000000 THEN
    RAISE EXCEPTION 'invalid_amenity' USING ERRCODE='22023';
  END IF;
  IF _id IS NULL THEN
    INSERT INTO public.amenities(society_id,name,description,amenity_type,opens_at,closes_at,slot_minutes,capacity,advance_days,cancellation_hours,weekly_household_limit,owner_allowed,tenant_allowed,defaulters_allowed,deposit_amount,fee_amount,is_active,created_by)
    VALUES (_society_id,btrim(_name),nullif(btrim(coalesce(_description,'')),''),_amenity_type,_opens_at,_closes_at,_slot_minutes,_capacity,_advance_days,_cancellation_hours,_weekly_household_limit,coalesce(_owner_allowed,true),coalesce(_tenant_allowed,true),coalesce(_defaulters_allowed,true),round(_deposit_amount,2),round(_fee_amount,2),coalesce(_is_active,true),v_uid)
    RETURNING id INTO v_id;
  ELSE
    SELECT to_jsonb(a) INTO v_before FROM public.amenities a WHERE a.id=_id AND a.society_id=_society_id FOR UPDATE;
    IF v_before IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
    UPDATE public.amenities SET name=btrim(_name),description=nullif(btrim(coalesce(_description,'')),''),amenity_type=_amenity_type,opens_at=_opens_at,closes_at=_closes_at,slot_minutes=_slot_minutes,capacity=_capacity,advance_days=_advance_days,cancellation_hours=_cancellation_hours,weekly_household_limit=_weekly_household_limit,owner_allowed=coalesce(_owner_allowed,true),tenant_allowed=coalesce(_tenant_allowed,true),defaulters_allowed=coalesce(_defaulters_allowed,true),deposit_amount=round(_deposit_amount,2),fee_amount=round(_fee_amount,2),is_active=coalesce(_is_active,true),updated_at=now() WHERE id=_id RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.audit_log(actor_id,action,target_table,target_id,society_id,metadata)
  VALUES(v_uid,CASE WHEN _id IS NULL THEN 'amenity.created' ELSE 'amenity.updated' END,'amenities',v_id::text,_society_id,jsonb_build_object('before',v_before,'active',coalesce(_is_active,true)));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_amenity_block(_amenity_id uuid, _blocked_date date, _reason text, _blocked boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_society uuid;
BEGIN
  SELECT society_id INTO v_society FROM public.amenities WHERE id=_amenity_id;
  IF v_society IS NULL OR NOT public._amenity_admin(v_society) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF _blocked_date < current_date OR _blocked_date > current_date + 730 THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE='22023'; END IF;
  IF _blocked THEN
    INSERT INTO public.amenity_blocked_dates(amenity_id,society_id,blocked_date,reason,created_by)
    VALUES(_amenity_id,v_society,_blocked_date,nullif(left(btrim(coalesce(_reason,'')),300),''),v_uid)
    ON CONFLICT(amenity_id,blocked_date) DO UPDATE SET reason=excluded.reason;
  ELSE
    DELETE FROM public.amenity_blocked_dates WHERE amenity_id=_amenity_id AND blocked_date=_blocked_date;
  END IF;
  INSERT INTO public.audit_log(actor_id,action,target_table,target_id,society_id,metadata)
  VALUES(v_uid,CASE WHEN _blocked THEN 'amenity.date_blocked' ELSE 'amenity.date_unblocked' END,'amenities',_amenity_id::text,v_society,jsonb_build_object('date',_blocked_date,'reason',left(coalesce(_reason,''),300)));
END $$;

CREATE OR REPLACE FUNCTION public.book_amenity(_amenity_id uuid, _starts_at timestamptz, _attendees integer, _idempotency_key uuid)
RETURNS TABLE(id uuid,status text) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid:=auth.uid(); a public.amenities; v_flat uuid; v_relationship text; v_end timestamptz; v_used integer; v_week_count integer; v_id uuid; v_status text;
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
  IF _starts_at<now() OR _starts_at>now()+make_interval(days=>a.advance_days) OR _starts_at::time<a.opens_at OR v_end::time>a.closes_at OR _attendees>a.capacity THEN RAISE EXCEPTION 'invalid_slot' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.amenity_blocked_dates b WHERE b.amenity_id=a.id AND b.blocked_date=_starts_at::date) THEN RAISE EXCEPTION 'blocked_date' USING ERRCODE='22023'; END IF;
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

CREATE OR REPLACE FUNCTION public.cancel_amenity_booking(_booking_id uuid, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
    SELECT * INTO w FROM public.amenity_bookings x WHERE x.amenity_id=a.id AND x.status='waitlisted' AND x.starts_at=b.starts_at AND x.ends_at=b.ends_at AND v_used+x.attendees<=a.capacity ORDER BY x.created_at FOR UPDATE SKIP LOCKED LIMIT 1;
    IF w.id IS NOT NULL THEN UPDATE public.amenity_bookings SET status='confirmed',updated_at=now() WHERE id=w.id; PERFORM public._notify_user(w.user_id,w.society_id,'amenity','Amenity booking confirmed',a.name||' is now confirmed','/app/amenities'); END IF;
  END IF;
  INSERT INTO public.audit_log(actor_id,action,target_table,target_id,society_id,metadata) VALUES(v_uid,'amenity.booking_cancelled','amenity_bookings',b.id::text,b.society_id,jsonb_build_object('reason',left(coalesce(_reason,''),300)));
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_amenity_booking_status(_booking_id uuid, _status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid:=auth.uid(); b public.amenity_bookings;
BEGIN
  SELECT * INTO b FROM public.amenity_bookings WHERE id=_booking_id FOR UPDATE;
  IF b.id IS NULL OR NOT public._amenity_admin(b.society_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF _status NOT IN('completed','no_show') OR b.status<>'confirmed' OR b.ends_at>now() THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  UPDATE public.amenity_bookings SET status=_status,updated_at=now() WHERE id=b.id;
  INSERT INTO public.audit_log(actor_id,action,target_table,target_id,society_id,metadata) VALUES(v_uid,'amenity.booking_'||_status,'amenity_bookings',b.id::text,b.society_id,'{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.get_amenity_fairness(_society_id uuid, _from date, _to date)
RETURNS TABLE(flat_id uuid,flat_label text,bookings bigint,cancellations bigint,no_shows bigint,peak_bookings bigint,waitlisted bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public._amenity_admin(_society_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF _from IS NULL OR _to IS NULL OR _to<_from OR _to-_from>366 THEN RAISE EXCEPTION 'invalid_period' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT b.flat_id,f.flat_number,count(*) FILTER(WHERE b.status IN('confirmed','completed','no_show')),count(*) FILTER(WHERE b.status='cancelled'),count(*) FILTER(WHERE b.status='no_show'),count(*) FILTER(WHERE b.status IN('confirmed','completed','no_show') AND (extract(hour from b.starts_at)<9 OR extract(hour from b.starts_at)>=18)),count(*) FILTER(WHERE b.status='waitlisted') FROM public.amenity_bookings b JOIN public.flats f ON f.id=b.flat_id WHERE b.society_id=_society_id AND b.starts_at>=_from::timestamptz AND b.starts_at<(_to+1)::timestamptz GROUP BY b.flat_id,f.flat_number ORDER BY count(*) FILTER(WHERE b.status IN('confirmed','completed','no_show')) DESC,f.flat_number;
END $$;

REVOKE ALL ON FUNCTION public.admin_upsert_amenity(uuid,uuid,text,text,text,time,time,integer,integer,integer,integer,integer,boolean,boolean,boolean,numeric,numeric,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_amenity_block(uuid,date,text,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.book_amenity(uuid,timestamptz,integer,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_amenity_booking(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_amenity_booking_status(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_amenity_fairness(uuid,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_amenity(uuid,uuid,text,text,text,time,time,integer,integer,integer,integer,integer,boolean,boolean,boolean,numeric,numeric,boolean), public.admin_set_amenity_block(uuid,date,text,boolean), public.book_amenity(uuid,timestamptz,integer,uuid), public.cancel_amenity_booking(uuid,text), public.admin_set_amenity_booking_status(uuid,text), public.get_amenity_fairness(uuid,date,date) TO authenticated;