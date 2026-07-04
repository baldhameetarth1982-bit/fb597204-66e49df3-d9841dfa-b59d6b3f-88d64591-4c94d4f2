-- Restrict pricing_settings SELECT to super admins only
DROP POLICY IF EXISTS pricing_settings_read_auth ON public.pricing_settings;
CREATE POLICY pricing_settings_super_admin_read
  ON public.pricing_settings
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- Safe public helper returning only non-sensitive fields
CREATE OR REPLACE FUNCTION public.get_public_pricing_settings()
RETURNS TABLE(enterprise_threshold_units integer, trial_days integer, active_gateway text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT enterprise_threshold_units, trial_days, active_gateway
  FROM public.pricing_settings
  WHERE id = 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_pricing_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_pricing_settings() TO authenticated;