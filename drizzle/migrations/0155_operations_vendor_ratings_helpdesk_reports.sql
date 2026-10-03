CREATE TABLE public.vendor_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.finance_vendors(id) ON DELETE RESTRICT,
  ticket_id uuid UNIQUE REFERENCES public.support_tickets(id) ON DELETE RESTRICT,
  service_log_id uuid UNIQUE REFERENCES public.asset_service_log(id) ON DELETE RESTRICT,
  rater_id uuid NOT NULL,
  rater_kind text NOT NULL CHECK (rater_kind IN ('resident','committee')),
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text CHECK (comment IS NULL OR char_length(comment) <= 500),
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
  moderation_reason text CHECK (moderation_reason IS NULL OR char_length(moderation_reason) <= 300),
  moderated_by uuid,
  moderated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((ticket_id IS NULL) <> (service_log_id IS NULL))
);
CREATE INDEX vendor_ratings_vendor_idx ON public.vendor_ratings(society_id, vendor_id, created_at DESC);
GRANT SELECT ON public.vendor_ratings TO authenticated;
GRANT ALL ON public.vendor_ratings TO service_role;
ALTER TABLE public.vendor_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vendor ratings: admins of society or own rater" ON public.vendor_ratings FOR SELECT TO authenticated
  USING (rater_id = auth.uid() OR public._helpdesk_is_admin(society_id));

-- Only rating text/status moderation may change; vendor, source, rater, score are immutable.
CREATE OR REPLACE FUNCTION public._vendor_rating_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'append_only' USING ERRCODE='42501'; END IF;
  IF NEW.vendor_id <> OLD.vendor_id OR NEW.society_id <> OLD.society_id OR NEW.rater_id <> OLD.rater_id
     OR NEW.rating <> OLD.rating OR NEW.ticket_id IS DISTINCT FROM OLD.ticket_id
     OR NEW.service_log_id IS DISTINCT FROM OLD.service_log_id OR NEW.created_at <> OLD.created_at
     OR NEW.comment IS DISTINCT FROM OLD.comment THEN
    RAISE EXCEPTION 'immutable' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_vendor_rating_guard BEFORE UPDATE OR DELETE ON public.vendor_ratings FOR EACH ROW EXECUTE FUNCTION public._vendor_rating_guard();

CREATE OR REPLACE FUNCTION public._caller_society() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT society_id FROM public.profiles WHERE id = auth.uid()
$$;

-- Resident: rate the vendor who handled their own resolved/closed request.
CREATE OR REPLACE FUNCTION public.vendor_rating_status(_ticket uuid)
RETURNS TABLE(eligible boolean, vendor_name text, rated boolean, my_rating smallint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.support_tickets; r public.vendor_ratings;
BEGIN
  SELECT * INTO t FROM public.support_tickets WHERE id = _ticket;
  IF auth.uid() IS NULL OR t.id IS NULL OR t.user_id <> auth.uid() THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO r FROM public.vendor_ratings WHERE ticket_id = t.id;
  RETURN QUERY SELECT (t.vendor_id IS NOT NULL AND t.status IN ('resolved','closed')),
    (SELECT v.name FROM public.finance_vendors v WHERE v.id = t.vendor_id AND v.society_id = t.society_id),
    r.id IS NOT NULL, r.rating;
END $$;

CREATE OR REPLACE FUNCTION public.vendor_rate_ticket(_ticket uuid, _rating integer, _comment text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); t public.support_tickets; rid uuid; rl record;
BEGIN
  SELECT * INTO t FROM public.support_tickets WHERE id = _ticket;
  IF uid IS NULL OR t.id IS NULL OR t.user_id <> uid THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF t.vendor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.finance_vendors v WHERE v.id = t.vendor_id AND v.society_id = t.society_id) THEN
    RAISE EXCEPTION 'no_vendor' USING ERRCODE='22023'; END IF;
  IF t.status NOT IN ('resolved','closed') THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF _rating IS NULL OR _rating NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'invalid_rating' USING ERRCODE='22023'; END IF;
  SELECT * INTO rl FROM public.touch_rate_limit('vendor_rate', uid::text, 20, 3600);
  IF NOT rl.allowed THEN RAISE EXCEPTION 'rate_limited' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.vendor_ratings (society_id, vendor_id, ticket_id, rater_id, rater_kind, rating, comment)
  VALUES (t.society_id, t.vendor_id, t.id, uid, 'resident', _rating, nullif(left(btrim(coalesce(_comment,'')),500),''))
  ON CONFLICT (ticket_id) DO NOTHING RETURNING id INTO rid;
  IF rid IS NULL THEN RAISE EXCEPTION 'already_rated' USING ERRCODE='22023'; END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'vendor.rated', 'vendor_ratings', rid::text, t.society_id, jsonb_build_object('vendor_id', t.vendor_id, 'ticket_id', t.id, 'rating', _rating));
  RETURN rid;
