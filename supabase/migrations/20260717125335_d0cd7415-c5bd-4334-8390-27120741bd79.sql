-- Stage 2D closure: trusted mutation boundary, atomic upload creation,
-- CSV-only production policy, and the canonical commit function.

-- Trusted internal mutation boundary — revoke authenticated grants.
REVOKE ALL ON FUNCTION public.migration_create_job(UUID, TEXT, TEXT, INT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.migration_create_job(UUID, TEXT, TEXT, INT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.migration_create_job(UUID, TEXT, TEXT, INT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.migration_create_job(UUID, TEXT, TEXT, INT, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.migration_finalize_upload(UUID, TEXT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.migration_finalize_upload(UUID, TEXT, INT, INT) FROM anon;
REVOKE ALL ON FUNCTION public.migration_finalize_upload(UUID, TEXT, INT, INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.migration_finalize_upload(UUID, TEXT, INT, INT) TO service_role;

REVOKE ALL ON FUNCTION public.migration_replace_staging(UUID, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.migration_replace_staging(UUID, JSONB, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.migration_replace_staging(UUID, JSONB, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.migration_replace_staging(UUID, JSONB, JSONB) TO service_role;

DROP FUNCTION IF EXISTS public.migration_set_storage_path(UUID, TEXT);

-- CSV-only production policy — tighten storage path validator.
CREATE OR REPLACE FUNCTION public.migration_upload_path_ok(_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE parts TEXT[]; soc UUID; jid UUID;
BEGIN
  IF _name IS NULL THEN RETURN FALSE; END IF;
  parts := string_to_array(_name, '/');
  IF array_length(parts, 1) IS DISTINCT FROM 3 THEN RETURN FALSE; END IF;
  IF parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN FALSE; END IF;
  IF parts[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN FALSE; END IF;
  IF length(parts[3]) < 5 OR length(parts[3]) > 128 THEN RETURN FALSE; END IF;
  IF parts[3] !~ '^[A-Za-z0-9._-]+\.csv$' THEN RETURN FALSE; END IF;
  soc := parts[1]::uuid;
  jid := parts[2]::uuid;
  IF NOT public.current_user_can_admin_migrations(soc) THEN RETURN FALSE; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.migration_jobs mj WHERE mj.id = jid AND mj.society_id = soc) THEN
    RETURN FALSE;
  END IF;
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END;
$$;

-- Admin helper accepting explicit actor id (used by internal fns for defence in depth).
CREATE OR REPLACE FUNCTION public.user_can_admin_migrations(_user_id UUID, _society_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.society_id = _society_id
      AND ur.role IN ('society_admin','super_admin')
      AND ur.is_active = TRUE
  ) OR public.has_role(_user_id, 'super_admin'::public.app_role);
$$;
REVOKE ALL ON FUNCTION public.user_can_admin_migrations(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_can_admin_migrations(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.user_can_admin_migrations(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_admin_migrations(UUID, UUID) TO service_role;

-- Atomic upload creation — service_role only.
CREATE OR REPLACE FUNCTION public.migration_begin_upload(
  _actor UUID, _society_id UUID, _source_type TEXT,
  _filename TEXT, _declared_size INT, _structure_mode TEXT
) RETURNS TABLE(job_id UUID, storage_path TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _job UUID; _rand TEXT; _path TEXT;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'unavailable'; END IF;
  IF NOT public.user_can_admin_migrations(_actor, _society_id) THEN
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
  IF _filename IS NULL OR length(_filename) < 5 OR length(_filename) > 240 THEN
    RAISE EXCEPTION 'invalid_file';
  END IF;
  _job := gen_random_uuid();
  _rand := encode(gen_random_bytes(16), 'hex');
  _path := _society_id::text || '/' || _job::text || '/' || _rand || '.csv';
  INSERT INTO public.migration_jobs (
    id, society_id, created_by, source_type, source_filename,
    file_checksum, storage_path, structure_mode, status
  ) VALUES (
    _job, _society_id, _actor, _source_type, _filename,
    'pending0', _path, COALESCE(_structure_mode,'structured'), 'uploaded'
  );
  job_id := _job;
  storage_path := _path;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.migration_begin_upload(UUID, UUID, TEXT, TEXT, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.migration_begin_upload(UUID, UUID, TEXT, TEXT, INT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.migration_begin_upload(UUID, UUID, TEXT, TEXT, INT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.migration_begin_upload(UUID, UUID, TEXT, TEXT, INT, TEXT) TO service_role;

-- Commit-request idempotency table.
CREATE TABLE IF NOT EXISTS public.migration_commit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id UUID NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.migration_jobs(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress','completed','failed')),
  result_json JSONB,
  failure_code TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  UNIQUE (job_id, request_id)
);
CREATE INDEX IF NOT EXISTS migration_commit_requests_job_idx ON public.migration_commit_requests(job_id);
GRANT SELECT ON public.migration_commit_requests TO authenticated;
GRANT ALL ON public.migration_commit_requests TO service_role;
ALTER TABLE public.migration_commit_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS migration_commit_requests_admin_read ON public.migration_commit_requests;
CREATE POLICY migration_commit_requests_admin_read ON public.migration_commit_requests
  FOR SELECT TO authenticated
  USING (public.current_user_can_admin_migrations(society_id));

-- Canonical commit function — real writes for structures + units only.
CREATE OR REPLACE FUNCTION public.commit_migration_job(
  _job_id UUID, _request_id TEXT, _expected_checksum TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _job RECORD; _existing RECORD; _payload_hash TEXT; _result JSONB;
  _r RECORD; _new_id UUID; _block_id UUID; _flat_id UUID;
  _structs_created INT := 0; _structs_matched INT := 0;
  _units_created INT := 0; _units_matched INT := 0;
  _skipped INT := 0; _committed INT := 0;
  _has_unsupported_creates INT := 0; _has_errors INT := 0; _has_conflicts INT := 0;
  _lock_key BIGINT;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF _request_id IS NULL OR length(_request_id) < 8 OR length(_request_id) > 80 THEN
    RETURN jsonb_build_object('status','operation_failed');
  END IF;
  SELECT * INTO _job FROM public.migration_jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF NOT public.user_can_admin_migrations(_uid, _job.society_id) THEN
    RETURN jsonb_build_object('status','unavailable');
  END IF;
  IF _expected_checksum IS NULL OR _expected_checksum <> _job.file_checksum THEN
    RETURN jsonb_build_object('status','idempotency_conflict');
  END IF;

  _lock_key := ('x' || substr(md5(_job_id::text),1,16))::bit(64)::bigint;
  IF NOT pg_try_advisory_xact_lock(_lock_key) THEN
    RETURN jsonb_build_object('status','job_already_committing');
  END IF;

  SELECT md5(
    _job.id::text || '|' || _job.file_checksum || '|' || _job.source_type || '|' ||
    COALESCE(_job.structure_mode,'') || '|' ||
    COALESCE((
      SELECT string_agg(
        r.row_number::text || ':' || r.entity_type::text || ':' ||
        r.action::text || ':' || r.status::text || ':' || r.row_checksum ||
        ':' || COALESCE(r.resolved_entity_id::text,''),
        '|' ORDER BY r.row_number
      ) FROM public.migration_rows r WHERE r.job_id = _job.id
    ),'')
  ) INTO _payload_hash;

  SELECT * INTO _existing FROM public.migration_commit_requests
    WHERE job_id = _job_id AND request_id = _request_id FOR UPDATE;
  IF FOUND THEN
    IF _existing.status = 'completed' THEN
      IF _existing.payload_hash = _payload_hash THEN
        RETURN jsonb_build_object('status','idempotent_replay','result', _existing.result_json);
      ELSE
        RETURN jsonb_build_object('status','idempotency_conflict');
      END IF;
    ELSIF _existing.status = 'in_progress' THEN
      RETURN jsonb_build_object('status','job_already_committing');
    END IF;
  END IF;

  IF _job.status = 'completed' THEN
    RETURN jsonb_build_object('status','idempotent_replay',
      'result', jsonb_build_object('committed_rows', _job.committed_rows));
  END IF;
  IF _job.status <> 'ready' THEN
    RETURN jsonb_build_object('status','job_not_ready');
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE status = 'error'),
    COUNT(*) FILTER (WHERE action = 'conflict'),
    COUNT(*) FILTER (
      WHERE action = 'create' AND entity_type IN ('resident','occupancy','family','vehicle')
    )
  INTO _has_errors, _has_conflicts, _has_unsupported_creates
  FROM public.migration_rows WHERE job_id = _job_id;

  IF _has_errors > 0 OR _has_conflicts > 0 OR _has_unsupported_creates > 0 THEN
    RETURN jsonb_build_object('status','unresolved_conflicts');
  END IF;

  IF _existing.id IS NULL THEN
    INSERT INTO public.migration_commit_requests
      (society_id, job_id, request_id, payload_hash, status, created_by)
      VALUES (_job.society_id, _job_id, _request_id, _payload_hash, 'in_progress', _uid);
  ELSE
    UPDATE public.migration_commit_requests
      SET status='in_progress', payload_hash=_payload_hash, failed_at=NULL, failure_code=NULL
      WHERE id = _existing.id;
  END IF;

  UPDATE public.migration_jobs SET status='committing', updated_at=now() WHERE id = _job_id;

  FOR _r IN
    SELECT * FROM public.migration_rows
    WHERE job_id = _job_id AND entity_type = 'structure'
      AND status IN ('valid','warning') AND action IN ('create','match_existing')
    ORDER BY row_number
  LOOP
    IF _r.action = 'create' THEN
      IF COALESCE(_job.structure_mode,'structured') <> 'structured' THEN
        _skipped := _skipped + 1; CONTINUE;
      END IF;
      INSERT INTO public.blocks (society_id, name, normalized_name)
        VALUES (_job.society_id,
          COALESCE(_r.mapped_json->>'structure_name', _r.mapped_json->>'name'),
          lower(regexp_replace(COALESCE(_r.mapped_json->>'structure_name', _r.mapped_json->>'name',''),
            '[^a-zA-Z0-9]+','','g')))
        RETURNING id INTO _new_id;
      _structs_created := _structs_created + 1;
    ELSE
      SELECT id INTO _new_id FROM public.blocks
        WHERE id = _r.resolved_entity_id AND society_id = _job.society_id;
      IF _new_id IS NULL THEN
        UPDATE public.migration_commit_requests
          SET status='failed', failed_at=now(), failure_code='provenance_mismatch'
          WHERE job_id=_job_id AND request_id=_request_id;
        UPDATE public.migration_jobs SET status='ready', updated_at=now() WHERE id=_job_id;
        RETURN jsonb_build_object('status','unresolved_conflicts');
      END IF;
      _structs_matched := _structs_matched + 1;
    END IF;
    INSERT INTO public.migration_entity_links
      (society_id, job_id, entity_type, source_type, source_key, source_checksum, canonical_entity_id)
    VALUES (_job.society_id, _job_id, 'structure', _job.source_type,
            COALESCE(_r.source_key, _r.row_checksum), _r.row_checksum, _new_id)
    ON CONFLICT DO NOTHING;
    UPDATE public.migration_rows
      SET resolved_entity_id = _new_id, status = 'committed', updated_at = now()
      WHERE id = _r.id;
    _committed := _committed + 1;
  END LOOP;

  FOR _r IN
    SELECT * FROM public.migration_rows
    WHERE job_id = _job_id AND entity_type = 'unit'
      AND status IN ('valid','warning') AND action IN ('create','match_existing')
    ORDER BY row_number
  LOOP
    IF _r.action = 'create' THEN
      _block_id := NULL;
      IF COALESCE(_job.structure_mode,'structured') = 'structured' THEN
        SELECT b.id INTO _block_id FROM public.blocks b
          WHERE b.society_id = _job.society_id
            AND lower(b.name) = lower(COALESCE(_r.mapped_json->>'structure_name',''))
          LIMIT 1;
        IF _block_id IS NULL THEN
          UPDATE public.migration_commit_requests
            SET status='failed', failed_at=now(), failure_code='structure_not_found'
            WHERE job_id=_job_id AND request_id=_request_id;
          UPDATE public.migration_jobs SET status='ready', updated_at=now() WHERE id=_job_id;
          RETURN jsonb_build_object('status','unresolved_conflicts');
        END IF;
      END IF;
      INSERT INTO public.flats (
        society_id, block_id, flat_number, floor, unit_type, normalized_label
      ) VALUES (
        _job.society_id, _block_id,
        COALESCE(_r.mapped_json->>'unit_label', _r.mapped_json->>'flat_number'),
        NULLIF(_r.mapped_json->>'floor','')::int,
        COALESCE(NULLIF(_r.mapped_json->>'unit_type',''),'residential'),
        lower(regexp_replace(COALESCE(_r.mapped_json->>'unit_label', _r.mapped_json->>'flat_number',''),
          '[^a-zA-Z0-9]+','','g'))
      ) RETURNING id INTO _flat_id;
      _units_created := _units_created + 1;
    ELSE
      SELECT id INTO _flat_id FROM public.flats
        WHERE id = _r.resolved_entity_id AND society_id = _job.society_id;
      IF _flat_id IS NULL THEN
        UPDATE public.migration_commit_requests
          SET status='failed', failed_at=now(), failure_code='provenance_mismatch'
          WHERE job_id=_job_id AND request_id=_request_id;
        UPDATE public.migration_jobs SET status='ready', updated_at=now() WHERE id=_job_id;
        RETURN jsonb_build_object('status','unresolved_conflicts');
      END IF;
      _units_matched := _units_matched + 1;
    END IF;
    INSERT INTO public.migration_entity_links
      (society_id, job_id, entity_type, source_type, source_key, source_checksum, canonical_entity_id)
    VALUES (_job.society_id, _job_id, 'unit', _job.source_type,
            COALESCE(_r.source_key, _r.row_checksum), _r.row_checksum, _flat_id)
    ON CONFLICT DO NOTHING;
    UPDATE public.migration_rows
      SET resolved_entity_id = _flat_id, status = 'committed', updated_at = now()
      WHERE id = _r.id;
    _committed := _committed + 1;
  END LOOP;

  SELECT COUNT(*) INTO _skipped FROM public.migration_rows
    WHERE job_id = _job_id AND status = 'skipped';

  _result := jsonb_build_object(
    'structures_created', _structs_created,
    'structures_matched', _structs_matched,
    'units_created', _units_created,
    'units_matched', _units_matched,
    'residents_created', 0,
    'residents_matched', 0,
    'occupancies_created', 0,
    'family_created', 0,
    'vehicles_created', 0,
    'skipped', _skipped,
    'total_committed', _committed
  );

  UPDATE public.migration_jobs
    SET status='completed', committed_at=now(), committed_rows=_committed,
        updated_at=now(), failure_code=NULL
    WHERE id = _job_id;

  UPDATE public.migration_commit_requests
    SET status='completed', completed_at=now(), result_json=_result, failure_code=NULL
    WHERE job_id=_job_id AND request_id=_request_id;

  INSERT INTO public.audit_log (society_id, actor_id, action, target_table, target_id, metadata)
    VALUES (_job.society_id, _uid, 'migration.commit', 'migration_jobs', _job_id::text, _result);

  RETURN jsonb_build_object('status','completed','result', _result);
EXCEPTION WHEN OTHERS THEN
  UPDATE public.migration_commit_requests
    SET status='failed', failed_at=now(), failure_code='operation_failed'
    WHERE job_id=_job_id AND request_id=_request_id;
  UPDATE public.migration_jobs SET status='ready', updated_at=now() WHERE id=_job_id;
  RETURN jsonb_build_object('status','operation_failed');
END;
$$;

REVOKE ALL ON FUNCTION public.commit_migration_job(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commit_migration_job(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.commit_migration_job(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_migration_job(UUID, TEXT, TEXT) TO service_role;