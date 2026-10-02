-- Roles: Auditor (read-only finance) + Staff (permission-scoped operations).
-- Extends the canonical user_roles / current_user_has_society_permission model.

ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS permissions text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS revoked_reason text;

CREATE OR REPLACE FUNCTION public.is_known_capability(_cap text)
 RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT _cap IN (
    'team.view','team.manage','privacy.view','privacy.manage',
    'society.settings','blocks.view','blocks.manage','flats.manage',
    'directory.view','residents.view_society','residents.view_block',
    'residents.private_detail','residents.manage',
    'finance.admin','finance.resident_summary','finance.resident_detailed',
    'billing.manage','notices.manage','polls.manage','guard.operate','self.household',
    'finance.read','staff.helpdesk','staff.operations','staff.assets','staff.inventory',
    'staff.vendors','staff.documents'
  );
$$;

CREATE OR REPLACE FUNCTION public._staff_permission_valid(_perms text[])
 RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT coalesce(array_length(_perms,1),0) <= 7 AND coalesce(bool_and(p IN (
    'staff.helpdesk','staff.operations','staff.assets','staff.inventory','staff.vendors','staff.documents','finance.read')), true)
  FROM unnest(coalesce(_perms,'{}'::text[])) p;
$$;

ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_permissions_scope CHECK (
  (role = 'staff' AND public._staff_permission_valid(permissions)) OR (role <> 'staff' AND permissions = '{}'::text[])
) NOT VALID;
ALTER TABLE public.user_roles VALIDATE CONSTRAINT user_roles_permissions_scope;

-- Helpdesk timeline can now record staff actions.
ALTER TABLE public.support_ticket_events DROP CONSTRAINT support_ticket_events_actor_kind_check;
ALTER TABLE public.support_ticket_events ADD CONSTRAINT support_ticket_events_actor_kind_check
  CHECK (actor_kind = ANY (ARRAY['resident','admin','system','staff']));

