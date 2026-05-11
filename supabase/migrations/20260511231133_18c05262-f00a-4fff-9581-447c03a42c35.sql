ALTER FUNCTION public.generate_society_code() SET search_path = public;

REVOKE ALL ON FUNCTION public.find_society_by_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_society_by_code(TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.join_society_with_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_society_with_code(TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.is_block_admin(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_block_admin(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated;