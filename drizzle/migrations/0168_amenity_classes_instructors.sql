-- Classes + instructors extend Amenities: every class runs at an amenity and reuses _amenity_eligibility.
CREATE TABLE public.amenity_instructors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  specialty text CHECK (specialty IS NULL OR char_length(specialty) <= 80),
  phone text CHECK (phone IS NULL OR phone ~ '^[0-9+ ]{7,16}$'),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.amenity_instructors TO authenticated;
GRANT ALL ON public.amenity_instructors TO service_role;
ALTER TABLE public.amenity_instructors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read instructors" ON public.amenity_instructors FOR SELECT TO authenticated USING (public._amenity_admin(society_id));

CREATE TABLE public.amenity_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  amenity_id uuid NOT NULL REFERENCES public.amenities(id) ON DELETE CASCADE,
  instructor_id uuid REFERENCES public.amenity_instructors(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 100),
  description text CHECK (description IS NULL OR char_length(description) <= 1000),
  weekdays smallint[] NOT NULL CHECK (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  start_time time NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 15 AND 240),
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 200),
  starts_on date NOT NULL,
  ends_on date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  cancel_reason text CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 300),
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
GRANT SELECT ON public.amenity_classes TO authenticated;
GRANT ALL ON public.amenity_classes TO service_role;
ALTER TABLE public.amenity_classes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read classes" ON public.amenity_classes FOR SELECT TO authenticated
USING (public._amenity_admin(society_id) OR public._authorize_membership_internal(auth.uid(), society_id));
CREATE INDEX amenity_classes_society ON public.amenity_classes(society_id, status);

CREATE TABLE public.amenity_class_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.amenity_classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  flat_id uuid NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('enrolled','waitlisted','cancelled')),
  cancel_reason text CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.amenity_class_enrollments TO authenticated;
GRANT ALL ON public.amenity_class_enrollments TO service_role;
ALTER TABLE public.amenity_class_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own or admin read enrollments" ON public.amenity_class_enrollments FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public._amenity_admin(society_id));
CREATE UNIQUE INDEX amenity_class_one_active_enrollment ON public.amenity_class_enrollments(class_id, user_id) WHERE status <> 'cancelled';
CREATE INDEX amenity_class_enrollments_class ON public.amenity_class_enrollments(class_id, status, created_at);

CREATE TABLE public.amenity_class_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.amenity_classes(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.amenity_class_enrollments(id) ON DELETE CASCADE,
  session_date date NOT NULL,
  method text NOT NULL CHECK (method IN ('committee','self_checkin')),
  marked_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, session_date)
);
GRANT SELECT ON public.amenity_class_attendance TO authenticated;
GRANT ALL ON public.amenity_class_attendance TO service_role;
ALTER TABLE public.amenity_class_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own or admin read attendance" ON public.amenity_class_attendance FOR SELECT TO authenticated
USING (public._amenity_admin(society_id) OR EXISTS (SELECT 1 FROM public.amenity_class_enrollments e WHERE e.id = enrollment_id AND e.user_id = auth.uid()));
CREATE TRIGGER trg_amenity_class_attendance_append_only BEFORE UPDATE OR DELETE ON public.amenity_class_attendance FOR EACH ROW EXECUTE FUNCTION public._append_only();

CREATE OR REPLACE FUNCTION public._class_runs_on(c public.amenity_classes, _d date)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT _d >= c.starts_on AND (c.ends_on IS NULL OR _d <= c.ends_on) AND extract(dow from _d)::smallint = ANY(c.weekdays)
$$;

