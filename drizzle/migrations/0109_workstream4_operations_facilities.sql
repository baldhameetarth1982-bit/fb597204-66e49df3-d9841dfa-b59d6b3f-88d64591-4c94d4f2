ALTER TABLE public.support_ticket_events DROP CONSTRAINT support_ticket_events_kind_check;
ALTER TABLE public.support_ticket_events ADD CONSTRAINT support_ticket_events_kind_check CHECK (kind = ANY (ARRAY['created','comment','status','assigned','approval_requested','approved','rejected','escalated','on_hold','reopened','rated','evidence','linked']));

ALTER TABLE public.finance_vendors
  ADD COLUMN IF NOT EXISTS contract_type text NOT NULL DEFAULT 'none' CHECK (contract_type IN ('none','contract','amc')),
  ADD COLUMN IF NOT EXISTS contract_start date,
  ADD COLUMN IF NOT EXISTS contract_end date,
  ADD COLUMN IF NOT EXISTS contract_value numeric(14,2) CHECK (contract_value IS NULL OR contract_value >= 0),
  ADD COLUMN IF NOT EXISTS contract_notes text CHECK (contract_notes IS NULL OR char_length(contract_notes) <= 500);

CREATE TABLE public.society_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 80),
  job_type text NOT NULL CHECK (job_type IN ('housekeeping','security','electrician','plumber','gardener','lift_operator','manager','other')),
  phone text CHECK (phone IS NULL OR phone ~ '^[0-9+ -]{6,20}$'),
  user_id uuid,
  shift_start time, shift_end time,
  shift_days smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
  is_active boolean NOT NULL DEFAULT true,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 300),
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.society_staff(society_id, is_active);
GRANT SELECT ON public.society_staff TO authenticated; GRANT ALL ON public.society_staff TO service_role;
ALTER TABLE public.society_staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read staff" ON public.society_staff FOR SELECT TO authenticated USING (public._helpdesk_is_admin(society_id));

CREATE TABLE public.staff_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.society_staff(id) ON DELETE CASCADE,
  day date NOT NULL,
  status text NOT NULL CHECK (status IN ('present','absent','leave','half_day')),
  note text CHECK (note IS NULL OR char_length(note) <= 200),
  recorded_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, day)
);
GRANT SELECT ON public.staff_attendance TO authenticated; GRANT ALL ON public.staff_attendance TO service_role;
ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read attendance" ON public.staff_attendance FOR SELECT TO authenticated USING (public._helpdesk_is_admin(society_id));

CREATE TABLE public.society_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  category text NOT NULL CHECK (category IN ('lift','pump','generator','electrical','plumbing','fire_safety','cctv','gym','garden','other')),
  location text CHECK (location IS NULL OR char_length(location) <= 80),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','under_repair','retired')),
  purchase_date date, installed_on date, warranty_until date, amc_until date,
  vendor_id uuid REFERENCES public.finance_vendors(id),
  qr_token text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(16),'hex'),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 300),
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.society_assets(society_id, status);
GRANT SELECT ON public.society_assets TO authenticated; GRANT ALL ON public.society_assets TO service_role;
ALTER TABLE public.society_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read assets" ON public.society_assets FOR SELECT TO authenticated USING (public._helpdesk_is_admin(society_id));

CREATE TABLE public.asset_service_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.society_assets(id) ON DELETE CASCADE,
  service_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('repair','service','amc_visit','inspection')),
  ticket_id uuid REFERENCES public.support_tickets(id),
  vendor_id uuid REFERENCES public.finance_vendors(id),
  expense_id uuid REFERENCES public.expenses(id),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 500),
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.asset_service_log(asset_id, service_date DESC);
GRANT SELECT ON public.asset_service_log TO authenticated; GRANT ALL ON public.asset_service_log TO service_role;
ALTER TABLE public.asset_service_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read service log" ON public.asset_service_log FOR SELECT TO authenticated USING (public._helpdesk_is_admin(society_id));

CREATE TABLE public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  location text CHECK (location IS NULL OR char_length(location) <= 80),
  unit text NOT NULL DEFAULT 'pcs' CHECK (char_length(unit) BETWEEN 1 AND 16),
  quantity numeric(12,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reorder_level numeric(12,2) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.inventory_items TO authenticated; GRANT ALL ON public.inventory_items TO service_role;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read inventory" ON public.inventory_items FOR SELECT TO authenticated USING (public._helpdesk_is_admin(society_id));

CREATE TABLE public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  delta numeric(12,2) NOT NULL CHECK (delta <> 0),
  resulting_qty numeric(12,2) NOT NULL CHECK (resulting_qty >= 0),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 200),
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.inventory_movements TO authenticated; GRANT ALL ON public.inventory_movements TO service_role;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read movements" ON public.inventory_movements FOR SELECT TO authenticated USING (public._helpdesk_is_admin(society_id));

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS sla_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalation_level smallint NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 3),
  ADD COLUMN IF NOT EXISTS escalation_reason text CHECK (escalation_reason IS NULL OR char_length(escalation_reason) <= 500),
  ADD COLUMN IF NOT EXISTS hold_reason text CHECK (hold_reason IS NULL OR char_length(hold_reason) <= 500),
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.society_assets(id),
  ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.society_staff(id),
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.finance_vendors(id),
  ADD COLUMN IF NOT EXISTS reopened_count smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS parent_ticket_id uuid REFERENCES public.support_tickets(id);
