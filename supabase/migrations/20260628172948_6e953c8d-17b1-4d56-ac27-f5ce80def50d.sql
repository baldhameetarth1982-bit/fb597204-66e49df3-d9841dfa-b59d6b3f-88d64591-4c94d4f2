GRANT EXECUTE ON FUNCTION public.get_admin_society_ids(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_block_ids(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_society_id(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_society_admin_for(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_membership(uuid, uuid) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';