CREATE OR REPLACE FUNCTION public.scheduler_mark_stalled()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int;
BEGIN
  IF current_user NOT IN ('postgres','supabase_admin','service_role') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  UPDATE public.scheduler_job_runs
     SET status = 'failed', finished_at = now(), failed = failed + 1,
         error = 'stalled: no finish recorded within 2 hours'
   WHERE status = 'running' AND started_at < now() - interval '2 hours';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.scheduler_mark_stalled() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.run_logged_db_job(_job text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE run uuid; k text; n int := 0; daily boolean;
BEGIN
  IF current_user NOT IN ('postgres','supabase_admin','service_role') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  daily := _job IN ('tenancy-expiry','tenancy-renewal-reminders','ops-daily-reminders','document-expiry','class-reminders');
  IF _job NOT IN ('tenancy-expiry','tenancy-renewal-reminders','ops-daily-reminders','amenity-waitlist-expiry','visitor-overstays','notice-publishing','meeting-reminders','vote-closing','document-expiry','class-reminders','election-reminders','material-pass-expiry','scheduler-stall-check') THEN
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
      WHEN 'document-expiry' THEN n := public.send_document_expiry_reminders();
      WHEN 'class-reminders' THEN n := public.send_class_reminders();
      WHEN 'election-reminders' THEN n := public.election_reminders();
      WHEN 'material-pass-expiry' THEN n := public.expire_material_passes();
      WHEN 'scheduler-stall-check' THEN n := public.scheduler_mark_stalled();
    END CASE;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.scheduler_run_finish(run, 'failed', 0, 1, left(SQLSTATE || ' ' || SQLERRM, 300));
    RETURN 'failed';
  END;
  PERFORM public.scheduler_run_finish(run, 'succeeded', coalesce(n,0), 0, NULL);
  RETURN 'succeeded';
END $function$;

SELECT cron.schedule('election-reminders-hourly', '25 * * * *', $$SELECT public.run_logged_db_job('election-reminders');$$);
SELECT cron.schedule('expire-material-passes-hourly', '20 * * * *', $$SELECT public.run_logged_db_job('material-pass-expiry');$$);
SELECT cron.schedule('scheduler-stall-check-hourly', '50 * * * *', $$SELECT public.run_logged_db_job('scheduler-stall-check');$$);