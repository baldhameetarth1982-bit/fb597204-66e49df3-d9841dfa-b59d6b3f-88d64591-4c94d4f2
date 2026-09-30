-- 1. Run-log: distinguish skipped and recovered runs; retention
ALTER TABLE public.scheduler_job_runs
  ADD COLUMN IF NOT EXISTS skip_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_skipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS recovered_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.scheduler_run_begin(_job text, _run_key text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.scheduler_job_runs; v uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('sched:' || _job || ':' || _run_key));
  SELECT * INTO r FROM public.scheduler_job_runs WHERE job = _job AND run_key = _run_key FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.scheduler_job_runs(job, run_key) VALUES (_job, _run_key) RETURNING id INTO v;
    RETURN v;
  END IF;
  IF r.status = 'succeeded' OR (r.status = 'running' AND r.started_at > now() - interval '30 minutes') THEN
    UPDATE public.scheduler_job_runs SET skip_count = skip_count + 1, last_skipped_at = now() WHERE id = r.id;
    RETURN NULL;
  END IF;
  UPDATE public.scheduler_job_runs SET status='running', started_at=now(), finished_at=NULL,
    attempts = attempts + 1, error = NULL,
    recovered_count = recovered_count + CASE WHEN r.status = 'running' THEN 1 ELSE 0 END
  WHERE id = r.id;
  RETURN r.id;
END $$;

CREATE OR REPLACE FUNCTION public.scheduler_prune_runs()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int;
BEGIN
  DELETE FROM public.scheduler_job_runs WHERE started_at < now() - interval '90 days' AND status <> 'running';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.scheduler_prune_runs() FROM PUBLIC, anon, authenticated;

-- 2. De-duplicating fan-out helpers (reuse _notify_user_once)
CREATE OR REPLACE FUNCTION public._notify_society_admins_once(_sid uuid, _kind text, _title text, _body text, _link text, _key text, _priority text DEFAULT 'normal')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE u uuid; n int := 0;
BEGIN
  FOR u IN SELECT DISTINCT r.user_id FROM public.user_roles r WHERE r.society_id=_sid AND r.role='society_admin' AND coalesce(r.is_active,true) AND r.user_id IS NOT NULL LOOP
    IF public._notify_user_once(u, _sid, _kind, _title, _body, _link, _key, _priority) THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public._notify_flat_once(_sid uuid, _flat uuid, _kind text, _title text, _body text, _link text, _key text, _priority text DEFAULT 'normal')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE u uuid; n int := 0;
BEGIN
  FOR u IN SELECT DISTINCT fr.user_id FROM public.flat_residents fr WHERE fr.flat_id=_flat AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL AND fr.user_id IS NOT NULL LOOP
    IF public._notify_user_once(u, _sid, _kind, _title, _body, _link, _key, _priority) THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public._notify_gate_staff_once(_sid uuid, _kind text, _title text, _body text, _link text, _key text, _priority text DEFAULT 'normal')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE u uuid; n int := 0;
