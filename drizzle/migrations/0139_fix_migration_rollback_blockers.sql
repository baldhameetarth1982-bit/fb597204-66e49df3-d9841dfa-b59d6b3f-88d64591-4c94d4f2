CREATE OR REPLACE FUNCTION public.migration_rollback_job(_job_id uuid, _reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  j record; v_ts timestamptz; v_reason text := nullif(btrim(coalesce(_reason,'')),'');
  v_blocks uuid[]; v_flats uuid[]; v_res uuid[]; v_fam uuid[]; v_veh uuid[]; v_blockers text[] := '{}';
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  SELECT * INTO j FROM migration_jobs WHERE id=_job_id FOR UPDATE;
  IF NOT FOUND OR NOT public.user_can_admin_migrations(auth.uid(), j.society_id) THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF v_reason IS NULL OR length(v_reason) < 5 OR length(v_reason) > 400 THEN RETURN jsonb_build_object('status','reason_required'); END IF;
  IF j.rolled_back_at IS NOT NULL THEN RETURN jsonb_build_object('status','already_rolled_back'); END IF;
  IF j.status <> 'completed' THEN RETURN jsonb_build_object('status','job_not_ready'); END IF;
  PERFORM public._rate_hit('migration_rollback', auth.uid()::text, 10, interval '1 hour');
  SELECT created_at INTO v_ts FROM migration_commit_requests WHERE job_id=_job_id AND status='completed' ORDER BY created_at LIMIT 1;
  IF v_ts IS NULL THEN RETURN jsonb_build_object('status','job_not_ready'); END IF;

  SELECT coalesce(array_agg(b.id),'{}') INTO v_blocks FROM migration_entity_links l JOIN blocks b ON b.id=l.canonical_entity_id
    WHERE l.job_id=_job_id AND l.entity_type='structure' AND b.society_id=j.society_id AND b.created_at=v_ts;
  SELECT coalesce(array_agg(f.id),'{}') INTO v_flats FROM migration_entity_links l JOIN flats f ON f.id=l.canonical_entity_id
    WHERE l.job_id=_job_id AND l.entity_type='unit' AND f.society_id=j.society_id AND f.created_at=v_ts;
  SELECT coalesce(array_agg(o.id),'{}') INTO v_res FROM migration_entity_links l JOIN offline_residents o ON o.id=l.canonical_entity_id
    WHERE l.job_id=_job_id AND l.entity_type='resident' AND o.society_id=j.society_id AND o.created_at=v_ts;
  SELECT coalesce(array_agg(m.id),'{}') INTO v_fam FROM migration_entity_links l JOIN family_members m ON m.id=l.canonical_entity_id
    WHERE l.job_id=_job_id AND l.entity_type='family' AND m.created_at=v_ts;
  SELECT coalesce(array_agg(v.id),'{}') INTO v_veh FROM migration_entity_links l JOIN vehicles v ON v.id=l.canonical_entity_id
    WHERE l.job_id=_job_id AND l.entity_type='vehicle' AND v.society_id=j.society_id AND v.created_at=v_ts;

  IF EXISTS (SELECT 1 FROM bills WHERE flat_id = ANY(v_flats)) THEN v_blockers := array_append(v_blockers, 'bills'::text); END IF;
  IF EXISTS (SELECT 1 FROM payments WHERE flat_id = ANY(v_flats)) THEN v_blockers := array_append(v_blockers, 'payments'::text); END IF;
  IF EXISTS (SELECT 1 FROM opening_balances WHERE flat_id = ANY(v_flats)) THEN v_blockers := array_append(v_blockers, 'opening_balances'::text); END IF;
  IF EXISTS (SELECT 1 FROM historical_payments WHERE flat_id = ANY(v_flats)) THEN v_blockers := array_append(v_blockers, 'past_payments'::text); END IF;
  IF EXISTS (SELECT 1 FROM maintenance_periods WHERE flat_id = ANY(v_flats)) THEN v_blockers := array_append(v_blockers, 'maintenance'::text); END IF;
  IF EXISTS (SELECT 1 FROM no_dues_requests WHERE flat_id = ANY(v_flats)) OR EXISTS (SELECT 1 FROM no_dues_certificates WHERE flat_id = ANY(v_flats)) THEN v_blockers := array_append(v_blockers, 'no_dues'::text); END IF;
  IF EXISTS (SELECT 1 FROM amenity_bookings WHERE flat_id = ANY(v_flats)) THEN v_blockers := array_append(v_blockers, 'amenity_bookings'::text); END IF;
  IF EXISTS (SELECT 1 FROM join_requests WHERE flat_id = ANY(v_flats)) THEN v_blockers := array_append(v_blockers, 'join_requests'::text); END IF;
  IF EXISTS (SELECT 1 FROM visitor_recurring_passes WHERE flat_id = ANY(v_flats)) THEN v_blockers := array_append(v_blockers, 'visitor_passes'::text); END IF;
  IF EXISTS (SELECT 1 FROM unit_billing_overrides WHERE flat_id = ANY(v_flats)) THEN v_blockers := array_append(v_blockers, 'billing_overrides'::text); END IF;
  IF EXISTS (SELECT 1 FROM parking_slots WHERE flat_id = ANY(v_flats) OR vehicle_id = ANY(v_veh)) THEN v_blockers := array_append(v_blockers, 'parking'::text); END IF;
  IF EXISTS (SELECT 1 FROM sos_alerts WHERE flat_id = ANY(v_flats)) THEN v_blockers := array_append(v_blockers, 'sos_alerts'::text); END IF;
  IF EXISTS (SELECT 1 FROM flat_residents WHERE flat_id = ANY(v_flats)) THEN v_blockers := array_append(v_blockers, 'app_residents'::text); END IF;
  IF EXISTS (SELECT 1 FROM offline_residents WHERE flat_id = ANY(v_flats) AND NOT (id = ANY(v_res))) THEN v_blockers := array_append(v_blockers, 'other_residents'::text); END IF;
  IF EXISTS (SELECT 1 FROM family_members WHERE (flat_id = ANY(v_flats) OR offline_resident_id = ANY(v_res)) AND NOT (id = ANY(v_fam))) THEN v_blockers := array_append(v_blockers, 'other_family'::text); END IF;
  IF EXISTS (SELECT 1 FROM vehicles WHERE (flat_id = ANY(v_flats) OR offline_resident_id = ANY(v_res)) AND NOT (id = ANY(v_veh))) THEN v_blockers := array_append(v_blockers, 'other_vehicles'::text); END IF;
  IF EXISTS (SELECT 1 FROM flats WHERE block_id = ANY(v_blocks) AND NOT (id = ANY(v_flats))) THEN v_blockers := array_append(v_blockers, 'other_units'::text); END IF;
  IF EXISTS (SELECT 1 FROM user_roles WHERE block_id = ANY(v_blocks)) OR EXISTS (SELECT 1 FROM user_role_block_scopes WHERE block_id = ANY(v_blocks))
     OR EXISTS (SELECT 1 FROM notices WHERE block_id = ANY(v_blocks)) THEN v_blockers := array_append(v_blockers, 'structure_in_use'::text); END IF;
  IF array_length(v_blockers,1) > 0 THEN
    INSERT INTO audit_log (actor_id, action, target_table, target_id, society_id, metadata)
      VALUES (auth.uid(), 'migration.rollback_refused', 'migration_jobs', _job_id::text, j.society_id, jsonb_build_object('blockers', v_blockers));
    RETURN jsonb_build_object('status','blocked_by_dependents','blockers', to_jsonb(v_blockers));
  END IF;

  DELETE FROM vehicles WHERE id = ANY(v_veh);
  DELETE FROM family_members WHERE id = ANY(v_fam);
  DELETE FROM offline_residents WHERE id = ANY(v_res);
  DELETE FROM flats WHERE id = ANY(v_flats);
  DELETE FROM blocks WHERE id = ANY(v_blocks);
  DELETE FROM migration_entity_links WHERE job_id=_job_id
    AND canonical_entity_id = ANY(v_blocks || v_flats || v_res || v_fam || v_veh);
  UPDATE migration_jobs SET rolled_back_at=now(), rolled_back_by=auth.uid(), rollback_reason=v_reason, updated_at=now(),
    rollback_summary=jsonb_build_object('structures',cardinality(v_blocks),'units',cardinality(v_flats),'residents',cardinality(v_res),
      'family',cardinality(v_fam),'vehicles',cardinality(v_veh))
    WHERE id=_job_id;
  INSERT INTO audit_log (actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (auth.uid(), 'migration.rolled_back', 'migration_jobs', _job_id::text, j.society_id,
      jsonb_build_object('reason', v_reason, 'structures', v_blocks, 'units', v_flats, 'residents', v_res, 'family', v_fam, 'vehicles', v_veh));
  RETURN jsonb_build_object('status','ok','structures',cardinality(v_blocks),'units',cardinality(v_flats),'residents',cardinality(v_res),
    'family',cardinality(v_fam),'vehicles',cardinality(v_veh));
END $function$;