END $$;

-- Committee: rate a vendor's logged service visit (asset service history).
CREATE OR REPLACE FUNCTION public.admin_rate_vendor_service(_log uuid, _rating integer, _comment text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); l public.asset_service_log; rid uuid; rl record;
BEGIN
  SELECT * INTO l FROM public.asset_service_log WHERE id = _log;
  IF uid IS NULL OR l.id IS NULL OR l.society_id IS DISTINCT FROM public._caller_society() OR NOT public._helpdesk_is_admin(l.society_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF l.vendor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.finance_vendors v WHERE v.id = l.vendor_id AND v.society_id = l.society_id) THEN
    RAISE EXCEPTION 'no_vendor' USING ERRCODE='22023'; END IF;
  IF _rating IS NULL OR _rating NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'invalid_rating' USING ERRCODE='22023'; END IF;
  SELECT * INTO rl FROM public.touch_rate_limit('vendor_rate', uid::text, 20, 3600);
  IF NOT rl.allowed THEN RAISE EXCEPTION 'rate_limited' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.vendor_ratings (society_id, vendor_id, service_log_id, rater_id, rater_kind, rating, comment)
  VALUES (l.society_id, l.vendor_id, l.id, uid, 'committee', _rating, nullif(left(btrim(coalesce(_comment,'')),500),''))
  ON CONFLICT (service_log_id) DO NOTHING RETURNING id INTO rid;
  IF rid IS NULL THEN RAISE EXCEPTION 'already_rated' USING ERRCODE='22023'; END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'vendor.rated', 'vendor_ratings', rid::text, l.society_id, jsonb_build_object('vendor_id', l.vendor_id, 'service_log_id', l.id, 'rating', _rating));
  RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION public.admin_moderate_vendor_rating(_id uuid, _hide boolean, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); r public.vendor_ratings;
BEGIN
  SELECT * INTO r FROM public.vendor_ratings WHERE id = _id;
  IF uid IS NULL OR r.id IS NULL OR r.society_id IS DISTINCT FROM public._caller_society() OR NOT public._helpdesk_is_admin(r.society_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF char_length(btrim(coalesce(_reason,''))) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  UPDATE public.vendor_ratings SET status = CASE WHEN _hide THEN 'hidden' ELSE 'published' END,
    moderation_reason = left(btrim(_reason),300), moderated_by = uid, moderated_at = now() WHERE id = r.id;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, CASE WHEN _hide THEN 'vendor.rating_hidden' ELSE 'vendor.rating_restored' END, 'vendor_ratings', r.id::text, r.society_id,
          jsonb_build_object('vendor_id', r.vendor_id, 'reason', left(btrim(_reason),300)));
END $$;