-- ---------------------------------------------------------------------------
-- Finance reader gate (read-only). Writes keep _finance_require_admin.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._finance_require_reader(_society_id uuid)
 RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF NOT (public.current_user_has_society_permission(_society_id,'billing.manage'::text,NULL::uuid)
          OR public.current_user_has_society_permission(_society_id,'finance.read'::text,NULL::uuid)
          OR public.has_role(v_uid,'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF NOT public._finance_plan_enabled(_society_id) THEN RAISE EXCEPTION 'plan_required' USING ERRCODE='42501'; END IF;
  RETURN v_uid;
END $$;
REVOKE ALL ON FUNCTION public._finance_require_reader(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._finance_require_reader(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public._finance_reader_for(_society_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT public.current_user_has_society_permission(_society_id, 'finance.read', NULL::uuid) $$;
REVOKE ALL ON FUNCTION public._finance_reader_for(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._finance_reader_for(uuid) TO authenticated;

-- Auditor read policies on canonical money tables (SELECT only; no write policies are added).
CREATE POLICY bills_finance_reader_read ON public.bills FOR SELECT TO authenticated USING (public._finance_reader_for(society_id));
CREATE POLICY bill_line_items_finance_reader_read ON public.bill_line_items FOR SELECT TO authenticated USING (public._finance_reader_for(society_id));
CREATE POLICY bill_adjustments_finance_reader_read ON public.bill_adjustments FOR SELECT TO authenticated USING (public._finance_reader_for(society_id));
CREATE POLICY payments_finance_reader_read ON public.payments FOR SELECT TO authenticated USING (public._finance_reader_for(society_id));
CREATE POLICY payment_receipts_finance_reader_read ON public.payment_receipts FOR SELECT TO authenticated USING (public._finance_reader_for(society_id));
CREATE POLICY income_records_finance_reader_read ON public.society_income_records FOR SELECT TO authenticated USING (public._finance_reader_for(society_id));
CREATE POLICY opening_balances_finance_reader_read ON public.opening_balances FOR SELECT TO authenticated USING (public._finance_reader_for(society_id));
CREATE POLICY historical_payments_finance_reader_read ON public.historical_payments FOR SELECT TO authenticated USING (public._finance_reader_for(society_id));
CREATE POLICY maintenance_periods_finance_reader_read ON public.maintenance_periods FOR SELECT TO authenticated USING (public._finance_reader_for(society_id));

-- ---------------------------------------------------------------------------
-- Invitations (bound to a verified phone; accepted only by that phone's owner)
-- ---------------------------------------------------------------------------
CREATE TABLE public.role_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  role public.app_role NOT NULL CHECK (role IN ('auditor','staff')),
  phone_digits text NOT NULL CHECK (phone_digits ~ '^91[6-9][0-9]{9}$'),
  display_name text CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 2 AND 80),
  staff_id uuid REFERENCES public.society_staff(id) ON DELETE SET NULL,
  permissions text[] NOT NULL DEFAULT '{}'::text[],
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','cancelled','declined')),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  invited_by uuid NOT NULL,
  accepted_by uuid,
  accepted_at timestamptz,
  cancelled_reason text CHECK (cancelled_reason IS NULL OR char_length(cancelled_reason) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'staff' AND staff_id IS NOT NULL) OR (role = 'auditor' AND staff_id IS NULL AND permissions = '{}'::text[]))
);
CREATE UNIQUE INDEX role_invitations_one_pending ON public.role_invitations (society_id, role, phone_digits) WHERE status = 'pending';
CREATE INDEX role_invitations_phone ON public.role_invitations (phone_digits) WHERE status = 'pending';
GRANT SELECT ON public.role_invitations TO authenticated;
GRANT ALL ON public.role_invitations TO service_role;
ALTER TABLE public.role_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_invitations_admin_read ON public.role_invitations FOR SELECT TO authenticated
  USING (public.current_user_has_society_permission(society_id, 'team.manage', NULL::uuid));

-- Session awareness (last seen per role); authorization never depends on this table.
CREATE TABLE public.role_sessions (
  role_id uuid PRIMARY KEY REFERENCES public.user_roles(id) ON DELETE CASCADE,
  society_id uuid NOT NULL,
  user_id uuid NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  device text CHECK (device IS NULL OR char_length(device) <= 120)
);
GRANT SELECT ON public.role_sessions TO authenticated;
GRANT ALL ON public.role_sessions TO service_role;
ALTER TABLE public.role_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_sessions_admin_read ON public.role_sessions FOR SELECT TO authenticated
  USING (public.current_user_has_society_permission(society_id, 'team.manage', NULL::uuid));

CREATE OR REPLACE FUNCTION public._caller_phone_digits()
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT nullif(regexp_replace(coalesce(u.phone,''),'\D','','g'),'') FROM auth.users u WHERE u.id = auth.uid() $$;
REVOKE ALL ON FUNCTION public._caller_phone_digits() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._roles_admin_society()
 RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  SELECT p.society_id INTO sid FROM public.profiles p WHERE p.id = auth.uid();
  IF sid IS NULL OR NOT public.current_user_has_society_permission(sid, 'team.manage', NULL::uuid) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  RETURN sid;
END $$;
REVOKE ALL ON FUNCTION public._roles_admin_society() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.admin_invite_role(_role text, _phone text, _name text, _staff uuid, _permissions text[])
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid := public._roles_admin_society(); d text; rid uuid; st public.society_staff;
BEGIN
  PERFORM public._rate_hit('role_invite', auth.uid()::text, 30, interval '1 hour');
  IF _role NOT IN ('auditor','staff') THEN RAISE EXCEPTION 'invalid_role' USING ERRCODE='22023'; END IF;
  d := regexp_replace(coalesce(_phone,''),'\D','','g');
  IF char_length(d) = 10 THEN d := '91' || d; END IF;
  IF d !~ '^91[6-9][0-9]{9}$' THEN RAISE EXCEPTION 'invalid_phone' USING ERRCODE='22023'; END IF;
  IF d = public._caller_phone_digits() THEN RAISE EXCEPTION 'self_assignment' USING ERRCODE='42501'; END IF;
  IF _role = 'staff' THEN
    SELECT * INTO st FROM public.society_staff WHERE id = _staff AND society_id = sid FOR UPDATE;
    IF st.id IS NULL OR NOT st.is_active THEN RAISE EXCEPTION 'staff_not_found' USING ERRCODE='22023'; END IF;
    IF st.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = st.user_id AND society_id = sid AND role='staff' AND is_active) THEN
      RAISE EXCEPTION 'staff_already_linked' USING ERRCODE='22023';
    END IF;
    IF NOT public._staff_permission_valid(_permissions) THEN RAISE EXCEPTION 'invalid_permissions' USING ERRCODE='22023'; END IF;
  ELSE
    _staff := NULL; _permissions := '{}';
  END IF;
  IF EXISTS (SELECT 1 FROM public.role_invitations WHERE society_id = sid AND role = _role::public.app_role AND phone_digits = d AND status='pending' AND expires_at > now()) THEN
    RAISE EXCEPTION 'invite_exists' USING ERRCODE='22023';
  END IF;
  UPDATE public.role_invitations SET status='cancelled', cancelled_reason='Expired', updated_at=now()
   WHERE society_id = sid AND role = _role::public.app_role AND phone_digits = d AND status='pending';
  INSERT INTO public.role_invitations (society_id, role, phone_digits, display_name, staff_id, permissions, invited_by)
  VALUES (sid, _role::public.app_role, d, nullif(btrim(coalesce(_name, st.full_name)),''), _staff, coalesce(_permissions,'{}'), auth.uid())
  RETURNING id INTO rid;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'roles.invited', 'role_invitations', rid::text, sid,
    jsonb_build_object('role', _role, 'staff_id', _staff, 'permissions', coalesce(_permissions,'{}'), 'phone_last4', right(d,4)));
  RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION public.admin_cancel_role_invitation(_id uuid, _reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid := public._roles_admin_society();
BEGIN
  IF char_length(btrim(coalesce(_reason,''))) < 5 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  UPDATE public.role_invitations SET status='cancelled', cancelled_reason=left(btrim(_reason),300), updated_at=now()
   WHERE id = _id AND society_id = sid AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='22023'; END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'roles.invite_cancelled', 'role_invitations', _id::text, sid, jsonb_build_object('reason', left(btrim(_reason),300)));
END $$;

CREATE OR REPLACE FUNCTION public.list_my_role_invitations()
 RETURNS TABLE(id uuid, society_name text, role text, job_type text, permissions text[], expires_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT i.id, s.name, i.role::text, st.job_type, i.permissions, i.expires_at
  FROM public.role_invitations i
  JOIN public.societies s ON s.id = i.society_id
  LEFT JOIN public.society_staff st ON st.id = i.staff_id
  WHERE i.status = 'pending' AND i.expires_at > now()
    AND public._caller_phone_digits() IS NOT NULL AND i.phone_digits = public._caller_phone_digits()
  ORDER BY i.created_at DESC LIMIT 10;
$$;

CREATE OR REPLACE FUNCTION public.respond_role_invitation(_id uuid, _accept boolean)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE uid uuid := auth.uid(); inv public.role_invitations; d text := public._caller_phone_digits(); rid uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  PERFORM public._rate_hit('role_invite_respond', uid::text, 20, interval '1 hour');
  SELECT * INTO inv FROM public.role_invitations WHERE id = _id FOR UPDATE;
  IF inv.id IS NULL OR d IS NULL OR inv.phone_digits <> d THEN RAISE EXCEPTION 'not_found' USING ERRCODE='22023'; END IF;
  IF inv.status <> 'pending' OR inv.expires_at <= now() THEN RAISE EXCEPTION 'invite_unavailable' USING ERRCODE='22023'; END IF;
  IF inv.invited_by = uid THEN RAISE EXCEPTION 'self_assignment' USING ERRCODE='42501'; END IF;
  IF NOT _accept THEN
    UPDATE public.role_invitations SET status='declined', updated_at=now() WHERE id = inv.id;
    INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (uid, 'roles.invite_declined', 'role_invitations', inv.id::text, inv.society_id, jsonb_build_object('role', inv.role));
    RETURN NULL;
  END IF;
  -- The inviter must still be allowed to manage the team when the invite is used.
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = inv.invited_by AND society_id = inv.society_id
                 AND role = 'society_admin' AND is_active) THEN
    RAISE EXCEPTION 'invite_unavailable' USING ERRCODE='22023';
  END IF;
  IF inv.role = 'staff' THEN
    PERFORM 1 FROM public.society_staff WHERE id = inv.staff_id AND society_id = inv.society_id AND is_active
      AND (user_id IS NULL OR user_id = uid) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invite_unavailable' USING ERRCODE='22023'; END IF;
    UPDATE public.society_staff SET user_id = uid, updated_at = now() WHERE id = inv.staff_id;
  END IF;
  INSERT INTO public.user_roles (user_id, role, society_id, is_active, assigned_by, permissions, revoked_reason)
  VALUES (uid, inv.role, inv.society_id, true, inv.invited_by, inv.permissions, NULL)
  ON CONFLICT (user_id, role, society_id) DO UPDATE
    SET is_active = true, assigned_by = EXCLUDED.assigned_by, permissions = EXCLUDED.permissions,
        deactivated_at = NULL, deactivated_by = NULL, revoked_reason = NULL, updated_at = now()
  RETURNING id INTO rid;
  UPDATE public.role_invitations SET status='accepted', accepted_by = uid, accepted_at = now(), updated_at=now() WHERE id = inv.id;
  UPDATE public.profiles SET society_id = inv.society_id WHERE id = uid AND society_id IS NULL;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'roles.invite_accepted', 'user_roles', rid::text, inv.society_id,
    jsonb_build_object('role', inv.role, 'invitation_id', inv.id, 'permissions', inv.permissions));
  PERFORM public._notify_society_admins(inv.society_id, 'team', 'Invitation accepted',
    CASE WHEN inv.role = 'auditor' THEN 'Your auditor has accepted access.' ELSE 'A staff member has accepted access.' END, '/society/team');
  RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION public.admin_list_role_access()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid := public._roles_admin_society();
BEGIN
  RETURN jsonb_build_object(
    'members', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'role_id', ur.id, 'role', ur.role, 'is_active', ur.is_active, 'permissions', ur.permissions,
        'full_name', coalesce(nullif(btrim(st.full_name),''), nullif(btrim(p.full_name),''), 'Unnamed'),
        'job_type', st.job_type, 'staff_id', st.id, 'revoked_reason', ur.revoked_reason,
        'deactivated_at', ur.deactivated_at, 'created_at', ur.created_at, 'last_seen_at', rs.last_seen_at, 'device', rs.device)
        ORDER BY ur.is_active DESC, ur.created_at DESC)
      FROM public.user_roles ur
      LEFT JOIN public.profiles p ON p.id = ur.user_id
      LEFT JOIN public.society_staff st ON st.user_id = ur.user_id AND st.society_id = ur.society_id AND ur.role = 'staff'
      LEFT JOIN public.role_sessions rs ON rs.role_id = ur.id
      WHERE ur.society_id = sid AND ur.role IN ('auditor','staff')), '[]'::jsonb),
    'invitations', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'role', i.role, 'display_name', i.display_name, 'phone_last4', right(i.phone_digits,4),
        'status', CASE WHEN i.status='pending' AND i.expires_at <= now() THEN 'expired' ELSE i.status END,
        'expires_at', i.expires_at, 'permissions', i.permissions, 'created_at', i.created_at, 'cancelled_reason', i.cancelled_reason)
        ORDER BY i.created_at DESC)
      FROM (SELECT * FROM public.role_invitations WHERE society_id = sid ORDER BY created_at DESC LIMIT 50) i), '[]'::jsonb),
    'history', coalesce((SELECT jsonb_agg(jsonb_build_object('action', a.action, 'at', a.created_at, 'metadata', a.metadata) ORDER BY a.created_at DESC)
      FROM (SELECT * FROM public.audit_log WHERE society_id = sid AND action LIKE 'roles.%' ORDER BY created_at DESC LIMIT 40) a), '[]'::jsonb),
    'staff_options', coalesce((SELECT jsonb_agg(jsonb_build_object('id', st.id, 'full_name', st.full_name, 'job_type', st.job_type) ORDER BY st.full_name)
      FROM public.society_staff st WHERE st.society_id = sid AND st.is_active
        AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = st.user_id AND ur.society_id = sid AND ur.role='staff' AND ur.is_active)), '[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_role_access(_role_id uuid, _active boolean, _reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid := public._roles_admin_society(); r public.user_roles;
