-- Workstream 3: extend canonical visitors / parking / notifications / audit. Additive only.

ALTER TABLE public.visitors
  ADD COLUMN IF NOT EXISTS recurring_pass_id uuid,
  ADD COLUMN IF NOT EXISTS restriction_id uuid,
  ADD COLUMN IF NOT EXISTS override_reason text,
  ADD COLUMN IF NOT EXISTS overstay_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS parking_slot_id uuid REFERENCES public.parking_slots(id);

CREATE UNIQUE INDEX IF NOT EXISTS visitors_one_active_parking
  ON public.visitors (parking_slot_id) WHERE status = 'inside' AND parking_slot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS visitors_inside_idx ON public.visitors (society_id, entry_at) WHERE status = 'inside';

CREATE TABLE public.visitor_recurring_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_id uuid NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  visitor_name text NOT NULL CHECK (char_length(visitor_name) BETWEEN 2 AND 80),
  phone text CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{7,15}$'),
  category text NOT NULL DEFAULT 'staff' CHECK (category IN ('staff','service','delivery','vendor','other')),
  days smallint[] NOT NULL CHECK (array_length(days,1) BETWEEN 1 AND 7 AND days <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  start_time time NOT NULL,
  end_time time NOT NULL,
  valid_from date NOT NULL DEFAULT current_date,
  valid_until date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  CHECK (valid_until >= valid_from)
);
GRANT SELECT ON public.visitor_recurring_passes TO authenticated;
GRANT ALL ON public.visitor_recurring_passes TO service_role;
ALTER TABLE public.visitor_recurring_passes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "residents read own flat passes" ON public.visitor_recurring_passes FOR SELECT TO authenticated
  USING (flat_id IN (SELECT fr.flat_id FROM public.flat_residents fr WHERE fr.user_id = auth.uid() AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL));
CREATE POLICY "admins read society passes" ON public.visitor_recurring_passes FOR SELECT TO authenticated
  USING (society_id IN (SELECT ur.society_id FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('society_admin','block_admin') AND ur.is_active IS NOT FALSE));

CREATE TABLE public.visitor_restrictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  visitor_name text NOT NULL CHECK (char_length(visitor_name) BETWEEN 2 AND 80),
  phone text CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{7,15}$'),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 300),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.visitor_restrictions TO authenticated;
GRANT ALL ON public.visitor_restrictions TO service_role;
ALTER TABLE public.visitor_restrictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read restrictions" ON public.visitor_restrictions FOR SELECT TO authenticated
  USING (society_id IN (SELECT ur.society_id FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('society_admin','block_admin') AND ur.is_active IS NOT FALSE));

CREATE TABLE public.security_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  visitor_id uuid REFERENCES public.visitors(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('trespass','argument','theft','damage','suspicious','medical','fire','other')),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  note text NOT NULL CHECK (char_length(note) BETWEEN 5 AND 500),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  reported_by uuid NOT NULL,
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.security_incidents TO authenticated;
GRANT ALL ON public.security_incidents TO service_role;
ALTER TABLE public.security_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gate staff read incidents" ON public.security_incidents FOR SELECT TO authenticated
  USING (society_id IN (SELECT ur.society_id FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('society_admin','block_admin','security') AND ur.is_active IS NOT FALSE));

CREATE TABLE public.sos_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_id uuid REFERENCES public.flats(id) ON DELETE SET NULL,
  raised_by uuid NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'raised' CHECK (status IN ('raised','acknowledged','resolved')),
  acknowledged_by uuid, acknowledged_at timestamptz,
  resolved_by uuid, resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sos_alerts_open_idx ON public.sos_alerts (society_id) WHERE status <> 'resolved';
GRANT SELECT ON public.sos_alerts TO authenticated;
GRANT ALL ON public.sos_alerts TO service_role;
ALTER TABLE public.sos_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "raiser reads own sos" ON public.sos_alerts FOR SELECT TO authenticated USING (raised_by = auth.uid());
CREATE POLICY "gate staff read sos" ON public.sos_alerts FOR SELECT TO authenticated
  USING (society_id IN (SELECT ur.society_id FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('society_admin','block_admin','security') AND ur.is_active IS NOT FALSE));

