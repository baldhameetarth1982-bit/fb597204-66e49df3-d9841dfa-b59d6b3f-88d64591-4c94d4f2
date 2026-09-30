CREATE TABLE public.scheduler_job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job text NOT NULL CHECK (job ~ '^[a-z0-9_.-]{2,60}$'),
  run_key text NOT NULL CHECK (char_length(run_key) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed','partial')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  attempts int NOT NULL DEFAULT 1,
  processed int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  error text CHECK (error IS NULL OR char_length(error) <= 300),
  UNIQUE (job, run_key)
);
GRANT SELECT ON public.scheduler_job_runs TO authenticated;
GRANT ALL ON public.scheduler_job_runs TO service_role;
ALTER TABLE public.scheduler_job_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins read job runs" ON public.scheduler_job_runs FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));
CREATE INDEX scheduler_job_runs_recent ON public.scheduler_job_runs (started_at DESC);

CREATE OR REPLACE FUNCTION public.scheduler_run_begin(_job text, _run_key text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.scheduler_job_runs; v uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('sched:' || _job || ':' || _run_key));
  SELECT * INTO r FROM public.scheduler_job_runs WHERE job = _job AND run_key = _run_key FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.scheduler_job_runs(job, run_key) VALUES (_job, _run_key) RETURNING id INTO v;
    RETURN v;
  END IF;
  IF r.status = 'succeeded' THEN RETURN NULL; END IF;
  IF r.status = 'running' AND r.started_at > now() - interval '30 minutes' THEN RETURN NULL; END IF;
  UPDATE public.scheduler_job_runs SET status='running', started_at=now(), finished_at=NULL,
    attempts = attempts + 1, error = NULL WHERE id = r.id;
  RETURN r.id;
END $$;

