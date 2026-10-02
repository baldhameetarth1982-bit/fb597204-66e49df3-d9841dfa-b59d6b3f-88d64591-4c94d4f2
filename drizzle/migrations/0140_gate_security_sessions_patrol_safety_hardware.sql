
-- ===== Helpers =====
CREATE OR REPLACE FUNCTION public._auth_session_id() RETURNS uuid LANGUAGE sql STABLE SET search_path TO 'public'
AS $$ SELECT CASE WHEN coalesce(auth.jwt()->>'session_id','') ~ '^[0-9a-f-]{36}$' THEN (auth.jwt()->>'session_id')::uuid END $$;

CREATE OR REPLACE FUNCTION public._sec_admin_society() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT society_id FROM public.user_roles WHERE user_id = auth.uid() AND is_active IS NOT FALSE AND society_id IS NOT NULL
      AND role IN ('society_admin','block_admin') ORDER BY (role='society_admin') DESC, created_at LIMIT 1 $$;

-- ===== 1. Guard sessions =====
CREATE TABLE public.guard_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  auth_session_id uuid NOT NULL,
  method text NOT NULL CHECK (method IN ('self','qr')),
  device_label text CHECK (char_length(device_label) <= 80),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','revoked')),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '12 hours',
  ended_at timestamptz,
  revoked_at timestamptz, revoked_by uuid, revoke_reason text CHECK (char_length(revoke_reason) <= 300),
  entry_token_id uuid
);
CREATE INDEX guard_sessions_lookup ON public.guard_sessions (user_id, society_id, status);
CREATE INDEX guard_sessions_society ON public.guard_sessions (society_id, started_at DESC);
GRANT SELECT ON public.guard_sessions TO authenticated;
GRANT ALL ON public.guard_sessions TO service_role;
ALTER TABLE public.guard_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own or security admin read guard sessions" ON public.guard_sessions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR society_id = public._sec_admin_society());

