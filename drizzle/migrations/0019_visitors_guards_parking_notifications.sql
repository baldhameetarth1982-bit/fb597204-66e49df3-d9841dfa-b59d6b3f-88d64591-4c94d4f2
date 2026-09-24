-- ===== Per-user notifications =====
CREATE TABLE public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  society_id uuid,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX idx_user_notifications_user ON public.user_notifications (user_id, created_at DESC);
GRANT SELECT ON public.user_notifications TO authenticated;
GRANT UPDATE (read_at) ON public.user_notifications TO authenticated;
GRANT ALL ON public.user_notifications TO service_role;
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own notifications read" ON public.user_notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own notifications mark read" ON public.user_notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public._notify_user(_user uuid, _society uuid, _kind text, _title text, _body text, _link text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.user_notifications (user_id, society_id, kind, title, body, link)
  VALUES (_user, _society, _kind, left(_title,120), left(_body,300), _link);
$$;
CREATE OR REPLACE FUNCTION public._notify_flat(_society uuid, _flat uuid, _kind text, _title text, _body text, _link text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.user_notifications (user_id, society_id, kind, title, body, link)
  SELECT DISTINCT fr.user_id, _society, _kind, left(_title,120), left(_body,300), _link
  FROM public.flat_residents fr
  WHERE fr.flat_id = _flat AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL AND fr.user_id IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public._notify_user(uuid,uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._notify_flat(uuid,uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;

-- Helpdesk: notify request owner when someone else updates it
CREATE OR REPLACE FUNCTION public._helpdesk_notify_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE owner uuid; tno bigint;
BEGIN
  SELECT user_id, ticket_no INTO owner, tno FROM public.support_tickets WHERE id = NEW.ticket_id;
  IF owner IS NULL OR NEW.actor_id = owner THEN RETURN NEW; END IF;
  PERFORM public._notify_user(owner, NEW.society_id, 'helpdesk',
    CASE WHEN NEW.kind = 'comment' THEN 'New reply on your request'
         WHEN NEW.to_status = 'resolved' THEN 'Your request was marked resolved'
         WHEN NEW.to_status = 'rejected' THEN 'Your request was declined'
         ELSE 'Your request was updated' END,
    'Request #' || coalesce(tno::text,''), '/app/helpdesk');
  RETURN NEW;
END $$;
CREATE TRIGGER trg_helpdesk_notify_owner AFTER INSERT ON public.support_ticket_events
FOR EACH ROW EXECUTE FUNCTION public._helpdesk_notify_owner();

-- ===== Visitors: extra fields =====
ALTER TABLE public.visitors ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'guest';
ALTER TABLE public.visitors ADD COLUMN IF NOT EXISTS valid_until timestamptz;
ALTER TABLE public.visitors ADD COLUMN IF NOT EXISTS decided_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_visitors_logged_by ON public.visitors (logged_by, created_at DESC);

-- Gate society of the caller (guard / admin / block admin), derived server-side
CREATE OR REPLACE FUNCTION public._gate_society()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT society_id FROM public.user_roles
  WHERE user_id = auth.uid() AND is_active IS NOT FALSE AND society_id IS NOT NULL
    AND role IN ('security','society_admin','block_admin')
  ORDER BY (role = 'security') DESC, created_at LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public._gate_society() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public._rate_hit(_bucket text, _subject text, _max int, _window interval)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ws timestamptz := to_timestamp(floor(extract(epoch FROM now()) / extract(epoch FROM _window)) * extract(epoch FROM _window)); c int;
BEGIN
  INSERT INTO public.rate_limits (bucket, subject, window_start, count) VALUES (_bucket, _subject, ws, 1)
  ON CONFLICT (bucket, subject, window_start) DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO c;
  IF c > _max THEN RAISE EXCEPTION 'rate_limited' USING ERRCODE='P0001'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._rate_hit(text,text,int,interval) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._visitor_clean(_t text, _max int)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT nullif(left(btrim(regexp_replace(coalesce(_t,''), '[\r\n\t]+', ' ', 'g')), _max), '') $$;

CREATE OR REPLACE FUNCTION public._visitor_new_code(_society uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c text; i int := 0;
BEGIN
  LOOP
    c := lpad((floor(random()*1000000))::int::text, 6, '0'); i := i + 1;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.visitors WHERE society_id = _society AND gate_pass_code = c);
    IF i > 50 THEN RAISE EXCEPTION 'code_unavailable'; END IF;
  END LOOP;
  RETURN c;
END $$;
REVOKE ALL ON FUNCTION public._visitor_new_code(uuid) FROM PUBLIC, anon, authenticated;

-- Resident: invite / pre-approve
CREATE OR REPLACE FUNCTION public.visitor_invite(_flat_id uuid, _name text, _phone text, _category text, _purpose text, _vehicle text, _expected_at timestamptz, _valid_hours int)
RETURNS TABLE(id uuid, gate_pass_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); fid uuid; sid uuid; code text; vid uuid; exp timestamptz; untl timestamptz;
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
  IF coalesce(_category,'guest') NOT IN ('guest','delivery','service','cab','other') THEN RAISE EXCEPTION 'invalid_category' USING ERRCODE='22023'; END IF;
  exp := coalesce(_expected_at, now());
  IF exp < now() - interval '1 hour' OR exp > now() + interval '30 days' THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE='22023'; END IF;
  untl := exp + make_interval(hours => greatest(1, least(coalesce(_valid_hours, 24), 168)));
  PERFORM public._rate_hit('visitor_invite', uid::text, 20, interval '1 hour');
  code := public._visitor_new_code(sid);
  INSERT INTO public.visitors (society_id, flat_id, flat_number, visitor_name, phone, vehicle_number, purpose, category,
      logged_by, status, pre_approved, gate_pass_code, expected_at, valid_until, approved_by, entry_at)
  SELECT sid, fid, f.flat_number, _name, _phone, upper(public._visitor_clean(_vehicle, 15)), public._visitor_clean(_purpose, 80), coalesce(_category,'guest'),
      uid, 'expected', true, code, exp, untl, uid, exp
  FROM public.flats f WHERE f.id = fid
  RETURNING visitors.id INTO vid;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'visitor.invited', 'visitors', vid::text, sid, jsonb_build_object('category', coalesce(_category,'guest')));
  RETURN QUERY SELECT vid, code;
END $$;

-- Resident: cancel an invite, or approve/deny a walk-in at the gate
CREATE OR REPLACE FUNCTION public.visitor_resident_action(_id uuid, _action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); v public.visitors;
BEGIN
  SELECT * INTO v FROM public.visitors WHERE visitors.id = _id FOR UPDATE;
  IF uid IS NULL OR v.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.flat_residents fr WHERE fr.flat_id = v.flat_id AND fr.user_id = uid AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL)
  THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF _action = 'cancel' AND v.status IN ('expected','pending') THEN
    UPDATE public.visitors SET status='cancelled', gate_pass_code=NULL, decided_at=now() WHERE visitors.id=_id;
  ELSIF _action = 'approve' AND v.status = 'awaiting' THEN
    UPDATE public.visitors SET status='approved', approved_by=uid, decided_at=now() WHERE visitors.id=_id;
  ELSIF _action = 'deny' AND v.status = 'awaiting' THEN
    UPDATE public.visitors SET status='denied', approved_by=uid, decided_at=now() WHERE visitors.id=_id;
  ELSE RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'visitor.resident_' || _action, 'visitors', _id::text, v.society_id, '{}'::jsonb);
END $$;

-- Guard: minimal gate list (masked phone, flat label only)
CREATE OR REPLACE FUNCTION public.guard_gate_list(_q text DEFAULT NULL, _scope text DEFAULT 'today')
RETURNS TABLE(id uuid, visitor_name text, phone_last4 text, category text, purpose text, flat_label text, vehicle_number text,
              status text, pre_approved boolean, expected_at timestamptz, valid_until timestamptz, entry_at timestamptz, exit_at timestamptz, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gate_society(); q text := nullif(btrim(coalesce(_q,'')), '');
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  SELECT v.id, v.visitor_name, CASE WHEN v.phone IS NULL THEN NULL ELSE right(v.phone, 4) END, v.category, v.purpose,
         coalesce(f.flat_number, v.flat_number), v.vehicle_number,
         CASE WHEN v.status IN ('expected','pending') AND v.valid_until IS NOT NULL AND v.valid_until < now() THEN 'expired' ELSE v.status END,
         v.pre_approved, v.expected_at, v.valid_until, v.entry_at, v.exit_at, v.created_at
  FROM public.visitors v LEFT JOIN public.flats f ON f.id = v.flat_id
  WHERE v.society_id = sid
    AND (
      (_scope = 'inside' AND v.status = 'inside') OR
      (_scope = 'expected' AND v.status IN ('expected','pending','awaiting','approved') AND coalesce(v.valid_until, v.created_at + interval '1 day') > now()) OR
      (_scope = 'today' AND (v.created_at > date_trunc('day', now()) OR v.entry_at > date_trunc('day', now()) OR v.status IN ('inside','awaiting','approved'))) OR
      (_scope = 'history' AND v.created_at > now() - interval '30 days')
    )
    AND (q IS NULL OR v.visitor_name ILIKE '%'||q||'%' OR coalesce(f.flat_number, v.flat_number,'') ILIKE '%'||q||'%'
         OR coalesce(v.vehicle_number,'') ILIKE '%'||q||'%' OR right(coalesce(v.phone,''),4) = q)
  ORDER BY v.created_at DESC LIMIT 100;
END $$;

-- Guard: walk-in (awaits resident approval when a flat is given)
CREATE OR REPLACE FUNCTION public.guard_log_walkin(_flat_label text, _name text, _phone text, _category text, _purpose text, _vehicle text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); sid uuid := public._gate_society(); fid uuid; flab text; vid uuid; st text;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  _name := public._visitor_clean(_name, 80);
  IF _name IS NULL OR char_length(_name) < 2 THEN RAISE EXCEPTION 'invalid_name' USING ERRCODE='22023'; END IF;
  _phone := nullif(regexp_replace(coalesce(_phone,''), '[^0-9+]', '', 'g'), '');
  IF _phone IS NOT NULL AND _phone !~ '^\+?[0-9]{7,15}$' THEN RAISE EXCEPTION 'invalid_phone' USING ERRCODE='22023'; END IF;
  IF coalesce(_category,'guest') NOT IN ('guest','delivery','service','cab','other') THEN RAISE EXCEPTION 'invalid_category' USING ERRCODE='22023'; END IF;
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
  st := CASE WHEN fid IS NULL THEN 'inside' ELSE 'awaiting' END;
  INSERT INTO public.visitors (society_id, flat_id, flat_number, visitor_name, phone, vehicle_number, purpose, category, logged_by, status, pre_approved, entry_at)
  VALUES (sid, fid, flab, _name, _phone, upper(public._visitor_clean(_vehicle, 15)), public._visitor_clean(_purpose, 80), coalesce(_category,'guest'), uid, st, false, now())
  RETURNING visitors.id INTO vid;
  IF fid IS NOT NULL THEN
    PERFORM public._notify_flat(sid, fid, 'visitor_approval', 'Visitor at the gate', _name || ' · ' || coalesce(public._visitor_clean(_purpose,80), initcap(coalesce(_category,'guest'))) || ' — approve or deny', '/app/visitors');
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'visitor.walkin_logged', 'visitors', vid::text, sid, jsonb_build_object('category', coalesce(_category,'guest')));
  RETURN vid;
END $$;

-- Guard: check-in / deny / check-out
CREATE OR REPLACE FUNCTION public.guard_visitor_action(_id uuid, _action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); sid uuid := public._gate_society(); v public.visitors;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO v FROM public.visitors WHERE visitors.id = _id AND society_id = sid FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF _action = 'checkin' AND (v.status = 'approved' OR (v.status IN ('expected','pending') AND coalesce(v.valid_until, now() + interval '1 minute') > now())) THEN
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
END $$;

-- Guard: check in by 6-digit pass (single use, expiring, brute-force limited)
CREATE OR REPLACE FUNCTION public.guard_checkin_code(_code text)
RETURNS TABLE(id uuid, visitor_name text, flat_label text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  UPDATE public.visitors SET status='inside', entry_at=now(), gate_pass_code=NULL WHERE visitors.id = v.id;
  IF v.flat_id IS NOT NULL THEN PERFORM public._notify_flat(sid, v.flat_id, 'visitor_entered', 'Visitor checked in', v.visitor_name || ' has entered', '/app/visitors'); END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'visitor.guard_checkin_code', 'visitors', v.id::text, sid, '{}'::jsonb);
  RETURN QUERY SELECT v.id, v.visitor_name, v.flat_number;
END $$;

-- Retire cross-society legacy code check-in
REVOKE ALL ON FUNCTION public.guard_checkin_by_code(uuid, text) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.guard_checkin_by_code(uuid, text) IS 'DEPRECATED: replaced by guard_checkin_code';
REVOKE ALL ON FUNCTION public.create_visitor_preapproval(uuid, uuid, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.create_visitor_preapproval(uuid, uuid, text, text, text, text, timestamptz) IS 'DEPRECATED: replaced by visitor_invite';

-- ===== Parking =====
CREATE TABLE public.parking_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  label text NOT NULL,
  slot_type text NOT NULL DEFAULT 'car',
  flat_id uuid REFERENCES public.flats(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parking_slot_type_chk CHECK (slot_type IN ('car','bike','visitor','other')),
  CONSTRAINT parking_label_len_chk CHECK (char_length(label) BETWEEN 1 AND 20)
);
CREATE UNIQUE INDEX ux_parking_label ON public.parking_slots (society_id, upper(label)) WHERE is_active;
CREATE INDEX idx_parking_flat ON public.parking_slots (flat_id);
GRANT SELECT ON public.parking_slots TO authenticated;
GRANT ALL ON public.parking_slots TO service_role;
ALTER TABLE public.parking_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gate and admins view parking" ON public.parking_slots FOR SELECT TO authenticated
  USING (society_id IN (SELECT ur.society_id FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.is_active IS NOT FALSE
         AND ur.role IN ('society_admin','block_admin','security')) OR public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "residents view own flat parking" ON public.parking_slots FOR SELECT TO authenticated
  USING (flat_id IN (SELECT fr.flat_id FROM public.flat_residents fr WHERE fr.user_id = auth.uid() AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL));

CREATE OR REPLACE FUNCTION public.admin_parking_upsert(_id uuid, _label text, _slot_type text, _flat_id uuid, _vehicle_id uuid, _notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); sid uuid; pid uuid; vflat uuid;
BEGIN
  SELECT ur.society_id INTO sid FROM public.user_roles ur WHERE ur.user_id = uid AND ur.role = 'society_admin' AND ur.is_active IS NOT FALSE AND ur.society_id IS NOT NULL ORDER BY ur.created_at LIMIT 1;
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  _label := upper(public._visitor_clean(_label, 20));
  IF _label IS NULL THEN RAISE EXCEPTION 'invalid_label' USING ERRCODE='22023'; END IF;
  IF coalesce(_slot_type,'car') NOT IN ('car','bike','visitor','other') THEN RAISE EXCEPTION 'invalid_type' USING ERRCODE='22023'; END IF;
  IF _flat_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.flats WHERE id = _flat_id AND society_id = sid) THEN RAISE EXCEPTION 'flat_not_found' USING ERRCODE='P0002'; END IF;
  IF _vehicle_id IS NOT NULL THEN
    SELECT flat_id INTO vflat FROM public.vehicles WHERE id = _vehicle_id AND society_id = sid AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'vehicle_not_found' USING ERRCODE='P0002'; END IF;
    IF _flat_id IS NULL THEN _flat_id := vflat; END IF;
  END IF;
  IF _id IS NULL THEN
    INSERT INTO public.parking_slots (society_id, label, slot_type, flat_id, vehicle_id, notes)
    VALUES (sid, _label, coalesce(_slot_type,'car'), _flat_id, _vehicle_id, public._visitor_clean(_notes, 200)) RETURNING id INTO pid;
  ELSE
    UPDATE public.parking_slots SET label=_label, slot_type=coalesce(_slot_type,'car'), flat_id=_flat_id, vehicle_id=_vehicle_id,
      notes=public._visitor_clean(_notes, 200), updated_at=now()
    WHERE id=_id AND society_id=sid AND is_active RETURNING id INTO pid;
    IF pid IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, CASE WHEN _id IS NULL THEN 'parking.created' ELSE 'parking.updated' END, 'parking_slots', pid::text, sid,
          jsonb_build_object('label', _label, 'assigned', _flat_id IS NOT NULL));
  IF _flat_id IS NOT NULL THEN PERFORM public._notify_flat(sid, _flat_id, 'parking', 'Parking allotted', 'Slot ' || _label || ' is assigned to your home', '/app/vehicles'); END IF;
  RETURN pid;
END $$;

CREATE OR REPLACE FUNCTION public.admin_parking_archive(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); sid uuid;
BEGIN
  SELECT ur.society_id INTO sid FROM public.user_roles ur WHERE ur.user_id = uid AND ur.role = 'society_admin' AND ur.is_active IS NOT FALSE AND ur.society_id IS NOT NULL ORDER BY ur.created_at LIMIT 1;
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  UPDATE public.parking_slots SET is_active=false, updated_at=now() WHERE id=_id AND society_id=sid;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'parking.archived', 'parking_slots', _id::text, sid, '{}'::jsonb);
END $$;