-- Committee: per-vendor performance from canonical records. Score withheld below 3 ratings.
CREATE OR REPLACE FUNCTION public.vendor_performance()
RETURNS TABLE(vendor_id uuid, rating_count integer, avg_rating numeric, recent_count integer, recent_avg numeric,
              tickets_total integer, tickets_open integer, tickets_overdue integer, service_visits integer, last_service date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._caller_society();
BEGIN
  IF sid IS NULL OR NOT public._helpdesk_is_admin(sid) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  SELECT v.id,
    (SELECT count(*)::int FROM public.vendor_ratings r WHERE r.vendor_id = v.id AND r.status='published'),
    (SELECT CASE WHEN count(*) >= 3 THEN round(avg(r.rating)::numeric, 1) END FROM public.vendor_ratings r WHERE r.vendor_id = v.id AND r.status='published'),
    (SELECT count(*)::int FROM public.vendor_ratings r WHERE r.vendor_id = v.id AND r.status='published' AND r.created_at > now() - interval '90 days'),
    (SELECT CASE WHEN count(*) >= 3 THEN round(avg(r.rating)::numeric, 1) END FROM public.vendor_ratings r WHERE r.vendor_id = v.id AND r.status='published' AND r.created_at > now() - interval '90 days'),
    (SELECT count(*)::int FROM public.support_tickets t WHERE t.society_id = sid AND t.vendor_id = v.id),
    (SELECT count(*)::int FROM public.support_tickets t WHERE t.society_id = sid AND t.vendor_id = v.id AND t.status IN ('open','reopened','in_progress','on_hold')),
    (SELECT count(*)::int FROM public.support_tickets t WHERE t.society_id = sid AND t.vendor_id = v.id AND t.status IN ('open','reopened','in_progress','on_hold') AND t.sla_due_at < now()),
    (SELECT count(*)::int FROM public.asset_service_log l WHERE l.society_id = sid AND l.vendor_id = v.id),
    (SELECT max(l.service_date) FROM public.asset_service_log l WHERE l.society_id = sid AND l.vendor_id = v.id)
  FROM public.finance_vendors v WHERE v.society_id = sid;
END $$;

-- Committee: rating history for one vendor (no rater contact details; residents shown generically).
CREATE OR REPLACE FUNCTION public.vendor_rating_history(_vendor uuid)
RETURNS TABLE(id uuid, created_at timestamptz, rating smallint, comment text, status text, moderation_reason text,
              source text, ticket_no bigint, service_kind text, asset_name text, rater_label text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._caller_society();
BEGIN
  IF sid IS NULL OR NOT public._helpdesk_is_admin(sid) OR NOT EXISTS (SELECT 1 FROM public.finance_vendors v WHERE v.id = _vendor AND v.society_id = sid) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  SELECT r.id, r.created_at, r.rating, r.comment, r.status, r.moderation_reason,
    CASE WHEN r.ticket_id IS NOT NULL THEN 'request' ELSE 'service' END,
    t.ticket_no, l.kind, a.name,
    CASE WHEN r.rater_kind = 'resident' THEN 'Resident' ELSE 'Committee' END
  FROM public.vendor_ratings r
  LEFT JOIN public.support_tickets t ON t.id = r.ticket_id
  LEFT JOIN public.asset_service_log l ON l.id = r.service_log_id
  LEFT JOIN public.society_assets a ON a.id = l.asset_id
  WHERE r.society_id = sid AND r.vendor_id = _vendor
  ORDER BY r.created_at DESC LIMIT 200;
END $$;

CREATE OR REPLACE FUNCTION public.vendor_service_log_unrated(_vendor uuid)
RETURNS TABLE(id uuid, service_date date, kind text, asset_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._caller_society();
BEGIN
  IF sid IS NULL OR NOT public._helpdesk_is_admin(sid) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT l.id, l.service_date, l.kind, a.name FROM public.asset_service_log l
    JOIN public.society_assets a ON a.id = l.asset_id
    WHERE l.society_id = sid AND l.vendor_id = _vendor AND NOT EXISTS (SELECT 1 FROM public.vendor_ratings r WHERE r.service_log_id = l.id)
    ORDER BY l.service_date DESC LIMIT 50;
END $$;

-- Helpdesk report scope: committee = whole society; staff (staff.helpdesk) = tickets assigned to them. Others refused.
CREATE OR REPLACE FUNCTION public._helpdesk_report_scope(OUT society_id uuid, OUT staff_id uuid, OUT scope text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c record;
BEGIN
  society_id := public._caller_society();
  IF auth.uid() IS NULL OR society_id IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF public._helpdesk_is_admin(society_id) THEN scope := 'society'; RETURN; END IF;
  SELECT * INTO c FROM public._staff_ctx('staff.helpdesk');
  staff_id := c.staff_id; scope := 'staff';
END $$;

CREATE OR REPLACE FUNCTION public._helpdesk_report_tickets(_sid uuid, _staff_scope uuid, _from date, _to date, _status text, _priority text,
  _category text, _staff uuid, _vendor uuid, _asset uuid, _flag text)
RETURNS SETOF public.support_tickets LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.* FROM public.support_tickets t
  WHERE t.society_id = _sid
    AND (_staff_scope IS NULL OR t.staff_id = _staff_scope)
    AND (_from IS NULL OR t.created_at >= _from::timestamptz)
    AND (_to IS NULL OR t.created_at < (_to + 1)::timestamptz)
    AND (_status IS NULL OR t.status = _status)
    AND (_priority IS NULL OR t.priority = _priority)
    AND (_category IS NULL OR t.category = _category)
    AND (_staff IS NULL OR t.staff_id = _staff)
    AND (_vendor IS NULL OR t.vendor_id = _vendor)
    AND (_asset IS NULL OR t.asset_id = _asset)
    AND (_flag IS NULL
      OR (_flag = 'overdue' AND t.sla_due_at < now() AND t.status IN ('open','reopened','in_progress','on_hold'))
      OR (_flag = 'escalated' AND t.escalation_level > 0)
      OR (_flag = 'on_hold' AND t.status = 'on_hold')
      OR (_flag = 'reopened' AND t.reopened_count > 0))
$$;
REVOKE ALL ON FUNCTION public._helpdesk_report_tickets(uuid,uuid,date,date,text,text,text,uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.helpdesk_report(_from date DEFAULT NULL, _to date DEFAULT NULL, _status text DEFAULT NULL,
  _priority text DEFAULT NULL, _category text DEFAULT NULL, _staff uuid DEFAULT NULL, _vendor uuid DEFAULT NULL,
  _asset uuid DEFAULT NULL, _flag text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; rl record; res jsonb;
BEGIN
  SELECT * INTO s FROM public._helpdesk_report_scope();
  IF _to IS NOT NULL AND _from IS NOT NULL AND _to < _from THEN RAISE EXCEPTION 'invalid_dates' USING ERRCODE='22023'; END IF;
  SELECT * INTO rl FROM public.touch_rate_limit('helpdesk_report', auth.uid()::text, 120, 600);
  IF NOT rl.allowed THEN RAISE EXCEPTION 'rate_limited' USING ERRCODE='P0001'; END IF;
  WITH t AS (SELECT * FROM public._helpdesk_report_tickets(s.society_id, s.staff_id, _from, _to, _status, _priority, _category, _staff, _vendor, _asset, _flag)),
  done AS (SELECT * FROM t WHERE resolved_at IS NOT NULL)
  SELECT jsonb_build_object(
    'scope', s.scope,
    'total', (SELECT count(*) FROM t),
    'open', (SELECT count(*) FROM t WHERE status IN ('open','reopened','in_progress','on_hold')),
    'resolved', (SELECT count(*) FROM t WHERE status IN ('resolved','closed')),
    'overdue', (SELECT count(*) FROM t WHERE sla_due_at < now() AND status IN ('open','reopened','in_progress','on_hold')),
    'escalated', (SELECT count(*) FROM t WHERE escalation_level > 0),
    'on_hold', (SELECT count(*) FROM t WHERE status = 'on_hold'),
    'reopened', (SELECT count(*) FROM t WHERE reopened_count > 0),
    'follow_ups', (SELECT count(*) FROM t WHERE parent_ticket_id IS NOT NULL),
    'avg_resolution_hours', (SELECT round((avg(extract(epoch FROM resolved_at - created_at)) / 3600)::numeric, 1) FROM done),
    'sla_met', (SELECT count(*) FROM done WHERE sla_due_at IS NOT NULL AND resolved_at <= sla_due_at),
    'sla_breached', (SELECT count(*) FROM done WHERE sla_due_at IS NOT NULL AND resolved_at > sla_due_at)
                  + (SELECT count(*) FROM t WHERE resolved_at IS NULL AND sla_due_at < now() AND status IN ('open','reopened','in_progress','on_hold')),
    'rating_count', (SELECT count(*) FROM public.ticket_ratings r JOIN t ON t.id = r.ticket_id),
    'rating_avg', (SELECT round(avg(r.rating)::numeric, 1) FROM public.ticket_ratings r JOIN t ON t.id = r.ticket_id),
    'by_status', (SELECT coalesce(jsonb_object_agg(status, n), '{}') FROM (SELECT status, count(*) n FROM t GROUP BY 1) x),
    'by_priority', (SELECT coalesce(jsonb_object_agg(priority, n), '{}') FROM (SELECT coalesce(priority,'none') priority, count(*) n FROM t GROUP BY 1) x),
    'by_category', (SELECT coalesce(jsonb_object_agg(category, n), '{}') FROM (SELECT coalesce(category,'other') category, count(*) n FROM t GROUP BY 1) x),
    'by_staff', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.staff_id, 'name', coalesce(st.full_name,'Unassigned'), 'count', x.n, 'open', x.o) ORDER BY x.n DESC), '[]')
                 FROM (SELECT staff_id, count(*) n, count(*) FILTER (WHERE status IN ('open','reopened','in_progress','on_hold')) o FROM t GROUP BY 1) x
                 LEFT JOIN public.society_staff st ON st.id = x.staff_id AND st.society_id = s.society_id),
    'by_vendor', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.vendor_id, 'name', v.name, 'count', x.n, 'open', x.o) ORDER BY x.n DESC), '[]')
                 FROM (SELECT vendor_id, count(*) n, count(*) FILTER (WHERE status IN ('open','reopened','in_progress','on_hold')) o FROM t WHERE vendor_id IS NOT NULL GROUP BY 1) x
                 JOIN public.finance_vendors v ON v.id = x.vendor_id AND v.society_id = s.society_id),
    'problem_assets', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.asset_id, 'name', a.name, 'location', a.location, 'count', x.n) ORDER BY x.n DESC), '[]')
                 FROM (SELECT asset_id, count(*) n FROM t WHERE asset_id IS NOT NULL GROUP BY 1 HAVING count(*) >= 2) x
                 JOIN public.society_assets a ON a.id = x.asset_id AND a.society_id = s.society_id),
    'by_month', (SELECT coalesce(jsonb_agg(jsonb_build_object('month', m, 'created', c, 'resolved', r) ORDER BY m), '[]')
                 FROM (SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') m, count(*) c, count(*) FILTER (WHERE status IN ('resolved','closed')) r FROM t GROUP BY 1) x)
  ) INTO res;
  RETURN res;
END $$;

CREATE OR REPLACE FUNCTION public.helpdesk_report_rows(_from date DEFAULT NULL, _to date DEFAULT NULL, _status text DEFAULT NULL,
  _priority text DEFAULT NULL, _category text DEFAULT NULL, _staff uuid DEFAULT NULL, _vendor uuid DEFAULT NULL,
  _asset uuid DEFAULT NULL, _flag text DEFAULT NULL)
RETURNS TABLE(ticket_no bigint, created_at timestamptz, subject text, category text, priority text, status text,
  staff_name text, vendor_name text, asset_name text, sla_due_at timestamptz, resolved_at timestamptz, overdue boolean,
  escalation_level smallint, reopened_count smallint, rating smallint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; rl record; n int;
BEGIN
  SELECT * INTO s FROM public._helpdesk_report_scope();
  SELECT * INTO rl FROM public.touch_rate_limit('helpdesk_export', auth.uid()::text, 10, 600);
  IF NOT rl.allowed THEN RAISE EXCEPTION 'rate_limited' USING ERRCODE='P0001'; END IF;
  SELECT count(*) INTO n FROM public._helpdesk_report_tickets(s.society_id, s.staff_id, _from, _to, _status, _priority, _category, _staff, _vendor, _asset, _flag);
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'helpdesk.report_exported', 'support_tickets', NULL, s.society_id,
    jsonb_build_object('scope', s.scope, 'rows', least(n, 5000), 'from', _from, 'to', _to, 'status', _status, 'priority', _priority,
      'category', _category, 'staff', _staff, 'vendor', _vendor, 'asset', _asset, 'flag', _flag));
  RETURN QUERY
  SELECT t.ticket_no, t.created_at, t.subject, t.category, t.priority, t.status, st.full_name, v.name, a.name,
    t.sla_due_at, t.resolved_at, (t.sla_due_at < now() AND t.status IN ('open','reopened','in_progress','on_hold')),
    t.escalation_level, t.reopened_count, r.rating
  FROM public._helpdesk_report_tickets(s.society_id, s.staff_id, _from, _to, _status, _priority, _category, _staff, _vendor, _asset, _flag) t
  LEFT JOIN public.society_staff st ON st.id = t.staff_id AND st.society_id = s.society_id
  LEFT JOIN public.finance_vendors v ON v.id = t.vendor_id AND v.society_id = s.society_id
  LEFT JOIN public.society_assets a ON a.id = t.asset_id AND a.society_id = s.society_id
  LEFT JOIN public.ticket_ratings r ON r.ticket_id = t.id
  ORDER BY t.created_at DESC LIMIT 5000;
END $$;

-- Reconciliation: add due-servicing reminders (scheduled maintenance due tomorrow or overdue), deduped per task/day.
CREATE OR REPLACE FUNCTION public.ops_daily_reminders()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r record; k text;
BEGIN
  FOR r IN SELECT t.id, t.society_id, t.ticket_no, t.subject, t.assigned_to FROM public.support_tickets t
    WHERE t.sla_due_at < now() AND t.status IN ('open','reopened','in_progress','on_hold') LOOP
    INSERT INTO public.ops_reminders_sent VALUES ('sla_overdue', r.id, current_date) ON CONFLICT DO NOTHING;
    k := 'sla_overdue:' || r.id || ':' || current_date;
    PERFORM public._notify_society_admins_once(r.society_id, 'helpdesk', 'Request #'||r.ticket_no||' is overdue', r.subject, '/society/helpdesk', k, 'high');
    IF r.assigned_to IS NOT NULL THEN PERFORM public._notify_user_once(r.assigned_to, r.society_id, 'helpdesk', 'Request #'||r.ticket_no||' is overdue', r.subject, '/society/helpdesk', k, 'high'); END IF;
  END LOOP;
  FOR r IN SELECT a.id, a.society_id, a.name, least(a.warranty_until, a.amc_until) d FROM public.society_assets a
    WHERE a.status <> 'retired' AND least(coalesce(a.warranty_until,'infinity'), coalesce(a.amc_until,'infinity')) BETWEEN current_date AND current_date + 30 LOOP
    INSERT INTO public.ops_reminders_sent VALUES ('asset_expiry', r.id, coalesce(r.d, current_date)) ON CONFLICT DO NOTHING;
    PERFORM public._notify_society_admins_once(r.society_id, 'operations', 'Warranty/AMC ending soon', r.name, '/society/operations', 'asset_expiry:'||r.id||':'||coalesce(r.d, current_date));
  END LOOP;
  FOR r IN SELECT v.id, v.society_id, v.name, v.contract_end FROM public.finance_vendors v
    WHERE v.is_active AND v.contract_type <> 'none' AND v.contract_end BETWEEN current_date AND current_date + 30 LOOP
    INSERT INTO public.ops_reminders_sent VALUES ('vendor_contract', r.id, r.contract_end) ON CONFLICT DO NOTHING;
    PERFORM public._notify_society_admins_once(r.society_id, 'operations', 'Vendor contract ending soon', r.name, '/society/operations', 'vendor_contract:'||r.id||':'||r.contract_end);
  END LOOP;
  FOR r IN SELECT i.id, i.society_id, i.name FROM public.inventory_items i WHERE i.is_active AND i.reorder_level > 0 AND i.quantity <= i.reorder_level LOOP
    INSERT INTO public.ops_reminders_sent VALUES ('low_stock', r.id, date_trunc('week', current_date)::date) ON CONFLICT DO NOTHING;
    PERFORM public._notify_society_admins_once(r.society_id, 'operations', 'Low stock', r.name, '/society/operations', 'low_stock:'||r.id||':'||date_trunc('week', current_date)::date);
  END LOOP;
  FOR r IN SELECT m.id, m.society_id, m.title, m.due_on, st.user_id FROM public.maintenance_tasks m
    LEFT JOIN public.society_staff st ON st.id = m.staff_id AND st.is_active
    WHERE m.status IN ('scheduled','paused','in_progress') AND m.due_on <= current_date + 1 LOOP
    k := 'maint_due:' || r.id || ':' || current_date;
    PERFORM public._notify_society_admins_once(r.society_id, 'operations', CASE WHEN r.due_on < current_date THEN 'Servicing overdue' ELSE 'Servicing due' END, r.title, '/society/operations', k);
    IF r.user_id IS NOT NULL THEN PERFORM public._notify_user_once(r.user_id, r.society_id, 'operations', CASE WHEN r.due_on < current_date THEN 'Servicing overdue' ELSE 'Servicing due' END, r.title, '/staff', k, 'normal'); END IF;
  END LOOP;
END $function$;