CREATE TABLE public.gate_offline_ops (
  op_id uuid PRIMARY KEY,
  society_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  kind text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.gate_offline_ops TO service_role;
ALTER TABLE public.gate_offline_ops ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._gate_admin_society() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT society_id FROM public.user_roles
  WHERE user_id = auth.uid() AND is_active IS NOT FALSE AND society_id IS NOT NULL AND role IN ('society_admin','block_admin')
  ORDER BY created_at LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.visitor_allowed_minutes(_cat text) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE _cat WHEN 'delivery' THEN 30 WHEN 'cab' THEN 20 WHEN 'service' THEN 240 WHEN 'vendor' THEN 240
    WHEN 'mover' THEN 600 WHEN 'staff' THEN 600 WHEN 'guest' THEN 480 ELSE 240 END;
$$;

CREATE OR REPLACE FUNCTION public._visitor_restriction_match(_sid uuid, _name text, _phone text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT r.id FROM public.visitor_restrictions r
  WHERE r.society_id = _sid AND r.is_active
    AND ((r.phone IS NOT NULL AND _phone IS NOT NULL AND right(r.phone,10) = right(_phone,10))
      OR (r.phone IS NULL AND lower(btrim(r.visitor_name)) = lower(btrim(coalesce(_name,'')))))
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._notify_gate_staff(_sid uuid, _kind text, _title text, _body text, _link text, _admins_only boolean DEFAULT false)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO public.user_notifications (user_id, society_id, kind, title, body, link)
  SELECT DISTINCT ur.user_id, _sid, _kind, left(_title,120), left(_body,300), _link
  FROM public.user_roles ur
  WHERE ur.society_id = _sid AND ur.is_active IS NOT FALSE AND ur.user_id IS NOT NULL
    AND ur.role = ANY (CASE WHEN _admins_only THEN ARRAY['society_admin','block_admin']::app_role[] ELSE ARRAY['society_admin','block_admin','security']::app_role[] END);
$$;

CREATE OR REPLACE FUNCTION public.guard_log_walkin(_flat_label text, _name text, _phone text, _category text, _purpose text, _vehicle text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); sid uuid := public._gate_society(); fid uuid; flab text; vid uuid; st text; rid uuid;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  _name := public._visitor_clean(_name, 80);
  IF _name IS NULL OR char_length(_name) < 2 THEN RAISE EXCEPTION 'invalid_name' USING ERRCODE='22023'; END IF;
  _phone := nullif(regexp_replace(coalesce(_phone,''), '[^0-9+]', '', 'g'), '');
  IF _phone IS NOT NULL AND _phone !~ '^\+?[0-9]{7,15}$' THEN RAISE EXCEPTION 'invalid_phone' USING ERRCODE='22023'; END IF;
  IF coalesce(_category,'guest') NOT IN ('guest','delivery','service','cab','vendor','mover','staff','other') THEN RAISE EXCEPTION 'invalid_category' USING ERRCODE='22023'; END IF;
  flab := public._visitor_clean(_flat_label, 20);
  IF flab IS NOT NULL THEN
    SELECT f.id, f.flat_number INTO fid, flab FROM public.flats f
     WHERE f.society_id = sid AND f.is_active IS NOT FALSE
       AND (upper(regexp_replace(f.flat_number,'[\s-]','','g')) = upper(regexp_replace(flab,'[\s-]','','g'))
            OR upper(coalesce(f.normalized_label,'')) = upper(regexp_replace(flab,'[\s-]','','g')))
     LIMIT 1;
    IF fid IS NULL THEN RAISE EXCEPTION 'flat_not_found' USING ERRCODE='P0002'; END IF;
  END IF;
  PERFORM public._rate_hit('guard_walkin', uid::text, 120, interval '1 hour');
  rid := public._visitor_restriction_match(sid, _name, _phone);
  st := CASE WHEN rid IS NOT NULL OR fid IS NOT NULL OR _category = 'mover' THEN 'awaiting' ELSE 'inside' END;
  INSERT INTO public.visitors (society_id, flat_id, flat_number, visitor_name, phone, vehicle_number, purpose, category, logged_by, status, pre_approved, entry_at, restriction_id)
  VALUES (sid, fid, flab, _name, _phone, upper(public._visitor_clean(_vehicle, 15)), public._visitor_clean(_purpose, 80), coalesce(_category,'guest'), uid, st, false, now(), rid)
  RETURNING visitors.id INTO vid;
  IF rid IS NOT NULL OR _category = 'mover' THEN
    PERFORM public._notify_gate_staff(sid, 'visitor_review', CASE WHEN rid IS NOT NULL THEN 'Restricted visitor at the gate' ELSE 'Movers at the gate' END,
      _name || coalesce(' for ' || flab, '') || ' — committee decision needed', '/society/visitors', true);
  ELSIF fid IS NOT NULL THEN
    PERFORM public._notify_flat(sid, fid, 'visitor_approval', 'Visitor at the gate', _name || ' · ' || coalesce(public._visitor_clean(_purpose,80), initcap(coalesce(_category,'guest'))) || ' — approve or deny', '/app/visitors');
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'visitor.walkin_logged', 'visitors', vid::text, sid, jsonb_build_object('category', coalesce(_category,'guest'), 'restricted', rid IS NOT NULL));
  RETURN vid;
END $function$;

CREATE OR REPLACE FUNCTION public.visitor_invite(_flat_id uuid, _name text, _phone text, _category text, _purpose text, _vehicle text, _expected_at timestamp with time zone, _valid_hours integer)
 RETURNS TABLE(id uuid, gate_pass_code text) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); fid uuid; sid uuid; code text; vid uuid; exp timestamptz; untl timestamptz; rid uuid; review boolean;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  SELECT fr.flat_id, f.society_id INTO fid, sid FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
   WHERE fr.user_id = uid AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL
     AND (_flat_id IS NULL OR fr.flat_id = _flat_id)
   ORDER BY fr.is_primary DESC NULLS LAST LIMIT 1;
  IF fid IS NULL THEN RAISE EXCEPTION 'not_your_flat' USING ERRCODE='42501'; END IF;
  _name := public._visitor_clean(_name, 80);
  IF _name IS NULL OR char_length(_name) < 2 THEN RAISE EXCEPTION 'invalid_name' USING ERRCODE='22023'; END IF;
  _phone := nullif(regexp_replace(coalesce(_phone,''), '[^0-9+]', '', 'g'), '');
  IF _phone IS NOT NULL AND _phone !~ '^\+?[0-9]{7,15}$' THEN RAISE EXCEPTION 'invalid_phone' USING ERRCODE='22023'; END IF;
  IF coalesce(_category,'guest') NOT IN ('guest','delivery','service','cab','vendor','mover','other') THEN RAISE EXCEPTION 'invalid_category' USING ERRCODE='22023'; END IF;
  exp := coalesce(_expected_at, now());
  IF exp < now() - interval '1 hour' OR exp > now() + interval '30 days' THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE='22023'; END IF;
  untl := exp + make_interval(hours => greatest(1, least(coalesce(_valid_hours, 24), 168)));
  PERFORM public._rate_hit('visitor_invite', uid::text, 20, interval '1 hour');
  rid := public._visitor_restriction_match(sid, _name, _phone);
  review := rid IS NOT NULL OR _category = 'mover';
  code := CASE WHEN review THEN NULL ELSE public._visitor_new_code(sid) END;
  INSERT INTO public.visitors (society_id, flat_id, flat_number, visitor_name, phone, vehicle_number, purpose, category,
      logged_by, status, pre_approved, gate_pass_code, expected_at, valid_until, approved_by, entry_at, restriction_id)
  SELECT sid, fid, f.flat_number, _name, _phone, upper(public._visitor_clean(_vehicle, 15)), public._visitor_clean(_purpose, 80), coalesce(_category,'guest'),
      uid, CASE WHEN review THEN 'awaiting' ELSE 'expected' END, NOT review, code, exp, untl, CASE WHEN review THEN NULL ELSE uid END, exp, rid
  FROM public.flats f WHERE f.id = fid
  RETURNING visitors.id INTO vid;
  IF review THEN
    PERFORM public._notify_gate_staff(sid, 'visitor_review', CASE WHEN rid IS NOT NULL THEN 'Restricted visitor invited' ELSE 'Move-in/out request' END,
      _name || ' on ' || to_char(exp AT TIME ZONE 'Asia/Kolkata', 'DD Mon') || ' — committee decision needed', '/society/visitors', true);
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'visitor.invited', 'visitors', vid::text, sid, jsonb_build_object('category', coalesce(_category,'guest'), 'review', review));
  RETURN QUERY SELECT vid, code;
