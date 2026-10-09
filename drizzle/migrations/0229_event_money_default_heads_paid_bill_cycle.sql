-- 1) Event money: optional link from canonical income/expense rows to a society event.
ALTER TABLE public.society_income_records ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.community_events(id) ON DELETE RESTRICT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.community_events(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS society_income_records_event_idx ON public.society_income_records(society_id, event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS expenses_event_idx ON public.expenses(society_id, event_id) WHERE event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_finance_event_link(_society_id uuid, _kind text, _record_id uuid, _event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_old uuid; v_ev_soc uuid;
BEGIN
  v_uid := public._finance_require_admin(_society_id);
  IF _kind NOT IN ('income','expense') THEN RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023'; END IF;
  IF _event_id IS NOT NULL THEN
    SELECT society_id INTO v_ev_soc FROM public.community_events WHERE id = _event_id;
    IF v_ev_soc IS NULL OR v_ev_soc <> _society_id THEN RAISE EXCEPTION 'event_not_found' USING ERRCODE = '02000'; END IF;
  END IF;
  IF _kind = 'income' THEN
    SELECT event_id INTO v_old FROM public.society_income_records WHERE id = _record_id AND society_id = _society_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'record_not_found' USING ERRCODE = '02000'; END IF;
    UPDATE public.society_income_records SET event_id = _event_id WHERE id = _record_id;
  ELSE
    SELECT event_id INTO v_old FROM public.expenses WHERE id = _record_id AND society_id = _society_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'record_not_found' USING ERRCODE = '02000'; END IF;
    UPDATE public.expenses SET event_id = _event_id WHERE id = _record_id;
  END IF;
  IF v_old IS DISTINCT FROM _event_id THEN
    INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
    VALUES (v_uid, _society_id, 'finance.event_link_changed',
            CASE WHEN _kind = 'income' THEN 'society_income_records' ELSE 'expenses' END, _record_id,
            jsonb_build_object('from_event', v_old, 'to_event', _event_id));
  END IF;
  RETURN jsonb_build_object('record_id', _record_id, 'event_id', _event_id);
END $$;
REVOKE ALL ON FUNCTION public.set_finance_event_link(uuid, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_finance_event_link(uuid, text, uuid, uuid) TO authenticated;

-- Totals per event come only from verified income and posted expenses (canonical truth).
CREATE OR REPLACE FUNCTION public.get_event_finance_summary(_society_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._finance_require_reader(_society_id);
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'event_id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'status', e.status,
      'income', coalesce((SELECT sum(i.amount) FROM public.society_income_records i
                          WHERE i.society_id = _society_id AND i.event_id = e.id AND i.verification_status = 'verified'), 0),
      'income_count', (SELECT count(*) FROM public.society_income_records i
                          WHERE i.society_id = _society_id AND i.event_id = e.id AND i.verification_status = 'verified'),
      'expense', coalesce((SELECT sum(x.amount) FROM public.expenses x
                          WHERE x.society_id = _society_id AND x.event_id = e.id AND x.status = 'posted'), 0),
      'expense_count', (SELECT count(*) FROM public.expenses x
                          WHERE x.society_id = _society_id AND x.event_id = e.id AND x.status = 'posted')
    ) ORDER BY e.starts_at DESC)
    FROM (SELECT * FROM public.community_events WHERE society_id = _society_id ORDER BY starts_at DESC LIMIT 200) e
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.get_event_finance_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_finance_summary(uuid) TO authenticated;

-- 2) Most common default income and expense heads (added only when missing).
CREATE OR REPLACE FUNCTION public.ensure_default_account_categories(_society_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid; v_i int := 0; v_e int := 0;
BEGIN
  v_uid := public._finance_require_admin(_society_id);
  INSERT INTO public.society_income_categories(society_id,key,display_name,is_system,is_active,created_by)
  SELECT _society_id, k, d, true, true, v_uid FROM (VALUES
    ('maintenance','Maintenance'),('amenities','Amenities'),('advertisement','Advertisement'),
    ('penalty_fees','Penalty Fees'),('bank_interest','Bank Interest'),('parking_charges','Parking Charges'),
    ('transfer_fees','Transfer Fees'),('event_collections','Event & Festival Collections'),
    ('donations','Donations'),('rent_income','Rent (Hall / Shop / Tower)')) AS t(k,d)
  WHERE NOT EXISTS (SELECT 1 FROM public.society_income_categories c WHERE c.society_id=_society_id AND (lower(c.key)=t.k OR lower(c.display_name)=lower(t.d)));
  GET DIAGNOSTICS v_i = ROW_COUNT;
  INSERT INTO public.finance_expense_categories(society_id,name,base_kind,is_default,created_by)
  SELECT _society_id, n, b, true, v_uid FROM (VALUES
    ('Water Bill','water'),('Electricity','electricity'),('Watchman','security'),('Cleaner','cleaning'),
    ('Lift Maintenance','repair'),('Repairs & Maintenance','repair'),('Garden & Housekeeping','cleaning'),
    ('Staff Salary','salary'),('Office & Stationery','other'),('Events & Festivals','other'),
    ('Bank Charges','other'),('Insurance','other')) AS t(n,b)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_e = ROW_COUNT;
  IF v_i + v_e > 0 THEN
    INSERT INTO public.audit_log(actor_id,society_id,action,target_table,metadata)
    VALUES (v_uid,_society_id,'finance.default_categories_seeded','finance_expense_categories',jsonb_build_object('income',v_i,'expense',v_e));
  END IF;
  RETURN jsonb_build_object('income_added',v_i,'expense_added',v_e);
END $$;

-- 3) Paid-home bill cycle: off by default; every 5 days bill verified-paid homes, remind due homes.
ALTER TABLE public.billing_schedules ALTER COLUMN enabled SET DEFAULT false;
ALTER TABLE public.society_automation_settings
  ADD COLUMN IF NOT EXISTS paid_bill_cycle_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_bill_cycle_last_run_at timestamptz;

CREATE OR REPLACE FUNCTION public.run_paid_home_bill_cycle()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; hp record; b record; v_n int := 0; v_billed int; v_reminded int;
BEGIN
  IF current_user NOT IN ('postgres','supabase_admin','service_role') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  FOR s IN
    SELECT a.society_id FROM public.society_automation_settings a
    WHERE a.paid_bill_cycle_enabled
      AND (a.paid_bill_cycle_last_run_at IS NULL OR a.paid_bill_cycle_last_run_at <= now() - interval '5 days')
      AND public._finance_plan_enabled(a.society_id)
    ORDER BY a.society_id LIMIT 200
    FOR UPDATE OF a SKIP LOCKED
  LOOP
    v_billed := 0; v_reminded := 0;
    -- Verified-paid homes with no bill for that month (one bill per home per month is enforced inside).
    FOR hp IN
      SELECT id FROM public.historical_payments
      WHERE society_id = s.society_id AND status = 'confirmed' AND reconciliation_state IS NULL
      ORDER BY payment_date LIMIT 500
    LOOP
      IF public._reconcile_historical_payment(hp.id) = 'bill_created_paid' THEN v_billed := v_billed + 1; END IF;
    END LOOP;
    -- Homes with dues get one reminder per cycle.
    FOR b IN
      SELECT DISTINCT flat_id FROM public.bills
      WHERE society_id = s.society_id AND cancelled_at IS NULL
        AND coalesce(status,'') NOT IN ('paid','cancelled') AND due_date < current_date
      LIMIT 2000
    LOOP
      PERFORM public._notify_flat(s.society_id, b.flat_id, 'bill_due', 'Maintenance due',
        'You have unpaid maintenance. Please pay or contact your society committee.', '/app/bills');
      v_reminded := v_reminded + 1;
    END LOOP;
    UPDATE public.society_automation_settings SET paid_bill_cycle_last_run_at = now() WHERE society_id = s.society_id;
    INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
    VALUES (NULL, s.society_id, 'billing.paid_home_cycle_run', 'society_automation_settings', s.society_id,
            jsonb_build_object('bills_created', v_billed, 'homes_reminded', v_reminded));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.run_paid_home_bill_cycle() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_society_automations(_society_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_bs record; v_rs record; v_last_rem timestamptz; v_rem_7d int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF NOT (public.current_user_has_society_permission(_society_id,'billing.manage'::text,NULL::uuid)
          OR public.has_role(v_uid,'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  SELECT enabled, cycle, anchor_day, due_offset_days, mode, last_run_at, last_run_count, next_run_at
    INTO v_bs FROM public.billing_schedules WHERE society_id = _society_id;
  SELECT reminders_enabled, reminder_min_days_overdue, reminder_repeat_days, updated_at,
         paid_bill_cycle_enabled, paid_bill_cycle_last_run_at
    INTO v_rs FROM public.society_automation_settings WHERE society_id = _society_id;
  SELECT max(created_at), count(*) FILTER (WHERE created_at > now() - interval '7 days')
    INTO v_last_rem, v_rem_7d
    FROM public.audit_log WHERE society_id = _society_id AND action = 'maintenance_reminder_sent'
      AND created_at > now() - interval '90 days';
  RETURN jsonb_build_object(
    'entitled', public._finance_plan_enabled(_society_id),
    'bill_run', CASE WHEN v_bs IS NULL THEN NULL ELSE jsonb_build_object(
      'enabled', v_bs.enabled, 'cycle', v_bs.cycle, 'anchor_day', v_bs.anchor_day,
      'due_offset_days', v_bs.due_offset_days, 'mode', v_bs.mode,
      'last_run_at', v_bs.last_run_at, 'last_run_count', v_bs.last_run_count,
      'next_run_at', v_bs.next_run_at) END,
    'paid_bill_cycle', jsonb_build_object(
      'enabled', coalesce(v_rs.paid_bill_cycle_enabled, false),
      'last_run_at', v_rs.paid_bill_cycle_last_run_at,
      'next_run_at', CASE WHEN coalesce(v_rs.paid_bill_cycle_enabled, false)
                          THEN greatest(now(), coalesce(v_rs.paid_bill_cycle_last_run_at + interval '5 days', now())) END),
    'reminders', jsonb_build_object(
      'enabled', coalesce(v_rs.reminders_enabled, true),
      'min_days_overdue', coalesce(v_rs.reminder_min_days_overdue, 0),
      'repeat_days', coalesce(v_rs.reminder_repeat_days, 1),
      'configured', v_rs IS NOT NULL,
      'last_run_at', v_last_rem, 'sent_7d', coalesce(v_rem_7d, 0))
  );
END $function$;

CREATE OR REPLACE FUNCTION public.admin_set_society_automation(_society_id uuid, _key text, _enabled boolean, _config jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_before jsonb; v_after jsonb; v_offset int; v_min int; v_rep int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF NOT (public.current_user_has_society_permission(_society_id,'billing.manage'::text,NULL::uuid)
          OR public.has_role(v_uid,'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF NOT public._finance_plan_enabled(_society_id) THEN
    RAISE EXCEPTION 'plan_required' USING ERRCODE='42501';
  END IF;
  IF _enabled IS NULL THEN RAISE EXCEPTION 'invalid_config'; END IF;

  IF _key = 'bill_run' THEN
    SELECT jsonb_build_object('enabled', enabled, 'due_offset_days', due_offset_days)
      INTO v_before FROM public.billing_schedules WHERE society_id = _society_id FOR UPDATE;
    IF v_before IS NULL THEN RAISE EXCEPTION 'schedule_missing'; END IF;
    v_offset := coalesce((_config->>'due_offset_days')::int, (v_before->>'due_offset_days')::int);
    IF v_offset < 0 OR v_offset > 60 THEN RAISE EXCEPTION 'invalid_config'; END IF;
    UPDATE public.billing_schedules SET enabled = _enabled, due_offset_days = v_offset, updated_at = now()
      WHERE society_id = _society_id;
    v_after := jsonb_build_object('enabled', _enabled, 'due_offset_days', v_offset);
  ELSIF _key = 'paid_bill_cycle' THEN
    SELECT jsonb_build_object('enabled', paid_bill_cycle_enabled)
      INTO v_before FROM public.society_automation_settings WHERE society_id = _society_id FOR UPDATE;
    INSERT INTO public.society_automation_settings AS s (society_id, paid_bill_cycle_enabled, updated_by, updated_at)
    VALUES (_society_id, _enabled, v_uid, now())
    ON CONFLICT (society_id) DO UPDATE SET paid_bill_cycle_enabled = EXCLUDED.paid_bill_cycle_enabled,
      updated_by = v_uid, updated_at = now();
    v_after := jsonb_build_object('enabled', _enabled);
  ELSIF _key = 'reminders' THEN
    SELECT jsonb_build_object('enabled', reminders_enabled, 'min_days_overdue', reminder_min_days_overdue,
                              'repeat_days', reminder_repeat_days)
      INTO v_before FROM public.society_automation_settings WHERE society_id = _society_id FOR UPDATE;
    v_min := coalesce((_config->>'min_days_overdue')::int, (v_before->>'min_days_overdue')::int, 0);
    v_rep := coalesce((_config->>'repeat_days')::int, (v_before->>'repeat_days')::int, 1);
    IF v_min NOT BETWEEN 0 AND 60 OR v_rep NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'invalid_config'; END IF;
    INSERT INTO public.society_automation_settings AS s
      (society_id, reminders_enabled, reminder_min_days_overdue, reminder_repeat_days, updated_by, updated_at)
    VALUES (_society_id, _enabled, v_min, v_rep, v_uid, now())
    ON CONFLICT (society_id) DO UPDATE SET reminders_enabled = EXCLUDED.reminders_enabled,
      reminder_min_days_overdue = EXCLUDED.reminder_min_days_overdue,
      reminder_repeat_days = EXCLUDED.reminder_repeat_days, updated_by = v_uid, updated_at = now();
    v_after := jsonb_build_object('enabled', _enabled, 'min_days_overdue', v_min, 'repeat_days', v_rep);
  ELSE
    RAISE EXCEPTION 'unknown_automation';
  END IF;

  IF v_before IS DISTINCT FROM v_after THEN
    INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (v_uid, 'automation_config_changed',
            CASE WHEN _key='bill_run' THEN 'billing_schedules' ELSE 'society_automation_settings' END,
            _society_id, _society_id,
            jsonb_build_object('automation', _key, 'before', v_before, 'after', v_after));
  END IF;
  RETURN v_after;
END $function$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'cron' AND p.proname = 'schedule') THEN
    BEGIN PERFORM cron.unschedule('paid-home-bill-cycle-daily'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule('paid-home-bill-cycle-daily', '40 2 * * *', 'SELECT public.run_paid_home_bill_cycle()');
  END IF;
END $$;