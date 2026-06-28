GRANT EXECUTE ON FUNCTION public.get_admin_society_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_block_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_block_admin(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_society_admin_for(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_membership(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_society_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;