END $function$;

CREATE OR REPLACE FUNCTION public.visitor_resident_action(_id uuid, _action text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); v public.visitors;
BEGIN
  SELECT * INTO v FROM public.visitors WHERE visitors.id = _id FOR UPDATE;
  IF uid IS NULL OR v.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.flat_residents fr WHERE fr.flat_id = v.flat_id AND fr.user_id = uid AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL)
  THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF _action = 'cancel' AND v.status IN ('expected','pending') THEN
    UPDATE public.visitors SET status='cancelled', gate_pass_code=NULL, decided_at=now() WHERE visitors.id=_id;
  ELSIF _action = 'cancel' AND v.status = 'awaiting' AND v.logged_by = uid THEN
    UPDATE public.visitors SET status='cancelled', decided_at=now() WHERE visitors.id=_id;
  ELSIF _action = 'approve' AND v.status = 'awaiting' THEN
    IF v.restriction_id IS NOT NULL OR v.category = 'mover' THEN RAISE EXCEPTION 'needs_committee' USING ERRCODE='42501'; END IF;
    UPDATE public.visitors SET status='approved', approved_by=uid, decided_at=now() WHERE visitors.id=_id;
  ELSIF _action = 'deny' AND v.status = 'awaiting' THEN
    UPDATE public.visitors SET status='denied', approved_by=uid, decided_at=now() WHERE visitors.id=_id;
  ELSE RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'visitor.resident_' || _action, 'visitors', _id::text, v.society_id, '{}'::jsonb);
END $function$;

CREATE OR REPLACE FUNCTION public.guard_visitor_action(_id uuid, _action text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); sid uuid := public._gate_society(); v public.visitors;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO v FROM public.visitors WHERE visitors.id = _id AND society_id = sid FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF _action = 'checkin' AND (v.status = 'approved' OR (v.status IN ('expected','pending') AND coalesce(v.valid_until, now() + interval '1 minute') > now())) THEN
    IF v.restriction_id IS NOT NULL AND v.override_reason IS NULL THEN RAISE EXCEPTION 'restricted_visitor' USING ERRCODE='42501'; END IF;
    UPDATE public.visitors SET status='inside', entry_at=now(), gate_pass_code=NULL WHERE visitors.id=_id;
    IF v.flat_id IS NOT NULL THEN PERFORM public._notify_flat(sid, v.flat_id, 'visitor_entered', 'Visitor checked in', v.visitor_name || ' has entered', '/app/visitors'); END IF;
  ELSIF _action = 'deny' AND v.status IN ('awaiting','approved','expected','pending') THEN
    UPDATE public.visitors SET status='denied', decided_at=now(), gate_pass_code=NULL WHERE visitors.id=_id;
  ELSIF _action = 'checkout' AND v.status = 'inside' THEN
    UPDATE public.visitors SET status='exited', exit_at=now() WHERE visitors.id=_id;
    IF v.flat_id IS NOT NULL THEN PERFORM public._notify_flat(sid, v.flat_id, 'visitor_exited', 'Visitor left', v.visitor_name || ' has left', '/app/visitors'); END IF;
  ELSE RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'visitor.guard_' || _action, 'visitors', _id::text, sid, '{}'::jsonb);
END $function$;

