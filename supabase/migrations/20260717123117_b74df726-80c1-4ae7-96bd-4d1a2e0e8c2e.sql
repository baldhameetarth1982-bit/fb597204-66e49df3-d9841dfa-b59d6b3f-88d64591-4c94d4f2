
CREATE OR REPLACE FUNCTION public.migration_upload_path_ok(_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parts TEXT[];
  soc UUID;
  jid UUID;
BEGIN
  IF _name IS NULL THEN RETURN FALSE; END IF;
  parts := string_to_array(_name, '/');
  IF array_length(parts, 1) IS DISTINCT FROM 3 THEN RETURN FALSE; END IF;
  IF parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN FALSE; END IF;
  IF parts[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN FALSE; END IF;
  IF length(parts[3]) < 5 OR length(parts[3]) > 128 THEN RETURN FALSE; END IF;
  IF parts[3] !~ '^[A-Za-z0-9._-]+\.(csv|xlsx)$' THEN RETURN FALSE; END IF;
  soc := parts[1]::uuid;
  jid := parts[2]::uuid;
  IF NOT public.current_user_can_admin_migrations(soc) THEN RETURN FALSE; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.migration_jobs mj WHERE mj.id = jid AND mj.society_id = soc) THEN
    RETURN FALSE;
  END IF;
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.migration_upload_path_ok(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.migration_upload_path_ok(TEXT) TO authenticated;

DROP POLICY IF EXISTS migration_uploads_admin_all ON storage.objects;
CREATE POLICY migration_uploads_admin_all ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'migration-uploads' AND public.migration_upload_path_ok(name))
  WITH CHECK (bucket_id = 'migration-uploads' AND public.migration_upload_path_ok(name));

REVOKE INSERT, UPDATE, DELETE ON public.migration_jobs FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.migration_rows FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.migration_entity_links FROM authenticated;

CREATE TABLE IF NOT EXISTS public.migration_parsed_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.migration_jobs(id) ON DELETE CASCADE,
  society_id UUID NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL CHECK (row_number >= 1),
  values_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  row_checksum TEXT NOT NULL,
  parse_status TEXT NOT NULL DEFAULT 'parsed' CHECK (parse_status IN ('parsed','skipped','error')),
  parse_error_codes TEXT[] NOT NULL DEFAULT '{}'::text[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, row_number)
);

CREATE INDEX IF NOT EXISTS migration_parsed_rows_job_idx ON public.migration_parsed_rows(job_id, row_number);

GRANT SELECT ON public.migration_parsed_rows TO authenticated;
GRANT ALL ON public.migration_parsed_rows TO service_role;
ALTER TABLE public.migration_parsed_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS migration_parsed_rows_admin_read ON public.migration_parsed_rows;
CREATE POLICY migration_parsed_rows_admin_read ON public.migration_parsed_rows
  FOR SELECT TO authenticated
  USING (public.current_user_can_admin_migrations(society_id));

CREATE OR REPLACE FUNCTION public.migration_replace_staging(
  _job_id UUID, _rows JSONB, _totals JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _job RECORD;
  _uid UUID := auth.uid();
  _next_status public.migration_job_status;
  _err INT; _val INT; _warn INT; _total INT;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  SELECT * INTO _job FROM public.migration_jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF NOT public.current_user_can_admin_migrations(_job.society_id) THEN
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
$$;

REVOKE ALL ON FUNCTION public.migration_replace_staging(UUID, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.migration_replace_staging(UUID, JSONB, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.migration_replace_staging(UUID, JSONB, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.migration_create_job(
  _society_id UUID, _source_type TEXT, _filename TEXT,
  _declared_size INT, _structure_mode TEXT, _storage_path TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _id UUID;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unavailable'; END IF;
  IF NOT public.current_user_can_admin_migrations(_society_id) THEN
    RAISE EXCEPTION 'unavailable';
  END IF;
  IF _source_type NOT IN ('sociyohub','generic','mygate','adda','nobrokerhood') THEN
    RAISE EXCEPTION 'unsupported_format';
  END IF;
  IF _declared_size <= 0 OR _declared_size > 10 * 1024 * 1024 THEN
    RAISE EXCEPTION 'invalid_file';
  END IF;
  IF _structure_mode IS NOT NULL AND _structure_mode NOT IN ('structured','serial') THEN
    RAISE EXCEPTION 'invalid_file';
  END IF;
  INSERT INTO public.migration_jobs (
    society_id, created_by, source_type, source_filename,
    file_checksum, storage_path, structure_mode, status
  ) VALUES (
    _society_id, _uid, _source_type, _filename,
    'pending0', _storage_path, _structure_mode, 'uploaded'
  ) RETURNING id INTO _id;
  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.migration_create_job(UUID, TEXT, TEXT, INT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.migration_create_job(UUID, TEXT, TEXT, INT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.migration_create_job(UUID, TEXT, TEXT, INT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.migration_finalize_upload(
  _job_id UUID, _checksum TEXT, _actual_size INT, _row_count INT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _job RECORD; _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  SELECT * INTO _job FROM public.migration_jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF NOT public.current_user_can_admin_migrations(_job.society_id) THEN
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
$$;

REVOKE ALL ON FUNCTION public.migration_finalize_upload(UUID, TEXT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.migration_finalize_upload(UUID, TEXT, INT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.migration_finalize_upload(UUID, TEXT, INT, INT) TO authenticated;