BEGIN
  FOR u IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.society_id=_sid AND ur.is_active IS NOT FALSE AND ur.user_id IS NOT NULL
      AND ur.role IN ('society_admin','block_admin','security') LOOP
    IF public._notify_user_once(u, _sid, _kind, _title, _body, _link, _key, _priority) THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public._notify_society_admins_once(uuid,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._notify_flat_once(uuid,uuid,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._notify_gate_staff_once(uuid,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._notify_user_once(uuid,uuid,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;

-- 3. Existing reminder senders moved onto the no-duplicate pipeline (same audience/timing, stable event keys)
CREATE OR REPLACE FUNCTION public.ops_daily_reminders()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
END $$;

CREATE OR REPLACE FUNCTION public.send_meeting_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE m public.meetings; u uuid; total int := 0;
BEGIN
  FOR m IN
    UPDATE public.meetings SET reminded_at = now()
    WHERE id IN (SELECT id FROM public.meetings WHERE status = 'scheduled' AND reminded_at IS NULL
                   AND starts_at BETWEEN now() AND now() + interval '24 hours' LIMIT 200 FOR UPDATE SKIP LOCKED)
    RETURNING *
  LOOP
    FOR u IN SELECT a.user_id FROM public._meeting_audience(m) a LOOP
      PERFORM public._notify_user_once(u, m.society_id, 'meeting', 'Reminder: ' || left(m.title, 100),
        to_char(m.starts_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM'), '/app/meetings',
        'meeting_reminder:' || m.id || ':' || extract(epoch from m.starts_at)::bigint);
    END LOOP;
    total := total + 1;
  END LOOP;
  RETURN total;
END $$;

CREATE OR REPLACE FUNCTION public.send_tenancy_renewal_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; v_count integer := 0; a record; k text;
BEGIN
  IF current_user NOT IN ('postgres','service_role','supabase_admin') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  FOR r IN
    WITH due AS (
      SELECT fr.id,fr.user_id,fr.flat_id,fr.lease_ends_on,f.society_id,f.flat_number
      FROM public.flat_residents fr JOIN public.flats f ON f.id=fr.flat_id
      LEFT JOIN public.society_settings ss ON ss.society_id=f.society_id
      WHERE fr.relationship='tenant' AND fr.is_active AND fr.moved_out_at IS NULL AND fr.archived_at IS NULL
        AND fr.notice_given_on IS NULL AND fr.lease_ends_on IS NOT NULL
        AND fr.lease_ends_on BETWEEN current_date AND current_date + coalesce(ss.tenancy_warning_days,30)
    ), ins AS (
      INSERT INTO public.tenancy_reminders_sent(flat_resident_id,window_key)
      SELECT id,lease_ends_on::text FROM due ON CONFLICT DO NOTHING RETURNING flat_resident_id
    ) SELECT d.* FROM due d JOIN ins ON ins.flat_resident_id=d.id
  LOOP
    k := 'tenancy_expiring:' || r.id || ':' || r.lease_ends_on;
    IF r.user_id IS NOT NULL THEN
      PERFORM public._notify_user_once(r.user_id,r.society_id,'tenancy_expiring','Your lease ends soon',
        'Your lease for flat '||r.flat_number||' ends on '||to_char(r.lease_ends_on,'DD Mon YYYY')||'. Please contact your society office about renewal.',NULL,k,'high');
    END IF;
    FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.society_id=r.society_id AND ur.is_active AND ur.role='society_admin'::public.app_role LOOP
      PERFORM public._notify_user_once(a.user_id,r.society_id,'tenancy_expiring','Lease ending soon',
        'Tenancy for flat '||r.flat_number||' ends on '||to_char(r.lease_ends_on,'DD Mon YYYY')||'.','/society/flats/'||r.flat_id,k);
    END LOOP;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END; $$;

CREATE OR REPLACE FUNCTION public.mark_visitor_overstays()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; n int := 0; k text;
BEGIN
  FOR r IN SELECT id, society_id, flat_id, visitor_name FROM public.visitors
    WHERE status='inside' AND overstay_notified_at IS NULL
      AND entry_at + make_interval(mins => public.visitor_allowed_minutes(category)) < now()
    ORDER BY entry_at LIMIT 500 FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.visitors SET overstay_notified_at=now() WHERE id=r.id;
    k := 'visitor_overstay:' || r.id;
    IF r.flat_id IS NOT NULL THEN PERFORM public._notify_flat_once(r.society_id, r.flat_id, 'visitor_overstay', 'Visitor still inside', r.visitor_name || ' is past the usual time', '/app/visitors', k); END IF;
    PERFORM public._notify_gate_staff_once(r.society_id, 'visitor_overstay', 'Overstay at gate', r.visitor_name || ' has not checked out', '/app/guard', k, 'high');
    INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (NULL, 'visitor.overstay_flagged', 'visitors', r.id::text, r.society_id, '{}'::jsonb);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.publish_due_notices()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n public.notices; u uuid; c int; total int := 0; urgent boolean;
BEGIN
  FOR n IN
    UPDATE public.notices SET notified_at = now()
    WHERE id IN (SELECT id FROM public.notices WHERE status = 'published' AND notified_at IS NULL
                   AND coalesce(publish_at, published_at) <= now() AND coalesce(publish_at, published_at) > now() - interval '7 days'
                   AND (expires_at IS NULL OR expires_at > now()) LIMIT 200 FOR UPDATE SKIP LOCKED)
    RETURNING *
  LOOP
    c := 0;
    urgent := n.priority = 'urgent' OR n.category = 'emergency';
    FOR u IN SELECT a.user_id FROM public._notice_audience(n) a LOOP
      PERFORM public._notify_user_once(u, n.society_id, 'notice',
        CASE WHEN urgent THEN 'Urgent notice: ' ELSE 'New notice: ' END || left(n.title, 100),
        CASE WHEN n.requires_ack THEN 'Please read and acknowledge.' ELSE left(n.body, 140) END, '/app/notices',
        'notice_published:' || n.id, CASE WHEN urgent THEN 'urgent' WHEN n.requires_ack THEN 'high' ELSE 'normal' END);
      c := c + 1;
    END LOOP;
    UPDATE public.notices SET notified_count = c WHERE id = n.id;
    total := total + 1;
  END LOOP;
  RETURN total;
END $$;

-- 4. Logged wrapper for in-database scheduled jobs (whitelisted, no dynamic SQL)
CREATE OR REPLACE FUNCTION public.run_logged_db_job(_job text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE run uuid; k text; n int := 0; daily boolean;
BEGIN
  IF current_user NOT IN ('postgres','supabase_admin','service_role') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  daily := _job IN ('tenancy-expiry','tenancy-renewal-reminders','ops-daily-reminders');
  IF _job NOT IN ('tenancy-expiry','tenancy-renewal-reminders','ops-daily-reminders','amenity-waitlist-expiry','visitor-overstays','notice-publishing','meeting-reminders','vote-closing') THEN
    RAISE EXCEPTION 'unknown_job';
  END IF;
  k := CASE WHEN daily THEN to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD') ELSE to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24') END;
  run := public.scheduler_run_begin(_job, k);
  IF run IS NULL THEN RETURN 'skipped'; END IF;
  BEGIN
    CASE _job
      WHEN 'tenancy-expiry' THEN n := public.expire_stale_tenancies(); PERFORM public.scheduler_prune_runs();
      WHEN 'tenancy-renewal-reminders' THEN n := public.send_tenancy_renewal_reminders();
      WHEN 'ops-daily-reminders' THEN PERFORM public.ops_daily_reminders();
      WHEN 'amenity-waitlist-expiry' THEN n := public.expire_stale_amenity_waitlist();
      WHEN 'visitor-overstays' THEN n := public.mark_visitor_overstays();
      WHEN 'notice-publishing' THEN n := public.publish_due_notices();
      WHEN 'meeting-reminders' THEN n := public.send_meeting_reminders();
      WHEN 'vote-closing' THEN n := public.close_expired_votes();
    END CASE;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.scheduler_run_finish(run, 'failed', 0, 1, left(SQLSTATE || ' ' || SQLERRM, 300));
    RETURN 'failed';
  END;
  PERFORM public.scheduler_run_finish(run, 'succeeded', coalesce(n,0), 0, NULL);
  RETURN 'succeeded';
END $$;
REVOKE ALL ON FUNCTION public.run_logged_db_job(text) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid, jobname FROM cron.job WHERE jobname IN ('expire-stale-tenancies-daily','ops-daily-reminders','expire-stale-amenity-waitlist-hourly') LOOP
    PERFORM cron.alter_job(j.jobid, command := CASE j.jobname
      WHEN 'expire-stale-tenancies-daily' THEN $c$SELECT public.run_logged_db_job('tenancy-expiry'); SELECT public.run_logged_db_job('tenancy-renewal-reminders');$c$
      WHEN 'ops-daily-reminders' THEN $c$SELECT public.run_logged_db_job('ops-daily-reminders');$c$
      ELSE $c$SELECT public.run_logged_db_job('amenity-waitlist-expiry'); SELECT public.run_logged_db_job('visitor-overstays'); SELECT public.run_logged_db_job('notice-publishing'); SELECT public.run_logged_db_job('meeting-reminders'); SELECT public.run_logged_db_job('vote-closing');$c$
    END);
  END LOOP;
END $$;

-- 5. Priority is server-authoritative: users may only change read_at on their own notifications
CREATE OR REPLACE FUNCTION public._user_notifications_read_only_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF current_user IN ('authenticated','anon') AND (
    NEW.priority IS DISTINCT FROM OLD.priority OR NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body
    OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.link IS DISTINCT FROM OLD.link OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
    OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.society_id IS DISTINCT FROM OLD.society_id OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
    RAISE EXCEPTION 'only_read_state_can_change' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_user_notifications_read_only ON public.user_notifications;
CREATE TRIGGER trg_user_notifications_read_only BEFORE UPDATE ON public.user_notifications
  FOR EACH ROW EXECUTE FUNCTION public._user_notifications_read_only_guard();

-- 6. Guard attention counts (security role only; counts only, no personal/financial data)
CREATE OR REPLACE FUNCTION public._guard_attention_counts()
RETURNS TABLE(sos int, incidents int, overstay int, restricted int, pending int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s uuid;
BEGIN
  SELECT ur.society_id INTO s FROM public.user_roles ur
   WHERE ur.user_id = auth.uid() AND ur.role = 'security' AND ur.is_active IS NOT FALSE AND ur.society_id IS NOT NULL
   ORDER BY ur.created_at LIMIT 1;
  IF s IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT
    (SELECT count(*)::int FROM public.sos_alerts a WHERE a.society_id = s AND a.status <> 'resolved'),
    (SELECT count(*)::int FROM public.security_incidents i WHERE i.society_id = s AND i.status = 'open'),
    (SELECT count(*)::int FROM public.visitors v WHERE v.society_id = s AND v.exit_at IS NULL AND v.status IN ('inside','overstayed')
       AND v.entry_at + make_interval(mins => public.visitor_allowed_minutes(v.category)) < now()),
    (SELECT count(*)::int FROM public.visitors v WHERE v.society_id = s AND v.exit_at IS NULL AND v.restriction_id IS NOT NULL
       AND v.status IN ('pending','inside','overstayed') AND v.created_at > now() - interval '24 hours'),
    (SELECT count(*)::int FROM public.visitors v WHERE v.society_id = s AND v.exit_at IS NULL AND v.status = 'pending'
       AND (v.valid_until IS NULL OR v.valid_until > now()) AND v.created_at > now() - interval '24 hours');
END $$;
REVOKE ALL ON FUNCTION public._guard_attention_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._guard_attention_counts() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_needs_attention()
RETURNS TABLE(key text, priority integer, reason text, item_count integer, link text)
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
#variable_conflict use_column
DECLARE uid uuid := auth.uid(); s uuid; is_admin boolean; can_fin boolean; can_res boolean; n int; g record;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT p.society_id INTO s FROM public.profiles p WHERE p.id = uid;
  IF s IS NULL THEN RETURN; END IF;
  is_admin := public.is_society_admin_for(s);
  can_fin := is_admin AND public.current_user_has_society_permission(s, 'billing.manage'::text, NULL::uuid);
  can_res := is_admin AND public.current_user_has_society_permission(s, 'residents.manage'::text, NULL::uuid);

  IF is_admin THEN
    SELECT count(*) INTO n FROM public.sos_alerts WHERE society_id = s AND status <> 'resolved';
    IF n > 0 THEN key:='sos_open'; priority:=1; reason:=n||' emergency alert(s) not resolved'; item_count:=n; link:='/society/visitors'; RETURN NEXT; END IF;
    SELECT count(*) INTO n FROM public.security_incidents WHERE society_id = s AND status = 'open';
    IF n > 0 THEN key:='incidents_open'; priority:=2; reason:=n||' security incident(s) open'; item_count:=n; link:='/society/visitors'; RETURN NEXT; END IF;
    SELECT count(*) INTO n FROM public.support_tickets WHERE society_id = s AND status NOT IN ('resolved','closed','cancelled')
      AND (sla_due_at < now() OR coalesce(escalation_level,0) > 0);
    IF n > 0 THEN key:='tickets_overdue'; priority:=2; reason:=n||' helpdesk request(s) overdue or escalated'; item_count:=n; link:='/society/helpdesk'; RETURN NEXT; END IF;
    IF can_res THEN
      SELECT count(*) INTO n FROM public.join_requests WHERE society_id = s AND status = 'pending';
      IF n > 0 THEN key:='join_pending'; priority:=3; reason:=n||' join request(s) waiting'; item_count:=n; link:='/society/approvals'; RETURN NEXT; END IF;
      SELECT count(*) INTO n FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
        WHERE f.society_id = s AND fr.is_active AND fr.lease_ends_on BETWEEN current_date AND current_date + 30;
      IF n > 0 THEN key:='tenancy_expiring'; priority:=4; reason:=n||' tenancy(ies) end within 30 days'; item_count:=n; link:='/society/flats'; RETURN NEXT; END IF;
      SELECT count(*) INTO n FROM public.privacy_requests WHERE society_id = s AND status IN ('pending','under_review');
      IF n > 0 THEN key:='privacy_pending'; priority:=3; reason:=n||' privacy request(s) to review'; item_count:=n; link:='/society/privacy-requests'; RETURN NEXT; END IF;
    END IF;
    IF can_fin THEN
      SELECT count(*) INTO n FROM public.payments WHERE society_id = s AND status = 'pending';
      IF n > 0 THEN key:='payments_verify'; priority:=2; reason:=n||' payment(s) waiting for verification'; item_count:=n; link:='/society/payments'; RETURN NEXT; END IF;
      SELECT count(*) INTO n FROM public.bill_run_approvals WHERE society_id = s AND status = 'requested' AND requested_by <> uid;
      IF n > 0 THEN key:='billrun_approval'; priority:=2; reason:=n||' bill run(s) need your approval'; item_count:=n; link:='/society/bill-studio/generate'; RETURN NEXT; END IF;
      SELECT count(*) INTO n FROM public.bills WHERE society_id = s AND status = 'unpaid' AND due_date < current_date AND cancelled_at IS NULL;
      IF n > 0 THEN key:='bills_overdue'; priority:=3; reason:=n||' bill(s) past due date'; item_count:=n; link:='/society/defaulters'; RETURN NEXT; END IF;
      SELECT count(*) INTO n FROM public.opening_balances WHERE society_id = s AND status = 'imported_unverified';
      IF n > 0 THEN key:='opening_unverified'; priority:=4; reason:=n||' imported old due(s) to review'; item_count:=n; link:='/society/opening-balances'; RETURN NEXT; END IF;
      SELECT count(*) INTO n FROM public.procurement_requests WHERE society_id = s AND status IN ('awaiting_approval','invoice_received');
      IF n > 0 THEN key:='procurement_action'; priority:=4; reason:=n||' purchase(s) awaiting action'; item_count:=n; link:='/society/operations'; RETURN NEXT; END IF;
      SELECT count(*) INTO n FROM public.migration_jobs WHERE society_id = s AND status IN ('ready','failed') AND coalesce(error_rows,0) > 0;
      IF n > 0 THEN key:='migration_conflicts'; priority:=5; reason:=n||' import(s) have rows needing fixes'; item_count:=n; link:='/society/import'; RETURN NEXT; END IF;
    END IF;
    SELECT count(*) INTO n FROM public.society_assets WHERE society_id = s AND status <> 'retired'
      AND least(coalesce(amc_until,'infinity'::date), coalesce(warranty_until,'infinity'::date)) BETWEEN current_date AND current_date + 30;
    IF n > 0 THEN key:='amc_expiring'; priority:=5; reason:=n||' asset AMC/warranty(ies) end within 30 days'; item_count:=n; link:='/society/operations'; RETURN NEXT; END IF;
    SELECT count(*) INTO n FROM public.finance_vendors WHERE society_id = s AND is_active AND contract_end BETWEEN current_date AND current_date + 30;
    IF n > 0 THEN key:='contracts_expiring'; priority:=5; reason:=n||' vendor contract(s) end within 30 days'; item_count:=n; link:='/society/operations'; RETURN NEXT; END IF;
    SELECT count(*) INTO n FROM public.inventory_items WHERE society_id = s AND is_active AND reorder_level IS NOT NULL AND quantity <= reorder_level;
    IF n > 0 THEN key:='inventory_low'; priority:=5; reason:=n||' stock item(s) at or below reorder level'; item_count:=n; link:='/society/operations'; RETURN NEXT; END IF;
  ELSE
    SELECT * INTO g FROM public._guard_attention_counts();
    IF FOUND THEN
      IF g.sos > 0 THEN key:='guard_sos'; priority:=1; reason:=g.sos||' emergency alert(s) active'; item_count:=g.sos; link:='/app/guard'; RETURN NEXT; END IF;
      IF g.restricted > 0 THEN key:='guard_restricted'; priority:=1; reason:=g.restricted||' restricted-list visitor alert(s)'; item_count:=g.restricted; link:='/app/guard'; RETURN NEXT; END IF;
      IF g.incidents > 0 THEN key:='guard_incidents'; priority:=2; reason:=g.incidents||' security incident(s) open'; item_count:=g.incidents; link:='/app/guard'; RETURN NEXT; END IF;
      IF g.overstay > 0 THEN key:='guard_overstay'; priority:=2; reason:=g.overstay||' visitor(s) past allowed time'; item_count:=g.overstay; link:='/app/guard'; RETURN NEXT; END IF;
      IF g.pending > 0 THEN key:='guard_pending'; priority:=3; reason:=g.pending||' visitor(s) waiting for approval'; item_count:=g.pending; link:='/app/guard'; RETURN NEXT; END IF;
    END IF;
    SELECT count(*) INTO n FROM public.bills bl WHERE bl.society_id = s AND bl.status = 'unpaid' AND bl.due_date < current_date
      AND bl.cancelled_at IS NULL AND EXISTS (SELECT 1 FROM public.flat_residents fr WHERE fr.flat_id = bl.flat_id AND fr.user_id = uid AND fr.is_active);
    IF n > 0 THEN key:='my_bills_overdue'; priority:=2; reason:=n||' bill(s) past due date'; item_count:=n; link:='/app/bills'; RETURN NEXT; END IF;
    SELECT count(*) INTO n FROM public.flat_residents fr WHERE fr.user_id = uid AND fr.is_active
      AND fr.lease_ends_on BETWEEN current_date AND current_date + 30;
    IF n > 0 THEN key:='my_lease_ending'; priority:=3; reason:='Your tenancy ends within 30 days'; item_count:=n; link:='/app/dashboard'; RETURN NEXT; END IF;
    SELECT count(*) INTO n FROM public.notices nt WHERE nt.society_id = s AND nt.status = 'published' AND nt.requires_ack
      AND (nt.expires_at IS NULL OR nt.expires_at > now())
      AND NOT EXISTS (SELECT 1 FROM public.notice_acks a WHERE a.notice_id = nt.id AND a.user_id = uid);
    IF n > 0 THEN key:='my_notice_ack'; priority:=3; reason:=n||' notice(s) need your acknowledgement'; item_count:=n; link:='/app/notices'; RETURN NEXT; END IF;
  END IF;
END $function$;