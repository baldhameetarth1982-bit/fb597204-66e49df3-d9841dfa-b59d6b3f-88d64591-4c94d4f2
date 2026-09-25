CREATE OR REPLACE FUNCTION public.migration_finalize_upload(_job_id uuid, _checksum text, _actual_size integer, _row_count integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _job RECORD; _uid UUID := auth.uid();
BEGIN
  -- Only the trusted server (service role) may call this; it verifies the
  -- caller's admin scope through the user's own session first.
  IF _uid IS NULL AND COALESCE(auth.role(),'') <> 'service_role' THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  SELECT * INTO _job FROM public.migration_jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF COALESCE(auth.role(),'') <> 'service_role' AND NOT public.current_user_can_admin_migrations(_job.society_id) THEN
    RETURN jsonb_build_object('status','unavailable');
  END IF;
  IF _job.status NOT IN ('uploaded','mapping') THEN
    RETURN jsonb_build_object('status','job_not_ready');
  END IF;
  IF _actual_size <= 0 OR _actual_size > 10 * 1024 * 1024 THEN
    RETURN jsonb_build_object('status','invalid_file');
  END IF;
  IF _row_count > 5000 THEN
    RETURN jsonb_build_object('status','too_many_rows');
  END IF;
  UPDATE public.migration_jobs SET
    file_checksum = _checksum, status = 'mapping',
    total_rows = _row_count, updated_at = now()
  WHERE id = _job_id;
  RETURN jsonb_build_object('status','ok');
END;
$function$;

CREATE OR REPLACE FUNCTION public.migration_replace_staging(_job_id uuid, _rows jsonb, _totals jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _job RECORD;
  _uid UUID := auth.uid();
  _next_status public.migration_job_status;
  _err INT; _val INT; _warn INT; _total INT;
BEGIN
  IF _uid IS NULL AND COALESCE(auth.role(),'') <> 'service_role' THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  SELECT * INTO _job FROM public.migration_jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF COALESCE(auth.role(),'') <> 'service_role' AND NOT public.current_user_can_admin_migrations(_job.society_id) THEN
    RETURN jsonb_build_object('status','unavailable');
  END IF;
  IF _job.status NOT IN ('uploaded','mapping','validating','ready') THEN
    RETURN jsonb_build_object('status','job_not_ready');
  END IF;

  DELETE FROM public.migration_rows WHERE job_id = _job_id;

  INSERT INTO public.migration_rows (
    job_id, society_id, row_number, entity_type, raw_json, mapped_json,
    source_key, row_checksum, action, status, error_codes, warning_codes
  )
  SELECT
    _job_id, _job.society_id, (r->>'row_number')::int,
    (r->>'entity_type')::public.migration_entity_type,
    COALESCE(r->'raw_json','{}'::jsonb),
    COALESCE(r->'mapped_json','{}'::jsonb),
    NULLIF(r->>'source_key',''), r->>'row_checksum',
    (r->>'action')::public.migration_row_action,
    (r->>'status')::public.migration_row_status,
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(r->'error_codes')), ARRAY[]::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(r->'warning_codes')), ARRAY[]::text[])
  FROM jsonb_array_elements(_rows) AS r;

  _total := (_totals->>'total')::int;
  _val := (_totals->>'valid')::int;
  _warn := (_totals->>'warnings')::int;
  _err := (_totals->>'errors')::int;
  _next_status := CASE WHEN _err = 0 THEN 'ready'::public.migration_job_status
                       ELSE 'validating'::public.migration_job_status END;

  UPDATE public.migration_jobs SET
    status = _next_status, total_rows = _total, valid_rows = _val,
    warning_rows = _warn, error_rows = _err,
    validated_at = now(), updated_at = now()
  WHERE id = _job_id;

  RETURN jsonb_build_object('status','ok','total',_total,'valid',_val,'warnings',_warn,'errors',_err);
END;
$function$;

REVOKE ALL ON FUNCTION public.migration_finalize_upload(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.migration_replace_staging(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.migration_finalize_upload(uuid, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.migration_replace_staging(uuid, jsonb, jsonb) TO service_role;