CREATE TABLE public.guard_reauth_blocks (
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now(),
  set_by uuid,
  PRIMARY KEY (society_id, user_id)
);
GRANT ALL ON public.guard_reauth_blocks TO service_role;
ALTER TABLE public.guard_reauth_blocks ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.guard_entry_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  guard_user_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz, used_session_id uuid,
  revoked_at timestamptz
);
GRANT ALL ON public.guard_entry_tokens TO service_role;
ALTER TABLE public.guard_entry_tokens ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._guard_session_ok(_sid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT EXISTS (SELECT 1 FROM public.guard_sessions gs WHERE gs.society_id = _sid AND gs.user_id = auth.uid()
   AND gs.status = 'active' AND gs.expires_at > now() AND gs.auth_session_id = public._auth_session_id()) $$;

-- Gate authority: admins act on their role; guards ONLY with a live, unrevoked session bound to this login.
CREATE OR REPLACE FUNCTION public._gate_society() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT ur.society_id FROM public.user_roles ur
  WHERE ur.user_id = auth.uid() AND ur.is_active IS NOT FALSE AND ur.society_id IS NOT NULL
    AND (ur.role IN ('society_admin','block_admin') OR (ur.role = 'security' AND public._guard_session_ok(ur.society_id)))
  ORDER BY (ur.role = 'security') DESC, ur.created_at LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._guard_role_society() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT society_id FROM public.user_roles WHERE user_id = auth.uid() AND is_active IS NOT FALSE AND society_id IS NOT NULL AND role = 'security' ORDER BY created_at LIMIT 1 $$;

CREATE OR REPLACE FUNCTION public.guard_session_status() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE uid uuid := auth.uid(); sid uuid; asid uuid := public._auth_session_id(); s public.guard_sessions; blocked boolean;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  sid := public._guard_role_society();
  IF sid IS NULL THEN RETURN jsonb_build_object('state','not_guard'); END IF;
  SELECT * INTO s FROM public.guard_sessions WHERE user_id = uid AND society_id = sid AND auth_session_id = asid ORDER BY started_at DESC LIMIT 1;
  blocked := EXISTS (SELECT 1 FROM public.guard_reauth_blocks WHERE society_id = sid AND user_id = uid);
  IF s.id IS NOT NULL AND s.status = 'active' AND s.expires_at > now() THEN
    IF s.last_seen_at < now() - interval '60 seconds' THEN UPDATE public.guard_sessions SET last_seen_at = now() WHERE id = s.id; END IF;
    RETURN jsonb_build_object('state','active','session_id',s.id,'expires_at',s.expires_at,'method',s.method);
  END IF;
  IF s.id IS NOT NULL AND s.status = 'revoked' THEN RETURN jsonb_build_object('state','revoked','reason',s.revoke_reason,'needs_qr',true); END IF;
  IF s.id IS NOT NULL AND s.status = 'active' THEN RETURN jsonb_build_object('state','expired','needs_qr',blocked); END IF;
  RETURN jsonb_build_object('state', CASE WHEN blocked THEN 'blocked' ELSE 'none' END, 'needs_qr', blocked);
END $$;

CREATE OR REPLACE FUNCTION public._guard_open_session(_sid uuid, _method text, _device text, _token uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE uid uuid := auth.uid(); asid uuid := public._auth_session_id(); nid uuid;
BEGIN
  IF asid IS NULL THEN RAISE EXCEPTION 'session_unbound' USING ERRCODE='42501'; END IF;
  UPDATE public.guard_sessions SET status='ended', ended_at=now() WHERE user_id = uid AND society_id = _sid AND status = 'active';
  INSERT INTO public.guard_sessions (society_id, user_id, auth_session_id, method, device_label, entry_token_id)
  VALUES (_sid, uid, asid, _method, left(nullif(trim(_device),''),80), _token) RETURNING id INTO nid;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'guard_session.started', 'guard_sessions', nid::text, _sid, jsonb_build_object('method', _method));
  RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.guard_start_session(_device text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid := public._guard_role_society();
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.guard_reauth_blocks WHERE society_id = sid AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'reauth_required' USING ERRCODE='42501'; END IF;
  PERFORM public._rate_hit('guard_session_start', auth.uid()::text, 10, interval '1 hour');
  RETURN public._guard_open_session(sid, 'self', _device, NULL);
END $$;

CREATE OR REPLACE FUNCTION public.guard_redeem_entry_token(_token text, _device text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
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
  nid := public._guard_open_session(sid, 'qr', _device, t.id);
  UPDATE public.guard_entry_tokens SET used_at = now(), used_session_id = nid WHERE id = t.id;
  DELETE FROM public.guard_reauth_blocks WHERE society_id = sid AND user_id = uid;
  RETURN jsonb_build_object('result','ok','session_id',nid);
END $$;

CREATE OR REPLACE FUNCTION public.guard_end_session() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.guard_sessions SET status='ended', ended_at=now() WHERE user_id = auth.uid() AND status='active' AND auth_session_id = public._auth_session_id();
END $$;

CREATE OR REPLACE FUNCTION public.admin_list_gate_guards() RETURNS TABLE (user_id uuid, full_name text, phone_last4 text, active_session_id uuid, started_at timestamptz, last_seen_at timestamptz, expires_at timestamptz, method text, device_label text, blocked boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid := public._sec_admin_society();
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  SELECT ur.user_id, p.full_name, right(p.phone,4), gs.id, gs.started_at, gs.last_seen_at, gs.expires_at, gs.method, gs.device_label,
         EXISTS (SELECT 1 FROM public.guard_reauth_blocks b WHERE b.society_id = sid AND b.user_id = ur.user_id)
  FROM (SELECT DISTINCT r.user_id FROM public.user_roles r WHERE r.society_id = sid AND r.role='security' AND r.is_active IS NOT FALSE AND r.user_id IS NOT NULL) ur
  LEFT JOIN public.profiles p ON p.id = ur.user_id
  LEFT JOIN LATERAL (SELECT * FROM public.guard_sessions g WHERE g.society_id = sid AND g.user_id = ur.user_id AND g.status='active' AND g.expires_at > now() ORDER BY g.started_at DESC LIMIT 1) gs ON true
  ORDER BY p.full_name NULLS LAST;
END $$;

CREATE OR REPLACE FUNCTION public.admin_revoke_guard_access(_guard_user_id uuid, _reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid := public._sec_admin_society(); n int;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF char_length(trim(coalesce(_reason,''))) < 5 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE society_id = sid AND user_id = _guard_user_id AND role='security') THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  PERFORM public._rate_hit('guard_revoke', auth.uid()::text, 60, interval '1 hour');
  UPDATE public.guard_sessions SET status='revoked', revoked_at=now(), revoked_by=auth.uid(), revoke_reason=left(trim(_reason),300)
   WHERE society_id = sid AND user_id = _guard_user_id AND status='active';
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.guard_entry_tokens SET revoked_at = now() WHERE society_id = sid AND guard_user_id = _guard_user_id AND used_at IS NULL AND revoked_at IS NULL;
  INSERT INTO public.guard_reauth_blocks (society_id, user_id, set_by) VALUES (sid, _guard_user_id, auth.uid()) ON CONFLICT (society_id, user_id) DO NOTHING;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'guard_session.revoked', 'guard_sessions', _guard_user_id::text, sid, jsonb_build_object('sessions', n, 'reason', left(trim(_reason),300)));
  PERFORM public._notify_user(_guard_user_id, sid, 'guard_session', 'Gate access signed out', 'The committee signed out your gate session. Ask them for a new QR to continue.', '/app/guard');
  RETURN jsonb_build_object('revoked_sessions', n);
END $$;

CREATE OR REPLACE FUNCTION public.admin_issue_guard_entry_token(_guard_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid := public._sec_admin_society(); raw text; exp timestamptz := now() + interval '10 minutes'; tid uuid;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE society_id = sid AND user_id = _guard_user_id AND role='security' AND is_active IS NOT FALSE) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  PERFORM public._rate_hit('guard_qr_issue', auth.uid()::text, 20, interval '1 hour');
  UPDATE public.guard_entry_tokens SET revoked_at = now() WHERE society_id = sid AND guard_user_id = _guard_user_id AND used_at IS NULL AND revoked_at IS NULL;
  raw := translate(encode(extensions.gen_random_bytes(32),'base64'), '+/=', '-_');
  INSERT INTO public.guard_entry_tokens (society_id, guard_user_id, token_hash, created_by, expires_at)
  VALUES (sid, _guard_user_id, encode(extensions.digest(raw,'sha256'),'hex'), auth.uid(), exp) RETURNING id INTO tid;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'guard_session.qr_issued', 'guard_entry_tokens', tid::text, sid, jsonb_build_object('guard', _guard_user_id));
  RETURN jsonb_build_object('token', raw, 'expires_at', exp);
END $$;

-- Harden legacy code path: no client society id, session-enforced.
CREATE OR REPLACE FUNCTION public.guard_checkin_by_code(_society_id uuid, _code text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid := public._gate_society(); _vid uuid;
BEGIN
  IF sid IS NULL OR sid <> _society_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  UPDATE public.visitors SET status = 'inside', entry_at = now(), gate_pass_code = NULL
   WHERE society_id = sid AND gate_pass_code = _code AND status = 'pending' RETURNING id INTO _vid;
  IF _vid IS NULL THEN RAISE EXCEPTION 'invalid or already used code'; END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata) VALUES (auth.uid(), 'visitor.guard_checkin', 'visitors', _vid::text, sid, '{}'::jsonb);
  RETURN _vid;
END $$;

-- Gate-staff read policies also require a live guard session.
DROP POLICY IF EXISTS "gate staff read incidents" ON public.security_incidents;
CREATE POLICY "gate staff read incidents" ON public.security_incidents FOR SELECT TO authenticated USING (society_id = public._gate_society());
DROP POLICY IF EXISTS "gate staff read sos" ON public.sos_alerts;
CREATE POLICY "gate staff read sos" ON public.sos_alerts FOR SELECT TO authenticated USING (society_id = public._gate_society());
DROP POLICY IF EXISTS "gate and admins view parking" ON public.parking_slots;
CREATE POLICY "gate and admins view parking" ON public.parking_slots FOR SELECT TO authenticated USING (society_id = public._gate_society() OR has_role(auth.uid(), 'super_admin'::app_role));

-- ===== 3. Patrol =====
CREATE TABLE public.patrol_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.patrol_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES public.patrol_routes(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  position int NOT NULL,
  code_hash text,
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.patrol_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  route_id uuid NOT NULL REFERENCES public.patrol_routes(id),
  assigned_guard uuid NOT NULL,
  scheduled_start timestamptz NOT NULL,
  due_by timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','partial','missed','cancelled')),
  started_at timestamptz, finished_at timestamptz,
  note text CHECK (char_length(note) <= 500),
  missed_notified_at timestamptz,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (due_by > scheduled_start)
);
CREATE INDEX patrol_rounds_society ON public.patrol_rounds (society_id, scheduled_start DESC);
CREATE INDEX patrol_rounds_guard ON public.patrol_rounds (assigned_guard, status);
CREATE TABLE public.patrol_round_checkpoints (
  round_id uuid NOT NULL REFERENCES public.patrol_rounds(id) ON DELETE CASCADE,
  checkpoint_id uuid NOT NULL REFERENCES public.patrol_checkpoints(id),
  society_id uuid NOT NULL,
  position int NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','missed')),
  completed_at timestamptz, completed_by uuid,
  verification text CHECK (verification IN ('manual','code')),
  location_evidence jsonb,
  note text CHECK (char_length(note) <= 300),
  incident_id uuid,
  PRIMARY KEY (round_id, checkpoint_id)
);
ALTER TABLE public.security_incidents ADD COLUMN IF NOT EXISTS patrol_round_id uuid REFERENCES public.patrol_rounds(id);
GRANT SELECT ON public.patrol_routes, public.patrol_rounds, public.patrol_round_checkpoints TO authenticated;
GRANT SELECT (id, route_id, society_id, name, position, is_active) ON public.patrol_checkpoints TO authenticated;
GRANT ALL ON public.patrol_routes, public.patrol_checkpoints, public.patrol_rounds, public.patrol_round_checkpoints TO service_role;
ALTER TABLE public.patrol_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patrol_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patrol_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patrol_round_checkpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gate read routes" ON public.patrol_routes FOR SELECT TO authenticated USING (society_id = public._gate_society());
CREATE POLICY "gate read checkpoints" ON public.patrol_checkpoints FOR SELECT TO authenticated USING (society_id = public._gate_society());
CREATE POLICY "admin or assigned read rounds" ON public.patrol_rounds FOR SELECT TO authenticated
  USING (society_id = public._sec_admin_society() OR (assigned_guard = auth.uid() AND society_id = public._gate_society()));
CREATE POLICY "admin or assigned read round checkpoints" ON public.patrol_round_checkpoints FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.patrol_rounds r WHERE r.id = round_id AND (r.society_id = public._sec_admin_society() OR (r.assigned_guard = auth.uid() AND r.society_id = public._gate_society()))));

