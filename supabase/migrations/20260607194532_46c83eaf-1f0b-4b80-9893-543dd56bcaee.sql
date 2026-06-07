CREATE OR REPLACE FUNCTION public.is_society_admin_for(_user_id uuid, _society_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = 'society_admin'::public.app_role
      AND society_id = _society_id
      AND society_id IS NOT NULL
  )
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = 'super_admin'::public.app_role
  )
$$;

DROP POLICY IF EXISTS "society admins manage roles in their society" ON public.user_roles;
DROP POLICY IF EXISTS "super admins manage all roles" ON public.user_roles;

CREATE POLICY "society admins manage roles in their society"
ON public.user_roles
FOR ALL
TO authenticated
USING (public.is_society_admin_for(auth.uid(), society_id))
WITH CHECK (public.is_society_admin_for(auth.uid(), society_id));

CREATE POLICY "super admins manage all roles"
ON public.user_roles
FOR ALL
TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));