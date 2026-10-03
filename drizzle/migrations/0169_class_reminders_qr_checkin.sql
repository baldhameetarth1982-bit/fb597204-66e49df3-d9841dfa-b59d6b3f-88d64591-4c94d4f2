-- Morning-of reminders now skip people no longer eligible (moved out, tenancy ended, dues-restricted).
CREATE OR REPLACE FUNCTION public.send_class_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_n integer := 0; v_d date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  FOR r IN SELECT e.user_id, e.flat_id, c.society_id, c.id, c.amenity_id, c.title, c.start_time FROM public.amenity_classes c
            JOIN public.amenity_class_enrollments e ON e.class_id = c.id AND e.status = 'enrolled' AND e.society_id = c.society_id
           WHERE c.status = 'active' AND public._class_runs_on(c, v_d) LOOP
    CONTINUE WHEN public._amenity_eligibility(r.user_id, r.flat_id, r.amenity_id) IS NOT NULL;
    v_n := v_n + public._notify_user_once(r.user_id, r.society_id, 'amenity', 'Class today', r.title || ' at ' || to_char(r.start_time, 'HH24:MI'), '/app/classes', 'class-reminder:' || r.id::text || ':' || r.user_id::text || ':' || v_d::text, 'normal');
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.send_class_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_class_reminders() TO service_role;

CREATE OR REPLACE FUNCTION public.run_logged_db_job(_job text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE run uuid; k text; n int := 0; daily boolean;
BEGIN
  IF current_user NOT IN ('postgres','supabase_admin','service_role') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  daily := _job IN ('tenancy-expiry','tenancy-renewal-reminders','ops-daily-reminders','document-expiry','class-reminders');
  IF _job NOT IN ('tenancy-expiry','tenancy-renewal-reminders','ops-daily-reminders','amenity-waitlist-expiry','visitor-overstays','notice-publishing','meeting-reminders','vote-closing','document-expiry','class-reminders') THEN
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
    END CASE;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.scheduler_run_finish(run, 'failed', 0, 1, left(SQLSTATE || ' ' || SQLERRM, 300));
    RETURN 'failed';
  END;
  PERFORM public.scheduler_run_finish(run, 'succeeded', coalesce(n,0), 0, NULL);
  RETURN 'succeeded';
END $function$;
REVOKE ALL ON FUNCTION public.run_logged_db_job(text) FROM PUBLIC, anon, authenticated;

-- 06:00 IST daily; a failed run is retried by a second slot at 07:00 IST (same day key, so a success is never repeated).
SELECT cron.schedule('class-reminders-daily', '30 0 * * *', $$SELECT public.run_logged_db_job('class-reminders');$$);
SELECT cron.schedule('class-reminders-retry', '30 1 * * *', $$SELECT public.run_logged_db_job('class-reminders');$$);

-- QR check-in: committee shows a short-lived code for today's session; only its hash is stored.
CREATE TABLE public.amenity_class_checkin_codes (
  token_hash text PRIMARY KEY,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.amenity_classes(id) ON DELETE CASCADE,
  session_date date NOT NULL,
  expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.amenity_class_checkin_codes TO service_role;
ALTER TABLE public.amenity_class_checkin_codes ENABLE ROW LEVEL SECURITY;
CREATE INDEX amenity_class_checkin_codes_class ON public.amenity_class_checkin_codes(class_id, expires_at);

CREATE OR REPLACE FUNCTION public.admin_issue_class_checkin_code(_class_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE c public.amenity_classes; v_now timestamp := now() AT TIME ZONE 'Asia/Kolkata'; v_tok text; v_exp timestamptz := now() + interval '10 minutes';
BEGIN
  SELECT * INTO c FROM public.amenity_classes WHERE id = _class_id;
  IF c.id IS NULL OR NOT public._amenity_admin(c.society_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF c.status <> 'active' OR NOT public._class_runs_on(c, v_now::date)
     OR v_now::time < c.start_time - interval '15 minutes'
     OR v_now::time > c.start_time + make_interval(mins => c.duration_minutes) THEN
    RAISE EXCEPTION 'checkin_closed' USING ERRCODE='22023'; END IF;
  DELETE FROM public.amenity_class_checkin_codes WHERE expires_at < now() - interval '1 day';
  v_tok := encode(gen_random_bytes(24), 'hex');
  INSERT INTO public.amenity_class_checkin_codes(token_hash, society_id, class_id, session_date, expires_at, created_by)
  VALUES (encode(digest(v_tok, 'sha256'), 'hex'), c.society_id, c.id, v_now::date, v_exp, auth.uid());
  RETURN jsonb_build_object('token', v_tok, 'expires_at', v_exp);
END $$;

CREATE OR REPLACE FUNCTION public.check_in_class_qr(_token text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE q public.amenity_class_checkin_codes; c public.amenity_classes; en public.amenity_class_enrollments;
        v_now timestamp := now() AT TIME ZONE 'Asia/Kolkata'; v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR _token IS NULL OR _token !~ '^[0-9a-f]{48}$' THEN RAISE EXCEPTION 'invalid_code' USING ERRCODE='22023'; END IF;
  SELECT * INTO q FROM public.amenity_class_checkin_codes WHERE token_hash = encode(digest(_token, 'sha256'), 'hex');
  IF q.token_hash IS NULL OR q.expires_at < now() OR q.session_date <> v_now::date THEN RAISE EXCEPTION 'invalid_code' USING ERRCODE='22023'; END IF;
  SELECT * INTO c FROM public.amenity_classes WHERE id = q.class_id AND society_id = q.society_id;
  IF c.id IS NULL OR c.status <> 'active' THEN RAISE EXCEPTION 'checkin_closed' USING ERRCODE='22023'; END IF;
  SELECT * INTO en FROM public.amenity_class_enrollments WHERE class_id = c.id AND society_id = c.society_id AND user_id = auth.uid() AND status = 'enrolled';
  IF en.id IS NULL OR public._amenity_eligibility(auth.uid(), en.flat_id, c.amenity_id) IS NOT NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF v_now::time < c.start_time - interval '15 minutes' OR v_now::time > c.start_time + make_interval(mins => c.duration_minutes) THEN
    RAISE EXCEPTION 'checkin_closed' USING ERRCODE='22023'; END IF;
  INSERT INTO public.amenity_class_attendance(society_id, class_id, enrollment_id, session_date, method, marked_by)
  VALUES (c.society_id, c.id, en.id, q.session_date, 'self_checkin', auth.uid())
  ON CONFLICT (enrollment_id, session_date) DO NOTHING RETURNING id INTO v_id;
  RETURN CASE WHEN v_id IS NULL THEN 'already_checked_in:' ELSE 'checked_in:' END || c.title;
END $$;

REVOKE ALL ON FUNCTION public.admin_issue_class_checkin_code(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.check_in_class_qr(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_issue_class_checkin_code(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_in_class_qr(text) TO authenticated;