CREATE OR REPLACE FUNCTION public.guard_checkin_code(_code text)
 RETURNS TABLE(id uuid, visitor_name text, flat_label text) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); sid uuid := public._gate_society(); v public.visitors;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF coalesce(_code,'') !~ '^[0-9]{6}$' THEN RAISE EXCEPTION 'invalid_code' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('gate_code', uid::text, 30, interval '10 minutes');
  SELECT * INTO v FROM public.visitors
   WHERE society_id = sid AND gate_pass_code = _code AND status IN ('expected','pending')
     AND coalesce(valid_until, now() + interval '1 minute') > now()
   FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'invalid_code' USING ERRCODE='P0002'; END IF;
  IF v.restriction_id IS NOT NULL AND v.override_reason IS NULL THEN RAISE EXCEPTION 'restricted_visitor' USING ERRCODE='42501'; END IF;
  UPDATE public.visitors SET status='inside', entry_at=now(), gate_pass_code=NULL WHERE visitors.id = v.id;
  IF v.flat_id IS NOT NULL THEN PERFORM public._notify_flat(sid, v.flat_id, 'visitor_entered', 'Visitor checked in', v.visitor_name || ' has entered', '/app/visitors'); END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'visitor.guard_checkin_code', 'visitors', v.id::text, sid, '{}'::jsonb);
  RETURN QUERY SELECT v.id, v.visitor_name, v.flat_number;
END $function$;

CREATE OR REPLACE FUNCTION public.guard_gate_list(_q text DEFAULT NULL::text, _scope text DEFAULT 'today'::text)
 RETURNS TABLE(id uuid, visitor_name text, phone_last4 text, category text, purpose text, flat_label text, vehicle_number text, status text, pre_approved boolean, expected_at timestamp with time zone, valid_until timestamp with time zone, entry_at timestamp with time zone, exit_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE sid uuid := public._gate_society(); q text := nullif(btrim(coalesce(_q,'')), '');
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  SELECT v.id, v.visitor_name, CASE WHEN v.phone IS NULL THEN NULL ELSE right(v.phone, 4) END, v.category, v.purpose,
         coalesce(f.flat_number, v.flat_number), v.vehicle_number,
         CASE WHEN v.status IN ('expected','pending') AND v.valid_until IS NOT NULL AND v.valid_until < now() THEN 'expired'
              WHEN v.status = 'inside' AND v.entry_at + make_interval(mins => public.visitor_allowed_minutes(v.category)) < now() THEN 'overstayed'
              ELSE v.status END,
         v.pre_approved, v.expected_at, v.valid_until, v.entry_at, v.exit_at, v.created_at
  FROM public.visitors v LEFT JOIN public.flats f ON f.id = v.flat_id
  WHERE v.society_id = sid
    AND (
      (_scope = 'inside' AND v.status = 'inside') OR
      (_scope = 'overstay' AND v.status = 'inside' AND v.entry_at + make_interval(mins => public.visitor_allowed_minutes(v.category)) < now()) OR
      (_scope = 'expected' AND v.status IN ('expected','pending','awaiting','approved') AND coalesce(v.valid_until, v.created_at + interval '1 day') > now()) OR
      (_scope = 'today' AND (v.created_at > date_trunc('day', now()) OR v.entry_at > date_trunc('day', now()) OR v.status IN ('inside','awaiting','approved'))) OR
      (_scope = 'history' AND v.created_at > now() - interval '30 days')
    )
    AND (q IS NULL OR v.visitor_name ILIKE '%'||q||'%' OR coalesce(f.flat_number, v.flat_number,'') ILIKE '%'||q||'%'
         OR coalesce(v.vehicle_number,'') ILIKE '%'||q||'%' OR right(coalesce(v.phone,''),4) = q)
  ORDER BY v.created_at DESC LIMIT 100;
END $function$;

CREATE OR REPLACE FUNCTION public.guard_visitor_flags(_ids uuid[])
RETURNS TABLE(id uuid, restricted boolean, needs_committee boolean, overridden boolean, parking_label text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sid uuid := public._gate_society();
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT v.id, v.restriction_id IS NOT NULL,
    v.status = 'awaiting' AND (v.restriction_id IS NOT NULL OR v.category = 'mover'),
    v.override_reason IS NOT NULL,
    CASE WHEN v.status = 'inside' THEN p.label END
  FROM public.visitors v LEFT JOIN public.parking_slots p ON p.id = v.parking_slot_id
  WHERE v.society_id = sid AND v.id = ANY (_ids[1:200]);
END $$;

CREATE OR REPLACE FUNCTION public.admin_visitor_decide(_id uuid, _action text, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); sid uuid := public._gate_admin_society(); v public.visitors; r text := public._visitor_clean(_reason, 300);
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO v FROM public.visitors WHERE visitors.id = _id AND society_id = sid FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF v.status <> 'awaiting' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('gate_admin_decide', uid::text, 60, interval '1 hour');
  IF _action = 'approve' THEN
    IF v.restriction_id IS NOT NULL AND (r IS NULL OR char_length(r) < 10) THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
    UPDATE public.visitors SET status='approved', approved_by=uid, decided_at=now(),
      override_reason = CASE WHEN v.restriction_id IS NOT NULL THEN r ELSE override_reason END WHERE visitors.id=_id;
  ELSIF _action = 'deny' THEN
    UPDATE public.visitors SET status='denied', approved_by=uid, decided_at=now() WHERE visitors.id=_id;
  ELSE RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF v.flat_id IS NOT NULL THEN
    PERFORM public._notify_flat(sid, v.flat_id, 'visitor_decision', CASE WHEN _action='approve' THEN 'Committee approved visitor' ELSE 'Committee denied visitor' END, v.visitor_name, '/app/visitors');
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'visitor.committee_' || _action, 'visitors', _id::text, sid, jsonb_build_object('restricted', v.restriction_id IS NOT NULL, 'category', v.category, 'reason', r));
END $$;

CREATE OR REPLACE FUNCTION public.gate_override(_id uuid, _action text, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); sid uuid; v public.visitors; r text := public._visitor_clean(_reason, 300);
BEGIN
  sid := CASE WHEN _action = 'force_entry' THEN public._gate_admin_society() ELSE public._gate_society() END;
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF r IS NULL OR char_length(r) < 10 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v FROM public.visitors WHERE visitors.id = _id AND society_id = sid FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  PERFORM public._rate_hit('gate_override', uid::text, 30, interval '1 hour');
  IF _action = 'force_exit' AND v.status = 'inside' THEN
    UPDATE public.visitors SET status='exited', exit_at=now(), override_reason=r WHERE visitors.id=_id;
  ELSIF _action = 'force_entry' AND v.status IN ('awaiting','approved','expected','pending') THEN
    IF v.status = 'awaiting' THEN UPDATE public.visitors SET status='approved', approved_by=uid, decided_at=now() WHERE visitors.id=_id; END IF;
    UPDATE public.visitors SET status='inside', entry_at=now(), gate_pass_code=NULL, override_reason=r WHERE visitors.id=_id;
    IF v.flat_id IS NOT NULL THEN PERFORM public._notify_flat(sid, v.flat_id, 'visitor_entered', 'Visitor let in by committee', v.visitor_name, '/app/visitors'); END IF;
  ELSE RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'visitor.override_' || _action, 'visitors', _id::text, sid, jsonb_build_object('reason', r, 'from', v.status));