CREATE OR REPLACE FUNCTION public.scheduler_run_finish(_id uuid, _status text, _processed int, _failed int, _error text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.scheduler_job_runs SET status = _status, finished_at = now(),
    processed = greatest(coalesce(_processed,0),0), failed = greatest(coalesce(_failed,0),0),
    error = left(_error, 300)
  WHERE id = _id AND status = 'running';
$$;
REVOKE ALL ON FUNCTION public.scheduler_run_begin(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scheduler_run_finish(uuid,text,int,int,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scheduler_run_begin(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.scheduler_run_finish(uuid,text,int,int,text) TO service_role;

ALTER TABLE public.user_notifications
  ADD COLUMN priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  ADD COLUMN dedupe_key text CHECK (dedupe_key IS NULL OR char_length(dedupe_key) <= 160);
CREATE UNIQUE INDEX user_notifications_dedupe ON public.user_notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public._notify_user_once(_user uuid, _society uuid, _kind text, _title text, _body text,
  _link text, _dedupe_key text, _priority text DEFAULT 'normal')
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF _link IS NOT NULL AND _link !~ '^/[A-Za-z0-9/_\-?=&.%]*$' THEN _link := NULL; END IF;
  INSERT INTO public.user_notifications (user_id, society_id, kind, title, body, link, dedupe_key, priority)
  VALUES (_user, _society, _kind, left(_title,120), left(_body,300), _link, _dedupe_key,
          CASE WHEN _priority IN ('low','normal','high','urgent') THEN _priority ELSE 'normal' END)
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END $$;
REVOKE ALL ON FUNCTION public._notify_user_once(uuid,uuid,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._notify_user_once(uuid,uuid,text,text,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.global_search(_q text, _limit int DEFAULT 5)
RETURNS TABLE (kind text, id uuid, title text, subtitle text, link text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  uid uuid := auth.uid(); s uuid; q text; lk text; lim int := least(greatest(coalesce(_limit,5),1),10);
  is_admin boolean; can_fin boolean; can_res boolean;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  q := btrim(coalesce(_q,''));
  IF char_length(q) < 2 OR char_length(q) > 80 THEN RETURN; END IF;
  SELECT p.society_id INTO s FROM public.profiles p WHERE p.id = uid;
  IF s IS NULL THEN RETURN; END IF;
  lk := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  is_admin := public.is_society_admin_for(s);
  can_fin := is_admin AND public.current_user_has_society_permission(s, 'billing.manage');
  can_res := is_admin AND public.current_user_has_society_permission(s, 'residents.manage');

  RETURN QUERY SELECT 'flat'::text, f.id, coalesce(b.name || ' · ', '') || f.flat_number, 'Flat'::text,
      CASE WHEN is_admin THEN '/society/flats/' || f.id ELSE '/app/dashboard' END
    FROM public.flats f LEFT JOIN public.blocks b ON b.id = f.block_id
    WHERE f.society_id = s AND f.is_active AND (f.flat_number ILIKE lk OR b.name ILIKE lk OR f.normalized_label ILIKE lk)
      AND (is_admin OR EXISTS (SELECT 1 FROM public.flat_residents fr WHERE fr.flat_id = f.id AND fr.user_id = uid AND fr.is_active))
    ORDER BY f.flat_number LIMIT lim;

  IF can_res THEN
    RETURN QUERY SELECT DISTINCT ON (p.id) 'resident'::text, p.id, coalesce(p.full_name,'Resident'),
        coalesce((SELECT coalesce(b.name || ' · ','') || f.flat_number FROM public.flat_residents fr
          JOIN public.flats f ON f.id = fr.flat_id LEFT JOIN public.blocks b ON b.id = f.block_id
          WHERE fr.user_id = p.id AND fr.is_active AND f.society_id = s LIMIT 1), 'Resident'),
        '/society/residents/' || p.id
      FROM public.profiles p
      WHERE p.full_name ILIKE lk AND EXISTS (SELECT 1 FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
        WHERE fr.user_id = p.id AND f.society_id = s)
      LIMIT lim;
  END IF;

  RETURN QUERY SELECT 'vehicle'::text, v.id, v.plate_number, coalesce(v.make_model, 'Vehicle'),
      CASE WHEN is_admin THEN '/society/vehicles' ELSE '/app/vehicles' END
    FROM public.vehicles v WHERE v.society_id = s AND v.is_active AND v.plate_number ILIKE lk
      AND (is_admin OR v.user_id = uid) LIMIT lim;

  RETURN QUERY SELECT 'visitor'::text, x.id, x.visitor_name,
      coalesce(x.flat_number,'') || ' · ' || to_char(coalesce(x.entry_at, x.created_at), 'DD Mon'),
      CASE WHEN is_admin THEN '/society/visitors' ELSE '/app/visitors' END
    FROM public.visitors x WHERE x.society_id = s AND (x.visitor_name ILIKE lk OR x.vehicle_number ILIKE lk)
      AND (is_admin OR EXISTS (SELECT 1 FROM public.flat_residents fr WHERE fr.flat_id = x.flat_id AND fr.user_id = uid AND fr.is_active))
    ORDER BY x.created_at DESC LIMIT lim;

  RETURN QUERY SELECT 'ticket'::text, t.id, t.subject, coalesce(t.ticket_no::text,'') || ' · ' || t.status,
      CASE WHEN is_admin THEN '/society/helpdesk' ELSE '/app/helpdesk' END
    FROM public.support_tickets t WHERE t.society_id = s AND (t.subject ILIKE lk OR t.ticket_no::text ILIKE lk)
      AND (is_admin OR t.user_id = uid) ORDER BY t.created_at DESC LIMIT lim;

  RETURN QUERY SELECT 'bill'::text, bl.id, coalesce(bl.bill_number, bl.period_label), bl.period_label || ' · ' || bl.status,
      CASE WHEN can_fin THEN '/society/bills/' || bl.id ELSE '/app/bills/' || bl.id END
    FROM public.bills bl WHERE bl.society_id = s AND (bl.bill_number ILIKE lk OR bl.period_label ILIKE lk)
      AND (can_fin OR EXISTS (SELECT 1 FROM public.flat_residents fr WHERE fr.flat_id = bl.flat_id AND fr.user_id = uid AND fr.is_active))
    ORDER BY bl.created_at DESC LIMIT lim;

  IF can_fin THEN
    RETURN QUERY SELECT 'payment'::text, py.id, coalesce(py.reference_no, 'Payment'), py.method || ' · ' || py.status,
        '/society/payments'::text
      FROM public.payments py WHERE py.society_id = s AND py.reference_no ILIKE lk ORDER BY py.created_at DESC LIMIT lim;
  END IF;

  RETURN QUERY SELECT 'notice'::text, n.id, n.title, coalesce(n.category,'Notice'),
      CASE WHEN is_admin THEN '/society/announcements' ELSE '/app/notices' END
    FROM public.notices n WHERE n.society_id = s AND n.title ILIKE lk AND (is_admin OR n.status = 'published')
    ORDER BY n.created_at DESC LIMIT lim;

  RETURN QUERY SELECT 'meeting'::text, m.id, m.title, to_char(m.starts_at, 'DD Mon YYYY'),
      CASE WHEN is_admin THEN '/society/meetings' ELSE '/app/meetings' END
    FROM public.meetings m WHERE m.society_id = s AND m.title ILIKE lk ORDER BY m.starts_at DESC LIMIT lim;

  RETURN QUERY SELECT 'document'::text, d.id, d.title, coalesce(d.category, d.kind),
      CASE WHEN is_admin THEN '/society/knowledge' ELSE '/app/documents' END
    FROM public.society_knowledge_sources d WHERE d.society_id = s AND d.status = 'ready' AND d.archived_at IS NULL
      AND d.title ILIKE lk AND (is_admin OR d.audience = 'residents')
    ORDER BY d.updated_at DESC LIMIT lim;

  IF is_admin THEN
    RETURN QUERY SELECT 'vendor'::text, fv.id, fv.name, coalesce(fv.category,'Vendor'), '/society/operations'::text
      FROM public.finance_vendors fv WHERE fv.society_id = s AND fv.name ILIKE lk LIMIT lim;
    RETURN QUERY SELECT 'asset'::text, a.id, a.name, coalesce(a.location, a.category, 'Asset'), '/society/operations'::text
      FROM public.society_assets a WHERE a.society_id = s AND a.name ILIKE lk LIMIT lim;
    RETURN QUERY SELECT 'purchase'::text, pr.id, pr.title, coalesce(pr.request_no::text,'') || ' · ' || pr.status, '/society/operations'::text
      FROM public.procurement_requests pr WHERE pr.society_id = s AND (pr.title ILIKE lk OR pr.request_no::text ILIKE lk)
      ORDER BY pr.created_at DESC LIMIT lim;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.global_search(text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.global_search(text,int) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_needs_attention()
RETURNS TABLE (key text, priority int, reason text, item_count int, link text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
#variable_conflict use_column
DECLARE uid uuid := auth.uid(); s uuid; is_admin boolean; can_fin boolean; can_res boolean; n int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT p.society_id INTO s FROM public.profiles p WHERE p.id = uid;
  IF s IS NULL THEN RETURN; END IF;
  is_admin := public.is_society_admin_for(s);
  can_fin := is_admin AND public.current_user_has_society_permission(s, 'billing.manage');
  can_res := is_admin AND public.current_user_has_society_permission(s, 'residents.manage');

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
END $$;
REVOKE ALL ON FUNCTION public.get_needs_attention() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_needs_attention() TO authenticated;