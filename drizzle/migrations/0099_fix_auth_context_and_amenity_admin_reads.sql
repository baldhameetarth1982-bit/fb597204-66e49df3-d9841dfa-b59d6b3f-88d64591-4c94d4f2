CREATE OR REPLACE FUNCTION public.get_current_auth_context()
RETURNS TABLE(profile jsonb,roles jsonb,primary_role text,society_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_user uuid:=auth.uid();v_society uuid;v_primary text;v_roles jsonb;v_profile jsonb;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
 SELECT CASE WHEN p.society_id IS NOT NULL AND public.authorize_membership(v_user,p.society_id) THEN p.society_id ELSE (
   SELECT ur.society_id FROM public.user_roles ur WHERE ur.user_id=v_user AND ur.is_active AND ur.society_id IS NOT NULL
   ORDER BY CASE ur.role WHEN 'society_admin'::public.app_role THEN 1 WHEN 'resident'::public.app_role THEN 2 WHEN 'block_admin'::public.app_role THEN 3 WHEN 'security'::public.app_role THEN 4 ELSE 9 END,ur.created_at LIMIT 1) END
 INTO v_society FROM public.profiles p WHERE p.id=v_user;
 SELECT coalesce(jsonb_agg(jsonb_build_object('role',ur.role,'society_id',ur.society_id,'block_id',ur.block_id) ORDER BY ur.created_at),'[]'::jsonb)
 INTO v_roles FROM public.user_roles ur WHERE ur.user_id=v_user AND ur.is_active AND (ur.role='super_admin'::public.app_role OR ur.society_id=v_society);
 SELECT CASE WHEN EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id=v_user AND ur.is_active AND ur.role='super_admin'::public.app_role) THEN 'super_admin'
   WHEN EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id=v_user AND ur.is_active AND ur.role='society_admin'::public.app_role AND ur.society_id=v_society) THEN 'society_admin'
   WHEN EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id=v_user AND ur.is_active AND ur.role='resident'::public.app_role AND ur.society_id=v_society) THEN 'resident'
   WHEN EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id=v_user AND ur.is_active AND ur.role='block_admin'::public.app_role AND ur.society_id=v_society) THEN 'block_admin'
   WHEN EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id=v_user AND ur.is_active AND ur.role='security'::public.app_role AND ur.society_id=v_society) THEN 'security' ELSE NULL END INTO v_primary;
 SELECT to_jsonb(p)||jsonb_build_object('society_id',v_society) INTO v_profile FROM public.profiles p WHERE p.id=v_user;
 RETURN QUERY SELECT v_profile,v_roles,v_primary,v_society;
END;
$$;

REVOKE ALL ON FUNCTION public._amenity_admin(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public._amenity_admin(uuid) TO authenticated,service_role;