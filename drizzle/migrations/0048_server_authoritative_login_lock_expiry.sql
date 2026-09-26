CREATE OR REPLACE FUNCTION public.is_login_account_locked(
  _subject text,
  _window_seconds integer DEFAULT 900,
  _max_failures integer DEFAULT 5
)
RETURNS TABLE(locked boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_cutoff timestamptz;
  v_failures integer;
  v_oldest timestamptz;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF _window_seconds < 1 OR _max_failures < 1 OR length(_subject) < 1 THEN
    RAISE EXCEPTION 'invalid_lock_parameters' USING ERRCODE = '22023';
  END IF;

  v_cutoff := v_now - make_interval(secs => _window_seconds);
  DELETE FROM public.rate_limits
  WHERE bucket = 'login:fail' AND subject = _subject AND window_start <= v_cutoff;

  SELECT COALESCE(sum(count), 0)::integer, min(window_start)
  INTO v_failures, v_oldest
  FROM public.rate_limits
  WHERE bucket = 'login:fail' AND subject = _subject AND window_start > v_cutoff;

  locked := v_failures >= _max_failures;
  retry_after_seconds := CASE
    WHEN locked AND v_oldest IS NOT NULL THEN GREATEST(1, ceil(extract(epoch FROM (v_oldest + make_interval(secs => _window_seconds) - v_now)))::integer)
    ELSE 0
  END;
  RETURN NEXT;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.is_login_account_locked(text,integer,integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_login_account_locked(text,integer,integer) TO service_role;