
-- 1) Tighten SECURITY DEFINER EXECUTE grants
REVOKE EXECUTE ON FUNCTION public.prevent_society_id_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.society_has_access(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.start_trial_for_society(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.activate_society_plan(uuid, text, integer) FROM PUBLIC, anon, authenticated;

-- 2) Hide invite_code from residents via column-level privileges; admins read it via get_society_invite_code() RPC
REVOKE SELECT ON public.societies FROM authenticated;
GRANT SELECT (
  id, name, registration_no, address, city, state, pincode, logo_url,
  plan, status, created_at, updated_at, plan_id, trial_ends_at,
  billing_active, property_type, plan_status, plan_expires_at, plan_selected_at
) ON public.societies TO authenticated;

-- 3) rate_limits: RLS enabled but no policy. Add explicit service-role-only policy to satisfy linter and document intent.
CREATE POLICY "service_role manages rate_limits"
  ON public.rate_limits
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