-- Guard: verify a vehicle by plate (no owner identity)
CREATE OR REPLACE FUNCTION public.guard_verify_vehicle(_plate text)
RETURNS TABLE(plate_number text, vehicle_type text, make_model text, color text, flat_label text, parking_label text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gate_society(); p text := upper(regexp_replace(coalesce(_plate,''), '[^A-Za-z0-9]', '', 'g'));
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF char_length(p) < 3 OR char_length(p) > 15 THEN RAISE EXCEPTION 'invalid_plate' USING ERRCODE='22023'; END IF;
  RETURN QUERY
  SELECT v.plate_number, v.type, v.make_model, v.color, f.flat_number,
         (SELECT string_agg(ps.label, ', ') FROM public.parking_slots ps WHERE ps.is_active AND (ps.vehicle_id = v.id OR (ps.vehicle_id IS NULL AND ps.flat_id = v.flat_id AND v.flat_id IS NOT NULL)))
  FROM public.vehicles v LEFT JOIN public.flats f ON f.id = v.flat_id
  WHERE v.society_id = sid AND v.is_active AND upper(regexp_replace(v.plate_number, '[^A-Za-z0-9]', '', 'g')) LIKE '%' || p || '%'
  LIMIT 5;
END $$;

REVOKE ALL ON FUNCTION public.visitor_invite(uuid,text,text,text,text,text,timestamptz,int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visitor_resident_action(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_gate_list(text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_log_walkin(text,text,text,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_visitor_action(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_checkin_code(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_parking_upsert(uuid,text,text,uuid,uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_parking_archive(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_verify_vehicle(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visitor_invite(uuid,text,text,text,text,text,timestamptz,int), public.visitor_resident_action(uuid,text),
  public.guard_gate_list(text,text), public.guard_log_walkin(text,text,text,text,text,text), public.guard_visitor_action(uuid,text),
  public.guard_checkin_code(text), public.admin_parking_upsert(uuid,text,text,uuid,uuid,text), public.admin_parking_archive(uuid),
  public.guard_verify_vehicle(text) TO authenticated;