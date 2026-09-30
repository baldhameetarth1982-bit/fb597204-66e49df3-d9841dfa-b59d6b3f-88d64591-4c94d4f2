DO $m$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.compare_migration_units(uuid,jsonb)'::regprocedure);
  IF position($q$v_diff := v_diff || 'area_sqft'$q$ IN d) = 0 OR position($q$v_diff := v_diff || 'unit_type'$q$ IN d) = 0 THEN
    RAISE EXCEPTION 'shape_changed';
  END IF;
  d := replace(d, $q$v_diff := v_diff || 'area_sqft'$q$, $q$v_diff := array_append(v_diff, 'area_sqft'::text)$q$);
  d := replace(d, $q$v_diff := v_diff || 'unit_type'$q$, $q$v_diff := array_append(v_diff, 'unit_type'::text)$q$);
  EXECUTE d;
END $m$;