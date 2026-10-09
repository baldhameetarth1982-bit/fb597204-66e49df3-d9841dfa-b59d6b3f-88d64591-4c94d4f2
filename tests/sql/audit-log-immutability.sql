-- Audit-history immutability harness (rollback-only, disposable DB only).
-- Proves service_role cannot UPDATE/DELETE an audit row, the row stays unchanged,
-- the final trigger function has no role exception, and deleting the actor
-- account no longer tries to rewrite audit history (no actor FK).
-- Output: AUDIT_RESULT|pass=<n>|fail=<n>|<failures or OK>
DO $aud$
DECLARE
  v_id uuid := gen_random_uuid();
  v_actor uuid := '7a7b0000-0000-4000-8000-0000000000a1';
  pass int := 0; failn int := 0; fails text := '';
  v_action text; v_src text; v_state text;
BEGIN
  PERFORM set_config('role', 'postgres', true);
  INSERT INTO public.audit_log(id, actor_id, action, target_table, metadata)
    VALUES (v_id, v_actor, '[QA] audit.synthetic', 'qa', '{}'::jsonb);

  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
  PERFORM set_config('role', 'service_role', true);
  BEGIN
    UPDATE public.audit_log SET action = 'tampered' WHERE id = v_id;
    failn := failn + 1; fails := fails || 'update_allowed;';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state IN ('55000','42501') THEN pass := pass + 1; ELSE failn := failn + 1; fails := fails || 'update_'||v_state||';'; END IF;
  END;
  BEGIN
    DELETE FROM public.audit_log WHERE id = v_id;
    failn := failn + 1; fails := fails || 'delete_allowed;';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state IN ('55000','42501') THEN pass := pass + 1; ELSE failn := failn + 1; fails := fails || 'delete_'||v_state||';'; END IF;
  END;

  -- Even the table owner path hits the trigger (no role exception in the function).
  PERFORM set_config('role', 'postgres', true);
  BEGIN
    UPDATE public.audit_log SET action = 'tampered' WHERE id = v_id;
    failn := failn + 1; fails := fails || 'owner_update_allowed;';
  EXCEPTION WHEN SQLSTATE '55000' THEN pass := pass + 1;
  END;

  SELECT action INTO v_action FROM public.audit_log WHERE id = v_id;
  IF v_action = '[QA] audit.synthetic' THEN pass := pass + 1; ELSE failn := failn + 1; fails := fails || 'row_changed;'; END IF;

  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public._protect_audit_log_history()'::regprocedure;
  IF v_src !~* 'service_role' AND v_src !~* 'RETURN' THEN pass := pass + 1; ELSE failn := failn + 1; fails := fails || 'function_has_exception;'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.audit_log'::regclass AND contype = 'f'
                 AND confrelid = 'auth.users'::regclass) THEN pass := pass + 1;
  ELSE failn := failn + 1; fails := fails || 'actor_fk_rewrites_history;'; END IF;

  RAISE NOTICE 'AUDIT_RESULT|pass=%|fail=%|%', pass, failn, CASE WHEN failn = 0 THEN 'OK' ELSE fails END;
  RAISE EXCEPTION 'rollback audit harness';
END $aud$;
