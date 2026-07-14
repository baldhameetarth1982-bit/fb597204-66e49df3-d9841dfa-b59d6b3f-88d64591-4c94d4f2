-- Turn 13: Explicit, additive REVOKE + GRANT hardening for No-Dues / Flat 360
-- function ACLs. Belt-and-suspenders even where defaults already look correct.

-- 1. Internal trusted-actor functions & privileged mutation RPCs:
--    service_role EXECUTE only; deny PUBLIC/anon/authenticated.
DO $$
DECLARE fn text;
BEGIN
  FOR fn IN SELECT unnest(ARRAY[
    'public.is_society_admin_for_internal(uuid,uuid)',
    'public.is_super_admin_internal(uuid)',
    'public.is_block_admin_for_flat_internal(uuid,uuid)',
    'public.can_manage_flat_internal(uuid,uuid)',
    'public.compute_no_dues_eligibility_internal(uuid,uuid)',
    'public.submit_no_dues_request_internal(uuid,uuid,uuid,text)',
    'public.transition_no_dues_request_internal(uuid,uuid,text,text,text)',
    'public.finalize_no_dues_issuance_internal(uuid,uuid,text,text,text,text,smallint,text,date)',
    'public.revoke_no_dues_certificate_internal(uuid,uuid,text)',
    'public.recheck_no_dues_request_internal(uuid,uuid)',
    'public.next_no_dues_cert_number_internal(uuid,uuid)',
    'public.touch_rate_limit(text,text,integer,integer)',
    'public.is_society_admin_for(uuid,uuid)',
    'public.is_super_admin(uuid)'
  ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

-- 2. Authenticated current-user wrappers: authenticated + service_role only.
DO $$
DECLARE fn text;
BEGIN
  FOR fn IN SELECT unnest(ARRAY[
    'public.current_user_is_society_admin_for(uuid)',
    'public.current_user_is_super_admin()',
    'public.current_user_can_manage_flat(uuid)'
  ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;