END $$;

CREATE OR REPLACE FUNCTION public.admin_upsert_visitor_restriction(_id uuid, _name text, _phone text, _reason text, _active boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); sid uuid := public._gate_admin_society(); rid uuid; r text := public._visitor_clean(_reason, 300);
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  _name := public._visitor_clean(_name, 80);
  IF _name IS NULL OR char_length(_name) < 2 THEN RAISE EXCEPTION 'invalid_name' USING ERRCODE='22023'; END IF;
  _phone := nullif(regexp_replace(coalesce(_phone,''), '[^0-9+]', '', 'g'), '');
  IF _phone IS NOT NULL AND _phone !~ '^\+?[0-9]{7,15}$' THEN RAISE EXCEPTION 'invalid_phone' USING ERRCODE='22023'; END IF;
  IF r IS NULL OR char_length(r) < 5 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('visitor_restriction', uid::text, 60, interval '1 hour');
  IF _id IS NULL THEN
    INSERT INTO public.visitor_restrictions (society_id, visitor_name, phone, reason, is_active, created_by)
    VALUES (sid, _name, _phone, r, coalesce(_active, true), uid) RETURNING id INTO rid;
  ELSE
    UPDATE public.visitor_restrictions SET visitor_name=_name, phone=_phone, reason=r, is_active=coalesce(_active,is_active), updated_at=now()
    WHERE id=_id AND society_id=sid RETURNING id INTO rid;
    IF rid IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, CASE WHEN _id IS NULL THEN 'visitor_restriction.created' ELSE 'visitor_restriction.updated' END, 'visitor_restrictions', rid::text, sid,
          jsonb_build_object('active', coalesce(_active,true)));
  RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION public.incident_create(_kind text, _severity text, _note text, _visitor_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); sid uuid := public._gate_society(); iid uuid; n text := public._visitor_clean(_note, 500);
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF n IS NULL OR char_length(n) < 5 THEN RAISE EXCEPTION 'invalid_note' USING ERRCODE='22023'; END IF;
  IF _kind NOT IN ('trespass','argument','theft','damage','suspicious','medical','fire','other') OR coalesce(_severity,'medium') NOT IN ('low','medium','high') THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE='22023'; END IF;
  IF _visitor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.visitors WHERE id=_visitor_id AND society_id=sid) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  PERFORM public._rate_hit('incident_create', uid::text, 30, interval '1 hour');
  INSERT INTO public.security_incidents (society_id, visitor_id, kind, severity, note, reported_by)
  VALUES (sid, _visitor_id, _kind, coalesce(_severity,'medium'), n, uid) RETURNING id INTO iid;
  PERFORM public._notify_gate_staff(sid, 'security_incident', 'Security incident: ' || initcap(_kind), left(n, 200), '/society/visitors', true);
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'incident.created', 'security_incidents', iid::text, sid, jsonb_build_object('kind', _kind, 'severity', coalesce(_severity,'medium')));
  RETURN iid;
END $$;