CREATE OR REPLACE FUNCTION public.admin_save_instructor(_id uuid, _society_id uuid, _name text, _specialty text, _phone text, _active boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_soc uuid := _society_id;
BEGIN
  IF _id IS NOT NULL THEN SELECT society_id INTO v_soc FROM public.amenity_instructors WHERE id = _id; END IF;
  IF v_soc IS NULL OR NOT public._amenity_admin(v_soc) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF _id IS NULL THEN
    INSERT INTO public.amenity_instructors(society_id, name, specialty, phone, created_by)
    VALUES (v_soc, btrim(_name), nullif(btrim(_specialty),''), nullif(btrim(_phone),''), auth.uid()) RETURNING id INTO v_id;
  ELSE
    UPDATE public.amenity_instructors SET name = btrim(_name), specialty = nullif(btrim(_specialty),''), phone = nullif(btrim(_phone),''), is_active = coalesce(_active, true)
     WHERE id = _id RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), CASE WHEN _id IS NULL THEN 'class.instructor_added' ELSE 'class.instructor_updated' END, 'amenity_instructors', v_id::text, v_soc, jsonb_build_object('active', coalesce(_active, true)));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_create_class(_amenity_id uuid, _instructor_id uuid, _title text, _description text, _weekdays smallint[], _start_time time, _duration integer, _capacity integer, _starts_on date, _ends_on date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.amenities; v_id uuid;
BEGIN
  SELECT * INTO a FROM public.amenities WHERE id = _amenity_id AND is_active;
  IF a.id IS NULL OR NOT public._amenity_admin(a.society_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF _instructor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.amenity_instructors WHERE id = _instructor_id AND society_id = a.society_id AND is_active) THEN
    RAISE EXCEPTION 'invalid_instructor' USING ERRCODE='22023'; END IF;
  IF _starts_on < current_date - 1 OR _capacity > a.capacity OR _start_time < a.opens_at OR _start_time + make_interval(mins => _duration) > a.closes_at THEN
    RAISE EXCEPTION 'invalid_slot' USING ERRCODE='22023'; END IF;
  INSERT INTO public.amenity_classes(society_id, amenity_id, instructor_id, title, description, weekdays, start_time, duration_minutes, capacity, starts_on, ends_on, created_by)
  VALUES (a.society_id, a.id, _instructor_id, btrim(_title), nullif(btrim(_description),''), _weekdays, _start_time, _duration, _capacity, _starts_on, _ends_on, auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'class.created', 'amenity_classes', v_id::text, a.society_id, jsonb_build_object('amenity_id', a.id, 'capacity', _capacity));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_cancel_class(_class_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.amenity_classes; e record;
BEGIN
  SELECT * INTO c FROM public.amenity_classes WHERE id = _class_id FOR UPDATE;
  IF c.id IS NULL OR NOT public._amenity_admin(c.society_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF c.status <> 'active' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF char_length(btrim(coalesce(_reason,''))) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  UPDATE public.amenity_classes SET status = 'cancelled', cancel_reason = btrim(_reason) WHERE id = c.id;
  FOR e IN UPDATE public.amenity_class_enrollments SET status = 'cancelled', cancel_reason = 'class_cancelled', updated_at = now()
           WHERE class_id = c.id AND status <> 'cancelled' RETURNING user_id LOOP
    PERFORM public._notify_user_once(e.user_id, c.society_id, 'amenity', 'Class cancelled', c.title || ': ' || btrim(_reason), '/app/classes', 'class-cancelled:' || c.id::text || ':' || e.user_id::text, 'normal');
  END LOOP;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'class.cancelled', 'amenity_classes', c.id::text, c.society_id, jsonb_build_object('reason', btrim(_reason)));
END $$;

CREATE OR REPLACE FUNCTION public.enroll_class(_class_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); c public.amenity_classes; v_flat uuid; v_home uuid; v_reason text; v_used integer; v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM public.amenity_classes WHERE id = _class_id;
  IF c.id IS NULL OR c.status <> 'active' OR (c.ends_on IS NOT NULL AND c.ends_on < current_date)
     OR c.society_id IS DISTINCT FROM public.get_user_society_id(v_uid) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('class:' || c.id::text, 0));
  v_home := public.current_home_flat_id();
  SELECT fr.flat_id INTO v_flat FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
   WHERE fr.user_id = v_uid AND f.society_id = c.society_id AND public._home_link_valid(v_uid, fr.flat_id)
   ORDER BY (fr.flat_id IS NOT DISTINCT FROM v_home) DESC, fr.is_primary DESC NULLS LAST, fr.created_at LIMIT 1;
  IF v_flat IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  v_reason := public._amenity_eligibility(v_uid, v_flat, c.amenity_id);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION '%', CASE WHEN v_reason IN ('not_current_resident','amenity_closed') THEN 'not_authorized' ELSE v_reason END USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.amenity_class_enrollments WHERE class_id = c.id AND user_id = v_uid AND status <> 'cancelled') THEN
    RAISE EXCEPTION 'already_enrolled' USING ERRCODE='23505'; END IF;
  SELECT count(*) INTO v_used FROM public.amenity_class_enrollments WHERE class_id = c.id AND status = 'enrolled';
  v_status := CASE WHEN v_used < c.capacity THEN 'enrolled' ELSE 'waitlisted' END;
  INSERT INTO public.amenity_class_enrollments(society_id, class_id, user_id, flat_id, status) VALUES (c.society_id, c.id, v_uid, v_flat, v_status);
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (v_uid, 'class.' || v_status, 'amenity_classes', c.id::text, c.society_id, jsonb_build_object('flat_id', v_flat));
  RETURN v_status;
END $$;

