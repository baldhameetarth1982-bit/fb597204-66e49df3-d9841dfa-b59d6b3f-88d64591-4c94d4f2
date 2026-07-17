-- Stage 2E closure — atomic rollback, real provenance for family/vehicle,
-- FK safety on offline_resident_id references.

-- 1) FK safety: prevent silent CASCADE deletes from removing family/vehicle
--    history when an offline resident record is removed. Switch to RESTRICT.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'family_members_offline_resident_id_fkey') THEN
    ALTER TABLE public.family_members DROP CONSTRAINT family_members_offline_resident_id_fkey;
  END IF;
  ALTER TABLE public.family_members
    ADD CONSTRAINT family_members_offline_resident_id_fkey
    FOREIGN KEY (offline_resident_id) REFERENCES public.offline_residents(id) ON DELETE RESTRICT;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_offline_resident_id_fkey') THEN
    ALTER TABLE public.vehicles DROP CONSTRAINT vehicles_offline_resident_id_fkey;
  END IF;
  ALTER TABLE public.vehicles
    ADD CONSTRAINT vehicles_offline_resident_id_fkey
    FOREIGN KEY (offline_resident_id) REFERENCES public.offline_residents(id) ON DELETE RESTRICT;
END$$;

-- 2) commit_migration_job: atomic rollback via nested BEGIN/EXCEPTION block,
--    real canonical IDs for family/vehicle links, and match_existing provenance
--    guard for residents.
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

  -- === Atomic phase: all canonical writes below run inside a nested block.
  -- RAISE EXCEPTION USING ERRCODE 'MG001' rolls back ALL writes in the block
  -- (subtransaction) before the EXCEPTION handler records the failure.
  BEGIN

    ----- Structures -----
    FOR _r IN
      SELECT * FROM public.migration_rows
       WHERE job_id = _job_id AND entity_type = 'structure'
         AND status IN ('valid','warning') AND action IN ('create','match_existing')
       ORDER BY row_number
    LOOP
      IF _r.action = 'create' THEN
        IF COALESCE(_job.structure_mode,'structured') <> 'structured' THEN
          UPDATE public.migration_rows SET status='skipped', updated_at=now() WHERE id=_r.id;
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
          RAISE EXCEPTION 'provenance_mismatch' USING ERRCODE = 'MG001';
        END IF;
        _structs_matched := _structs_matched + 1;
      END IF;
      INSERT INTO public.migration_entity_links
        (society_id, job_id, entity_type, source_type, source_key, source_checksum, canonical_entity_id)
      VALUES (_job.society_id, _job_id, 'structure', _job.source_type,
              COALESCE(_r.source_key, _r.row_checksum), _r.row_checksum, _new_id)
      ON CONFLICT DO NOTHING;
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
          RAISE EXCEPTION 'provenance_mismatch' USING ERRCODE = 'MG001';
        END IF;
        _units_matched := _units_matched + 1;
      END IF;
      INSERT INTO public.migration_entity_links
        (society_id, job_id, entity_type, source_type, source_key, source_checksum, canonical_entity_id)
      VALUES (_job.society_id, _job_id, 'unit', _job.source_type,
              COALESCE(_r.source_key, _r.row_checksum), _r.row_checksum, _flat_id)
      ON CONFLICT DO NOTHING;
      UPDATE public.migration_rows
        SET resolved_entity_id = _flat_id, status='committed', updated_at=now()
        WHERE id = _r.id;
      _committed := _committed + 1;
    END LOOP;

    ----- Residents (create → offline_resident; match_existing → profile) -----
    FOR _r IN
      SELECT * FROM public.migration_rows
       WHERE job_id = _job_id AND entity_type = 'resident'
         AND status IN ('valid','warning') AND action IN ('create','match_existing')
       ORDER BY row_number
    LOOP
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

      IF _r.action = 'create' THEN
        INSERT INTO public.offline_residents (society_id, flat_id, full_name, phone, email)
          VALUES (_job.society_id, _flat_id,
                  COALESCE(_r.mapped_json->>'display_name', _r.mapped_json->>'full_name'),
                  NULLIF(_r.mapped_json->>'phone',''),
                  NULLIF(_r.mapped_json->>'email',''))
          RETURNING id INTO _resident_id;
        _residents_created := _residents_created + 1;
        _occupancies_created := _occupancies_created + 1;
      ELSE
        -- match_existing: verify profile still exists in the society; else provenance_mismatch.
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

      INSERT INTO public.migration_entity_links
        (society_id, job_id, entity_type, source_type, source_key, source_checksum, canonical_entity_id)
      VALUES (_job.society_id, _job_id, 'resident', _job.source_type,
              COALESCE(_r.source_key, _r.mapped_json->>'external_resident_key', _r.row_checksum),
              _r.row_checksum, _resident_id)
      ON CONFLICT DO NOTHING;
      UPDATE public.migration_rows
        SET resolved_entity_id = _resident_id, status='committed', updated_at=now()
        WHERE id = _r.id;
      _committed := _committed + 1;
    END LOOP;

    ----- Family (canonical_entity_id = family_members.id, not resident id) -----
    FOR _r IN
      SELECT * FROM public.migration_rows
       WHERE job_id = _job_id AND entity_type = 'family'
         AND status IN ('valid','warning') AND action = 'create'
       ORDER BY row_number
    LOOP
      _resident_id := NULL; _flat_id := NULL; _family_id := NULL;
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

      IF EXISTS (SELECT 1 FROM public.offline_residents WHERE id=_resident_id AND society_id=_job.society_id) THEN
        SELECT flat_id INTO _flat_id FROM public.offline_residents WHERE id=_resident_id;
        INSERT INTO public.family_members
          (user_id, offline_resident_id, society_id, flat_id, full_name, relation, phone, age)
          VALUES (NULL, _resident_id, _job.society_id, _flat_id,
                  COALESCE(_r.mapped_json->>'family_member_name', _r.mapped_json->>'full_name'),
                  COALESCE(NULLIF(_r.mapped_json->>'relation',''),'other'),
                  NULLIF(_r.mapped_json->>'phone',''),
                  NULLIF(_r.mapped_json->>'age','')::int)
          RETURNING id INTO _family_id;
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
      ELSE
        RAISE EXCEPTION 'resident_link_invalid' USING ERRCODE = 'MG001';
      END IF;

      _family_created := _family_created + 1;
      INSERT INTO public.migration_entity_links
        (society_id, job_id, entity_type, source_type, source_key, source_checksum, canonical_entity_id)
      VALUES (_job.society_id, _job_id, 'family', _job.source_type,
              COALESCE(_r.source_key, _r.row_checksum), _r.row_checksum, _family_id)
      ON CONFLICT DO NOTHING;
      UPDATE public.migration_rows
        SET resolved_entity_id = _family_id, status='committed', updated_at=now()
        WHERE id = _r.id;
      _committed := _committed + 1;
    END LOOP;

    ----- Vehicles (canonical_entity_id = vehicles.id) -----
    FOR _r IN
      SELECT * FROM public.migration_rows
       WHERE job_id = _job_id AND entity_type = 'vehicle'
         AND status IN ('valid','warning') AND action = 'create'
       ORDER BY row_number
    LOOP
      _resident_id := NULL; _flat_id := NULL; _vehicle_id := NULL;
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
      INSERT INTO public.migration_entity_links
        (society_id, job_id, entity_type, source_type, source_key, source_checksum, canonical_entity_id)
      VALUES (_job.society_id, _job_id, 'vehicle', _job.source_type,
              COALESCE(_r.source_key, _r.row_checksum), _r.row_checksum, _vehicle_id)
      ON CONFLICT DO NOTHING;
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
      -- All canonical writes since the inner BEGIN have been rolled back.
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