CREATE OR REPLACE FUNCTION public.incident_resolve(_id uuid, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); sid uuid := public._gate_admin_society(); n text := public._visitor_clean(_note, 300);
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF n IS NULL OR char_length(n) < 5 THEN RAISE EXCEPTION 'invalid_note' USING ERRCODE='22023'; END IF;
  UPDATE public.security_incidents SET status='resolved', resolved_by=uid, resolved_at=now(), resolution_note=n
   WHERE id=_id AND society_id=sid AND status='open';
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'incident.resolved', 'security_incidents', _id::text, sid, '{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.resident_upsert_recurring_pass(_id uuid, _name text, _phone text, _category text, _days smallint[], _start time, _end time, _until date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); fid uuid; sid uuid; pid uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  SELECT fr.flat_id, f.society_id INTO fid, sid FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
   WHERE fr.user_id = uid AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL
   ORDER BY fr.is_primary DESC NULLS LAST LIMIT 1;
  IF fid IS NULL THEN RAISE EXCEPTION 'not_your_flat' USING ERRCODE='42501'; END IF;
  _name := public._visitor_clean(_name, 80);
  IF _name IS NULL OR char_length(_name) < 2 THEN RAISE EXCEPTION 'invalid_name' USING ERRCODE='22023'; END IF;
  _phone := nullif(regexp_replace(coalesce(_phone,''), '[^0-9+]', '', 'g'), '');
  IF _phone IS NOT NULL AND _phone !~ '^\+?[0-9]{7,15}$' THEN RAISE EXCEPTION 'invalid_phone' USING ERRCODE='22023'; END IF;
  IF coalesce(_category,'staff') NOT IN ('staff','service','delivery','vendor','other') THEN RAISE EXCEPTION 'invalid_category' USING ERRCODE='22023'; END IF;
  IF _days IS NULL OR array_length(_days,1) IS NULL OR NOT (_days <@ ARRAY[0,1,2,3,4,5,6]::smallint[]) THEN RAISE EXCEPTION 'invalid_days' USING ERRCODE='22023'; END IF;
  IF _start IS NULL OR _end IS NULL OR _end <= _start THEN RAISE EXCEPTION 'invalid_time' USING ERRCODE='22023'; END IF;
  IF _until IS NULL OR _until < current_date OR _until > current_date + 366 THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('recurring_pass', uid::text, 20, interval '1 hour');
  IF _id IS NULL THEN
    INSERT INTO public.visitor_recurring_passes (society_id, flat_id, created_by, visitor_name, phone, category, days, start_time, end_time, valid_until)
    VALUES (sid, fid, uid, _name, _phone, coalesce(_category,'staff'), (SELECT array_agg(DISTINCT d ORDER BY d) FROM unnest(_days) d), _start, _end, _until)
    RETURNING id INTO pid;
  ELSE
    UPDATE public.visitor_recurring_passes SET visitor_name=_name, phone=_phone, category=coalesce(_category,'staff'),
      days=(SELECT array_agg(DISTINCT d ORDER BY d) FROM unnest(_days) d), start_time=_start, end_time=_end, valid_until=_until, updated_at=now()
    WHERE id=_id AND flat_id=fid AND status <> 'revoked' RETURNING id INTO pid;
    IF pid IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, CASE WHEN _id IS NULL THEN 'recurring_pass.created' ELSE 'recurring_pass.updated' END, 'visitor_recurring_passes', pid::text, sid, jsonb_build_object('category', coalesce(_category,'staff')));
  RETURN pid;
END $$;

CREATE OR REPLACE FUNCTION public.resident_set_recurring_pass_status(_id uuid, _status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); p public.visitor_recurring_passes;
BEGIN
  IF _status NOT IN ('active','paused','revoked') THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  SELECT * INTO p FROM public.visitor_recurring_passes WHERE id=_id FOR UPDATE;
  IF p.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.flat_residents fr WHERE fr.flat_id=p.flat_id AND fr.user_id=uid AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL)
    THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF p.status = 'revoked' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  UPDATE public.visitor_recurring_passes SET status=_status, updated_at=now() WHERE id=_id;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'recurring_pass.' || _status, 'visitor_recurring_passes', _id::text, p.society_id, '{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.guard_recurring_list(_q text DEFAULT NULL)
