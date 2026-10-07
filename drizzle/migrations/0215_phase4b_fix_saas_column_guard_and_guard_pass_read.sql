-- Phase 4B fixes found by the tenant/role security harness.
-- 1) The SaaS-column guard compared current_user with 'authenticated'/'anon',
--    but as SECURITY DEFINER current_user was always the owner, so the guard
--    never fired and a society admin could change their own plan/billing
--    columns directly. Run it as the caller so the check works as designed;
--    trusted RPCs and server code still run as other roles and are unaffected.
ALTER FUNCTION public._societies_protect_saas_columns() SECURITY INVOKER;

-- 2) The "Guards read approved passes" policy calls _guard_role_society(),
--    which signed-in users could not execute, so reading material passes
--    failed. It only returns the caller's own guard society.
GRANT EXECUTE ON FUNCTION public._guard_role_society() TO authenticated;