BEGIN
  PERFORM public._rate_hit('role_access', auth.uid()::text, 60, interval '1 hour');
  SELECT * INTO r FROM public.user_roles WHERE id = _role_id AND society_id = sid FOR UPDATE;
  IF r.id IS NULL OR r.role NOT IN ('auditor','staff') THEN RAISE EXCEPTION 'role_not_found' USING ERRCODE='22023'; END IF;
  IF r.user_id = auth.uid() THEN RAISE EXCEPTION 'self_assignment' USING ERRCODE='42501'; END IF;
  IF NOT _active AND char_length(btrim(coalesce(_reason,''))) < 5 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  IF _active AND r.role = 'staff' AND NOT EXISTS (SELECT 1 FROM public.society_staff WHERE user_id = r.user_id AND society_id = sid AND is_active) THEN
    RAISE EXCEPTION 'staff_not_found' USING ERRCODE='22023';
  END IF;
  UPDATE public.user_roles SET is_active = _active,
    deactivated_at = CASE WHEN _active THEN NULL ELSE now() END,
    deactivated_by = CASE WHEN _active THEN NULL ELSE auth.uid() END,
    revoked_reason = CASE WHEN _active THEN NULL ELSE left(btrim(_reason),300) END,
    updated_at = now()
  WHERE id = r.id;
  IF NOT _active THEN DELETE FROM public.role_sessions WHERE role_id = r.id; END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), CASE WHEN _active THEN 'roles.reactivated' ELSE 'roles.revoked' END, 'user_roles', r.id::text, sid,
    jsonb_build_object('role', r.role, 'target_user_id', r.user_id, 'reason', CASE WHEN _active THEN NULL ELSE left(btrim(_reason),300) END));
  IF NOT _active THEN
    PERFORM public._notify_user(r.user_id, sid, 'team', 'Access removed', 'Your ' || r.role::text || ' access to this society has been removed.', '/');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_staff_permissions(_role_id uuid, _permissions text[])
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid := public._roles_admin_society(); r public.user_roles;
BEGIN
  SELECT * INTO r FROM public.user_roles WHERE id = _role_id AND society_id = sid FOR UPDATE;
  IF r.id IS NULL OR r.role <> 'staff' THEN RAISE EXCEPTION 'role_not_found' USING ERRCODE='22023'; END IF;
  IF r.user_id = auth.uid() THEN RAISE EXCEPTION 'self_assignment' USING ERRCODE='42501'; END IF;
  IF NOT public._staff_permission_valid(_permissions) THEN RAISE EXCEPTION 'invalid_permissions' USING ERRCODE='22023'; END IF;
  UPDATE public.user_roles SET permissions = (SELECT coalesce(array_agg(DISTINCT p ORDER BY p),'{}') FROM unnest(_permissions) p), updated_at = now() WHERE id = r.id;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'roles.permissions_changed', 'user_roles', r.id::text, sid,
    jsonb_build_object('previous', r.permissions, 'resulting', _permissions));
