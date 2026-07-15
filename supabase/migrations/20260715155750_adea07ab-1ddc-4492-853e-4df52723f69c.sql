GRANT EXECUTE ON FUNCTION public.get_admin_society_ids(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_admin_block_ids(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_user_society_id(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO anon;