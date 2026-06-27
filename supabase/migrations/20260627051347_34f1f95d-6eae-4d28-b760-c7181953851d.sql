-- Restrict user_points SELECT to own rows (was: any society member could read all members' point reasons)
DROP POLICY IF EXISTS "society members view points" ON public.user_points;
CREATE POLICY "users view own points"
  ON public.user_points
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Revoke EXECUTE on internal SECURITY DEFINER helpers that are not called by clients
-- and are only used by other SECURITY DEFINER functions.
REVOKE EXECUTE ON FUNCTION public.authorize_membership(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.find_referrer_by_code(text) FROM PUBLIC, anon, authenticated;