CREATE OR REPLACE FUNCTION public.patrol_sweep(_sid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, status FROM public.patrol_rounds WHERE society_id = _sid AND status IN ('scheduled','in_progress') AND due_by < now() FOR UPDATE SKIP LOCKED LOOP
    UPDATE public.patrol_round_checkpoints SET status='missed' WHERE round_id = r.id AND status='pending';
    UPDATE public.patrol_rounds SET status = CASE WHEN r.status='scheduled' THEN 'missed' ELSE 'partial' END, finished_at = now() WHERE id = r.id;
    INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata) VALUES (NULL, 'patrol.round_overdue', 'patrol_rounds', r.id::text, _sid, jsonb_build_object('was', r.status));
  END LOOP;
  UPDATE public.patrol_rounds SET missed_notified_at = now() WHERE society_id = _sid AND status IN ('missed','partial') AND missed_notified_at IS NULL;
  IF FOUND THEN PERFORM public._notify_society_admins(_sid, 'patrol', 'Patrol round missed', 'One or more patrol rounds were missed or left incomplete.', '/society/visitors'); END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_upsert_patrol_route(_id uuid, _name text, _checkpoints jsonb, _active boolean DEFAULT true) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid := public._sec_admin_society(); rid uuid := _id; cp jsonb; i int := 0; code text;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  PERFORM public._rate_hit('patrol_admin', auth.uid()::text, 60, interval '1 hour');
  IF rid IS NULL THEN
    IF jsonb_typeof(_checkpoints) <> 'array' OR jsonb_array_length(_checkpoints) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'invalid_checkpoints' USING ERRCODE='22023'; END IF;
    INSERT INTO public.patrol_routes (society_id, name, created_by) VALUES (sid, trim(_name), auth.uid()) RETURNING id INTO rid;
    FOR cp IN SELECT * FROM jsonb_array_elements(_checkpoints) LOOP
      i := i + 1; code := nullif(trim(coalesce(cp->>'code','')),'');
      IF code IS NOT NULL AND code !~ '^[A-Za-z0-9]{4,12}$' THEN RAISE EXCEPTION 'invalid_code' USING ERRCODE='22023'; END IF;
      INSERT INTO public.patrol_checkpoints (route_id, society_id, name, position, code_hash)
      VALUES (rid, sid, trim(cp->>'name'), i, CASE WHEN code IS NULL THEN NULL ELSE encode(extensions.digest(rid::text || ':' || upper(code), 'sha256'),'hex') END);
    END LOOP;
  ELSE
    UPDATE public.patrol_routes SET name = trim(_name), is_active = _active WHERE id = rid AND society_id = sid;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata) VALUES (auth.uid(), CASE WHEN _id IS NULL THEN 'patrol.route_created' ELSE 'patrol.route_updated' END, 'patrol_routes', rid::text, sid, jsonb_build_object('active', _active));
  RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION public.admin_schedule_patrol_rounds(_route_id uuid, _guard uuid, _first_start timestamptz, _window_minutes int, _days int DEFAULT 1) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid := public._sec_admin_society(); d int; rid uuid;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _window_minutes NOT BETWEEN 10 AND 720 OR _days NOT BETWEEN 1 AND 14 OR _first_start < now() - interval '1 hour' THEN RAISE EXCEPTION 'invalid_schedule' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patrol_routes WHERE id = _route_id AND society_id = sid AND is_active) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE society_id = sid AND user_id = _guard AND role='security' AND is_active IS NOT FALSE) THEN RAISE EXCEPTION 'guard_not_in_society' USING ERRCODE='42501'; END IF;
  PERFORM public._rate_hit('patrol_admin', auth.uid()::text, 60, interval '1 hour');
  FOR d IN 0.._days-1 LOOP
    INSERT INTO public.patrol_rounds (society_id, route_id, assigned_guard, scheduled_start, due_by, created_by)
    VALUES (sid, _route_id, _guard, _first_start + make_interval(days => d), _first_start + make_interval(days => d, mins => _window_minutes), auth.uid()) RETURNING id INTO rid;
    INSERT INTO public.patrol_round_checkpoints (round_id, checkpoint_id, society_id, position)
    SELECT rid, c.id, sid, c.position FROM public.patrol_checkpoints c WHERE c.route_id = _route_id AND c.is_active;
  END LOOP;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata) VALUES (auth.uid(), 'patrol.rounds_scheduled', 'patrol_routes', _route_id::text, sid, jsonb_build_object('guard', _guard, 'days', _days));
  PERFORM public._notify_user(_guard, sid, 'patrol', 'Patrol rounds assigned', 'You have new patrol rounds on the Gate screen.', '/app/guard');
  RETURN _days;
END $$;

