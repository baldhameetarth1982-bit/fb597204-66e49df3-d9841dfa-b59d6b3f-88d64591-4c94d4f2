-- Restore missing Data API GRANTs on societies and EXECUTE on helper functions.
-- Table-level privileges were absent (RLS policies existed but PostgREST returned
-- "permission denied for table societies"). Helper functions used inside RLS
-- policies (get_user_society_id, get_admin_society_ids, etc.) also lost EXECUTE
-- for the authenticated role.

GRANT SELECT, INSERT, UPDATE ON public.societies TO authenticated;
GRANT ALL ON public.societies TO service_role;

-- Helper functions used by RLS and by client-facing code (RPCs) must be
-- executable by authenticated users. These are SECURITY DEFINER with their
-- own internal auth checks.
GRANT EXECUTE ON FUNCTION public.get_user_society_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_society_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_block_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_membership(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.society_has_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_society_plan(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_auth_context() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_society_business_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_society_payout_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.society_payout_active(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_razorpay_public_config() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_society_flats_public(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_societies_by_name(text) TO authenticated;

-- is_society_admin_for is called by many policies; grant to authenticated.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_society_admin_for'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO authenticated', r.nspname, r.proname, r.args);
  END LOOP;
END $$;