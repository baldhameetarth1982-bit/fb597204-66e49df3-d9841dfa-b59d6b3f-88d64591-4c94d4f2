CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role AND COALESCE(is_active,true)) $f$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $f$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role='super_admin'::public.app_role AND COALESCE(is_active,true)) $f$;

CREATE OR REPLACE FUNCTION public.is_super_admin_internal(_actor_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$ SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=_actor_id AND ur.role='super_admin' AND COALESCE(ur.is_active,true)) $f$;

CREATE OR REPLACE FUNCTION public.is_society_admin_for_internal(_actor_id uuid, _society_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$ SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=_actor_id AND ur.role='society_admin'::public.app_role AND ur.society_id=_society_id AND COALESCE(ur.is_active,true)) $f$;