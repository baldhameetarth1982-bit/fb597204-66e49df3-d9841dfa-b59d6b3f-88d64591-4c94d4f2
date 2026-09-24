-- Gamification: raw leaderboard view exposes user ids; canonical path is get_society_leaderboard().
REVOKE ALL ON public.society_leaderboard FROM anon, authenticated;
COMMENT ON VIEW public.society_leaderboard IS 'DEPRECATED: use get_society_leaderboard() (society-derived, no user ids).';

-- Helpdesk: additive columns
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS assigned_to uuid,
  ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approval_status text,
  ADD COLUMN IF NOT EXISTS resolution_note text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS ticket_no bigint GENERATED ALWAYS AS IDENTITY;

CREATE INDEX IF NOT EXISTS support_tickets_society_status_idx ON public.support_tickets (society_id, status, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_user_idx ON public.support_tickets (user_id, created_at DESC);

-- Timeline (status changes, comments, assignment, approvals). Append-only.
CREATE TABLE IF NOT EXISTS public.support_ticket_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE RESTRICT,
  society_id uuid NOT NULL,
  actor_id uuid,
  actor_kind text NOT NULL CHECK (actor_kind IN ('resident','admin','system')),
  kind text NOT NULL CHECK (kind IN ('created','comment','status','assigned','approval_requested','approved','rejected')),
  from_status text,
  to_status text,
  body text CHECK (body IS NULL OR char_length(body) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_ticket_events_ticket_idx ON public.support_ticket_events (ticket_id, created_at);

GRANT SELECT ON public.support_ticket_events TO authenticated;
GRANT ALL ON public.support_ticket_events TO service_role;
ALTER TABLE public.support_ticket_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ticket owner reads events" ON public.support_ticket_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id AND t.user_id = auth.uid()));
CREATE POLICY "society admins read events" ON public.support_ticket_events FOR SELECT TO authenticated
  USING (society_id IN (SELECT public.get_admin_society_ids(auth.uid())) OR public.has_role(auth.uid(), 'super_admin'::app_role));

CREATE OR REPLACE FUNCTION public._support_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ticket history is append-only' USING ERRCODE = '42501'; END $$;
DROP TRIGGER IF EXISTS trg_support_events_immutable ON public.support_ticket_events;
CREATE TRIGGER trg_support_events_immutable BEFORE UPDATE OR DELETE ON public.support_ticket_events
  FOR EACH ROW EXECUTE FUNCTION public._support_events_immutable();

-- All resident writes now go through guarded functions (no direct status edits / deletes).
DROP POLICY IF EXISTS "users update own tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "users delete own tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "users create own tickets" ON public.support_tickets;

CREATE OR REPLACE FUNCTION public._helpdesk_is_admin(_sid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.has_role(auth.uid(), 'super_admin'::app_role) OR public.current_user_is_society_admin_for(_sid)
$$;
REVOKE ALL ON FUNCTION public._helpdesk_is_admin(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.helpdesk_create_ticket(_category text, _subject text, _description text, _priority text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); sid uuid; tid uuid; recent int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  sid := public.get_user_society_id(uid);
  IF sid IS NULL THEN RAISE EXCEPTION 'no_society' USING ERRCODE='42501'; END IF;
  IF _category NOT IN ('complaint','daily_help','maintenance','lost_found','approval') THEN RAISE EXCEPTION 'invalid_category' USING ERRCODE='22023'; END IF;
  IF _priority NOT IN ('low','normal','high','urgent') THEN RAISE EXCEPTION 'invalid_priority' USING ERRCODE='22023'; END IF;
  _subject := btrim(coalesce(_subject,'')); _description := btrim(coalesce(_description,''));
  IF char_length(_subject) < 3 OR char_length(_subject) > 120 THEN RAISE EXCEPTION 'invalid_subject' USING ERRCODE='22023'; END IF;
  IF char_length(_description) < 5 OR char_length(_description) > 2000 THEN RAISE EXCEPTION 'invalid_description' USING ERRCODE='22023'; END IF;
  SELECT count(*) INTO recent FROM public.support_tickets WHERE user_id = uid AND created_at > now() - interval '1 hour';
  IF recent >= 10 THEN RAISE EXCEPTION 'rate_limited' USING ERRCODE='P0001'; END IF;
  -- duplicate-submit guard: same subject within 2 minutes returns the existing ticket
  SELECT id INTO tid FROM public.support_tickets WHERE user_id = uid AND lower(subject) = lower(_subject) AND created_at > now() - interval '2 minutes' LIMIT 1;
  IF tid IS NOT NULL THEN RETURN tid; END IF;
  INSERT INTO public.support_tickets (user_id, society_id, category, subject, description, priority, status, requires_approval, approval_status)
  VALUES (uid, sid, _category, _subject, _description, _priority, CASE WHEN _category='approval' THEN 'awaiting_approval' ELSE 'open' END,
          _category='approval', CASE WHEN _category='approval' THEN 'pending' END)
  RETURNING id INTO tid;
  INSERT INTO public.support_ticket_events (ticket_id, society_id, actor_id, actor_kind, kind, to_status)
  VALUES (tid, sid, uid, 'resident', 'created', CASE WHEN _category='approval' THEN 'awaiting_approval' ELSE 'open' END);
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'helpdesk.ticket_created', 'support_tickets', tid::text, sid, jsonb_build_object('category', _category, 'priority', _priority));
  RETURN tid;
END $$;

CREATE OR REPLACE FUNCTION public.helpdesk_add_comment(_ticket uuid, _body text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); t public.support_tickets; is_admin boolean; recent int;
BEGIN
  SELECT * INTO t FROM public.support_tickets WHERE id = _ticket;
  IF uid IS NULL OR t.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  is_admin := public._helpdesk_is_admin(t.society_id);
  IF t.user_id <> uid AND NOT is_admin THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF t.status IN ('closed','cancelled') THEN RAISE EXCEPTION 'ticket_closed' USING ERRCODE='22023'; END IF;
  _body := btrim(coalesce(_body,''));
  IF char_length(_body) < 1 OR char_length(_body) > 2000 THEN RAISE EXCEPTION 'invalid_comment' USING ERRCODE='22023'; END IF;
  SELECT count(*) INTO recent FROM public.support_ticket_events WHERE actor_id = uid AND kind='comment' AND created_at > now() - interval '10 minutes';
  IF recent >= 30 THEN RAISE EXCEPTION 'rate_limited' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.support_ticket_events (ticket_id, society_id, actor_id, actor_kind, kind, body)
  VALUES (t.id, t.society_id, uid, CASE WHEN t.user_id = uid THEN 'resident' ELSE 'admin' END, 'comment', _body);
  UPDATE public.support_tickets SET last_activity_at = now() WHERE id = t.id;
END $$;

-- Admin status / assignment changes with a strict transition map.
CREATE OR REPLACE FUNCTION public.helpdesk_admin_update(_ticket uuid, _status text DEFAULT NULL, _assign uuid DEFAULT NULL, _unassign boolean DEFAULT false, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); t public.support_tickets; allowed text[];
BEGIN
  SELECT * INTO t FROM public.support_tickets WHERE id = _ticket FOR UPDATE;
  IF uid IS NULL OR t.id IS NULL OR NOT public._helpdesk_is_admin(t.society_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  _note := nullif(btrim(coalesce(_note,'')),'');
  IF _note IS NOT NULL AND char_length(_note) > 2000 THEN RAISE EXCEPTION 'invalid_note' USING ERRCODE='22023'; END IF;

  IF _assign IS NOT NULL OR _unassign THEN
    IF _assign IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.user_roles r WHERE r.user_id = _assign AND r.society_id = t.society_id
        AND r.role IN ('society_admin','block_admin') AND coalesce(r.is_active, true)) THEN
      RAISE EXCEPTION 'invalid_assignee' USING ERRCODE='22023';
    END IF;
    IF t.assigned_to IS DISTINCT FROM _assign THEN
      UPDATE public.support_tickets SET assigned_to = _assign, last_activity_at = now() WHERE id = t.id;
      INSERT INTO public.support_ticket_events (ticket_id, society_id, actor_id, actor_kind, kind, body)
      VALUES (t.id, t.society_id, uid, 'admin', 'assigned', CASE WHEN _assign IS NULL THEN 'Unassigned' ELSE 'Assigned' END);
      INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
      VALUES (uid, 'helpdesk.ticket_assigned', 'support_tickets', t.id::text, t.society_id, jsonb_build_object('assigned', _assign IS NOT NULL));
    END IF;
  END IF;

  IF _status IS NOT NULL AND _status <> t.status THEN
    allowed := CASE t.status
      WHEN 'open' THEN ARRAY['in_progress','awaiting_approval','resolved','rejected']
      WHEN 'in_progress' THEN ARRAY['awaiting_approval','resolved']
      WHEN 'resolved' THEN ARRAY['closed','in_progress']
      ELSE ARRAY[]::text[] END;
    IF NOT (_status = ANY(allowed)) THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
    IF _status IN ('rejected') AND _note IS NULL THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
    UPDATE public.support_tickets SET status = _status, last_activity_at = now(),
      requires_approval = requires_approval OR _status = 'awaiting_approval',
      approval_status = CASE WHEN _status = 'awaiting_approval' THEN 'pending' ELSE approval_status END,
      resolution_note = CASE WHEN _status IN ('resolved','rejected') THEN _note ELSE resolution_note END,
      resolved_at = CASE WHEN _status = 'resolved' THEN now() WHEN _status = 'in_progress' THEN NULL ELSE resolved_at END,
      closed_at = CASE WHEN _status IN ('closed','rejected') THEN now() ELSE closed_at END
    WHERE id = t.id;
    INSERT INTO public.support_ticket_events (ticket_id, society_id, actor_id, actor_kind, kind, from_status, to_status, body)
    VALUES (t.id, t.society_id, uid, 'admin', CASE WHEN _status='awaiting_approval' THEN 'approval_requested' ELSE 'status' END, t.status, _status, _note);
    INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (uid, 'helpdesk.ticket_status', 'support_tickets', t.id::text, t.society_id, jsonb_build_object('from', t.status, 'to', _status));
  ELSIF _note IS NOT NULL AND _status IS NULL THEN
    INSERT INTO public.support_ticket_events (ticket_id, society_id, actor_id, actor_kind, kind, body)
    VALUES (t.id, t.society_id, uid, 'admin', 'comment', _note);
    UPDATE public.support_tickets SET last_activity_at = now() WHERE id = t.id;
  END IF;
END $$;

-- Committee approval decision (society admins only).
CREATE OR REPLACE FUNCTION public.helpdesk_decide_approval(_ticket uuid, _approve boolean, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); t public.support_tickets; ns text;
BEGIN
  SELECT * INTO t FROM public.support_tickets WHERE id = _ticket FOR UPDATE;
  IF uid IS NULL OR t.id IS NULL OR NOT (public.has_role(uid,'super_admin'::app_role) OR public.current_user_has_society_permission(t.society_id, 'society.settings')) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF t.status <> 'awaiting_approval' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  _reason := nullif(btrim(coalesce(_reason,'')),'');
  IF NOT _approve AND (_reason IS NULL OR char_length(_reason) < 3) THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  IF _reason IS NOT NULL AND char_length(_reason) > 2000 THEN RAISE EXCEPTION 'invalid_note' USING ERRCODE='22023'; END IF;
  ns := CASE WHEN _approve THEN 'in_progress' ELSE 'rejected' END;
  UPDATE public.support_tickets SET status = ns, approval_status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
    resolution_note = CASE WHEN _approve THEN resolution_note ELSE _reason END,
    closed_at = CASE WHEN _approve THEN closed_at ELSE now() END, last_activity_at = now()
  WHERE id = t.id;
  INSERT INTO public.support_ticket_events (ticket_id, society_id, actor_id, actor_kind, kind, from_status, to_status, body)
  VALUES (t.id, t.society_id, uid, 'admin', CASE WHEN _approve THEN 'approved' ELSE 'rejected' END, t.status, ns, _reason);
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, CASE WHEN _approve THEN 'helpdesk.approval_approved' ELSE 'helpdesk.approval_rejected' END, 'support_tickets', t.id::text, t.society_id, '{}'::jsonb);
END $$;

-- Resident actions on their own ticket.
CREATE OR REPLACE FUNCTION public.helpdesk_resident_action(_ticket uuid, _action text, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); t public.support_tickets; ns text;
BEGIN
  SELECT * INTO t FROM public.support_tickets WHERE id = _ticket FOR UPDATE;
  IF uid IS NULL OR t.id IS NULL OR t.user_id <> uid THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  ns := CASE
    WHEN _action = 'cancel' AND t.status IN ('open','awaiting_approval') THEN 'cancelled'
    WHEN _action = 'confirm' AND t.status = 'resolved' THEN 'closed'
    WHEN _action = 'reopen' AND t.status = 'resolved' THEN 'open'
    ELSE NULL END;
  IF ns IS NULL THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  _note := nullif(left(btrim(coalesce(_note,'')), 2000),'');
  UPDATE public.support_tickets SET status = ns, last_activity_at = now(),
    closed_at = CASE WHEN ns IN ('closed','cancelled') THEN now() ELSE NULL END,
    resolved_at = CASE WHEN ns = 'open' THEN NULL ELSE resolved_at END
  WHERE id = t.id;
  INSERT INTO public.support_ticket_events (ticket_id, society_id, actor_id, actor_kind, kind, from_status, to_status, body)
  VALUES (t.id, t.society_id, uid, 'resident', 'status', t.status, ns, _note);
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'helpdesk.ticket_status', 'support_tickets', t.id::text, t.society_id, jsonb_build_object('from', t.status, 'to', ns, 'by', 'resident'));
END $$;

-- Admin queue with requester name + flat only (no phone/email), society derived from caller.
CREATE OR REPLACE FUNCTION public.helpdesk_admin_queue(_status text DEFAULT NULL, _limit int DEFAULT 200)
RETURNS TABLE(id uuid, ticket_no bigint, subject text, description text, category text, priority text, status text,
  requires_approval boolean, approval_status text, assigned_to uuid, assignee_name text, requester_name text,
  flat_label text, created_at timestamptz, last_activity_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sid uuid := public.get_user_society_id(auth.uid());
BEGIN
  IF auth.uid() IS NULL OR sid IS NULL OR NOT public._helpdesk_is_admin(sid) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  SELECT t.id, t.ticket_no, t.subject, t.description, t.category, t.priority, t.status, t.requires_approval, t.approval_status,
         t.assigned_to, a.full_name, coalesce(p.full_name, 'Resident'),
         (SELECT f.flat_number FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
            WHERE fr.user_id = t.user_id AND f.society_id = sid ORDER BY fr.created_at DESC LIMIT 1),
         t.created_at, t.last_activity_at
  FROM public.support_tickets t
  LEFT JOIN public.profiles p ON p.id = t.user_id
  LEFT JOIN public.profiles a ON a.id = t.assigned_to
  WHERE t.society_id = sid AND (_status IS NULL OR t.status = _status)
  ORDER BY (t.status IN ('closed','cancelled','rejected')), 
           CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
           t.last_activity_at DESC
  LIMIT greatest(1, least(coalesce(_limit,200), 500));
END $$;

CREATE OR REPLACE FUNCTION public.helpdesk_assignees()
RETURNS TABLE(user_id uuid, full_name text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sid uuid := public.get_user_society_id(auth.uid());
BEGIN
  IF auth.uid() IS NULL OR sid IS NULL OR NOT public._helpdesk_is_admin(sid) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT DISTINCT r.user_id, coalesce(p.full_name, 'Team member')
  FROM public.user_roles r LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE r.society_id = sid AND r.role IN ('society_admin','block_admin') AND coalesce(r.is_active, true);
END $$;

-- Timeline with actor display names only.
CREATE OR REPLACE FUNCTION public.helpdesk_ticket_timeline(_ticket uuid)
RETURNS TABLE(id uuid, kind text, actor_kind text, actor_name text, from_status text, to_status text, body text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE t public.support_tickets;
BEGIN
  SELECT * INTO t FROM public.support_tickets WHERE support_tickets.id = _ticket;
  IF auth.uid() IS NULL OR t.id IS NULL OR (t.user_id <> auth.uid() AND NOT public._helpdesk_is_admin(t.society_id)) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';
  END IF;
  RETURN QUERY SELECT e.id, e.kind, e.actor_kind,
    CASE WHEN e.actor_kind = 'admin' THEN 'Society office' WHEN e.actor_id = auth.uid() THEN 'You'
         ELSE coalesce(split_part(p.full_name,' ',1), 'Resident') END,
    e.from_status, e.to_status, e.body, e.created_at
  FROM public.support_ticket_events e LEFT JOIN public.profiles p ON p.id = e.actor_id
  WHERE e.ticket_id = t.id ORDER BY e.created_at;
END $$;

REVOKE ALL ON FUNCTION public.helpdesk_create_ticket(text,text,text,text), public.helpdesk_add_comment(uuid,text),
  public.helpdesk_admin_update(uuid,text,uuid,boolean,text), public.helpdesk_decide_approval(uuid,boolean,text),
  public.helpdesk_resident_action(uuid,text,text), public.helpdesk_admin_queue(text,int), public.helpdesk_assignees(),
  public.helpdesk_ticket_timeline(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpdesk_create_ticket(text,text,text,text), public.helpdesk_add_comment(uuid,text),
  public.helpdesk_admin_update(uuid,text,uuid,boolean,text), public.helpdesk_decide_approval(uuid,boolean,text),
  public.helpdesk_resident_action(uuid,text,text), public.helpdesk_admin_queue(text,int), public.helpdesk_assignees(),
  public.helpdesk_ticket_timeline(uuid) TO authenticated;