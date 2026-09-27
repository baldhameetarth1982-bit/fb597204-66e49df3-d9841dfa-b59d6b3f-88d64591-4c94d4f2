-- Per-society reminder automation settings (bill run config stays in billing_schedules).
CREATE TABLE IF NOT EXISTS public.society_automation_settings (
  society_id uuid PRIMARY KEY REFERENCES public.societies(id) ON DELETE CASCADE,
  reminders_enabled boolean NOT NULL DEFAULT true,
  reminder_min_days_overdue integer NOT NULL DEFAULT 0 CHECK (reminder_min_days_overdue BETWEEN 0 AND 60),
  reminder_repeat_days integer NOT NULL DEFAULT 1 CHECK (reminder_repeat_days BETWEEN 1 AND 30),
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.society_automation_settings TO authenticated;
GRANT ALL ON public.society_automation_settings TO service_role;
ALTER TABLE public.society_automation_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY automation_settings_admin_read ON public.society_automation_settings
  FOR SELECT TO authenticated
  USING (public.is_society_admin_for(auth.uid(), society_id) OR public.is_super_admin(auth.uid()));
-- No direct write policies: changes go through admin_set_society_automation only.

-- Private scheduler token (DB-held so pg_cron can authenticate to the hooks).
CREATE TABLE IF NOT EXISTS public._scheduler_tokens (
  name text PRIMARY KEY,
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public._scheduler_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON public._scheduler_tokens TO service_role;
ALTER TABLE public._scheduler_tokens ENABLE ROW LEVEL SECURITY;
INSERT INTO public._scheduler_tokens(name, token)
VALUES ('automation_cron', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.verify_scheduler_token(_token text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(length(_token) = 64 AND EXISTS (
    SELECT 1 FROM public._scheduler_tokens WHERE name = 'automation_cron' AND token = _token
  ), false)
$$;
REVOKE ALL ON FUNCTION public.verify_scheduler_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_scheduler_token(text) TO service_role;

-- Read model for the Automations page.
CREATE OR REPLACE FUNCTION public.get_society_automations(_society_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_bs record; v_rs record; v_last_rem timestamptz; v_rem_7d int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF NOT (public.current_user_has_society_permission(_society_id,'billing.manage'::text,NULL::uuid)
          OR public.has_role(v_uid,'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  SELECT enabled, cycle, anchor_day, due_offset_days, mode, last_run_at, last_run_count, next_run_at
    INTO v_bs FROM public.billing_schedules WHERE society_id = _society_id;
  SELECT reminders_enabled, reminder_min_days_overdue, reminder_repeat_days, updated_at
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
    'reminders', jsonb_build_object(
      'enabled', coalesce(v_rs.reminders_enabled, true),
      'min_days_overdue', coalesce(v_rs.reminder_min_days_overdue, 0),
      'repeat_days', coalesce(v_rs.reminder_repeat_days, 1),
      'configured', v_rs IS NOT NULL,
      'last_run_at', v_last_rem, 'sent_7d', coalesce(v_rem_7d, 0))
  );
END $$;
REVOKE ALL ON FUNCTION public.get_society_automations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_society_automations(uuid) TO authenticated, service_role;

-- Single privileged write path: auth + permission + Premium + audit.
CREATE OR REPLACE FUNCTION public.admin_set_society_automation(
  _society_id uuid, _key text, _enabled boolean, _config jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    -- next_run_at is intentionally untouched: changes never trigger an immediate run.
    UPDATE public.billing_schedules SET enabled = _enabled, due_offset_days = v_offset, updated_at = now()
      WHERE society_id = _society_id;
    v_after := jsonb_build_object('enabled', _enabled, 'due_offset_days', v_offset);
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
END $$;
REVOKE ALL ON FUNCTION public.admin_set_society_automation(uuid, text, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_society_automation(uuid, text, boolean, jsonb) TO authenticated, service_role;

-- Authenticate the existing scheduler jobs (previously sent no credential -> 401).
SELECT cron.schedule('run-billing-daily', '0 2 * * *', $cron$
  SELECT net.http_post(
    url := 'https://project--68752e3a-4def-45ab-8ff0-b74d48f33a17.lovable.app/api/public/hooks/run-billing',
    headers := jsonb_build_object('Content-Type','application/json',
      'X-Scheduler-Token', (SELECT token FROM public._scheduler_tokens WHERE name='automation_cron')),
    body := '{}'::jsonb);
$cron$);
SELECT cron.schedule('maintenance-reminders-daily', '30 3 * * *', $cron$
  SELECT net.http_post(
    url := 'https://project--68752e3a-4def-45ab-8ff0-b74d48f33a17.lovable.app/api/public/hooks/maintenance-reminders',
    headers := jsonb_build_object('Content-Type','application/json',
      'X-Scheduler-Token', (SELECT token FROM public._scheduler_tokens WHERE name='automation_cron')),
    body := '{}'::jsonb);
$cron$);