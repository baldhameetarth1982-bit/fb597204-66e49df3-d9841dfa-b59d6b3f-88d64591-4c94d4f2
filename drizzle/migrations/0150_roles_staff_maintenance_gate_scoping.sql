-- Staff work areas: add explicit, read-only Gate visibility. Staff never become Guards (guard RPCs require role 'security').
CREATE OR REPLACE FUNCTION public._staff_permission_valid(_perms text[])
 RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT coalesce(array_length(_perms,1),0) <= 8 AND coalesce(bool_and(p IN (
    'staff.helpdesk','staff.operations','staff.assets','staff.inventory','staff.vendors','staff.documents','staff.gate','finance.read')), true)
  FROM unnest(coalesce(_perms,'{}'::text[])) p;
$$;

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
    'staff.vendors','staff.documents','staff.gate'
  );
$$;

-- Scheduled maintenance: committee schedules work on an asset for one staff member; staff progress only their own tasks.
CREATE TABLE public.maintenance_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES public.society_assets(id) ON DELETE SET NULL,
  staff_id uuid NOT NULL REFERENCES public.society_staff(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  instructions text CHECK (instructions IS NULL OR char_length(instructions) <= 1000),
  due_on date NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','paused','done','cancelled')),
  staff_note text CHECK (staff_note IS NULL OR char_length(staff_note) <= 1000),
  cancel_reason text CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 300),
  started_at timestamptz, completed_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX maintenance_tasks_staff_idx ON public.maintenance_tasks (staff_id, status, due_on);
CREATE INDEX maintenance_tasks_society_idx ON public.maintenance_tasks (society_id, due_on DESC);
GRANT SELECT ON public.maintenance_tasks TO authenticated;
GRANT ALL ON public.maintenance_tasks TO service_role;
ALTER TABLE public.maintenance_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Committee reads society maintenance" ON public.maintenance_tasks FOR SELECT TO authenticated
  USING (public._helpdesk_is_admin(society_id));

CREATE OR REPLACE FUNCTION public.admin_schedule_maintenance(_asset uuid, _staff uuid, _title text, _due date, _instructions text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE sid uuid; rid uuid;
BEGIN
  SELECT society_id INTO sid FROM public.society_staff WHERE id = _staff AND is_active;
  IF sid IS NULL THEN RAISE EXCEPTION 'staff_not_found' USING ERRCODE='22023'; END IF;
  PERFORM public._ops_admin(sid);
  IF _asset IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.society_assets WHERE id = _asset AND society_id = sid) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE='22023'; END IF;
  IF char_length(btrim(coalesce(_title,''))) < 3 OR _due IS NULL OR _due < current_date - 1 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  INSERT INTO public.maintenance_tasks (society_id, asset_id, staff_id, title, instructions, due_on, created_by)
  VALUES (sid, _asset, _staff, left(btrim(_title),120), nullif(left(btrim(coalesce(_instructions,'')),1000),''), _due, auth.uid()) RETURNING id INTO rid;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'maintenance.scheduled', 'maintenance_tasks', rid::text, sid, jsonb_build_object('staff_id', _staff, 'asset_id', _asset, 'due_on', _due));
  PERFORM public._notify_user(st.user_id, sid, 'operations', 'Maintenance assigned', left(btrim(_title),120), '/staff')
    FROM public.society_staff st WHERE st.id = _staff AND st.user_id IS NOT NULL;
  RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION public.admin_cancel_maintenance(_id uuid, _reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE m public.maintenance_tasks;
BEGIN
  SELECT * INTO m FROM public.maintenance_tasks WHERE id = _id FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='22023'; END IF;
  PERFORM public._ops_admin(m.society_id);
  IF m.status IN ('done','cancelled') THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF char_length(btrim(coalesce(_reason,''))) < 5 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  UPDATE public.maintenance_tasks SET status='cancelled', cancel_reason=left(btrim(_reason),300), updated_at=now() WHERE id=_id;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'maintenance.cancelled', 'maintenance_tasks', _id::text, m.society_id, jsonb_build_object('reason', left(btrim(_reason),300)));
END $$;

CREATE OR REPLACE FUNCTION public.staff_my_maintenance(_include_done boolean DEFAULT false)
 RETURNS TABLE(id uuid, title text, instructions text, due_on date, status text, staff_note text, asset_name text, asset_location text, started_at timestamptz, completed_at timestamptz)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM public._staff_ctx('staff.operations');
  RETURN QUERY SELECT m.id, m.title, m.instructions, m.due_on, m.status, m.staff_note, a.name, a.location, m.started_at, m.completed_at
  FROM public.maintenance_tasks m LEFT JOIN public.society_assets a ON a.id = m.asset_id
  WHERE m.society_id = c.society_id AND m.staff_id = c.staff_id
    AND (_include_done OR m.status IN ('scheduled','in_progress','paused'))
  ORDER BY (m.status IN ('done','cancelled')), m.due_on LIMIT 100;
END $$;