CREATE OR REPLACE FUNCTION public.admin_cancel_patrol_round(_id uuid, _reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid := public._sec_admin_society();
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  UPDATE public.patrol_rounds SET status='cancelled', finished_at=now(), note=left(trim(_reason),500) WHERE id=_id AND society_id=sid AND status IN ('scheduled','in_progress');
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata) VALUES (auth.uid(), 'patrol.round_cancelled', 'patrol_rounds', _id::text, sid, '{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.guard_patrol_list() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid := public._gate_society();
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  PERFORM public.patrol_sweep(sid);
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x->>'scheduled_start') FROM (
    SELECT jsonb_build_object('id', r.id, 'route', pr.name, 'status', r.status, 'scheduled_start', r.scheduled_start, 'due_by', r.due_by,
      'checkpoints', (SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'needs_code', c.code_hash IS NOT NULL, 'status', rc.status, 'completed_at', rc.completed_at) ORDER BY rc.position)
                        FROM public.patrol_round_checkpoints rc JOIN public.patrol_checkpoints c ON c.id = rc.checkpoint_id WHERE rc.round_id = r.id)) x
    FROM public.patrol_rounds r JOIN public.patrol_routes pr ON pr.id = r.route_id
    WHERE r.society_id = sid AND r.assigned_guard = auth.uid()
      AND (r.status IN ('scheduled','in_progress') OR r.finished_at > now() - interval '12 hours')
      AND r.scheduled_start < now() + interval '24 hours') s), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.guard_patrol_start(_round_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid := public._gate_society(); r public.patrol_rounds;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  PERFORM public.patrol_sweep(sid);
  SELECT * INTO r FROM public.patrol_rounds WHERE id = _round_id AND society_id = sid FOR UPDATE;
  IF r.id IS NULL OR r.assigned_guard <> auth.uid() THEN RAISE EXCEPTION 'not_assigned' USING ERRCODE='42501'; END IF;
  IF r.status = 'in_progress' THEN RETURN; END IF;
  IF r.status <> 'scheduled' OR now() < r.scheduled_start - interval '15 minutes' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  UPDATE public.patrol_rounds SET status='in_progress', started_at=now() WHERE id=_round_id;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata) VALUES (auth.uid(), 'patrol.round_started', 'patrol_rounds', _round_id::text, sid, '{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.guard_patrol_checkpoint(_round_id uuid, _checkpoint_id uuid, _code text DEFAULT NULL, _note text DEFAULT NULL, _incident_severity text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid := public._gate_society(); r public.patrol_rounds; rc public.patrol_round_checkpoints; c public.patrol_checkpoints; iid uuid; remaining int;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  PERFORM public._rate_hit('patrol_checkpoint', auth.uid()::text, 120, interval '1 hour');
  SELECT * INTO r FROM public.patrol_rounds WHERE id = _round_id AND society_id = sid FOR UPDATE;
  IF r.id IS NULL OR r.assigned_guard <> auth.uid() THEN RAISE EXCEPTION 'not_assigned' USING ERRCODE='42501'; END IF;
  SELECT * INTO rc FROM public.patrol_round_checkpoints WHERE round_id = _round_id AND checkpoint_id = _checkpoint_id FOR UPDATE;
  IF rc.round_id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF rc.status = 'done' THEN RETURN jsonb_build_object('result','already_done'); END IF;
  IF r.status <> 'in_progress' OR r.due_by < now() OR rc.status <> 'pending' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  SELECT * INTO c FROM public.patrol_checkpoints WHERE id = _checkpoint_id;
  IF c.code_hash IS NOT NULL AND (coalesce(_code,'') = '' OR encode(extensions.digest(c.route_id::text || ':' || upper(trim(_code)), 'sha256'),'hex') <> c.code_hash) THEN
    RAISE EXCEPTION 'wrong_checkpoint_code' USING ERRCODE='22023'; END IF;
  IF _incident_severity IS NOT NULL THEN
    IF _incident_severity NOT IN ('low','medium','high') OR char_length(trim(coalesce(_note,''))) < 5 THEN RAISE EXCEPTION 'invalid_incident' USING ERRCODE='22023'; END IF;
    INSERT INTO public.security_incidents (society_id, kind, severity, note, reported_by, patrol_round_id)
    VALUES (sid, 'suspicious', _incident_severity, left('Patrol at ' || c.name || ': ' || trim(_note), 500), auth.uid(), _round_id) RETURNING id INTO iid;
    PERFORM public._notify_gate_staff(sid, 'incident', 'Patrol incident at ' || c.name, left(trim(_note),200), '/society/visitors', true);
  END IF;
  UPDATE public.patrol_round_checkpoints SET status='done', completed_at=now(), completed_by=auth.uid(),
    verification = CASE WHEN c.code_hash IS NULL THEN 'manual' ELSE 'code' END, note = left(nullif(trim(coalesce(_note,'')),''),300), incident_id = iid
   WHERE round_id = _round_id AND checkpoint_id = _checkpoint_id;
  SELECT count(*) INTO remaining FROM public.patrol_round_checkpoints WHERE round_id = _round_id AND status = 'pending';
  IF remaining = 0 THEN UPDATE public.patrol_rounds SET status='completed', finished_at=now() WHERE id=_round_id; END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata) VALUES (auth.uid(), 'patrol.checkpoint_done', 'patrol_rounds', _round_id::text, sid, jsonb_build_object('checkpoint', _checkpoint_id, 'incident', iid));
  RETURN jsonb_build_object('result','done','round_completed', remaining = 0);
END $$;

CREATE OR REPLACE FUNCTION public.guard_patrol_finish(_round_id uuid, _note text DEFAULT NULL) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid := public._gate_society(); r public.patrol_rounds; missed int;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM public.patrol_rounds WHERE id = _round_id AND society_id = sid FOR UPDATE;
  IF r.id IS NULL OR r.assigned_guard <> auth.uid() THEN RAISE EXCEPTION 'not_assigned' USING ERRCODE='42501'; END IF;
  IF r.status IN ('completed','partial') THEN RETURN r.status; END IF;
  IF r.status <> 'in_progress' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  UPDATE public.patrol_round_checkpoints SET status='missed' WHERE round_id=_round_id AND status='pending';
  GET DIAGNOSTICS missed = ROW_COUNT;
  UPDATE public.patrol_rounds SET status = CASE WHEN missed = 0 THEN 'completed' ELSE 'partial' END, finished_at=now(), note=left(nullif(trim(coalesce(_note,'')),''),500) WHERE id=_round_id;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata) VALUES (auth.uid(), 'patrol.round_finished', 'patrol_rounds', _round_id::text, sid, jsonb_build_object('missed', missed));
  RETURN CASE WHEN missed = 0 THEN 'completed' ELSE 'partial' END;
END $$;