CREATE INDEX IF NOT EXISTS support_tickets_asset_idx ON public.support_tickets(asset_id) WHERE asset_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public._helpdesk_sla_hours(_priority text) RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _priority WHEN 'urgent' THEN 24 WHEN 'high' THEN 72 WHEN 'normal' THEN 120 ELSE 168 END $$;

CREATE OR REPLACE FUNCTION public._helpdesk_set_sla() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.priority IS DISTINCT FROM OLD.priority THEN
    NEW.sla_due_at := coalesce(NEW.created_at, now()) + make_interval(hours => public._helpdesk_sla_hours(NEW.priority));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_support_tickets_sla BEFORE INSERT OR UPDATE OF priority ON public.support_tickets FOR EACH ROW EXECUTE FUNCTION public._helpdesk_set_sla();
UPDATE public.support_tickets SET sla_due_at = created_at + make_interval(hours => public._helpdesk_sla_hours(priority)) WHERE sla_due_at IS NULL;

CREATE TABLE public.ticket_ratings (
  ticket_id uuid PRIMARY KEY REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  society_id uuid NOT NULL, user_id uuid NOT NULL,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text CHECK (comment IS NULL OR char_length(comment) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ticket_ratings TO authenticated; GRANT ALL ON public.ticket_ratings TO service_role;
ALTER TABLE public.ticket_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rater or admin reads" ON public.ticket_ratings FOR SELECT TO authenticated USING (user_id = auth.uid() OR public._helpdesk_is_admin(society_id));

CREATE TABLE public.ticket_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  society_id uuid NOT NULL,
  uploaded_by uuid NOT NULL,
  path text NOT NULL UNIQUE CHECK (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{32}\.(jpg|png|webp|pdf)$'),
  mime text NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes int NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.ticket_attachments(ticket_id);
GRANT SELECT ON public.ticket_attachments TO authenticated; GRANT ALL ON public.ticket_attachments TO service_role;
ALTER TABLE public.ticket_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ticket parties read evidence" ON public.ticket_attachments FOR SELECT TO authenticated USING (
  public._helpdesk_is_admin(society_id) OR EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id AND (t.user_id = auth.uid() OR t.assigned_to = auth.uid())));

CREATE TABLE public.ops_reminders_sent (
  kind text NOT NULL, ref_id uuid NOT NULL, ref_date date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (kind, ref_id, ref_date)
);
GRANT ALL ON public.ops_reminders_sent TO service_role;
ALTER TABLE public.ops_reminders_sent ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._ops_admin(_sid uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR _sid IS NULL OR NOT public._helpdesk_is_admin(_sid) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  PERFORM public._rate_hit('ops_write', auth.uid()::text, 240, interval '1 hour');
  RETURN auth.uid();
END $$;
REVOKE ALL ON FUNCTION public._ops_admin(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._notify_society_admins(_sid uuid, _kind text, _title text, _body text, _link text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO public.user_notifications (user_id, society_id, kind, title, body, link)
  SELECT DISTINCT r.user_id, _sid, _kind, left(_title,120), left(_body,300), _link FROM public.user_roles r
  WHERE r.society_id = _sid AND r.role = 'society_admin' AND coalesce(r.is_active, true) $$;
REVOKE ALL ON FUNCTION public._notify_society_admins(uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.helpdesk_admin_update(_ticket uuid, _status text DEFAULT NULL, _assign uuid DEFAULT NULL, _unassign boolean DEFAULT false, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE uid uuid := auth.uid(); t public.support_tickets; allowed text[];
BEGIN
  SELECT * INTO t FROM public.support_tickets WHERE id = _ticket FOR UPDATE;
  IF uid IS NULL OR t.id IS NULL OR NOT public._helpdesk_is_admin(t.society_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  _note := nullif(btrim(coalesce(_note,'')),'');
  IF _note IS NOT NULL AND char_length(_note) > 2000 THEN RAISE EXCEPTION 'invalid_note' USING ERRCODE='22023'; END IF;
  IF _assign IS NOT NULL OR _unassign THEN
    IF _assign IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _assign AND r.society_id = t.society_id
        AND r.role IN ('society_admin','block_admin') AND coalesce(r.is_active, true)) THEN
      RAISE EXCEPTION 'invalid_assignee' USING ERRCODE='22023';
    END IF;
    IF t.assigned_to IS DISTINCT FROM _assign THEN
      UPDATE public.support_tickets SET assigned_to = _assign, last_activity_at = now() WHERE id = t.id;
      INSERT INTO public.support_ticket_events (ticket_id, society_id, actor_id, actor_kind, kind, body)
      VALUES (t.id, t.society_id, uid, 'admin', 'assigned', CASE WHEN _assign IS NULL THEN 'Unassigned' ELSE 'Assigned' END);
      INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
      VALUES (uid, 'helpdesk.ticket_assigned', 'support_tickets', t.id::text, t.society_id, jsonb_build_object('assigned', _assign IS NOT NULL));
      IF _assign IS NOT NULL AND _assign <> uid THEN
        PERFORM public._notify_user(_assign, t.society_id, 'helpdesk', 'Request assigned to you', '#'||t.ticket_no||' '||t.subject, '/society/helpdesk');
      END IF;
    END IF;
  END IF;
  IF _status IS NOT NULL AND _status <> t.status THEN
    allowed := CASE t.status
      WHEN 'open' THEN ARRAY['in_progress','awaiting_approval','resolved','rejected','on_hold']
      WHEN 'reopened' THEN ARRAY['in_progress','awaiting_approval','resolved','rejected','on_hold']
      WHEN 'in_progress' THEN ARRAY['awaiting_approval','resolved','on_hold']
      WHEN 'on_hold' THEN ARRAY['in_progress','resolved']
      WHEN 'resolved' THEN ARRAY['closed','in_progress']
      ELSE ARRAY[]::text[] END;
    IF NOT (_status = ANY(allowed)) THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
    IF _status IN ('rejected','on_hold') AND (_note IS NULL OR char_length(_note) < 3) THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
    UPDATE public.support_tickets SET status = _status, last_activity_at = now(),
      requires_approval = requires_approval OR _status = 'awaiting_approval',
      approval_status = CASE WHEN _status = 'awaiting_approval' THEN 'pending' ELSE approval_status END,
      resolution_note = CASE WHEN _status IN ('resolved','rejected') THEN _note ELSE resolution_note END,
      hold_reason = CASE WHEN _status = 'on_hold' THEN _note ELSE NULL END,
      resolved_at = CASE WHEN _status = 'resolved' THEN now() WHEN _status = 'in_progress' THEN NULL ELSE resolved_at END,
      closed_at = CASE WHEN _status IN ('closed','rejected') THEN now() ELSE closed_at END
    WHERE id = t.id;
    INSERT INTO public.support_ticket_events (ticket_id, society_id, actor_id, actor_kind, kind, from_status, to_status, body)
    VALUES (t.id, t.society_id, uid, 'admin', CASE WHEN _status='awaiting_approval' THEN 'approval_requested' WHEN _status='on_hold' THEN 'on_hold' ELSE 'status' END, t.status, _status, _note);
    INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (uid, 'helpdesk.ticket_status', 'support_tickets', t.id::text, t.society_id, jsonb_build_object('from', t.status, 'to', _status));
    IF _status IN ('on_hold','resolved','rejected','in_progress') THEN
      PERFORM public._notify_user(t.user_id, t.society_id, 'helpdesk', 'Request #'||t.ticket_no||' updated',
        CASE _status WHEN 'on_hold' THEN 'On hold: '||_note WHEN 'resolved' THEN 'Marked resolved. Confirm or reopen it.' WHEN 'rejected' THEN 'Rejected: '||_note ELSE 'Work has started.' END, '/app/helpdesk');
    END IF;
  ELSIF _note IS NOT NULL AND _status IS NULL THEN
    INSERT INTO public.support_ticket_events (ticket_id, society_id, actor_id, actor_kind, kind, body) VALUES (t.id, t.society_id, uid, 'admin', 'comment', _note);
    UPDATE public.support_tickets SET last_activity_at = now() WHERE id = t.id;
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.helpdesk_assign_work(_ticket uuid, _staff uuid, _vendor uuid, _asset uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid; t public.support_tickets; su uuid;
BEGIN
  SELECT * INTO t FROM public.support_tickets WHERE id = _ticket FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  uid := public._ops_admin(t.society_id);
  IF t.status IN ('closed','cancelled','rejected') THEN RAISE EXCEPTION 'ticket_closed' USING ERRCODE='22023'; END IF;
  IF _staff IS NOT NULL THEN
    SELECT user_id INTO su FROM public.society_staff WHERE id = _staff AND society_id = t.society_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_assignee' USING ERRCODE='22023'; END IF;
  END IF;
  IF _vendor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.finance_vendors WHERE id = _vendor AND society_id = t.society_id AND is_active) THEN RAISE EXCEPTION 'invalid_vendor' USING ERRCODE='22023'; END IF;
  IF _asset IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.society_assets WHERE id = _asset AND society_id = t.society_id) THEN RAISE EXCEPTION 'invalid_asset' USING ERRCODE='22023'; END IF;
  UPDATE public.support_tickets SET staff_id = _staff, vendor_id = _vendor, asset_id = _asset, last_activity_at = now() WHERE id = t.id;
  INSERT INTO public.support_ticket_events (ticket_id, society_id, actor_id, actor_kind, kind, body)
  VALUES (t.id, t.society_id, uid, 'admin', 'linked', 'Work assignment updated');
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'helpdesk.work_assigned', 'support_tickets', t.id::text, t.society_id, jsonb_build_object('staff', _staff, 'vendor', _vendor, 'asset', _asset));
  IF su IS NOT NULL AND _staff IS DISTINCT FROM t.staff_id THEN
    PERFORM public._notify_user(su, t.society_id, 'helpdesk', 'Work assigned to you', '#'||t.ticket_no||' '||t.subject, '/society/helpdesk');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.helpdesk_escalate(_ticket uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid; t public.support_tickets;
BEGIN
  SELECT * INTO t FROM public.support_tickets WHERE id = _ticket FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  uid := public._ops_admin(t.society_id);
  _reason := btrim(coalesce(_reason,''));
  IF char_length(_reason) < 5 OR char_length(_reason) > 500 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  IF t.status NOT IN ('open','reopened','in_progress','on_hold','awaiting_approval') OR t.escalation_level >= 3 THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  UPDATE public.support_tickets SET escalation_level = t.escalation_level + 1, escalation_reason = _reason, last_activity_at = now() WHERE id = t.id;
  INSERT INTO public.support_ticket_events (ticket_id, society_id, actor_id, actor_kind, kind, body) VALUES (t.id, t.society_id, uid, 'admin', 'escalated', _reason);
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'helpdesk.escalated', 'support_tickets', t.id::text, t.society_id, jsonb_build_object('level', t.escalation_level + 1));
  PERFORM public._notify_society_admins(t.society_id, 'helpdesk', 'Request #'||t.ticket_no||' escalated', _reason, '/society/helpdesk');
END $$;

CREATE OR REPLACE FUNCTION public.helpdesk_reopen(_ticket uuid, _note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); t public.support_tickets; is_admin boolean; nid uuid;
BEGIN
  SELECT * INTO t FROM public.support_tickets WHERE id = _ticket FOR UPDATE;
  IF uid IS NULL OR t.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  is_admin := public._helpdesk_is_admin(t.society_id);
  IF t.user_id <> uid AND NOT is_admin THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  _note := btrim(coalesce(_note,''));
  IF char_length(_note) < 5 OR char_length(_note) > 2000 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  IF t.status NOT IN ('resolved','closed') THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('helpdesk_reopen', uid::text, 10, interval '1 hour');
  IF coalesce(t.resolved_at, t.closed_at, now()) >= now() - interval '7 days' THEN
    UPDATE public.support_tickets SET status = 'reopened', reopened_count = reopened_count + 1, resolved_at = NULL, closed_at = NULL,
      last_activity_at = now(), sla_due_at = now() + make_interval(hours => public._helpdesk_sla_hours(priority)) WHERE id = t.id;
    INSERT INTO public.support_ticket_events (ticket_id, society_id, actor_id, actor_kind, kind, from_status, to_status, body)
    VALUES (t.id, t.society_id, uid, CASE WHEN t.user_id = uid THEN 'resident' ELSE 'admin' END, 'reopened', t.status, 'reopened', _note);
    nid := t.id;
  ELSE
    INSERT INTO public.support_tickets (user_id, society_id, subject, description, category, priority, status, asset_id, parent_ticket_id, last_activity_at)
    VALUES (t.user_id, t.society_id, left('Repeat: '||t.subject, 120), _note, t.category, t.priority, 'open', t.asset_id, t.id, now()) RETURNING id INTO nid;
    INSERT INTO public.support_ticket_events (ticket_id, society_id, actor_id, actor_kind, kind, body)
    VALUES (nid, t.society_id, uid, CASE WHEN t.user_id = uid THEN 'resident' ELSE 'admin' END, 'created', 'Follow-up of #'||t.ticket_no);
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'helpdesk.reopened', 'support_tickets', t.id::text, t.society_id, jsonb_build_object('new_ticket', nid <> t.id));
  IF t.assigned_to IS NOT NULL THEN PERFORM public._notify_user(t.assigned_to, t.society_id, 'helpdesk', 'Request #'||t.ticket_no||' reopened', left(_note,200), '/society/helpdesk'); END IF;
  RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.helpdesk_resident_action(_ticket uuid, _action text, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE uid uuid := auth.uid(); t public.support_tickets; ns text;
BEGIN
  IF _action = 'reopen' THEN PERFORM public.helpdesk_reopen(_ticket, coalesce(nullif(btrim(_note),''), 'Issue not fixed')); RETURN; END IF;
  SELECT * INTO t FROM public.support_tickets WHERE id = _ticket FOR UPDATE;
  IF uid IS NULL OR t.id IS NULL OR t.user_id <> uid THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  ns := CASE WHEN _action = 'cancel' AND t.status IN ('open','awaiting_approval') THEN 'cancelled'
             WHEN _action = 'confirm' AND t.status = 'resolved' THEN 'closed' ELSE NULL END;
  IF ns IS NULL THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  _note := nullif(left(btrim(coalesce(_note,'')), 2000),'');
  UPDATE public.support_tickets SET status = ns, last_activity_at = now(), closed_at = now() WHERE id = t.id;
  INSERT INTO public.support_ticket_events (ticket_id, society_id, actor_id, actor_kind, kind, from_status, to_status, body)
  VALUES (t.id, t.society_id, uid, 'resident', 'status', t.status, ns, _note);
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'helpdesk.ticket_status', 'support_tickets', t.id::text, t.society_id, jsonb_build_object('from', t.status, 'to', ns, 'by', 'resident'));
END $function$;

CREATE OR REPLACE FUNCTION public.helpdesk_rate(_ticket uuid, _rating int, _comment text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); t public.support_tickets;
BEGIN
  SELECT * INTO t FROM public.support_tickets WHERE id = _ticket;
  IF uid IS NULL OR t.id IS NULL OR t.user_id <> uid THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF t.status NOT IN ('resolved','closed') THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF _rating IS NULL OR _rating NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'invalid_rating' USING ERRCODE='22023'; END IF;
  INSERT INTO public.ticket_ratings (ticket_id, society_id, user_id, rating, comment)
  VALUES (t.id, t.society_id, uid, _rating, nullif(left(btrim(coalesce(_comment,'')),500),''))
  ON CONFLICT (ticket_id) DO NOTHING;
  IF NOT FOUND THEN RAISE EXCEPTION 'already_rated' USING ERRCODE='22023'; END IF;
  INSERT INTO public.support_ticket_events (ticket_id, society_id, actor_id, actor_kind, kind, body) VALUES (t.id, t.society_id, uid, 'resident', 'rated', _rating||'/5');
END $$;

CREATE OR REPLACE FUNCTION public.helpdesk_ticket_access(_ticket uuid)
RETURNS TABLE(society_id uuid, can_view boolean, can_upload boolean) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE t public.support_tickets; adm boolean;
BEGIN
  SELECT * INTO t FROM public.support_tickets s WHERE s.id = _ticket;
  IF auth.uid() IS NULL OR t.id IS NULL THEN RETURN QUERY SELECT NULL::uuid, false, false; RETURN; END IF;
  adm := public._helpdesk_is_admin(t.society_id);
  RETURN QUERY SELECT t.society_id, (adm OR t.user_id = auth.uid() OR t.assigned_to = auth.uid()),
    ((adm OR t.user_id = auth.uid() OR t.assigned_to = auth.uid()) AND t.status NOT IN ('closed','cancelled','rejected'));
END $$;

CREATE OR REPLACE FUNCTION public.helpdesk_record_attachment(_ticket uuid, _path text, _mime text, _size int)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a record; nid uuid;
BEGIN
  SELECT * INTO a FROM public.helpdesk_ticket_access(_ticket);
  IF NOT coalesce(a.can_upload,false) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF split_part(_path,'/',1) <> a.society_id::text OR split_part(_path,'/',2) <> _ticket::text THEN RAISE EXCEPTION 'invalid_path' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM public.ticket_attachments WHERE ticket_id = _ticket) >= 10 THEN RAISE EXCEPTION 'too_many_files' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('helpdesk_upload', auth.uid()::text, 30, interval '1 hour');
  INSERT INTO public.ticket_attachments (ticket_id, society_id, uploaded_by, path, mime, size_bytes) VALUES (_ticket, a.society_id, auth.uid(), _path, _mime, _size) RETURNING id INTO nid;
  INSERT INTO public.support_ticket_events (ticket_id, society_id, actor_id, actor_kind, kind, body)
  VALUES (_ticket, a.society_id, auth.uid(), CASE WHEN public._helpdesk_is_admin(a.society_id) THEN 'admin' ELSE 'resident' END, 'evidence', 'Attached a file');
  RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.helpdesk_admin_queue_v2(_limit int DEFAULT 300)
RETURNS TABLE(id uuid, ticket_no bigint, subject text, description text, category text, priority text, status text, requires_approval boolean, approval_status text,
  assigned_to uuid, assignee_name text, requester_name text, flat_label text, created_at timestamptz, last_activity_at timestamptz,
  sla_due_at timestamptz, escalation_level smallint, escalation_reason text, hold_reason text, staff_id uuid, staff_name text, vendor_id uuid, vendor_name text,
  asset_id uuid, asset_name text, reopened_count smallint, parent_ticket_id uuid, rating smallint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sid uuid := public.get_user_society_id(auth.uid());
BEGIN
  IF auth.uid() IS NULL OR sid IS NULL OR NOT public._helpdesk_is_admin(sid) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  SELECT t.id, t.ticket_no, t.subject, t.description, t.category, t.priority, t.status, t.requires_approval, t.approval_status,
    t.assigned_to, a.full_name, coalesce(p.full_name,'Resident'),
    (SELECT f.flat_number FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id WHERE fr.user_id = t.user_id AND f.society_id = sid ORDER BY fr.created_at DESC LIMIT 1),
    t.created_at, t.last_activity_at, t.sla_due_at, t.escalation_level, t.escalation_reason, t.hold_reason,
    t.staff_id, st.full_name, t.vendor_id, v.name, t.asset_id, sa.name, t.reopened_count, t.parent_ticket_id, r.rating
  FROM public.support_tickets t
  LEFT JOIN public.profiles p ON p.id = t.user_id LEFT JOIN public.profiles a ON a.id = t.assigned_to
  LEFT JOIN public.society_staff st ON st.id = t.staff_id LEFT JOIN public.finance_vendors v ON v.id = t.vendor_id
  LEFT JOIN public.society_assets sa ON sa.id = t.asset_id LEFT JOIN public.ticket_ratings r ON r.ticket_id = t.id
  WHERE t.society_id = sid
  ORDER BY (t.status IN ('closed','cancelled','rejected')), t.escalation_level DESC,
    CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.last_activity_at DESC
  LIMIT greatest(1, least(coalesce(_limit,300), 500));
END $$;

CREATE OR REPLACE FUNCTION public.admin_upsert_staff(_id uuid, _name text, _job text, _phone text, _shift_start time, _shift_end time, _days smallint[], _active boolean, _notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sid uuid := public.get_user_society_id(auth.uid()); uid uuid; rid uuid;
BEGIN
  IF _id IS NOT NULL THEN SELECT society_id INTO sid FROM public.society_staff WHERE id = _id; END IF;
  uid := public._ops_admin(sid);
  IF _days IS NULL OR EXISTS (SELECT 1 FROM unnest(_days) d WHERE d NOT BETWEEN 0 AND 6) THEN RAISE EXCEPTION 'invalid_days' USING ERRCODE='22023'; END IF;
  IF _id IS NULL THEN
    INSERT INTO public.society_staff (society_id, full_name, job_type, phone, shift_start, shift_end, shift_days, is_active, notes, created_by)
    VALUES (sid, btrim(_name), _job, nullif(btrim(_phone),''), _shift_start, _shift_end, _days, coalesce(_active,true), nullif(btrim(_notes),''), uid) RETURNING id INTO rid;
  ELSE
    UPDATE public.society_staff SET full_name = btrim(_name), job_type = _job, phone = nullif(btrim(_phone),''), shift_start = _shift_start, shift_end = _shift_end,
      shift_days = _days, is_active = coalesce(_active,true), notes = nullif(btrim(_notes),''), updated_at = now() WHERE id = _id RETURNING id INTO rid;
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, CASE WHEN _id IS NULL THEN 'ops.staff_created' ELSE 'ops.staff_updated' END, 'society_staff', rid::text, sid, jsonb_build_object('active', coalesce(_active,true), 'job', _job));
  RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION public.admin_record_attendance(_staff uuid, _day date, _status text, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sid uuid; uid uuid;
BEGIN
  SELECT society_id INTO sid FROM public.society_staff WHERE id = _staff;
  uid := public._ops_admin(sid);
  IF _day IS NULL OR _day > current_date OR _day < current_date - 60 THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE='22023'; END IF;
  INSERT INTO public.staff_attendance (society_id, staff_id, day, status, note, recorded_by) VALUES (sid, _staff, _day, _status, nullif(btrim(_note),''), uid)
  ON CONFLICT (staff_id, day) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, recorded_by = EXCLUDED.recorded_by;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'ops.attendance', 'society_staff', _staff::text, sid, jsonb_build_object('day', _day, 'status', _status));
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_vendor_contract(_vendor uuid, _type text, _start date, _end date, _value numeric, _notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sid uuid; uid uuid;
BEGIN
  SELECT society_id INTO sid FROM public.finance_vendors WHERE id = _vendor;
  uid := public._ops_admin(sid);
  IF _start IS NOT NULL AND _end IS NOT NULL AND _end < _start THEN RAISE EXCEPTION 'invalid_dates' USING ERRCODE='22023'; END IF;
  UPDATE public.finance_vendors SET contract_type = _type, contract_start = _start, contract_end = _end, contract_value = _value,
    contract_notes = nullif(btrim(_notes),''), updated_at = now() WHERE id = _vendor;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'ops.vendor_contract', 'finance_vendors', _vendor::text, sid, jsonb_build_object('type', _type, 'end', _end));
END $$;

CREATE OR REPLACE FUNCTION public.admin_upsert_asset(_id uuid, _name text, _category text, _location text, _status text, _purchase date, _installed date, _warranty date, _amc date, _vendor uuid, _notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sid uuid := public.get_user_society_id(auth.uid()); uid uuid; rid uuid;
BEGIN
  IF _id IS NOT NULL THEN SELECT society_id INTO sid FROM public.society_assets WHERE id = _id; END IF;
  uid := public._ops_admin(sid);
  IF _vendor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.finance_vendors WHERE id = _vendor AND society_id = sid) THEN RAISE EXCEPTION 'invalid_vendor' USING ERRCODE='22023'; END IF;
  IF _id IS NULL THEN
    INSERT INTO public.society_assets (society_id, name, category, location, status, purchase_date, installed_on, warranty_until, amc_until, vendor_id, notes, created_by)
    VALUES (sid, btrim(_name), _category, nullif(btrim(_location),''), coalesce(_status,'active'), _purchase, _installed, _warranty, _amc, _vendor, nullif(btrim(_notes),''), uid) RETURNING id INTO rid;
  ELSE
    UPDATE public.society_assets SET name = btrim(_name), category = _category, location = nullif(btrim(_location),''), status = coalesce(_status,'active'),
      purchase_date = _purchase, installed_on = _installed, warranty_until = _warranty, amc_until = _amc, vendor_id = _vendor, notes = nullif(btrim(_notes),''), updated_at = now()
    WHERE id = _id RETURNING id INTO rid;
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, CASE WHEN _id IS NULL THEN 'ops.asset_created' ELSE 'ops.asset_updated' END, 'society_assets', rid::text, sid, jsonb_build_object('status', coalesce(_status,'active')));
  RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION public.admin_add_asset_service(_asset uuid, _date date, _kind text, _ticket uuid, _vendor uuid, _expense uuid, _notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sid uuid; uid uuid; rid uuid;
BEGIN
  SELECT society_id INTO sid FROM public.society_assets WHERE id = _asset;
  uid := public._ops_admin(sid);
  IF _date IS NULL OR _date > current_date THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE='22023'; END IF;
  IF _ticket IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.support_tickets WHERE id = _ticket AND society_id = sid) THEN RAISE EXCEPTION 'invalid_ticket' USING ERRCODE='22023'; END IF;
  IF _vendor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.finance_vendors WHERE id = _vendor AND society_id = sid) THEN RAISE EXCEPTION 'invalid_vendor' USING ERRCODE='22023'; END IF;
  IF _expense IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.expenses WHERE id = _expense AND society_id = sid AND status <> 'reversed') THEN RAISE EXCEPTION 'invalid_expense' USING ERRCODE='22023'; END IF;
  INSERT INTO public.asset_service_log (society_id, asset_id, service_date, kind, ticket_id, vendor_id, expense_id, notes, created_by)
  VALUES (sid, _asset, _date, _kind, _ticket, _vendor, _expense, nullif(btrim(_notes),''), uid) RETURNING id INTO rid;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'ops.asset_service', 'society_assets', _asset::text, sid, jsonb_build_object('kind', _kind, 'expense', _expense));
  RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION public.admin_upsert_inventory_item(_id uuid, _name text, _location text, _unit text, _reorder numeric, _active boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sid uuid := public.get_user_society_id(auth.uid()); uid uuid; rid uuid;
BEGIN
  IF _id IS NOT NULL THEN SELECT society_id INTO sid FROM public.inventory_items WHERE id = _id; END IF;
  uid := public._ops_admin(sid);
  IF _id IS NULL THEN
    INSERT INTO public.inventory_items (society_id, name, location, unit, reorder_level, is_active, created_by)
    VALUES (sid, btrim(_name), nullif(btrim(_location),''), coalesce(nullif(btrim(_unit),''),'pcs'), coalesce(_reorder,0), coalesce(_active,true), uid) RETURNING id INTO rid;
  ELSE
    UPDATE public.inventory_items SET name = btrim(_name), location = nullif(btrim(_location),''), unit = coalesce(nullif(btrim(_unit),''),'pcs'),
      reorder_level = coalesce(_reorder,0), is_active = coalesce(_active,true), updated_at = now() WHERE id = _id RETURNING id INTO rid;
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'ops.inventory_item', 'inventory_items', rid::text, sid, jsonb_build_object('active', coalesce(_active,true)));
  RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION public.admin_adjust_inventory(_item uuid, _delta numeric, _reason text)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE it public.inventory_items; uid uuid; nq numeric;
