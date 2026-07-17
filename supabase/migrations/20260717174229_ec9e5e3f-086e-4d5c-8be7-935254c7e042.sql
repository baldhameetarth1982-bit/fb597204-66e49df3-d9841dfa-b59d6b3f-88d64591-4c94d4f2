
-- Stage 2E closure — explicit provenance conflict enforcement + pre-commit dedup.

-- Internal helper: SECURITY DEFINER, fixed search_path, revoked from PUBLIC/anon.
-- Insert new link; if a link already exists for (society, source_type, entity_type,
-- source_key), compare canonical_entity_id. Same → no-op (safe replay). Different
-- → raise 'provenance_mismatch' with SQLSTATE MG001 so the caller's rollback
-- block reverts every canonical write in the current commit attempt.
CREATE OR REPLACE FUNCTION public._migration_link_or_conflict(
  _society_id UUID,
  _job_id UUID,
  _entity_type public.migration_entity_type,
  _source_type TEXT,
  _source_key TEXT,
  _source_checksum TEXT,
  _canonical_entity_id UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _existing UUID;
BEGIN
  SELECT canonical_entity_id INTO _existing
    FROM public.migration_entity_links
   WHERE society_id = _society_id
     AND source_type = _source_type
     AND entity_type = _entity_type
     AND source_key = _source_key
   LIMIT 1;
  IF _existing IS NULL THEN
    INSERT INTO public.migration_entity_links
      (society_id, job_id, entity_type, source_type, source_key, source_checksum, canonical_entity_id)
    VALUES (_society_id, _job_id, _entity_type, _source_type, _source_key, _source_checksum, _canonical_entity_id);
  ELSIF _existing = _canonical_entity_id THEN
    -- Idempotent replay: same key mapped to same canonical id. Safe.
    RETURN;
  ELSE
    RAISE EXCEPTION 'provenance_mismatch' USING ERRCODE = 'MG001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._migration_link_or_conflict(UUID, UUID, public.migration_entity_type, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._migration_link_or_conflict(UUID, UUID, public.migration_entity_type, TEXT, TEXT, TEXT, UUID) FROM anon;
REVOKE ALL ON FUNCTION public._migration_link_or_conflict(UUID, UUID, public.migration_entity_type, TEXT, TEXT, TEXT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._migration_link_or_conflict(UUID, UUID, public.migration_entity_type, TEXT, TEXT, TEXT, UUID) TO service_role;

-- Rewrite commit_migration_job:
--   * pre-commit dedup: reuse existing canonical when the same source_key already
--     resolves to a canonical row that still exists;
--   * every migration_entity_links write goes through _migration_link_or_conflict
--     (no ON CONFLICT DO NOTHING inside this function).
CREATE OR REPLACE FUNCTION public.commit_migration_job(
  _job_id UUID, _request_id TEXT, _expected_checksum TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _job RECORD; _existing RECORD; _payload_hash TEXT; _result JSONB;
  _r RECORD; _new_id UUID; _block_id UUID; _flat_id UUID; _lock_key BIGINT;
  _resident_id UUID; _plate TEXT; _norm TEXT;
  _family_id UUID; _vehicle_id UUID;
  _reuse_id UUID;
  _src_key TEXT;
  _outstanding INT := 0;
  _structs_created INT := 0; _structs_matched INT := 0;
  _units_created INT := 0; _units_matched INT := 0;
  _residents_created INT := 0; _residents_matched INT := 0;
  _occupancies_created INT := 0;
  _family_created INT := 0; _vehicles_created INT := 0;
  _skipped INT := 0; _committed INT := 0;
  _has_errors INT := 0; _has_conflicts INT := 0;
  _fail_code TEXT;
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

  SELECT COUNT(*) FILTER (WHERE status = 'error'),
         COUNT(*) FILTER (WHERE action = 'conflict')
    INTO _has_errors, _has_conflicts
    FROM public.migration_rows WHERE job_id = _job_id;
  IF _has_errors > 0 OR _has_conflicts > 0 THEN
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

  BEGIN

    ----- Structures -----
    FOR _r IN
      SELECT * FROM public.migration_rows
       WHERE job_id = _job_id AND entity_type = 'structure'
         AND status IN ('valid','warning') AND action IN ('create','match_existing')
       ORDER BY row_number
    LOOP
      _src_key := COALESCE(_r.source_key, _r.row_checksum);
      _reuse_id := NULL;
      IF _r.action = 'create' THEN
        IF COALESCE(_job.structure_mode,'structured') <> 'structured' THEN
          UPDATE public.migration_rows SET status='skipped', updated_at=now() WHERE id=_r.id;
          _skipped := _skipped + 1; CONTINUE;
        END IF;
        -- Pre-commit dedup: reuse existing canonical when same key still resolves.
        SELECT l.canonical_entity_id INTO _reuse_id
          FROM public.migration_entity_links l
          JOIN public.blocks b ON b.id = l.canonical_entity_id AND b.society_id = _job.society_id
         WHERE l.society_id = _job.society_id AND l.source_type = _job.source_type
           AND l.entity_type = 'structure' AND l.source_key = _src_key
         LIMIT 1;
        IF _reuse_id IS NOT NULL THEN
          _new_id := _reuse_id; _structs_matched := _structs_matched + 1;
        ELSE
          INSERT INTO public.blocks (society_id, name, normalized_name)
            VALUES (_job.society_id,
              COALESCE(_r.mapped_json->>'structure_name', _r.mapped_json->>'name'),
              lower(regexp_replace(COALESCE(_r.mapped_json->>'structure_name', _r.mapped_json->>'name',''),
                '[^a-zA-Z0-9]+','','g')))
            RETURNING id INTO _new_id;
          _structs_created := _structs_created + 1;
        END IF;
      ELSE
        SELECT id INTO _new_id FROM public.blocks
          WHERE id = _r.resolved_entity_id AND society_id = _job.society_id;
        IF _new_id IS NULL THEN
          RAISE EXCEPTION 'provenance_mismatch' USING ERRCODE = 'MG001';
        END IF;
        _structs_matched := _structs_matched + 1;
      END IF;
      PERFORM public._migration_link_or_conflict(
        _job.society_id, _job_id, 'structure', _job.source_type,
        _src_key, _r.row_checksum, _new_id);
      UPDATE public.migration_rows
        SET resolved_entity_id = _new_id, status='committed', updated_at=now()
        WHERE id = _r.id;
      _committed := _committed + 1;
    END LOOP;

    ----- Units -----
    FOR _r IN
      SELECT * FROM public.migration_rows
       WHERE job_id = _job_id AND entity_type = 'unit'
         AND status IN ('valid','warning') AND action IN ('create','match_existing')
       ORDER BY row_number
    LOOP
      _src_key := COALESCE(_r.source_key, _r.row_checksum);
      _reuse_id := NULL;
      IF _r.action = 'create' THEN
        _block_id := NULL;
        IF COALESCE(_job.structure_mode,'structured') = 'structured' THEN
          SELECT b.id INTO _block_id FROM public.blocks b
            WHERE b.society_id = _job.society_id
              AND lower(b.name) = lower(COALESCE(_r.mapped_json->>'structure_name',''))
            LIMIT 1;
          IF _block_id IS NULL THEN
            RAISE EXCEPTION 'structure_not_found' USING ERRCODE = 'MG001';
          END IF;
        END IF;
        SELECT l.canonical_entity_id INTO _reuse_id
          FROM public.migration_entity_links l
          JOIN public.flats f ON f.id = l.canonical_entity_id AND f.society_id = _job.society_id
         WHERE l.society_id = _job.society_id AND l.source_type = _job.source_type
           AND l.entity_type = 'unit' AND l.source_key = _src_key
         LIMIT 1;
        IF _reuse_id IS NOT NULL THEN
          _flat_id := _reuse_id; _units_matched := _units_matched + 1;
        ELSE
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
        END IF;
      ELSE
        SELECT id INTO _flat_id FROM public.flats
          WHERE id = _r.resolved_entity_id AND society_id = _job.society_id;
        IF _flat_id IS NULL THEN
          RAISE EXCEPTION 'provenance_mismatch' USING ERRCODE = 'MG001';
        END IF;
        _units_matched := _units_matched + 1;
      END IF;
      PERFORM public._migration_link_or_conflict(
        _job.society_id, _job_id, 'unit', _job.source_type,
        _src_key, _r.row_checksum, _flat_id);
      UPDATE public.migration_rows
        SET resolved_entity_id = _flat_id, status='committed', updated_at=now()
        WHERE id = _r.id;
      _committed := _committed + 1;
    END LOOP;

    ----- Residents -----
    FOR _r IN
      SELECT * FROM public.migration_rows
       WHERE job_id = _job_id AND entity_type = 'resident'
         AND status IN ('valid','warning') AND action IN ('create','match_existing')
       ORDER BY row_number
    LOOP
      _src_key := COALESCE(_r.source_key, _r.mapped_json->>'external_resident_key', _r.row_checksum);
      _flat_id := NULL;
      SELECT f.id INTO _flat_id
        FROM public.flats f
        LEFT JOIN public.blocks b ON b.id = f.block_id
       WHERE f.society_id = _job.society_id
         AND lower(regexp_replace(f.flat_number, '[^a-zA-Z0-9]+','','g'))
             = lower(regexp_replace(COALESCE(_r.mapped_json->>'unit_label',''), '[^a-zA-Z0-9]+','','g'))
         AND (
           COALESCE(_r.mapped_json->>'structure_name','') = ''
           OR lower(b.name) = lower(_r.mapped_json->>'structure_name')
         )
       LIMIT 1;
      IF _flat_id IS NULL THEN
        RAISE EXCEPTION 'unit_not_found' USING ERRCODE = 'MG001';
      END IF;

      _reuse_id := NULL;
      IF _r.action = 'create' THEN
        -- Reuse existing offline_resident (or profile) tied to same key.
        SELECT l.canonical_entity_id INTO _reuse_id
          FROM public.migration_entity_links l
         WHERE l.society_id = _job.society_id AND l.source_type = _job.source_type
           AND l.entity_type = 'resident' AND l.source_key = _src_key
         LIMIT 1;
        IF _reuse_id IS NOT NULL AND (
             EXISTS (SELECT 1 FROM public.offline_residents WHERE id=_reuse_id AND society_id=_job.society_id)
             OR EXISTS (SELECT 1 FROM public.profiles WHERE id=_reuse_id AND society_id=_job.society_id)
           ) THEN
          _resident_id := _reuse_id;
          _residents_matched := _residents_matched + 1;
        ELSE
          INSERT INTO public.offline_residents (society_id, flat_id, full_name, phone, email)
            VALUES (_job.society_id, _flat_id,
                    COALESCE(_r.mapped_json->>'display_name', _r.mapped_json->>'full_name'),
                    NULLIF(_r.mapped_json->>'phone',''),
                    NULLIF(_r.mapped_json->>'email',''))
            RETURNING id INTO _resident_id;
          _residents_created := _residents_created + 1;
          _occupancies_created := _occupancies_created + 1;
        END IF;
      ELSE
        SELECT id INTO _resident_id FROM public.profiles
          WHERE id = _r.resolved_entity_id AND society_id = _job.society_id;
        IF _resident_id IS NULL THEN
          RAISE EXCEPTION 'resident_not_in_society' USING ERRCODE = 'MG001';
        END IF;
        _residents_matched := _residents_matched + 1;
        IF NOT EXISTS (
          SELECT 1 FROM public.flat_residents
           WHERE user_id = _resident_id AND flat_id = _flat_id AND is_active = true
        ) THEN
          INSERT INTO public.flat_residents (user_id, flat_id, relationship, is_active)
            VALUES (_resident_id, _flat_id,
                    COALESCE(NULLIF(_r.mapped_json->>'relationship',''),'resident'), true);
          _occupancies_created := _occupancies_created + 1;
        END IF;
      END IF;

      PERFORM public._migration_link_or_conflict(
        _job.society_id, _job_id, 'resident', _job.source_type,
        _src_key, _r.row_checksum, _resident_id);
      UPDATE public.migration_rows
        SET resolved_entity_id = _resident_id, status='committed', updated_at=now()
        WHERE id = _r.id;
      _committed := _committed + 1;
    END LOOP;

    ----- Family -----
    FOR _r IN
      SELECT * FROM public.migration_rows
       WHERE job_id = _job_id AND entity_type = 'family'
         AND status IN ('valid','warning') AND action = 'create'
       ORDER BY row_number
    LOOP
      _src_key := COALESCE(_r.source_key, _r.row_checksum);
      _resident_id := NULL; _flat_id := NULL; _family_id := NULL; _reuse_id := NULL;
      SELECT l.canonical_entity_id INTO _resident_id
        FROM public.migration_entity_links l
       WHERE l.society_id = _job.society_id
         AND l.entity_type = 'resident'
         AND l.source_type = _job.source_type
         AND l.source_key = COALESCE(_r.mapped_json->>'external_resident_key','')
       ORDER BY l.created_at DESC LIMIT 1;
      IF _resident_id IS NULL THEN
        RAISE EXCEPTION 'resident_link_missing' USING ERRCODE = 'MG001';
      END IF;

      -- Reuse existing family record for same key when still present.
      SELECT l.canonical_entity_id INTO _reuse_id
        FROM public.migration_entity_links l
        JOIN public.family_members fm ON fm.id = l.canonical_entity_id AND fm.society_id = _job.society_id
       WHERE l.society_id = _job.society_id AND l.source_type = _job.source_type
         AND l.entity_type = 'family' AND l.source_key = _src_key
       LIMIT 1;
      IF _reuse_id IS NOT NULL THEN
        _family_id := _reuse_id;
      ELSIF EXISTS (SELECT 1 FROM public.offline_residents WHERE id=_resident_id AND society_id=_job.society_id) THEN
        SELECT flat_id INTO _flat_id FROM public.offline_residents WHERE id=_resident_id;
        INSERT INTO public.family_members
          (user_id, offline_resident_id, society_id, flat_id, full_name, relation, phone, age)
          VALUES (NULL, _resident_id, _job.society_id, _flat_id,
                  COALESCE(_r.mapped_json->>'family_member_name', _r.mapped_json->>'full_name'),
                  COALESCE(NULLIF(_r.mapped_json->>'relation',''),'other'),
                  NULLIF(_r.mapped_json->>'phone',''),
                  NULLIF(_r.mapped_json->>'age','')::int)
          RETURNING id INTO _family_id;
        _family_created := _family_created + 1;
      ELSIF EXISTS (SELECT 1 FROM public.profiles WHERE id=_resident_id AND society_id=_job.society_id) THEN
        SELECT fr.flat_id INTO _flat_id FROM public.flat_residents fr
          WHERE fr.user_id=_resident_id AND fr.is_active=true
          ORDER BY fr.created_at DESC LIMIT 1;
        INSERT INTO public.family_members
          (user_id, society_id, flat_id, full_name, relation, phone, age)
          VALUES (_resident_id, _job.society_id, _flat_id,
                  COALESCE(_r.mapped_json->>'family_member_name', _r.mapped_json->>'full_name'),
                  COALESCE(NULLIF(_r.mapped_json->>'relation',''),'other'),
                  NULLIF(_r.mapped_json->>'phone',''),
                  NULLIF(_r.mapped_json->>'age','')::int)
          RETURNING id INTO _family_id;
        _family_created := _family_created + 1;
      ELSE
        RAISE EXCEPTION 'resident_link_invalid' USING ERRCODE = 'MG001';
      END IF;

      PERFORM public._migration_link_or_conflict(
        _job.society_id, _job_id, 'family', _job.source_type,
        _src_key, _r.row_checksum, _family_id);
      UPDATE public.migration_rows
        SET resolved_entity_id = _family_id, status='committed', updated_at=now()
        WHERE id = _r.id;
      _committed := _committed + 1;
    END LOOP;

    ----- Vehicles -----
    FOR _r IN
      SELECT * FROM public.migration_rows
       WHERE job_id = _job_id AND entity_type = 'vehicle'
         AND status IN ('valid','warning') AND action = 'create'
       ORDER BY row_number
    LOOP
      _src_key := COALESCE(_r.source_key, _r.row_checksum);
      _resident_id := NULL; _flat_id := NULL; _vehicle_id := NULL; _reuse_id := NULL;
      SELECT l.canonical_entity_id INTO _resident_id
        FROM public.migration_entity_links l
       WHERE l.society_id = _job.society_id
         AND l.entity_type = 'resident'
         AND l.source_type = _job.source_type
         AND l.source_key = COALESCE(_r.mapped_json->>'external_resident_key','')
       ORDER BY l.created_at DESC LIMIT 1;
      IF _resident_id IS NULL THEN
        RAISE EXCEPTION 'resident_link_missing' USING ERRCODE = 'MG001';
      END IF;

      _plate := COALESCE(_r.mapped_json->>'registration_number', _r.mapped_json->>'plate_number','');
      _norm  := upper(regexp_replace(_plate, '\s+', '', 'g'));
      IF length(_norm) < 3 THEN
        RAISE EXCEPTION 'invalid_plate' USING ERRCODE = 'MG001';
      END IF;

      -- Pre-commit dedup: reuse existing vehicle mapped from same source key.
      SELECT l.canonical_entity_id INTO _reuse_id
        FROM public.migration_entity_links l
        JOIN public.vehicles v ON v.id = l.canonical_entity_id AND v.society_id = _job.society_id
       WHERE l.society_id = _job.society_id AND l.source_type = _job.source_type
         AND l.entity_type = 'vehicle' AND l.source_key = _src_key
       LIMIT 1;
      IF _reuse_id IS NOT NULL THEN
        _vehicle_id := _reuse_id;
      ELSE
        IF EXISTS (
          SELECT 1 FROM public.vehicles
           WHERE society_id = _job.society_id AND is_active = true
             AND upper(regexp_replace(plate_number, '\s+', '', 'g')) = _norm
        ) THEN
          RAISE EXCEPTION 'duplicate_active_plate' USING ERRCODE = 'MG001';
        END IF;

        IF EXISTS (SELECT 1 FROM public.offline_residents WHERE id=_resident_id AND society_id=_job.society_id) THEN
          SELECT flat_id INTO _flat_id FROM public.offline_residents WHERE id=_resident_id;
          INSERT INTO public.vehicles
            (society_id, user_id, offline_resident_id, flat_id, plate_number, type, make_model, color, is_active)
            VALUES (_job.society_id, NULL, _resident_id, _flat_id, _norm,
                    COALESCE(NULLIF(_r.mapped_json->>'type',''),'car'),
                    NULLIF(_r.mapped_json->>'make_model',''),
                    NULLIF(_r.mapped_json->>'color',''), true)
            RETURNING id INTO _vehicle_id;
        ELSIF EXISTS (SELECT 1 FROM public.profiles WHERE id=_resident_id AND society_id=_job.society_id) THEN
          SELECT fr.flat_id INTO _flat_id FROM public.flat_residents fr
            WHERE fr.user_id=_resident_id AND fr.is_active=true
            ORDER BY fr.created_at DESC LIMIT 1;
          INSERT INTO public.vehicles
            (society_id, user_id, flat_id, plate_number, type, make_model, color, is_active)
            VALUES (_job.society_id, _resident_id, _flat_id, _norm,
                    COALESCE(NULLIF(_r.mapped_json->>'type',''),'car'),
                    NULLIF(_r.mapped_json->>'make_model',''),
                    NULLIF(_r.mapped_json->>'color',''), true)
            RETURNING id INTO _vehicle_id;
        ELSE
          RAISE EXCEPTION 'resident_link_invalid' USING ERRCODE = 'MG001';
        END IF;
        _vehicles_created := _vehicles_created + 1;
      END IF;

      PERFORM public._migration_link_or_conflict(
        _job.society_id, _job_id, 'vehicle', _job.source_type,
        _src_key, _r.row_checksum, _vehicle_id);
      UPDATE public.migration_rows
        SET resolved_entity_id = _vehicle_id, status='committed', updated_at=now()
        WHERE id = _r.id;
      _committed := _committed + 1;
    END LOOP;

    ----- Completion guard -----
    SELECT COUNT(*) INTO _outstanding FROM public.migration_rows
      WHERE job_id = _job_id
        AND status IN ('valid','warning')
        AND action IN ('create','match_existing');
    IF _outstanding > 0 THEN
      RAISE EXCEPTION 'rows_unresolved' USING ERRCODE = 'MG001';
    END IF;

  EXCEPTION
    WHEN SQLSTATE 'MG001' THEN
      _fail_code := SQLERRM;
      UPDATE public.migration_commit_requests
        SET status='failed', failed_at=now(), failure_code=_fail_code
        WHERE job_id=_job_id AND request_id=_request_id;
      UPDATE public.migration_jobs SET status='ready', updated_at=now() WHERE id=_job_id;
      RETURN jsonb_build_object('status','unresolved_conflicts','failure_code', _fail_code);
  END;

  SELECT COUNT(*) INTO _skipped FROM public.migration_rows
    WHERE job_id = _job_id AND status = 'skipped';

  _result := jsonb_build_object(
    'structures_created', _structs_created,
    'structures_matched', _structs_matched,
    'units_created', _units_created,
    'units_matched', _units_matched,
    'residents_created', _residents_created,
    'residents_matched', _residents_matched,
    'occupancies_created', _occupancies_created,
    'family_created', _family_created,
    'vehicles_created', _vehicles_created,
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