END $$;

-- Current active auditor/staff role in the caller's current society (server-resolved).
CREATE OR REPLACE FUNCTION public.my_role_access()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE uid uuid := auth.uid(); sid uuid; r record; res jsonb := '[]'::jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  SELECT society_id INTO sid FROM public.profiles WHERE id = uid;
  FOR r IN SELECT ur.id, ur.role, ur.permissions FROM public.user_roles ur
           WHERE ur.user_id = uid AND ur.society_id = sid AND ur.is_active AND ur.role IN ('auditor','staff')
             AND (ur.role <> 'staff' OR EXISTS (SELECT 1 FROM public.society_staff st WHERE st.user_id = uid AND st.society_id = sid AND st.is_active))
  LOOP
    INSERT INTO public.role_sessions (role_id, society_id, user_id, last_seen_at)
    VALUES (r.id, sid, uid, now())
    ON CONFLICT (role_id) DO UPDATE SET last_seen_at = now()
      WHERE public.role_sessions.last_seen_at < now() - interval '2 minutes';
    res := res || jsonb_build_object('role', r.role, 'permissions', r.permissions);
  END LOOP;
  RETURN jsonb_build_object('society_id', sid, 'society_name', (SELECT name FROM public.societies WHERE id = sid), 'roles', res);
END $$;