BEGIN
  SELECT * INTO it FROM public.inventory_items WHERE id = _item FOR UPDATE;
  uid := public._ops_admin(it.society_id);
  IF _delta IS NULL OR _delta = 0 OR abs(_delta) > 100000 THEN RAISE EXCEPTION 'invalid_quantity' USING ERRCODE='22023'; END IF;
  IF char_length(btrim(coalesce(_reason,''))) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  nq := it.quantity + _delta;
  IF nq < 0 THEN RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='22023'; END IF;
  UPDATE public.inventory_items SET quantity = nq, updated_at = now() WHERE id = _item;
  INSERT INTO public.inventory_movements (society_id, item_id, delta, resulting_qty, reason, created_by) VALUES (it.society_id, _item, _delta, nq, btrim(_reason), uid);
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'ops.inventory_adjust', 'inventory_items', _item::text, it.society_id, jsonb_build_object('delta', _delta, 'qty', nq));
  RETURN nq;
END $$;

CREATE OR REPLACE FUNCTION public.asset_qr_lookup(_token text)
RETURNS TABLE(name text, category text, location text, status text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT a.name, a.category, a.location, a.status FROM public.society_assets a WHERE _token ~ '^[0-9a-f]{32}$' AND a.qr_token = _token AND a.status <> 'retired' $$;

CREATE OR REPLACE FUNCTION public.ops_daily_reminders() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT t.id, t.society_id, t.ticket_no, t.subject, t.assigned_to FROM public.support_tickets t
    WHERE t.sla_due_at < now() AND t.status IN ('open','reopened','in_progress','on_hold') LOOP
    INSERT INTO public.ops_reminders_sent VALUES ('sla_overdue', r.id, current_date) ON CONFLICT DO NOTHING;
    IF FOUND THEN
      PERFORM public._notify_society_admins(r.society_id, 'helpdesk', 'Request #'||r.ticket_no||' is overdue', r.subject, '/society/helpdesk');
      IF r.assigned_to IS NOT NULL THEN PERFORM public._notify_user(r.assigned_to, r.society_id, 'helpdesk', 'Request #'||r.ticket_no||' is overdue', r.subject, '/society/helpdesk'); END IF;
    END IF;
  END LOOP;
  FOR r IN SELECT a.id, a.society_id, a.name, least(a.warranty_until, a.amc_until) d FROM public.society_assets a
    WHERE a.status <> 'retired' AND least(coalesce(a.warranty_until,'infinity'), coalesce(a.amc_until,'infinity')) BETWEEN current_date AND current_date + 30 LOOP
    INSERT INTO public.ops_reminders_sent VALUES ('asset_expiry', r.id, coalesce(r.d, current_date)) ON CONFLICT DO NOTHING;
    IF FOUND THEN PERFORM public._notify_society_admins(r.society_id, 'operations', 'Warranty/AMC ending soon', r.name, '/society/operations'); END IF;
  END LOOP;
  FOR r IN SELECT v.id, v.society_id, v.name, v.contract_end FROM public.finance_vendors v
    WHERE v.is_active AND v.contract_type <> 'none' AND v.contract_end BETWEEN current_date AND current_date + 30 LOOP
    INSERT INTO public.ops_reminders_sent VALUES ('vendor_contract', r.id, r.contract_end) ON CONFLICT DO NOTHING;
    IF FOUND THEN PERFORM public._notify_society_admins(r.society_id, 'operations', 'Vendor contract ending soon', r.name, '/society/operations'); END IF;
  END LOOP;
  FOR r IN SELECT i.id, i.society_id, i.name FROM public.inventory_items i WHERE i.is_active AND i.reorder_level > 0 AND i.quantity <= i.reorder_level LOOP
    INSERT INTO public.ops_reminders_sent VALUES ('low_stock', r.id, date_trunc('week', current_date)::date) ON CONFLICT DO NOTHING;
    IF FOUND THEN PERFORM public._notify_society_admins(r.society_id, 'operations', 'Low stock', r.name, '/society/operations'); END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.ops_daily_reminders() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.helpdesk_assign_work(uuid,uuid,uuid,uuid), public.helpdesk_escalate(uuid,text), public.helpdesk_reopen(uuid,text),
  public.helpdesk_rate(uuid,int,text), public.helpdesk_ticket_access(uuid), public.helpdesk_record_attachment(uuid,text,text,int), public.helpdesk_admin_queue_v2(int),
  public.admin_upsert_staff(uuid,text,text,text,time,time,smallint[],boolean,text), public.admin_record_attendance(uuid,date,text,text),
  public.admin_set_vendor_contract(uuid,text,date,date,numeric,text), public.admin_upsert_asset(uuid,text,text,text,text,date,date,date,date,uuid,text),
  public.admin_add_asset_service(uuid,date,text,uuid,uuid,uuid,text), public.admin_upsert_inventory_item(uuid,text,text,text,numeric,boolean),
  public.admin_adjust_inventory(uuid,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpdesk_assign_work(uuid,uuid,uuid,uuid), public.helpdesk_escalate(uuid,text), public.helpdesk_reopen(uuid,text),
  public.helpdesk_rate(uuid,int,text), public.helpdesk_ticket_access(uuid), public.helpdesk_record_attachment(uuid,text,text,int), public.helpdesk_admin_queue_v2(int),
  public.admin_upsert_staff(uuid,text,text,text,time,time,smallint[],boolean,text), public.admin_record_attendance(uuid,date,text,text),
  public.admin_set_vendor_contract(uuid,text,date,date,numeric,text), public.admin_upsert_asset(uuid,text,text,text,text,date,date,date,date,uuid,text),
  public.admin_add_asset_service(uuid,date,text,uuid,uuid,uuid,text), public.admin_upsert_inventory_item(uuid,text,text,text,numeric,boolean),
  public.admin_adjust_inventory(uuid,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.asset_qr_lookup(text) TO anon, authenticated;

SELECT cron.schedule('ops-daily-reminders', '40 3 * * *', 'SELECT public.ops_daily_reminders();');
