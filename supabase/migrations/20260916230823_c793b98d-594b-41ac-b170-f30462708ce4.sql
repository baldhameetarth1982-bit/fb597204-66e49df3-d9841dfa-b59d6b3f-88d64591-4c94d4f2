DO $final_audit_payment_contract_check$
DECLARE
  offender record;
  v_submit_definition text;
BEGIN
  FOR offender IN
    SELECT n.nspname AS schema_name, p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS identity_arguments
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND pg_get_functiondef(p.oid) ~* 'insert[[:space:]]+into[[:space:]]+(public[.])?audit_log[[:space:]]*[(][^)]*(entity_type|entity_id|meta)([[:space:],)]|$)'
  LOOP
    RAISE EXCEPTION 'noncanonical audit_log writer remains: %.%(%)',
      offender.schema_name, offender.function_name, offender.identity_arguments;
  END LOOP;

  SELECT pg_get_functiondef('public.submit_offline_payment(uuid,text,numeric,date,text,text,text,text)'::regprocedure)
    INTO v_submit_definition;

  IF v_submit_definition !~* 'flat_id[[:space:]]*=[[:space:]]*b[.]flat_id[[:space:]]+AND[[:space:]]+user_id[[:space:]]*=[[:space:]]*uid[[:space:]]+AND[[:space:]]+is_active[[:space:]]*=[[:space:]]*true[[:space:]]+AND[[:space:]]+moved_out_at[[:space:]]+IS[[:space:]]+NULL' THEN
    RAISE EXCEPTION 'submit_offline_payment active occupancy guard is missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'payments'
       AND cmd = 'INSERT' AND 'authenticated' = ANY(roles)
  ) THEN
    RAISE EXCEPTION 'authenticated payment INSERT policy remains';
  END IF;

  IF has_table_privilege('authenticated', 'public.payments', 'INSERT')
     OR has_table_privilege('authenticated', 'public.payments', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.payments', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated direct payment mutation privilege remains';
  END IF;
END;
$final_audit_payment_contract_check$;