CREATE OR REPLACE FUNCTION public.staff_update_maintenance(_id uuid, _status text, _note text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c record; m public.maintenance_tasks; allowed text[];
BEGIN
  SELECT * INTO c FROM public._staff_ctx('staff.operations');
  PERFORM public._rate_hit('staff_maint', auth.uid()::text, 120, interval '1 hour');
  SELECT * INTO m FROM public.maintenance_tasks WHERE id = _id FOR UPDATE;
  IF m.id IS NULL OR m.society_id <> c.society_id OR m.staff_id <> c.staff_id THEN RAISE EXCEPTION 'not_found' USING ERRCODE='22023'; END IF;
  _note := nullif(btrim(coalesce(_note,'')),'');
  IF _note IS NOT NULL AND char_length(_note) > 1000 THEN RAISE EXCEPTION 'invalid_note' USING ERRCODE='22023'; END IF;
  allowed := CASE m.status WHEN 'scheduled' THEN ARRAY['in_progress'] WHEN 'in_progress' THEN ARRAY['paused','done']
    WHEN 'paused' THEN ARRAY['in_progress','done'] ELSE ARRAY[]::text[] END;
  IF NOT (_status = ANY(allowed)) THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF _status IN ('paused','done') AND (_note IS NULL OR char_length(_note) < 3) THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  UPDATE public.maintenance_tasks SET status=_status, staff_note=coalesce(_note, staff_note), updated_at=now(),
    started_at = coalesce(started_at, CASE WHEN _status='in_progress' THEN now() END),
    completed_at = CASE WHEN _status='done' THEN now() ELSE completed_at END
  WHERE id=_id;
  -- Completion records a service entry only; it never creates an expense, bill or charge.
  IF _status = 'done' AND m.asset_id IS NOT NULL THEN
    INSERT INTO public.asset_service_log (society_id, asset_id, service_date, kind, notes, created_by)
    VALUES (m.society_id, m.asset_id, current_date, 'service', left(m.title||': '||_note,500), auth.uid());
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'staff.maintenance_status', 'maintenance_tasks', _id::text, m.society_id, jsonb_build_object('from', m.status, 'to', _status));
END $$;

-- Assets: least privilege — only assets linked to the caller's own assigned requests or maintenance.
CREATE OR REPLACE FUNCTION public._staff_asset_ids(_society uuid, _staff uuid)
 RETURNS TABLE(asset_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT t.asset_id FROM public.support_tickets t WHERE t.society_id=_society AND t.staff_id=_staff AND t.asset_id IS NOT NULL
    AND t.status NOT IN ('closed','cancelled','rejected')
  UNION
  SELECT m.asset_id FROM public.maintenance_tasks m WHERE m.society_id=_society AND m.staff_id=_staff AND m.asset_id IS NOT NULL
    AND m.status IN ('scheduled','in_progress','paused');
$$;
REVOKE ALL ON FUNCTION public._staff_asset_ids(uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.staff_list_assets()
 RETURNS TABLE(id uuid, name text, category text, location text, status text, warranty_until date, amc_until date, last_service date)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM public._staff_ctx('staff.assets');
  RETURN QUERY SELECT a.id, a.name, a.category, a.location, a.status, a.warranty_until, a.amc_until,
    (SELECT max(l.service_date) FROM public.asset_service_log l WHERE l.asset_id = a.id)
  FROM public.society_assets a
  WHERE a.society_id = c.society_id AND a.id IN (SELECT s.asset_id FROM public._staff_asset_ids(c.society_id, c.staff_id) s)
  ORDER BY a.name LIMIT 300;
END $$;

CREATE OR REPLACE FUNCTION public.staff_log_asset_service(_asset uuid, _kind text, _notes text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c record; rid uuid;
BEGIN
  SELECT * INTO c FROM public._staff_ctx('staff.assets');
  PERFORM public._rate_hit('staff_asset', auth.uid()::text, 60, interval '1 hour');
  IF NOT EXISTS (SELECT 1 FROM public._staff_asset_ids(c.society_id, c.staff_id) s WHERE s.asset_id = _asset) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE='22023'; END IF;
  IF _kind NOT IN ('repair','service','inspection') THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  IF char_length(btrim(coalesce(_notes,''))) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  INSERT INTO public.asset_service_log (society_id, asset_id, service_date, kind, notes, created_by)
  VALUES (c.society_id, _asset, current_date, _kind, left(btrim(_notes),500), auth.uid()) RETURNING id INTO rid;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'staff.asset_service', 'society_assets', _asset::text, c.society_id, jsonb_build_object('kind', _kind));
  RETURN rid;
END $$;

-- Gate: explicit staff.gate gives a read-only "inside now" view (no phone, no approvals, no check-in/out).
CREATE OR REPLACE FUNCTION public.staff_gate_inside()
 RETURNS TABLE(visitor text, category text, flat_number text, entry_at timestamptz)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM public._staff_ctx('staff.gate');
  RETURN QUERY SELECT split_part(btrim(v.visitor_name),' ',1), v.category, v.flat_number, v.entry_at
  FROM public.visitors v WHERE v.society_id = c.society_id AND v.status = 'inside' AND v.exit_at IS NULL
  ORDER BY v.entry_at DESC LIMIT 100;
END $$;

REVOKE ALL ON FUNCTION public.admin_schedule_maintenance(uuid,uuid,text,date,text), public.admin_cancel_maintenance(uuid,text),
  public.staff_my_maintenance(boolean), public.staff_update_maintenance(uuid,text,text), public.staff_gate_inside() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_schedule_maintenance(uuid,uuid,text,date,text), public.admin_cancel_maintenance(uuid,text),
  public.staff_my_maintenance(boolean), public.staff_update_maintenance(uuid,text,text), public.staff_gate_inside() TO authenticated;