-- ---------------------------------------------------------------------------
-- Auditor: finance-only audit history (no secrets, no non-finance actions)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auditor_finance_history(_from date, _to date, _limit int DEFAULT 100, _offset int DEFAULT 0)
 RETURNS TABLE(at timestamptz, action text, target_table text, target_id text, actor_name text, metadata jsonb)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid;
BEGIN
  SELECT society_id INTO sid FROM public.profiles WHERE id = auth.uid();
  PERFORM public._finance_require_reader(sid);
  IF _from IS NULL OR _to IS NULL OR _from > _to OR _to - _from > 730 THEN RAISE EXCEPTION 'invalid_period' USING ERRCODE='22023'; END IF;
  RETURN QUERY
  SELECT a.created_at, a.action, a.target_table, a.target_id,
         coalesce(nullif(btrim(p.full_name),''), 'System'), a.metadata
  FROM public.audit_log a LEFT JOIN public.profiles p ON p.id = a.actor_id
  WHERE a.society_id = sid AND a.created_at >= _from AND a.created_at < _to + 1
    AND (a.target_table IN ('bills','payments','payment_receipts','expenses','society_income_records','finance_journal_entries',
          'finance_fiscal_years','opening_balances','historical_payments','bill_adjustments','society_budgets','procurement_requests',
          'finance_vendors','society_tax_settings','expense_tax_calculations','bank_statement_lines','bill_generation_batches')
         OR a.action LIKE 'finance.%' OR a.action LIKE 'billing.%' OR a.action LIKE 'auditor.%')
  ORDER BY a.created_at DESC
  LIMIT least(greatest(coalesce(_limit,100),1),200) OFFSET greatest(coalesce(_offset,0),0);
END $$;