CREATE OR REPLACE FUNCTION public.leave_class(_class_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); c public.amenity_classes; en public.amenity_class_enrollments; w public.amenity_class_enrollments; v_used integer; v_reason text;
BEGIN
  SELECT * INTO c FROM public.amenity_classes WHERE id = _class_id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('class:' || c.id::text, 0));
  SELECT * INTO en FROM public.amenity_class_enrollments WHERE class_id = c.id AND user_id = v_uid AND status <> 'cancelled' FOR UPDATE;
  IF en.id IS NULL THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  UPDATE public.amenity_class_enrollments SET status = 'cancelled', cancel_reason = 'left_by_resident', updated_at = now() WHERE id = en.id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (v_uid, 'class.left', 'amenity_classes', c.id::text, c.society_id, jsonb_build_object('was', en.status));
  IF en.status <> 'enrolled' OR c.status <> 'active' THEN RETURN; END IF;
  SELECT count(*) INTO v_used FROM public.amenity_class_enrollments WHERE class_id = c.id AND status = 'enrolled';
  FOR w IN SELECT * FROM public.amenity_class_enrollments WHERE class_id = c.id AND status = 'waitlisted' ORDER BY created_at, id FOR UPDATE LOOP
    EXIT WHEN v_used >= c.capacity;
    v_reason := public._amenity_eligibility(w.user_id, w.flat_id, c.amenity_id);
    IF v_reason IS NOT NULL THEN
      IF v_reason <> 'dues_restricted' THEN
        UPDATE public.amenity_class_enrollments SET status = 'cancelled', cancel_reason = 'eligibility_lost:' || v_reason, updated_at = now() WHERE id = w.id;
      END IF;
      CONTINUE;
    END IF;
    UPDATE public.amenity_class_enrollments SET status = 'enrolled', updated_at = now() WHERE id = w.id;
    INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (v_uid, 'class.waitlist_promoted', 'amenity_class_enrollments', w.id::text, c.society_id, '{}'::jsonb);
    PERFORM public._notify_user_once(w.user_id, c.society_id, 'amenity', 'You have a place in the class', c.title || ' moved you off the waitlist', '/app/classes', 'class-promoted:' || w.id::text, 'normal');
    v_used := v_used + 1;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.admin_mark_class_attendance(_class_id uuid, _session_date date, _enrollment_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.amenity_classes; v_n integer;
BEGIN
  SELECT * INTO c FROM public.amenity_classes WHERE id = _class_id;
  IF c.id IS NULL OR NOT public._amenity_admin(c.society_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF _session_date > current_date OR NOT public._class_runs_on(c, _session_date) THEN RAISE EXCEPTION 'invalid_slot' USING ERRCODE='22023'; END IF;
  INSERT INTO public.amenity_class_attendance(society_id, class_id, enrollment_id, session_date, method, marked_by)
  SELECT c.society_id, c.id, e.id, _session_date, 'committee', auth.uid()
    FROM public.amenity_class_enrollments e WHERE e.class_id = c.id AND e.status = 'enrolled' AND e.id = ANY(_enrollment_ids)
  ON CONFLICT (enrollment_id, session_date) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'class.attendance_marked', 'amenity_classes', c.id::text, c.society_id, jsonb_build_object('date', _session_date, 'marked', v_n));
  RETURN v_n;
END $$;

-- Self check-in: only enrolled residents, only on a session day, from 15 min before start until the session ends (IST).
CREATE OR REPLACE FUNCTION public.check_in_class(_class_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.amenity_classes; en public.amenity_class_enrollments; v_now timestamp := now() AT TIME ZONE 'Asia/Kolkata';
BEGIN
  SELECT * INTO c FROM public.amenity_classes WHERE id = _class_id AND status = 'active';
  SELECT * INTO en FROM public.amenity_class_enrollments WHERE class_id = _class_id AND user_id = auth.uid() AND status = 'enrolled';
  IF c.id IS NULL OR en.id IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF NOT public._class_runs_on(c, v_now::date)
     OR v_now::time < c.start_time - interval '15 minutes'
     OR v_now::time > c.start_time + make_interval(mins => c.duration_minutes) THEN
    RAISE EXCEPTION 'checkin_closed' USING ERRCODE='22023'; END IF;
  INSERT INTO public.amenity_class_attendance(society_id, class_id, enrollment_id, session_date, method, marked_by)
  VALUES (c.society_id, c.id, en.id, v_now::date, 'self_checkin', auth.uid()) ON CONFLICT (enrollment_id, session_date) DO NOTHING;
END $$;

-- Reminders: called by the existing daily scheduler; one notice per enrolled person per session.
CREATE OR REPLACE FUNCTION public.send_class_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_n integer := 0; v_d date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  FOR r IN SELECT e.user_id, c.society_id, c.id, c.title, c.start_time FROM public.amenity_classes c
            JOIN public.amenity_class_enrollments e ON e.class_id = c.id AND e.status = 'enrolled'
           WHERE c.status = 'active' AND public._class_runs_on(c, v_d) LOOP
    v_n := v_n + public._notify_user_once(r.user_id, r.society_id, 'amenity', 'Class today', r.title || ' at ' || to_char(r.start_time, 'HH24:MI'), '/app/classes', 'class-reminder:' || r.id::text || ':' || r.user_id::text || ':' || v_d::text, 'normal');
  END LOOP;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public._class_runs_on(public.amenity_classes, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.send_class_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_class_reminders() TO service_role;
REVOKE ALL ON FUNCTION public.admin_save_instructor(uuid, uuid, text, text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_create_class(uuid, uuid, text, text, smallint[], time, integer, integer, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_cancel_class(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enroll_class(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.leave_class(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_mark_class_attendance(uuid, date, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.check_in_class(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_instructor(uuid, uuid, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_class(uuid, uuid, text, text, smallint[], time, integer, integer, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_class(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enroll_class(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_class(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_class_attendance(uuid, date, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_in_class(uuid) TO authenticated;
