-- Guard join requests (by society code, committee approval) and server-enforced guard shift hours.
CREATE TABLE public.guard_shifts (
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  weekdays smallint[] NOT NULL CHECK (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  start_time time NOT NULL,
  end_time time NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (society_id, user_id),
  CHECK (start_time <> end_time)
);
GRANT SELECT ON public.guard_shifts TO authenticated;
GRANT ALL ON public.guard_shifts TO service_role;
ALTER TABLE public.guard_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "guard or committee read shift" ON public.guard_shifts FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_society_admin_for(auth.uid(), society_id));

CREATE TABLE public.guard_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  full_name text NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 80),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  reason text,
  reviewer_id uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX guard_join_requests_one_pending ON public.guard_join_requests(user_id) WHERE status = 'pending';
CREATE INDEX guard_join_requests_society_status ON public.guard_join_requests(society_id, status, created_at DESC);
GRANT SELECT ON public.guard_join_requests TO authenticated;
GRANT ALL ON public.guard_join_requests TO service_role;
ALTER TABLE public.guard_join_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own or committee read guard requests" ON public.guard_join_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_society_admin_for(auth.uid(), society_id));

-- Is this guard inside their scheduled hours right now? Uses database time only.
-- Guards without a saved schedule (added before this change) keep working until the committee sets hours.
CREATE OR REPLACE FUNCTION public._guard_on_shift(_sid uuid, _uid uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s public.guard_shifts; lt timestamp; d int; t time;
BEGIN
  SELECT * INTO s FROM public.guard_shifts WHERE society_id = _sid AND user_id = _uid;
  IF NOT FOUND THEN RETURN true; END IF;
  lt := now() AT TIME ZONE s.timezone;
  d := extract(dow FROM lt)::int; t := lt::time;
  IF s.start_time < s.end_time THEN
    RETURN d = ANY (s.weekdays) AND t >= s.start_time AND t < s.end_time;
  END IF;
  -- Overnight shift: the weekday is the day the shift starts.
  RETURN (d = ANY (s.weekdays) AND t >= s.start_time) OR (((d + 6) % 7) = ANY (s.weekdays) AND t < s.end_time);
END $$;
REVOKE ALL ON FUNCTION public._guard_on_shift(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._guard_session_ok(_sid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.guard_sessions gs WHERE gs.society_id = _sid AND gs.user_id = auth.uid()
     AND gs.status = 'active' AND gs.expires_at > now() AND gs.auth_session_id = public._auth_session_id())
   AND public._guard_on_shift(_sid, auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.guard_start_session(_device text DEFAULT NULL::text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sid uuid := public._guard_role_society();
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT public._guard_on_shift(sid, auth.uid()) THEN RAISE EXCEPTION 'off_shift' USING ERRCODE='42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.guard_reauth_blocks WHERE society_id = sid AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'reauth_required' USING ERRCODE='42501'; END IF;
  PERFORM public._rate_hit('guard_session_start', auth.uid()::text, 10, interval '1 hour');
  RETURN public._guard_open_session(sid, 'self', _device, NULL);
END $$;

CREATE OR REPLACE FUNCTION public.guard_redeem_entry_token(_token text, _device text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); t public.guard_entry_tokens; sid uuid; nid uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  PERFORM public._rate_hit('guard_qr_redeem', uid::text, 10, interval '15 minutes');
  IF _token IS NULL OR _token !~ '^[A-Za-z0-9_-]{32,64}$' THEN RETURN jsonb_build_object('result','invalid'); END IF;
  SELECT * INTO t FROM public.guard_entry_tokens WHERE token_hash = encode(extensions.digest(_token, 'sha256'),'hex') FOR UPDATE;
  IF t.id IS NULL THEN RETURN jsonb_build_object('result','invalid'); END IF;
  IF t.guard_user_id <> uid THEN
    INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata) VALUES (uid, 'guard_session.qr_wrong_user', 'guard_entry_tokens', t.id::text, t.society_id, '{}'::jsonb);
    RETURN jsonb_build_object('result','invalid'); END IF;
  IF t.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('result','revoked'); END IF;
  IF t.used_at IS NOT NULL THEN RETURN jsonb_build_object('result','used'); END IF;
  IF t.expires_at <= now() THEN RETURN jsonb_build_object('result','expired'); END IF;
  SELECT society_id INTO sid FROM public.user_roles WHERE user_id = uid AND society_id = t.society_id AND role='security' AND is_active IS NOT FALSE LIMIT 1;
  IF sid IS NULL THEN RETURN jsonb_build_object('result','invalid'); END IF;
  -- Do not use up the QR outside shift hours.
  IF NOT public._guard_on_shift(sid, uid) THEN RETURN jsonb_build_object('result','off_shift'); END IF;
  nid := public._guard_open_session(sid, 'qr', _device, t.id);
  UPDATE public.guard_entry_tokens SET used_at = now(), used_session_id = nid WHERE id = t.id;
  DELETE FROM public.guard_reauth_blocks WHERE society_id = sid AND user_id = uid;
  RETURN jsonb_build_object('result','ok','session_id',nid);
END $$;

CREATE OR REPLACE FUNCTION public.guard_session_status()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); sid uuid; asid uuid := public._auth_session_id(); s public.guard_sessions; blocked boolean; sh public.guard_shifts; shj jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  sid := public._guard_role_society();
  IF sid IS NULL THEN RETURN jsonb_build_object('state','not_guard'); END IF;
  SELECT * INTO sh FROM public.guard_shifts WHERE society_id = sid AND user_id = uid;
  IF sh.user_id IS NOT NULL THEN
    shj := jsonb_build_object('weekdays', to_jsonb(sh.weekdays), 'start', to_char(sh.start_time,'HH24:MI'), 'end', to_char(sh.end_time,'HH24:MI'), 'timezone', sh.timezone);
  END IF;
  IF NOT public._guard_on_shift(sid, uid) THEN
    RETURN jsonb_build_object('state','off_shift','shift',shj);
  END IF;
  SELECT * INTO s FROM public.guard_sessions WHERE user_id = uid AND society_id = sid AND auth_session_id = asid ORDER BY started_at DESC LIMIT 1;
  blocked := EXISTS (SELECT 1 FROM public.guard_reauth_blocks WHERE society_id = sid AND user_id = uid);
  IF s.id IS NOT NULL AND s.status = 'active' AND s.expires_at > now() THEN
    IF s.last_seen_at < now() - interval '60 seconds' THEN UPDATE public.guard_sessions SET last_seen_at = now() WHERE id = s.id; END IF;
    RETURN jsonb_build_object('state','active','session_id',s.id,'expires_at',s.expires_at,'method',s.method,'shift',shj);
  END IF;
  IF s.id IS NOT NULL AND s.status = 'revoked' THEN RETURN jsonb_build_object('state','revoked','reason',s.revoke_reason,'needs_qr',true,'shift',shj); END IF;
  IF s.id IS NOT NULL AND s.status = 'active' THEN RETURN jsonb_build_object('state','expired','needs_qr',blocked,'shift',shj); END IF;
  RETURN jsonb_build_object('state', CASE WHEN blocked THEN 'blocked' ELSE 'none' END, 'needs_qr', blocked, 'shift', shj);
END $$;

-- Material passes previously checked only the guard role; now they need a live on-shift session too.
CREATE OR REPLACE FUNCTION public.guard_mark_material_pass(_pass_id uuid, _action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _p material_passes;
BEGIN
  SELECT * INTO _p FROM material_passes WHERE id=_pass_id FOR UPDATE;
  IF NOT FOUND OR _p.society_id IS DISTINCT FROM public._guard_role_society() OR NOT public._guard_session_ok(_p.society_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  IF _action='in' AND _p.status='approved' THEN
    IF now() < _p.valid_from - interval '30 minutes' OR now() > _p.valid_until THEN RAISE EXCEPTION 'Pass is not valid right now'; END IF;
    UPDATE material_passes SET status='in_progress', checked_in_at=now() WHERE id=_p.id;
  ELSIF _action='done' AND _p.status='in_progress' THEN
    UPDATE material_passes SET status='completed', checked_out_at=now() WHERE id=_p.id;
  ELSE RAISE EXCEPTION 'invalid_transition'; END IF;
  INSERT INTO audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'material_pass.'||_action, 'material_passes', _p.id::text, _p.society_id, '{}'::jsonb);
END $$;

DROP POLICY IF EXISTS "Guards read approved passes" ON public.material_passes;
CREATE POLICY "Guards read approved passes" ON public.material_passes FOR SELECT TO authenticated
  USING (society_id = public._guard_role_society() AND public._guard_session_ok(society_id)
         AND status = ANY (ARRAY['approved','in_progress','completed']));

-- SOS stays available to a guard at any time, including outside shift hours.
CREATE OR REPLACE FUNCTION public.guard_raise_sos(_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); sid uuid := public._guard_role_society(); aid uuid; nm text;
BEGIN
  IF uid IS NULL OR sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT id INTO aid FROM public.sos_alerts WHERE raised_by = uid AND society_id = sid AND status <> 'resolved' AND created_at > now() - interval '15 minutes' ORDER BY created_at DESC LIMIT 1;
  IF aid IS NOT NULL THEN RETURN aid; END IF;
  PERFORM public._rate_hit('guard_sos_raise', uid::text, 5, interval '1 hour');
  INSERT INTO public.sos_alerts (society_id, flat_id, raised_by, note) VALUES (sid, NULL, uid, public._visitor_clean(_note, 200)) RETURNING id INTO aid;
  SELECT coalesce(full_name, 'A guard') INTO nm FROM public.profiles WHERE id = uid;
  PERFORM public._notify_gate_staff(sid, 'sos', 'SOS from guard ' || left(coalesce(nm,'A guard'),60), coalesce(public._visitor_clean(_note,200), 'Guard needs urgent help'), '/society/visitors', false);
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'sos.raised_by_guard', 'sos_alerts', aid::text, sid, '{}'::jsonb);
  RETURN aid;
END $$;
REVOKE ALL ON FUNCTION public.guard_raise_sos(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guard_raise_sos(text) TO authenticated;

CREATE OR REPLACE FUNCTION public._validate_guard_shift(_weekdays smallint[], _start time, _end time)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
BEGIN
  IF _weekdays IS NULL OR cardinality(_weekdays) = 0 OR NOT (_weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[]) THEN
    RAISE EXCEPTION 'SHIFT_DAYS_REQUIRED: Choose at least one working day' USING ERRCODE='22023'; END IF;
  IF _start IS NULL OR _end IS NULL OR _start = _end THEN
    RAISE EXCEPTION 'SHIFT_TIME_INVALID: Start and end time must be different' USING ERRCODE='22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._validate_guard_shift(smallint[], time, time) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_guard_join_request(_code text, _full_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); sid uuid; rid uuid; nm text := left(btrim(coalesce(_full_name,'')), 80);
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF NOT public.user_has_verified_phone_internal(uid) THEN
    RAISE EXCEPTION 'PHONE_VERIFICATION_REQUIRED: Verify your mobile number before joining a society' USING ERRCODE='42501'; END IF;
  IF NOT public.user_account_complete_internal(uid) THEN
    RAISE EXCEPTION 'AGE_REQUIRED: Choose your year of birth before joining a society' USING ERRCODE='42501'; END IF;
  IF char_length(nm) < 2 THEN RAISE EXCEPTION 'NAME_REQUIRED: Enter your full name' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('guard_join_request', uid::text, 5, interval '1 hour');
  SELECT id INTO sid FROM public.societies WHERE upper(invite_code) = upper(btrim(coalesce(_code,''))) AND status = 'active' LIMIT 1;
  IF sid IS NULL THEN RAISE EXCEPTION 'CODE_INVALID: That society code was not found' USING ERRCODE='P0002'; END IF;
  -- A guard cannot also be a resident or committee member.
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND is_active IS NOT FALSE AND society_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.flat_residents WHERE user_id = uid AND is_active IS NOT FALSE AND moved_out_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.join_requests WHERE user_id = uid AND status = 'pending') THEN
    RAISE EXCEPTION 'ALREADY_MEMBER: This account already belongs to a society or has a resident request' USING ERRCODE='42501'; END IF;
  SELECT id INTO rid FROM public.guard_join_requests WHERE user_id = uid AND status = 'pending';
  IF rid IS NOT NULL THEN RETURN rid; END IF;
  INSERT INTO public.guard_join_requests (society_id, user_id, full_name) VALUES (sid, uid, nm) RETURNING id INTO rid;
  PERFORM public._notify_society_admins(sid, 'guard_join', 'New guard request', nm || ' wants to join as a guard', '/society/visitors');
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'guard_join.requested', 'guard_join_requests', rid::text, sid, '{}'::jsonb);
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.submit_guard_join_request(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_guard_join_request(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_guard_join_request()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  UPDATE public.guard_join_requests SET status='cancelled', updated_at=now() WHERE user_id = auth.uid() AND status='pending';
$$;
REVOKE ALL ON FUNCTION public.cancel_guard_join_request() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_guard_join_request() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_guard_join_requests()
RETURNS TABLE(id uuid, full_name text, phone_last4 text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sid uuid := public._sec_admin_society();
BEGIN
  IF sid IS NULL OR NOT public.is_society_admin_for(auth.uid(), sid) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT g.id, g.full_name, right(p.phone,4), g.created_at
    FROM public.guard_join_requests g LEFT JOIN public.profiles p ON p.id = g.user_id
    WHERE g.society_id = sid AND g.status = 'pending' ORDER BY g.created_at LIMIT 100;
END $$;
REVOKE ALL ON FUNCTION public.admin_list_guard_join_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_guard_join_requests() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_guard_join_request(_id uuid, _approve boolean, _weekdays smallint[] DEFAULT NULL, _start time DEFAULT NULL, _end time DEFAULT NULL, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); r public.guard_join_requests;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM public.guard_join_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF NOT public.is_society_admin_for(uid, r.society_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'ALREADY_REVIEWED: This request was already handled' USING ERRCODE='22023'; END IF;
  IF NOT _approve THEN
    UPDATE public.guard_join_requests SET status='rejected', reviewer_id=uid, reviewed_at=now(), reason=nullif(left(btrim(coalesce(_reason,'')),200),''), updated_at=now() WHERE id=_id;
    PERFORM public._notify_user(r.user_id, r.society_id, 'guard_join', 'Guard request not approved', coalesce(nullif(left(btrim(coalesce(_reason,'')),200),''), 'Please contact the society office'), '/onboarding/guard');
  ELSE
    PERFORM public._validate_guard_shift(_weekdays, _start, _end);
    IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = r.user_id AND is_active IS NOT FALSE AND society_id IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.flat_residents WHERE user_id = r.user_id AND is_active IS NOT FALSE AND moved_out_at IS NULL) THEN
      RAISE EXCEPTION 'ALREADY_MEMBER: This person already belongs to a society' USING ERRCODE='42501'; END IF;
    PERFORM set_config('app.allow_society_change', 'on', true);
    UPDATE public.profiles SET society_id = r.society_id, updated_at = now() WHERE id = r.user_id;
    PERFORM set_config('app.allow_society_change', 'off', true);
    INSERT INTO public.user_roles (user_id, role, society_id, assigned_by) VALUES (r.user_id, 'security'::public.app_role, r.society_id, uid) ON CONFLICT DO NOTHING;
    INSERT INTO public.guard_shifts (society_id, user_id, weekdays, start_time, end_time, updated_by)
    VALUES (r.society_id, r.user_id, (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(_weekdays) x), _start, _end, uid)
    ON CONFLICT (society_id, user_id) DO UPDATE SET weekdays=EXCLUDED.weekdays, start_time=EXCLUDED.start_time, end_time=EXCLUDED.end_time, updated_by=uid, updated_at=now();
    UPDATE public.guard_join_requests SET status='approved', reviewer_id=uid, reviewed_at=now(), updated_at=now() WHERE id=_id;
    PERFORM public._notify_user(r.user_id, r.society_id, 'guard_join', 'You are approved as a guard', 'Open the gate screen during your shift hours', '/app/guard');
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, CASE WHEN _approve THEN 'guard_join.approved' ELSE 'guard_join.rejected' END, 'guard_join_requests', _id::text, r.society_id,
          CASE WHEN _approve THEN jsonb_build_object('weekdays', to_jsonb(_weekdays), 'start', _start::text, 'end', _end::text) ELSE '{}'::jsonb END);
END $$;
REVOKE ALL ON FUNCTION public.admin_review_guard_join_request(uuid, boolean, smallint[], time, time, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_guard_join_request(uuid, boolean, smallint[], time, time, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_guard_shift(_guard_user_id uuid, _weekdays smallint[], _start time, _end time)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); sid uuid := public._sec_admin_society();
BEGIN
  IF sid IS NULL OR NOT public.is_society_admin_for(uid, sid) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_guard_user_id AND society_id=sid AND role='security' AND is_active IS NOT FALSE) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  PERFORM public._validate_guard_shift(_weekdays, _start, _end);
  PERFORM public._rate_hit('guard_shift_set', uid::text, 60, interval '1 hour');
  INSERT INTO public.guard_shifts (society_id, user_id, weekdays, start_time, end_time, updated_by)
  VALUES (sid, _guard_user_id, (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(_weekdays) x), _start, _end, uid)
  ON CONFLICT (society_id, user_id) DO UPDATE SET weekdays=EXCLUDED.weekdays, start_time=EXCLUDED.start_time, end_time=EXCLUDED.end_time, updated_by=uid, updated_at=now();
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'guard_shift.set', 'guard_shifts', _guard_user_id::text, sid, jsonb_build_object('weekdays', to_jsonb(_weekdays), 'start', _start::text, 'end', _end::text));
END $$;
REVOKE ALL ON FUNCTION public.admin_set_guard_shift(uuid, smallint[], time, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_guard_shift(uuid, smallint[], time, time) TO authenticated;

-- A guard account cannot request to join as a resident.
CREATE OR REPLACE FUNCTION public._join_requests_block_guards()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.user_id AND role = 'security' AND is_active IS NOT FALSE)
     OR EXISTS (SELECT 1 FROM public.guard_join_requests WHERE user_id = NEW.user_id AND status = 'pending') THEN
    RAISE EXCEPTION 'GUARD_CANNOT_BE_RESIDENT: A guard account cannot join as a resident' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._join_requests_block_guards() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER join_requests_block_guards BEFORE INSERT ON public.join_requests FOR EACH ROW EXECUTE FUNCTION public._join_requests_block_guards();