CREATE OR REPLACE FUNCTION public.admin_patrol_overview(_days int DEFAULT 7) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid := public._sec_admin_society();
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  PERFORM public.patrol_sweep(sid);
  RETURN jsonb_build_object(
    'routes', coalesce((SELECT jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name, 'active', pr.is_active,
        'checkpoints', (SELECT count(*) FROM public.patrol_checkpoints c WHERE c.route_id = pr.id AND c.is_active)) ORDER BY pr.name) FROM public.patrol_routes pr WHERE pr.society_id = sid), '[]'::jsonb),
    'rounds', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'route', pr.name, 'guard', p.full_name, 'status', r.status, 'scheduled_start', r.scheduled_start, 'due_by', r.due_by,
        'done', (SELECT count(*) FROM public.patrol_round_checkpoints x WHERE x.round_id = r.id AND x.status='done'),
        'total', (SELECT count(*) FROM public.patrol_round_checkpoints x WHERE x.round_id = r.id),
        'incidents', (SELECT count(*) FROM public.security_incidents i WHERE i.patrol_round_id = r.id)) ORDER BY r.scheduled_start DESC)
      FROM public.patrol_rounds r JOIN public.patrol_routes pr ON pr.id = r.route_id LEFT JOIN public.profiles p ON p.id = r.assigned_guard
      WHERE r.society_id = sid AND r.scheduled_start BETWEEN now() - make_interval(days => least(greatest(_days,1),60)) AND now() + interval '14 days'), '[]'::jsonb));
END $$;

-- ===== 4. Child / elder safety =====
CREATE TABLE public.safety_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_id uuid NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  relation text CHECK (char_length(relation) <= 40),
  phone text NOT NULL CHECK (phone ~ '^\+?[0-9]{10,13}$'),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.safety_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_id uuid NOT NULL REFERENCES public.flats(id),
  raised_by uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('child','elder')),
  subject_name text CHECK (char_length(subject_name) <= 80),
  note text CHECK (char_length(note) <= 300),
  last_seen text CHECK (char_length(last_seen) <= 120),
  status text NOT NULL DEFAULT 'raised' CHECK (status IN ('raised','acknowledged','resolved')),
  acknowledged_by uuid, acknowledged_at timestamptz,
  resolved_by uuid, resolved_at timestamptz, resolution_note text CHECK (char_length(resolution_note) <= 300),
  escalated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX safety_alerts_society ON public.safety_alerts (society_id, status, created_at DESC);
GRANT SELECT ON public.safety_contacts, public.safety_alerts TO authenticated;
GRANT ALL ON public.safety_contacts, public.safety_alerts TO service_role;
ALTER TABLE public.safety_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_alerts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._my_active_flat() RETURNS TABLE (flat_id uuid, society_id uuid, flat_number text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT fr.flat_id, f.society_id, f.flat_number FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
      WHERE fr.user_id = auth.uid() AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL ORDER BY fr.is_primary DESC NULLS LAST LIMIT 1 $$;

CREATE POLICY "household reads own contacts" ON public.safety_contacts FOR SELECT TO authenticated USING (flat_id IN (SELECT flat_id FROM public._my_active_flat()));
CREATE POLICY "household reads own alerts" ON public.safety_alerts FOR SELECT TO authenticated USING (flat_id IN (SELECT flat_id FROM public._my_active_flat()));
CREATE POLICY "gate staff read alerts" ON public.safety_alerts FOR SELECT TO authenticated USING (society_id = public._gate_society());

CREATE OR REPLACE FUNCTION public.resident_set_safety_contact(_id uuid, _name text, _relation text, _phone text, _active boolean DEFAULT true) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE f record; cid uuid := _id;
BEGIN
  SELECT * INTO f FROM public._my_active_flat();
  IF f.flat_id IS NULL THEN RAISE EXCEPTION 'not_your_flat' USING ERRCODE='42501'; END IF;
  PERFORM public._rate_hit('safety_contact', auth.uid()::text, 30, interval '1 hour');
  IF cid IS NULL THEN
    IF (SELECT count(*) FROM public.safety_contacts WHERE flat_id = f.flat_id AND is_active) >= 5 THEN RAISE EXCEPTION 'too_many_contacts' USING ERRCODE='22023'; END IF;
    INSERT INTO public.safety_contacts (society_id, flat_id, name, relation, phone, created_by)
    VALUES (f.society_id, f.flat_id, trim(_name), nullif(trim(coalesce(_relation,'')),''), regexp_replace(_phone,'[\s-]','','g'), auth.uid()) RETURNING id INTO cid;
  ELSE
    UPDATE public.safety_contacts SET name=trim(_name), relation=nullif(trim(coalesce(_relation,'')),''), phone=regexp_replace(_phone,'[\s-]','','g'), is_active=_active
     WHERE id = cid AND flat_id = f.flat_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata) VALUES (auth.uid(), 'safety.contact_saved', 'safety_contacts', cid::text, f.society_id, jsonb_build_object('active', _active));
  RETURN cid;
END $$;

CREATE OR REPLACE FUNCTION public.safety_alert_raise(_kind text, _subject text, _note text, _last_seen text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE f record; aid uuid;
BEGIN
  SELECT * INTO f FROM public._my_active_flat();
  IF f.flat_id IS NULL THEN RAISE EXCEPTION 'not_your_flat' USING ERRCODE='42501'; END IF;
  IF _kind NOT IN ('child','elder') THEN RAISE EXCEPTION 'invalid_kind' USING ERRCODE='22023'; END IF;
  SELECT id INTO aid FROM public.safety_alerts WHERE flat_id = f.flat_id AND kind = _kind AND status <> 'resolved' AND created_at > now() - interval '30 minutes' LIMIT 1;
  IF aid IS NOT NULL THEN RETURN aid; END IF;
  PERFORM public._rate_hit('safety_alert', auth.uid()::text, 5, interval '1 hour');
  INSERT INTO public.safety_alerts (society_id, flat_id, raised_by, kind, subject_name, note, last_seen)
  VALUES (f.society_id, f.flat_id, auth.uid(), _kind, public._visitor_clean(_subject, 80), public._visitor_clean(_note, 300), public._visitor_clean(_last_seen, 120)) RETURNING id INTO aid;
  PERFORM public._notify_gate_staff(f.society_id, 'safety_alert', (CASE _kind WHEN 'child' THEN 'Child safety alert' ELSE 'Elder safety alert' END) || ' · ' || coalesce(f.flat_number,'a home'),
    coalesce('Last seen: ' || public._visitor_clean(_last_seen,120), 'Please watch the gates and check the premises.'), '/app/guard', false);
  PERFORM public._notify_flat(f.society_id, f.flat_id, 'safety_alert', 'Safety alert raised', 'Guards and the committee have been alerted.', '/app/emergency');
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata) VALUES (auth.uid(), 'safety.alert_raised', 'safety_alerts', aid::text, f.society_id, jsonb_build_object('kind', _kind));
  RETURN aid;
END $$;