RETURNS TABLE(id uuid, visitor_name text, phone_last4 text, category text, flat_label text, start_time time, end_time time, valid_now boolean, inside boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sid uuid := public._gate_society(); q text := nullif(btrim(coalesce(_q,'')),''); lt timestamp := now() AT TIME ZONE 'Asia/Kolkata';
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT p.id, p.visitor_name, right(p.phone,4), p.category, f.flat_number, p.start_time, p.end_time,
    (extract(dow FROM lt)::smallint = ANY (p.days) AND lt::time BETWEEN p.start_time AND p.end_time AND lt::date BETWEEN p.valid_from AND p.valid_until),
    EXISTS (SELECT 1 FROM public.visitors v WHERE v.recurring_pass_id = p.id AND v.status = 'inside')
  FROM public.visitor_recurring_passes p JOIN public.flats f ON f.id = p.flat_id
  WHERE p.society_id = sid AND p.status = 'active' AND lt::date BETWEEN p.valid_from AND p.valid_until
    AND extract(dow FROM lt)::smallint = ANY (p.days)
    AND (q IS NULL OR p.visitor_name ILIKE '%'||q||'%' OR f.flat_number ILIKE '%'||q||'%' OR right(coalesce(p.phone,''),4) = q)
  ORDER BY p.start_time LIMIT 100;
END $$;

CREATE OR REPLACE FUNCTION public.guard_checkin_recurring(_pass_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); sid uuid := public._gate_society(); p public.visitor_recurring_passes; vid uuid; lt timestamp := now() AT TIME ZONE 'Asia/Kolkata'; fl text;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO p FROM public.visitor_recurring_passes WHERE id=_pass_id AND society_id=sid FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF p.status <> 'active' OR NOT (extract(dow FROM lt)::smallint = ANY (p.days)) OR lt::time NOT BETWEEN p.start_time AND p.end_time
     OR lt::date NOT BETWEEN p.valid_from AND p.valid_until THEN RAISE EXCEPTION 'pass_not_valid_now' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.flat_residents fr WHERE fr.flat_id=p.flat_id AND fr.user_id=p.created_by AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL)
    THEN RAISE EXCEPTION 'pass_not_valid_now' USING ERRCODE='22023'; END IF;
  IF public._visitor_restriction_match(sid, p.visitor_name, p.phone) IS NOT NULL THEN RAISE EXCEPTION 'restricted_visitor' USING ERRCODE='42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.visitors v WHERE v.recurring_pass_id = p.id AND v.status = 'inside') THEN RAISE EXCEPTION 'already_inside' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('guard_walkin', uid::text, 120, interval '1 hour');
  SELECT flat_number INTO fl FROM public.flats WHERE id = p.flat_id;
  INSERT INTO public.visitors (society_id, flat_id, flat_number, visitor_name, phone, category, logged_by, status, pre_approved, entry_at, approved_by, recurring_pass_id)
  VALUES (sid, p.flat_id, fl, p.visitor_name, p.phone, CASE WHEN p.category IN ('staff','service','delivery','vendor') THEN p.category ELSE 'other' END,
          uid, 'inside', true, now(), p.created_by, p.id) RETURNING id INTO vid;
  PERFORM public._notify_flat(sid, p.flat_id, 'visitor_entered', 'Regular visitor arrived', p.visitor_name || ' has entered', '/app/visitors');
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'visitor.recurring_checkin', 'visitors', vid::text, sid, jsonb_build_object('pass', p.id));
  RETURN vid;
END $$;

CREATE OR REPLACE FUNCTION public.gate_visitor_parking_list()
RETURNS TABLE(id uuid, label text, occupied boolean, visitor_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sid uuid := public._gate_society();
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT p.id, p.label, v.id IS NOT NULL, v.visitor_name
  FROM public.parking_slots p LEFT JOIN public.visitors v ON v.parking_slot_id = p.id AND v.status = 'inside'
  WHERE p.society_id = sid AND p.is_active AND p.slot_type = 'visitor' ORDER BY p.label;
END $$;

CREATE OR REPLACE FUNCTION public.gate_assign_visitor_parking(_visitor_id uuid, _slot_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); sid uuid := public._gate_society(); v public.visitors; lbl text;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO v FROM public.visitors WHERE id=_visitor_id AND society_id=sid FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF v.status <> 'inside' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF _slot_id IS NOT NULL THEN
    SELECT label INTO lbl FROM public.parking_slots WHERE id=_slot_id AND society_id=sid AND is_active AND slot_type='visitor' FOR UPDATE;
    IF lbl IS NULL THEN RAISE EXCEPTION 'slot_not_found' USING ERRCODE='P0002'; END IF;
    IF EXISTS (SELECT 1 FROM public.visitors o WHERE o.parking_slot_id=_slot_id AND o.status='inside' AND o.id <> _visitor_id) THEN RAISE EXCEPTION 'slot_taken' USING ERRCODE='23505'; END IF;
  END IF;
  PERFORM public._rate_hit('gate_parking', uid::text, 120, interval '1 hour');
  UPDATE public.visitors SET parking_slot_id=_slot_id WHERE id=_visitor_id;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, CASE WHEN _slot_id IS NULL THEN 'parking.visitor_released' ELSE 'parking.visitor_assigned' END, 'visitors', _visitor_id::text, sid, jsonb_build_object('slot', lbl));
END $$;

CREATE OR REPLACE FUNCTION public.sos_raise(_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); fid uuid; sid uuid; fl text; aid uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  SELECT fr.flat_id, f.society_id, f.flat_number INTO fid, sid, fl FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
   WHERE fr.user_id = uid AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL
   ORDER BY fr.is_primary DESC NULLS LAST LIMIT 1;
  IF fid IS NULL THEN RAISE EXCEPTION 'not_your_flat' USING ERRCODE='42501'; END IF;
  SELECT id INTO aid FROM public.sos_alerts WHERE raised_by=uid AND status <> 'resolved' AND created_at > now() - interval '15 minutes' ORDER BY created_at DESC LIMIT 1;
  IF aid IS NOT NULL THEN RETURN aid; END IF;
  PERFORM public._rate_hit('sos_raise', uid::text, 5, interval '1 hour');
  INSERT INTO public.sos_alerts (society_id, flat_id, raised_by, note) VALUES (sid, fid, uid, public._visitor_clean(_note, 200)) RETURNING id INTO aid;
  PERFORM public._notify_gate_staff(sid, 'sos', 'SOS from ' || coalesce(fl,'a home'), coalesce(public._visitor_clean(_note,200), 'Resident needs urgent help'), '/app/guard', false);
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'sos.raised', 'sos_alerts', aid::text, sid, '{}'::jsonb);
  RETURN aid;
END $$;

