REVOKE ALL ON FUNCTION public.is_login_account_locked(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_login_account_locked(text, integer, integer) TO service_role;

DROP POLICY IF EXISTS "guards & admins manage visitors in their society" ON public.visitors;
CREATE POLICY "admins manage visitors in their society"
ON public.visitors
FOR ALL
TO authenticated
USING (
  society_id IN (
    SELECT ur.society_id
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('society_admin', 'block_admin')
      AND ur.is_active IS NOT FALSE
      AND ur.society_id IS NOT NULL
  )
)
WITH CHECK (
  society_id IN (
    SELECT ur.society_id
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('society_admin', 'block_admin')
      AND ur.is_active IS NOT FALSE
      AND ur.society_id IS NOT NULL
  )
);

DROP POLICY IF EXISTS "guards & admins view society vehicles" ON public.vehicles;
CREATE POLICY "admins view society vehicles"
ON public.vehicles
FOR SELECT
TO authenticated
USING (
  society_id IN (
    SELECT ur.society_id
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('society_admin', 'block_admin')
      AND ur.is_active IS NOT FALSE
      AND ur.society_id IS NOT NULL
  )
);

COMMENT ON FUNCTION public.is_login_account_locked(text, integer, integer) IS 'Server-only 15-minute account lockout check; not callable by anonymous browser clients.';