CREATE OR REPLACE FUNCTION public.safety_alert_update(_id uuid, _action text, _note text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE a public.safety_alerts; gsid uuid := public._gate_society(); own boolean;
BEGIN
  SELECT * INTO a FROM public.safety_alerts WHERE id = _id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  own := a.flat_id IN (SELECT flat_id FROM public._my_active_flat());
  IF NOT (own OR a.society_id = gsid) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF _action = 'ack' THEN
    IF a.society_id IS DISTINCT FROM gsid THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
    IF a.status <> 'raised' THEN RETURN; END IF;
    UPDATE public.safety_alerts SET status='acknowledged', acknowledged_by=auth.uid(), acknowledged_at=now() WHERE id=_id;
    PERFORM public._notify_flat(a.society_id, a.flat_id, 'safety_alert', 'Guard is responding', 'Your safety alert was acknowledged by the gate.', '/app/emergency');
  ELSIF _action = 'resolve' THEN
    IF a.status = 'resolved' THEN RETURN; END IF;
    UPDATE public.safety_alerts SET status='resolved', resolved_by=auth.uid(), resolved_at=now(), resolution_note=public._visitor_clean(_note,300) WHERE id=_id;
    PERFORM public._notify_gate_staff(a.society_id, 'safety_alert', 'Safety alert resolved', coalesce(public._visitor_clean(_note,200),'Marked safe.'), '/app/guard', false);
  ELSE RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata) VALUES (auth.uid(), 'safety.alert_' || _action, 'safety_alerts', _id::text, a.society_id, '{}'::jsonb);
END $$;

-- Guards see contacts ONLY for open alerts in their society; escalates unacknowledged alerts once.
CREATE OR REPLACE FUNCTION public.gate_safety_alerts() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid := public._gate_society(); r record;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  FOR r IN SELECT id FROM public.safety_alerts WHERE society_id = sid AND status='raised' AND escalated_at IS NULL AND created_at < now() - interval '5 minutes' FOR UPDATE SKIP LOCKED LOOP
    UPDATE public.safety_alerts SET escalated_at = now() WHERE id = r.id;
    PERFORM public._notify_society_admins(sid, 'safety_alert', 'Safety alert not yet acknowledged', 'A child/elder safety alert has waited over 5 minutes.', '/society/visitors');
  END LOOP;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'status', a.status, 'flat', f.flat_number, 'subject', a.subject_name, 'note', a.note, 'last_seen', a.last_seen,
      'created_at', a.created_at, 'escalated', a.escalated_at IS NOT NULL,
      'contacts', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'relation', c.relation, 'phone', c.phone)), '[]'::jsonb) FROM public.safety_contacts c WHERE c.flat_id = a.flat_id AND c.is_active)) ORDER BY a.created_at DESC)
    FROM public.safety_alerts a JOIN public.flats f ON f.id = a.flat_id WHERE a.society_id = sid AND a.status <> 'resolved'), '[]'::jsonb);
END $$;

-- ===== 5-7. Hardware foundation =====
CREATE TABLE public.gate_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('anpr','rfid','barrier')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  gate_label text CHECK (char_length(gate_label) <= 60),
  provider text CHECK (char_length(provider) <= 60),
  status text NOT NULL DEFAULT 'unconfigured' CHECK (status IN ('unconfigured','active','disabled')),
  key_hash text,
  last_seen_at timestamptz, last_error text CHECK (char_length(last_error) <= 200),
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.rfid_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  credential_hash text NOT NULL,
  last4 text NOT NULL,
  label text CHECK (char_length(label) <= 60),
  vehicle_id uuid REFERENCES public.vehicles(id), flat_id uuid REFERENCES public.flats(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid, revoked_at timestamptz,
  UNIQUE (society_id, credential_hash)
);
CREATE TABLE public.gate_hardware_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES public.gate_devices(id),
  kind text NOT NULL CHECK (kind IN ('plate_read','rfid_scan','barrier_result')),
  external_event_id text NOT NULL CHECK (char_length(external_event_id) BETWEEN 6 AND 80),
  occurred_at timestamptz NOT NULL,
  plate text, confidence numeric(4,3),
  result text NOT NULL CHECK (result IN ('matched_resident','matched_visitor','needs_review','allowed','denied','revoked_credential','recorded')),
  vehicle_id uuid, visitor_id uuid, rfid_credential_id uuid,
  reviewed_by uuid, reviewed_at timestamptz, review_decision text CHECK (review_decision IN ('allow','deny')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, external_event_id)
);
CREATE INDEX gate_hw_events_society ON public.gate_hardware_events (society_id, created_at DESC);
CREATE TABLE public.barrier_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES public.gate_devices(id),
  request_id uuid NOT NULL UNIQUE,
  requested_by uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 200),
  visitor_id uuid,
  status text NOT NULL CHECK (status IN ('queued','delivered','succeeded','failed','timeout','unavailable')),
  provider_message text CHECK (char_length(provider_message) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX barrier_commands_device ON public.barrier_commands (device_id, status, created_at);
GRANT SELECT (id, society_id, kind, name, gate_label, provider, status, last_seen_at, last_error, created_at) ON public.gate_devices TO authenticated;
GRANT SELECT (id, society_id, last4, label, vehicle_id, flat_id, status, created_at, revoked_at) ON public.rfid_credentials TO authenticated;
GRANT SELECT ON public.gate_hardware_events, public.barrier_commands TO authenticated;
GRANT ALL ON public.gate_devices, public.rfid_credentials, public.gate_hardware_events, public.barrier_commands TO service_role;
ALTER TABLE public.gate_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfid_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gate_hardware_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barrier_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gate read devices" ON public.gate_devices FOR SELECT TO authenticated USING (society_id = public._gate_society());
CREATE POLICY "admin read rfid" ON public.rfid_credentials FOR SELECT TO authenticated USING (society_id = public._sec_admin_society());
CREATE POLICY "gate read hw events" ON public.gate_hardware_events FOR SELECT TO authenticated USING (society_id = public._gate_society());
CREATE POLICY "gate read barrier commands" ON public.barrier_commands FOR SELECT TO authenticated USING (society_id = public._gate_society());

CREATE OR REPLACE FUNCTION public._norm_plate(_p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT nullif(upper(regexp_replace(coalesce(_p,''),'[^A-Za-z0-9]','','g')),'') $$;

CREATE OR REPLACE FUNCTION public.admin_upsert_gate_device(_id uuid, _kind text, _name text, _gate_label text, _provider text, _status text, _rotate_key boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid := public._sec_admin_society(); did uuid := _id; raw text; d public.gate_devices;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  PERFORM public._rate_hit('gate_device_admin', auth.uid()::text, 30, interval '1 hour');
  IF _status NOT IN ('unconfigured','active','disabled') THEN RAISE EXCEPTION 'invalid_status' USING ERRCODE='22023'; END IF;
  IF did IS NULL THEN
    INSERT INTO public.gate_devices (society_id, kind, name, gate_label, provider, status, created_by)
    VALUES (sid, _kind, trim(_name), nullif(trim(coalesce(_gate_label,'')),''), nullif(trim(coalesce(_provider,'')),''), 'unconfigured', auth.uid()) RETURNING id INTO did;
  ELSE
    UPDATE public.gate_devices SET name=trim(_name), gate_label=nullif(trim(coalesce(_gate_label,'')),''), provider=nullif(trim(coalesce(_provider,'')),''), status=_status
     WHERE id = did AND society_id = sid;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  END IF;
  SELECT * INTO d FROM public.gate_devices WHERE id = did;
  IF _id IS NULL OR _rotate_key THEN
    raw := 'gdk_' || translate(encode(extensions.gen_random_bytes(32),'base64'), '+/=', '-_');
    UPDATE public.gate_devices SET key_hash = encode(extensions.digest(raw,'sha256'),'hex') WHERE id = did;
  END IF;
  IF _status = 'active' AND (SELECT key_hash FROM public.gate_devices WHERE id = did) IS NULL THEN RAISE EXCEPTION 'device_key_required' USING ERRCODE='22023'; END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), CASE WHEN _id IS NULL THEN 'gate_device.created' WHEN _rotate_key THEN 'gate_device.key_rotated' ELSE 'gate_device.updated' END, 'gate_devices', did::text, sid, jsonb_build_object('kind', d.kind, 'status', _status));
  RETURN jsonb_build_object('id', did, 'device_key', raw);
END $$;

CREATE OR REPLACE FUNCTION public.admin_register_rfid(_raw text, _label text, _vehicle_id uuid, _flat_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid := public._sec_admin_society(); norm text := upper(regexp_replace(coalesce(_raw,''),'[^A-Za-z0-9]','','g')); cid uuid;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF char_length(norm) NOT BETWEEN 6 AND 64 THEN RAISE EXCEPTION 'invalid_credential' USING ERRCODE='22023'; END IF;
  IF _vehicle_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.vehicles WHERE id=_vehicle_id AND society_id=sid AND is_active IS NOT FALSE) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF _flat_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.flats WHERE id=_flat_id AND society_id=sid) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  PERFORM public._rate_hit('rfid_admin', auth.uid()::text, 60, interval '1 hour');
  INSERT INTO public.rfid_credentials (society_id, credential_hash, last4, label, vehicle_id, flat_id, created_by)
  VALUES (sid, encode(extensions.digest(sid::text || ':' || norm,'sha256'),'hex'), right(norm,4), nullif(trim(coalesce(_label,'')),''), _vehicle_id, _flat_id, auth.uid())
  ON CONFLICT (society_id, credential_hash) DO NOTHING RETURNING id INTO cid;
  IF cid IS NULL THEN RAISE EXCEPTION 'already_registered' USING ERRCODE='23505'; END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata) VALUES (auth.uid(), 'rfid.registered', 'rfid_credentials', cid::text, sid, jsonb_build_object('last4', right(norm,4)));
  RETURN cid;