-- 3) Server-derived setup checklist for Stage 2 closure. Returns simple
--    booleans/counts for the society. RLS on the function is authenticated;
--    scope check is done inside the definer body.
CREATE OR REPLACE FUNCTION public.migration_setup_checklist(_society_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _blocks INT; _flats INT; _residents INT; _completed_imports INT;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF NOT public.user_can_admin_migrations(_uid, _society_id) THEN
    RETURN jsonb_build_object('status','unavailable');
  END IF;
  SELECT COUNT(*) INTO _blocks FROM public.blocks WHERE society_id=_society_id;
  SELECT COUNT(*) INTO _flats  FROM public.flats  WHERE society_id=_society_id;
  SELECT COUNT(*) INTO _residents FROM public.flat_residents fr
    JOIN public.flats f ON f.id=fr.flat_id
    WHERE f.society_id=_society_id AND fr.is_active=true;
  SELECT COUNT(*) INTO _completed_imports FROM public.migration_jobs
    WHERE society_id=_society_id AND status='completed';
  RETURN jsonb_build_object(
    'status','ok',
    'has_blocks', _blocks > 0,
    'has_flats',  _flats  > 0,
    'has_residents', _residents > 0,
    'has_completed_imports', _completed_imports > 0,
    'blocks', _blocks, 'flats', _flats,
    'active_residents', _residents,
    'completed_imports', _completed_imports
  );
END;
$$;
REVOKE ALL ON FUNCTION public.migration_setup_checklist(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.migration_setup_checklist(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.migration_setup_checklist(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.migration_setup_checklist(UUID) TO service_role;