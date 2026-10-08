-- The (uuid,text) overload is ambiguous with (uuid,text,uuid DEFAULT NULL):
-- every two-argument call failed with "is not unique". The three-argument
-- version with a NULL block returns identical results, has all dependents
-- and the same grants. Remove only the redundant overload.
DROP FUNCTION IF EXISTS public.current_user_has_society_permission(uuid, text);
REVOKE ALL ON FUNCTION public.current_user_has_society_permission(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_has_society_permission(uuid, text, uuid) TO authenticated, service_role;