END $$;

CREATE OR REPLACE FUNCTION public.admin_revoke_rfid(_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid := public._sec_admin_society();
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  UPDATE public.rfid_credentials SET status='revoked', revoked_at=now(), revoked_by=auth.uid() WHERE id=_id AND society_id=sid AND status='active';
  IF FOUND THEN INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata) VALUES (auth.uid(), 'rfid.revoked', 'rfid_credentials', _id::text, sid, '{}'::jsonb); END IF;
END $$;

-- Device ingestion: service-role only. Society comes from the authenticated device row, never the payload.
CREATE OR REPLACE FUNCTION public.device_ingest_event(_device_id uuid, _key text, _event jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE d public.gate_devices; ev text := _event->>'event_id'; typ text := _event->>'type'; occ timestamptz; plate text; conf numeric;
        res text; vid uuid; visid uuid; cred public.rfid_credentials; eid uuid; cmds jsonb; existing record;
BEGIN
  SELECT * INTO d FROM public.gate_devices WHERE id = _device_id FOR UPDATE;
  IF d.id IS NULL OR d.key_hash IS NULL OR _key IS NULL OR encode(extensions.digest(_key,'sha256'),'hex') <> d.key_hash THEN RETURN jsonb_build_object('error','unauthorized'); END IF;
  IF d.status <> 'active' THEN RETURN jsonb_build_object('error','device_inactive'); END IF;
  PERFORM public._rate_hit('gate_device_ingest', d.id::text, 600, interval '1 minute');
  UPDATE public.gate_devices SET last_seen_at = now(), last_error = NULL WHERE id = d.id;
  IF typ = 'barrier_poll' AND d.kind = 'barrier' THEN
    UPDATE public.barrier_commands SET status='timeout', completed_at=now(), provider_message='Device did not confirm in time' WHERE device_id=d.id AND status IN ('queued','delivered') AND created_at < now() - interval '30 seconds';
    WITH c AS (UPDATE public.barrier_commands SET status='delivered' WHERE device_id=d.id AND status='queued' RETURNING id, request_id)
    SELECT coalesce(jsonb_agg(jsonb_build_object('command_id', id)), '[]'::jsonb) INTO cmds FROM c;
    RETURN jsonb_build_object('ok', true, 'commands', cmds);
  END IF;
  BEGIN occ := (_event->>'occurred_at')::timestamptz; EXCEPTION WHEN others THEN RETURN jsonb_build_object('error','invalid_payload'); END;
  IF occ IS NULL OR occ < now() - interval '5 minutes' OR occ > now() + interval '1 minute' THEN RETURN jsonb_build_object('error','stale_event'); END IF;
  SELECT id, result INTO existing FROM public.gate_hardware_events WHERE device_id = d.id AND external_event_id = ev;
  IF existing.id IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'duplicate', true, 'result', existing.result); END IF;
  IF typ = 'plate_read' AND d.kind = 'anpr' THEN
    plate := public._norm_plate(_event->>'plate'); conf := least(greatest(coalesce((_event->>'confidence')::numeric, 0),0),1);
    SELECT id INTO vid FROM public.vehicles WHERE society_id = d.society_id AND is_active IS NOT FALSE AND public._norm_plate(plate_number) = plate LIMIT 1;
    IF vid IS NULL THEN
      SELECT id INTO visid FROM public.visitors WHERE society_id = d.society_id AND public._norm_plate(vehicle_number) = plate AND status IN ('approved','expected','pending','inside') AND created_at > now() - interval '24 hours' ORDER BY created_at DESC LIMIT 1;
    END IF;
    res := CASE WHEN plate IS NULL OR conf < 0.8 THEN 'needs_review' WHEN vid IS NOT NULL THEN 'matched_resident' WHEN visid IS NOT NULL THEN 'matched_visitor' ELSE 'needs_review' END;
    INSERT INTO public.gate_hardware_events (society_id, device_id, kind, external_event_id, occurred_at, plate, confidence, result, vehicle_id, visitor_id)
    VALUES (d.society_id, d.id, 'plate_read', ev, occ, plate, conf, res, vid, visid) RETURNING id INTO eid;
  ELSIF typ = 'rfid_scan' AND d.kind = 'rfid' THEN
    SELECT * INTO cred FROM public.rfid_credentials WHERE society_id = d.society_id
      AND credential_hash = encode(extensions.digest(d.society_id::text || ':' || upper(regexp_replace(coalesce(_event->>'credential',''),'[^A-Za-z0-9]','','g')),'sha256'),'hex');
    res := CASE WHEN cred.id IS NULL THEN 'denied' WHEN cred.status <> 'active' THEN 'revoked_credential' ELSE 'allowed' END;
    INSERT INTO public.gate_hardware_events (society_id, device_id, kind, external_event_id, occurred_at, result, rfid_credential_id, vehicle_id)
    VALUES (d.society_id, d.id, 'rfid_scan', ev, occ, res, cred.id, cred.vehicle_id) RETURNING id INTO eid;
  ELSIF typ = 'barrier_result' AND d.kind = 'barrier' THEN
    UPDATE public.barrier_commands SET status = CASE WHEN (_event->>'success')::boolean THEN 'succeeded' ELSE 'failed' END, completed_at = now(), provider_message = left(_event->>'message',200)
     WHERE id = (_event->>'command_id')::uuid AND device_id = d.id AND status IN ('queued','delivered');
    IF NOT FOUND THEN RETURN jsonb_build_object('error','unknown_command'); END IF;
    INSERT INTO public.gate_hardware_events (society_id, device_id, kind, external_event_id, occurred_at, result) VALUES (d.society_id, d.id, 'barrier_result', ev, occ, 'recorded') RETURNING id INTO eid;
  ELSE
    RETURN jsonb_build_object('error','type_not_allowed_for_device');
  END IF;
  IF res = 'needs_review' THEN PERFORM public._notify_gate_staff_once(d.society_id, 'gate_review', 'Vehicle needs a check', 'Camera could not confirm a number plate at ' || coalesce(d.gate_label, d.name), '/app/guard', 'hw_review:' || d.id || ':' || to_char(now(),'YYYYMMDDHH24MI'), 'normal'); END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata) VALUES (NULL, 'gate_device.event', 'gate_hardware_events', eid::text, d.society_id, jsonb_build_object('type', typ, 'result', res));
  RETURN jsonb_build_object('ok', true, 'result', coalesce(res,'recorded'));
