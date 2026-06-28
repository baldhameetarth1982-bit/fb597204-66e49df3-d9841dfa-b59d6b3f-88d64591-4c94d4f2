-- Restore EXECUTE on RLS-helper functions. They are SECURITY DEFINER and only
-- return ids the caller already has a role-row for, so exposing EXECUTE to
-- authenticated is safe and REQUIRED by the profiles/flats/bills RLS policies.
GRANT EXECUTE ON FUNCTION public.get_admin_society_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_block_ids(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_block_admin(uuid, uuid)  TO authenticated;