-- ---------------------------------------------------------------------------
-- Staff work (assignment-scoped). Society + staff identity are server-derived.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._staff_ctx(_cap text, OUT society_id uuid, OUT staff_id uuid)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  SELECT p.society_id INTO society_id FROM public.profiles p WHERE p.id = uid;
  SELECT st.id INTO staff_id FROM public.society_staff st
   JOIN public.user_roles ur ON ur.user_id = st.user_id AND ur.society_id = st.society_id AND ur.role = 'staff' AND ur.is_active
   WHERE st.user_id = uid AND st.society_id = _staff_ctx.society_id AND st.is_active
     AND (_cap IS NULL OR _cap = ANY(ur.permissions));
  IF staff_id IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._staff_ctx(text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.staff_my_context()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c record; st public.society_staff; perms text[];
BEGIN
  SELECT * INTO c FROM public._staff_ctx(NULL);
  SELECT * INTO st FROM public.society_staff WHERE id = c.staff_id;
  SELECT ur.permissions INTO perms FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.society_id = c.society_id AND ur.role='staff' AND ur.is_active;
  RETURN jsonb_build_object('society_name', (SELECT name FROM public.societies WHERE id = c.society_id),
    'full_name', st.full_name, 'job_type', st.job_type, 'shift_start', st.shift_start, 'shift_end', st.shift_end,
    'shift_days', st.shift_days, 'permissions', perms,
    'attendance', coalesce((SELECT jsonb_agg(jsonb_build_object('day', a.day, 'status', a.status) ORDER BY a.day DESC)
       FROM (SELECT * FROM public.staff_attendance WHERE staff_id = st.id ORDER BY day DESC LIMIT 14) a), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.staff_my_tickets(_include_done boolean DEFAULT false)
 RETURNS TABLE(id uuid, ticket_no bigint, subject text, description text, category text, priority text, status text,
               sla_due_at timestamptz, created_at timestamptz, asset_name text, asset_location text, flat_label text, hold_reason text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM public._staff_ctx('staff.helpdesk');
  RETURN QUERY
  SELECT t.id, t.ticket_no, t.subject, t.description, t.category, t.priority, t.status, t.sla_due_at, t.created_at,
         a.name, a.location,
         (SELECT f.flat_number FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
           WHERE fr.user_id = t.user_id AND f.society_id = t.society_id AND fr.is_active AND fr.moved_out_at IS NULL LIMIT 1),
         t.hold_reason
  FROM public.support_tickets t LEFT JOIN public.society_assets a ON a.id = t.asset_id
  WHERE t.society_id = c.society_id AND t.staff_id = c.staff_id
    AND (_include_done OR t.status NOT IN ('resolved','closed','cancelled','rejected'))
  ORDER BY (t.status IN ('resolved','closed','cancelled','rejected')), t.sla_due_at NULLS LAST, t.created_at DESC
  LIMIT 100;
END $$;

CREATE OR REPLACE FUNCTION public.staff_ticket_timeline(_ticket uuid)
 RETURNS TABLE(kind text, actor_kind text, from_status text, to_status text, body text, created_at timestamptz)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM public._staff_ctx('staff.helpdesk');
  IF NOT EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = _ticket AND t.society_id = c.society_id AND t.staff_id = c.staff_id) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE='22023';
  END IF;
  RETURN QUERY SELECT e.kind, e.actor_kind, e.from_status, e.to_status, e.body, e.created_at
    FROM public.support_ticket_events e WHERE e.ticket_id = _ticket ORDER BY e.created_at LIMIT 200;
END $$;

CREATE OR REPLACE FUNCTION public.staff_update_ticket(_ticket uuid, _status text, _note text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c record; t public.support_tickets; allowed text[];
BEGIN
  SELECT * INTO c FROM public._staff_ctx('staff.helpdesk');
  PERFORM public._rate_hit('staff_ticket', auth.uid()::text, 120, interval '1 hour');
  SELECT * INTO t FROM public.support_tickets WHERE id = _ticket FOR UPDATE;
  IF t.id IS NULL OR t.society_id <> c.society_id OR t.staff_id IS DISTINCT FROM c.staff_id THEN RAISE EXCEPTION 'not_found' USING ERRCODE='22023'; END IF;
  _note := nullif(btrim(coalesce(_note,'')),'');
  IF _note IS NOT NULL AND char_length(_note) > 2000 THEN RAISE EXCEPTION 'invalid_note' USING ERRCODE='22023'; END IF;
  IF _status IS NULL THEN
    IF _note IS NULL THEN RAISE EXCEPTION 'invalid_note' USING ERRCODE='22023'; END IF;
    IF t.status IN ('closed','cancelled','rejected') THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
    INSERT INTO public.support_ticket_events (ticket_id, society_id, actor_id, actor_kind, kind, body)
    VALUES (t.id, t.society_id, auth.uid(), 'staff', 'comment', _note);
    UPDATE public.support_tickets SET last_activity_at = now() WHERE id = t.id;
    RETURN;
  END IF;
  -- Staff may progress work, pause it with a reason, or mark it done; committee closes/rejects.
  allowed := CASE t.status
    WHEN 'open' THEN ARRAY['in_progress','on_hold','resolved']
    WHEN 'reopened' THEN ARRAY['in_progress','on_hold','resolved']
    WHEN 'in_progress' THEN ARRAY['on_hold','resolved']
    WHEN 'on_hold' THEN ARRAY['in_progress','resolved']
    ELSE ARRAY[]::text[] END;
  IF NOT (_status = ANY(allowed)) THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF _status IN ('on_hold','resolved') AND (_note IS NULL OR char_length(_note) < 3) THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  UPDATE public.support_tickets SET status = _status, last_activity_at = now(),
    hold_reason = CASE WHEN _status = 'on_hold' THEN _note ELSE NULL END,
    resolution_note = CASE WHEN _status = 'resolved' THEN _note ELSE resolution_note END,
    resolved_at = CASE WHEN _status = 'resolved' THEN now() ELSE resolved_at END
  WHERE id = t.id;
  INSERT INTO public.support_ticket_events (ticket_id, society_id, actor_id, actor_kind, kind, from_status, to_status, body)
  VALUES (t.id, t.society_id, auth.uid(), 'staff', CASE WHEN _status = 'on_hold' THEN 'on_hold' ELSE 'status' END, t.status, _status, _note);
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'staff.ticket_status', 'support_tickets', t.id::text, t.society_id, jsonb_build_object('from', t.status, 'to', _status));
  IF _status = 'resolved' THEN
    PERFORM public._notify_user(t.user_id, t.society_id, 'helpdesk', 'Request resolved', '#'||t.ticket_no||' '||t.subject, '/app/helpdesk');
  END IF;
END $$;

-- Assigned staff may view/upload evidence on their tickets (same private bucket path).
CREATE OR REPLACE FUNCTION public._staff_assigned_ticket(_ticket uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.support_tickets t
    JOIN public.society_staff st ON st.id = t.staff_id AND st.society_id = t.society_id AND st.is_active AND st.user_id = auth.uid()
    JOIN public.user_roles ur ON ur.user_id = st.user_id AND ur.society_id = st.society_id AND ur.role = 'staff' AND ur.is_active
         AND 'staff.helpdesk' = ANY(ur.permissions)
    WHERE t.id = _ticket);
$$;
REVOKE ALL ON FUNCTION public._staff_assigned_ticket(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._staff_assigned_ticket(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.helpdesk_ticket_access(_ticket uuid)
 RETURNS TABLE(society_id uuid, can_view boolean, can_upload boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE t public.support_tickets; adm boolean; ok boolean;
BEGIN
  SELECT * INTO t FROM public.support_tickets s WHERE s.id = _ticket;
  IF auth.uid() IS NULL OR t.id IS NULL THEN RETURN QUERY SELECT NULL::uuid, false, false; RETURN; END IF;
  adm := public._helpdesk_is_admin(t.society_id);
  ok := adm OR t.user_id = auth.uid() OR t.assigned_to = auth.uid() OR public._staff_assigned_ticket(t.id);
  RETURN QUERY SELECT t.society_id, ok, (ok AND t.status NOT IN ('closed','cancelled','rejected'));
END $$;

CREATE POLICY ticket_attachments_assigned_staff_read ON public.ticket_attachments FOR SELECT TO authenticated
  USING (public._staff_assigned_ticket(ticket_id));

CREATE OR REPLACE FUNCTION public.staff_list_assets()
 RETURNS TABLE(id uuid, name text, category text, location text, status text, warranty_until date, amc_until date, last_service date)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM public._staff_ctx('staff.assets');
  RETURN QUERY SELECT a.id, a.name, a.category, a.location, a.status, a.warranty_until, a.amc_until,
    (SELECT max(l.service_date) FROM public.asset_service_log l WHERE l.asset_id = a.id)
  FROM public.society_assets a WHERE a.society_id = c.society_id ORDER BY a.name LIMIT 300;
END $$;

CREATE OR REPLACE FUNCTION public.staff_log_asset_service(_asset uuid, _kind text, _notes text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c record; rid uuid;
BEGIN
  SELECT * INTO c FROM public._staff_ctx('staff.assets');
  PERFORM public._rate_hit('staff_asset', auth.uid()::text, 60, interval '1 hour');
  IF NOT EXISTS (SELECT 1 FROM public.society_assets WHERE id = _asset AND society_id = c.society_id) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='22023'; END IF;
  IF _kind NOT IN ('repair','service','inspection') THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  IF char_length(btrim(coalesce(_notes,''))) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  -- Never links an expense: staff work records do not create or change money records.
  INSERT INTO public.asset_service_log (society_id, asset_id, service_date, kind, notes, created_by)
  VALUES (c.society_id, _asset, current_date, _kind, left(btrim(_notes),500), auth.uid()) RETURNING id INTO rid;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'staff.asset_service', 'society_assets', _asset::text, c.society_id, jsonb_build_object('kind', _kind));
  RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION public.staff_list_inventory()
 RETURNS TABLE(id uuid, name text, location text, unit text, quantity numeric, reorder_level numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM public._staff_ctx('staff.inventory');
  RETURN QUERY SELECT i.id, i.name, i.location, i.unit, i.quantity, i.reorder_level
  FROM public.inventory_items i WHERE i.society_id = c.society_id AND i.is_active ORDER BY i.name LIMIT 300;
END $$;

CREATE OR REPLACE FUNCTION public.staff_use_inventory(_item uuid, _qty numeric, _reason text)
 RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c record; it public.inventory_items; nq numeric;
BEGIN
  SELECT * INTO c FROM public._staff_ctx('staff.inventory');
  PERFORM public._rate_hit('staff_inventory', auth.uid()::text, 120, interval '1 hour');
  SELECT * INTO it FROM public.inventory_items WHERE id = _item FOR UPDATE;
  IF it.id IS NULL OR it.society_id <> c.society_id OR NOT it.is_active THEN RAISE EXCEPTION 'not_found' USING ERRCODE='22023'; END IF;
  -- Staff can only record stock taken out for work; restocking stays with the committee.
  IF _qty IS NULL OR _qty <= 0 OR _qty > 10000 THEN RAISE EXCEPTION 'invalid_quantity' USING ERRCODE='22023'; END IF;
  IF char_length(btrim(coalesce(_reason,''))) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  nq := it.quantity - _qty;
  IF nq < 0 THEN RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='22023'; END IF;
  UPDATE public.inventory_items SET quantity = nq, updated_at = now() WHERE id = _item;
  INSERT INTO public.inventory_movements (society_id, item_id, delta, resulting_qty, reason, created_by)
  VALUES (it.society_id, _item, -_qty, nq, left(btrim(_reason),200), auth.uid());
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'staff.inventory_use', 'inventory_items', _item::text, it.society_id, jsonb_build_object('delta', -_qty, 'qty', nq));
  RETURN nq;
END $$;

CREATE OR REPLACE FUNCTION public.staff_list_vendors()
 RETURNS TABLE(id uuid, name text, category text, phone text, contract_end date)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM public._staff_ctx('staff.vendors');
  RETURN QUERY SELECT v.id, v.name, v.category, v.phone, v.contract_end
  FROM public.finance_vendors v WHERE v.society_id = c.society_id AND coalesce(v.is_active,true) ORDER BY v.name LIMIT 200;
END $$;

CREATE OR REPLACE FUNCTION public.staff_list_documents()
 RETURNS TABLE(id uuid, title text, category text, file_name text, updated_at timestamptz)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM public._staff_ctx('staff.documents');
  -- Only documents published for all residents; committee-only files stay private.
  RETURN QUERY SELECT k.id, k.title, k.category, k.file_name, k.updated_at
  FROM public.society_knowledge_sources k
  WHERE k.society_id = c.society_id AND k.kind = 'document' AND k.audience = 'residents' AND k.status = 'ready' AND k.storage_path IS NOT NULL
  ORDER BY k.updated_at DESC LIMIT 100;
END $$;

CREATE OR REPLACE FUNCTION public.staff_document_path(_id uuid)
 RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c record; p text;
BEGIN
  SELECT * INTO c FROM public._staff_ctx('staff.documents');
  SELECT k.storage_path INTO p FROM public.society_knowledge_sources k
   WHERE k.id = _id AND k.society_id = c.society_id AND k.kind='document' AND k.audience='residents' AND k.status='ready';
  IF p IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='22023'; END IF;
  RETURN p;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'admin_invite_role(text,text,text,uuid,text[])','admin_cancel_role_invitation(uuid,text)','list_my_role_invitations()',
    'respond_role_invitation(uuid,boolean)','admin_list_role_access()','admin_set_role_access(uuid,boolean,text)',
    'admin_set_staff_permissions(uuid,text[])','my_role_access()','auditor_finance_history(date,date,integer,integer)',
    'staff_my_context()','staff_my_tickets(boolean)','staff_ticket_timeline(uuid)','staff_update_ticket(uuid,text,text)',
    'staff_list_assets()','staff_log_asset_service(uuid,text,text)','staff_list_inventory()','staff_use_inventory(uuid,numeric,text)',
    'staff_list_vendors()','staff_list_documents()','staff_document_path(uuid)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- Patch existing functions in place (only the gate call / anchors change).
DO $patch$
DECLARE f text; d text; a text; ins text;
BEGIN
  FOREACH f IN ARRAY ARRAY['fin_balance_sheet','fin_income_expenditure','fin_list_accounts','fin_list_manual_journals','fin_tax_report',
                           'fin_trial_balance','fin_year_status','fin_tally_export','get_auditor_pack','get_auditor_pack_extras'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname=f;
    IF d IS NULL OR position('_finance_require_admin(' in d) = 0 THEN RAISE EXCEPTION 'patch_target_missing %', f; END IF;
    EXECUTE replace(d, '_finance_require_admin(', '_finance_require_reader(');
  END LOOP;

  d := pg_get_functiondef('public.current_user_has_society_permission(uuid,text,uuid)'::regprocedure);
  a := E'  ) THEN RETURN true; END IF;\n';
  IF position(a in d) = 0 THEN RAISE EXCEPTION 'patch_target_missing permission'; END IF;
  ins := $i$
  IF _capability = 'finance.read' THEN
    RETURN public.is_society_admin_for(v_uid, _society_id)
      OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_uid AND ur.society_id = _society_id AND ur.is_active AND ur.role = 'auditor')
      OR EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.society_staff st ON st.user_id = ur.user_id AND st.society_id = ur.society_id AND st.is_active
                 WHERE ur.user_id = v_uid AND ur.society_id = _society_id AND ur.is_active AND ur.role = 'staff' AND 'finance.read' = ANY(ur.permissions));
  END IF;
  IF _capability LIKE 'staff.%' THEN
    RETURN EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.society_staff st ON st.user_id = ur.user_id AND st.society_id = ur.society_id AND st.is_active
                   WHERE ur.user_id = v_uid AND ur.society_id = _society_id AND ur.is_active AND ur.role = 'staff' AND _capability = ANY(ur.permissions));
  END IF;
$i$;
  EXECUTE replace(d, a, a || ins);

  d := pg_get_functiondef('public.resolve_financial_visibility(uuid)'::regprocedure);
  a := E'    RETURN ''admin'';\n  END IF;\n';
  IF position(a in d) = 0 THEN RAISE EXCEPTION 'patch_target_missing visibility'; END IF;
  EXECUTE replace(d, a, a || E'  IF public.current_user_has_society_permission(_society_id, ''finance.read'', NULL::uuid) THEN RETURN ''admin''; END IF;\n');

  d := pg_get_functiondef('public.get_current_auth_context()'::regprocedure);
  a := $x$ur.society_id=v_society) THEN 'security' ELSE NULL END INTO v_primary;$x$;
  IF position(a in d) = 0 THEN RAISE EXCEPTION 'patch_target_missing auth_context'; END IF;
  d := replace(d, a, $x$ur.society_id=v_society) THEN 'security'
   WHEN EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id=v_user AND ur.is_active AND ur.role='auditor'::public.app_role AND ur.society_id=v_society) THEN 'auditor'
   WHEN EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.society_staff st ON st.user_id=ur.user_id AND st.society_id=ur.society_id AND st.is_active WHERE ur.user_id=v_user AND ur.is_active AND ur.role='staff'::public.app_role AND ur.society_id=v_society) THEN 'staff' ELSE NULL END INTO v_primary;$x$);
  EXECUTE d;
END $patch$;