CREATE OR REPLACE FUNCTION public.sos_update(_id uuid, _action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); sid uuid := public._gate_society(); a public.sos_alerts;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM public.sos_alerts WHERE id=_id AND society_id=sid FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF _action = 'acknowledge' AND a.status = 'raised' THEN
    UPDATE public.sos_alerts SET status='acknowledged', acknowledged_by=uid, acknowledged_at=now() WHERE id=_id;
    PERFORM public._notify_user(a.raised_by, sid, 'sos', 'Help is on the way', 'Security has seen your SOS', '/app/emergency');
  ELSIF _action = 'resolve' AND a.status IN ('raised','acknowledged') THEN
    UPDATE public.sos_alerts SET status='resolved', resolved_by=uid, resolved_at=now(),
      acknowledged_by=coalesce(acknowledged_by, uid), acknowledged_at=coalesce(acknowledged_at, now()) WHERE id=_id;
  ELSE RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'sos.' || _action, 'sos_alerts', _id::text, sid, '{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.gate_sos_open()
RETURNS TABLE(id uuid, flat_label text, note text, status text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sid uuid := public._gate_society();
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT a.id, f.flat_number, a.note, a.status, a.created_at
  FROM public.sos_alerts a LEFT JOIN public.flats f ON f.id = a.flat_id
  WHERE a.society_id = sid AND a.status <> 'resolved' ORDER BY a.created_at DESC LIMIT 20;
END $$;

CREATE OR REPLACE FUNCTION public.guard_offline_replay(_op_id uuid, _kind text, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); sid uuid := public._gate_society(); prev jsonb; res jsonb; vid uuid; st text;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _op_id IS NULL OR _kind NOT IN ('walkin','checkout') THEN RAISE EXCEPTION 'not_allowed_offline' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_op_id::text, 0));
  SELECT result INTO prev FROM public.gate_offline_ops WHERE op_id=_op_id AND society_id=sid AND actor_id=uid;
  IF prev IS NOT NULL THEN RETURN prev || jsonb_build_object('duplicate', true); END IF;
  IF EXISTS (SELECT 1 FROM public.gate_offline_ops WHERE op_id=_op_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  PERFORM public._rate_hit('gate_offline_replay', uid::text, 300, interval '1 hour');
  IF _kind = 'walkin' THEN
    IF nullif(btrim(coalesce(_payload->>'flat_label','')),'') IS NULL THEN RAISE EXCEPTION 'flat_not_found' USING ERRCODE='P0002'; END IF;
    vid := public.guard_log_walkin(_payload->>'flat_label', _payload->>'name', _payload->>'phone', _payload->>'category', _payload->>'purpose', _payload->>'vehicle');
    res := jsonb_build_object('result','ok','visitor_id',vid);
  ELSE
    vid := (_payload->>'visitor_id')::uuid;
    SELECT status INTO st FROM public.visitors WHERE id=vid AND society_id=sid;
    IF st IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
    IF st = 'inside' THEN
      PERFORM public.guard_visitor_action(vid, 'checkout');
      res := jsonb_build_object('result','ok','visitor_id',vid);
    ELSE
      res := jsonb_build_object('result','conflict','visitor_id',vid,'current_status',st);
    END IF;
  END IF;
  INSERT INTO public.gate_offline_ops (op_id, society_id, actor_id, kind, result) VALUES (_op_id, sid, uid, _kind, res);
  RETURN res;
END $$;

CREATE OR REPLACE FUNCTION public.mark_visitor_overstays()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT id, society_id, flat_id, visitor_name FROM public.visitors
    WHERE status='inside' AND overstay_notified_at IS NULL
      AND entry_at + make_interval(mins => public.visitor_allowed_minutes(category)) < now()
    ORDER BY entry_at LIMIT 500 FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.visitors SET overstay_notified_at=now() WHERE id=r.id;
    IF r.flat_id IS NOT NULL THEN PERFORM public._notify_flat(r.society_id, r.flat_id, 'visitor_overstay', 'Visitor still inside', r.visitor_name || ' is past the usual time', '/app/visitors'); END IF;
    PERFORM public._notify_gate_staff(r.society_id, 'visitor_overstay', 'Overstay at gate', r.visitor_name || ' has not checked out', '/app/guard', false);
    INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (NULL, 'visitor.overstay_flagged', 'visitors', r.id::text, r.society_id, '{}'::jsonb);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public._gate_admin_society() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._visitor_restriction_match(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._notify_gate_staff(uuid, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_visitor_overstays() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_visitor_overstays() TO service_role;
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.guard_visitor_flags(uuid[])','public.admin_visitor_decide(uuid, text, text)','public.gate_override(uuid, text, text)',
    'public.admin_upsert_visitor_restriction(uuid, text, text, text, boolean)','public.incident_create(text, text, text, uuid)',
    'public.incident_resolve(uuid, text)','public.resident_upsert_recurring_pass(uuid, text, text, text, smallint[], time, time, date)',
    'public.resident_set_recurring_pass_status(uuid, text)','public.guard_recurring_list(text)','public.guard_checkin_recurring(uuid)',
    'public.gate_visitor_parking_list()','public.gate_assign_visitor_parking(uuid, uuid)','public.sos_raise(text)','public.sos_update(uuid, text)',
    'public.gate_sos_open()','public.guard_offline_replay(uuid, text, jsonb)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

-- Reuse the existing hourly job (no new polling job); overstay status itself is derived live.
SELECT cron.unschedule('expire-stale-amenity-waitlist-hourly') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-stale-amenity-waitlist-hourly');
SELECT cron.schedule('expire-stale-amenity-waitlist-hourly','10 * * * *','SELECT public.expire_stale_amenity_waitlist(); SELECT public.mark_visitor_overstays();');