END $$;

CREATE OR REPLACE FUNCTION public.gate_review_hardware_event(_id uuid, _decision text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid := public._gate_society();
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _decision NOT IN ('allow','deny') THEN RAISE EXCEPTION 'invalid_decision' USING ERRCODE='22023'; END IF;
  UPDATE public.gate_hardware_events SET reviewed_by=auth.uid(), reviewed_at=now(), review_decision=_decision WHERE id=_id AND society_id=sid AND result='needs_review' AND reviewed_at IS NULL;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata) VALUES (auth.uid(), 'gate_device.reviewed', 'gate_hardware_events', _id::text, sid, jsonb_build_object('decision', _decision));
END $$;

CREATE OR REPLACE FUNCTION public.gate_request_barrier_open(_device_id uuid, _reason text, _request_id uuid, _visitor_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid := public._gate_society(); d public.gate_devices; st text; msg text; cid uuid; ex public.barrier_commands;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO ex FROM public.barrier_commands WHERE request_id = _request_id;
  IF ex.id IS NOT NULL THEN
    IF ex.society_id <> sid THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
    RETURN jsonb_build_object('command_id', ex.id, 'status', ex.status, 'message', ex.provider_message); END IF;
  SELECT * INTO d FROM public.gate_devices WHERE id = _device_id AND society_id = sid AND kind='barrier';
  IF d.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF char_length(trim(coalesce(_reason,''))) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  IF _visitor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.visitors WHERE id=_visitor_id AND society_id=sid) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  PERFORM public._rate_hit('barrier_open', auth.uid()::text, 30, interval '10 minutes');
  IF d.status = 'active' AND d.last_seen_at > now() - interval '2 minutes' THEN st := 'queued'; msg := NULL;
  ELSE st := 'unavailable'; msg := 'Barrier is not connected. Open it manually.'; END IF;
  INSERT INTO public.barrier_commands (society_id, device_id, request_id, requested_by, reason, visitor_id, status, provider_message, completed_at)
  VALUES (sid, d.id, _request_id, auth.uid(), left(trim(_reason),200), _visitor_id, st, msg, CASE WHEN st='unavailable' THEN now() END) RETURNING id INTO cid;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata) VALUES (auth.uid(), 'barrier.open_requested', 'barrier_commands', cid::text, sid, jsonb_build_object('device', d.id, 'status', st));
  RETURN jsonb_build_object('command_id', cid, 'status', st, 'message', msg);
END $$;

-- ===== Grants =====
REVOKE ALL ON FUNCTION public._auth_session_id(), public._sec_admin_society(), public._guard_session_ok(uuid), public._guard_role_society(),
  public._guard_open_session(uuid,text,text,uuid), public.patrol_sweep(uuid), public._my_active_flat(), public.device_ingest_event(uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._auth_session_id(), public._sec_admin_society(), public._guard_session_ok(uuid), public._my_active_flat() TO authenticated;
REVOKE ALL ON FUNCTION public._guard_open_session(uuid,text,text,uuid), public.patrol_sweep(uuid), public.device_ingest_event(uuid,text,jsonb), public._guard_role_society() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.device_ingest_event(uuid,text,jsonb) TO service_role;
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['guard_session_status()','guard_start_session(text)','guard_redeem_entry_token(text,text)','guard_end_session()','admin_list_gate_guards()',
    'admin_revoke_guard_access(uuid,text)','admin_issue_guard_entry_token(uuid)','admin_upsert_patrol_route(uuid,text,jsonb,boolean)','admin_schedule_patrol_rounds(uuid,uuid,timestamptz,integer,integer)',
    'admin_cancel_patrol_round(uuid,text)','guard_patrol_list()','guard_patrol_start(uuid)','guard_patrol_checkpoint(uuid,uuid,text,text,text)','guard_patrol_finish(uuid,text)','admin_patrol_overview(integer)',
    'resident_set_safety_contact(uuid,text,text,text,boolean)','safety_alert_raise(text,text,text,text)','safety_alert_update(uuid,text,text)','gate_safety_alerts()',
    'admin_upsert_gate_device(uuid,text,text,text,text,text,boolean)','admin_register_rfid(text,text,uuid,uuid)','admin_revoke_rfid(uuid)','gate_review_hardware_event(uuid,text)','gate_request_barrier_open(uuid,text,uuid,uuid)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;
