-- Writes to staff roles and announcements go only through the audited SECURITY DEFINER functions.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.platform_staff_roles FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.platform_announcements FROM anon, authenticated;
REVOKE ALL ON public.platform_staff_roles FROM anon;
REVOKE ALL ON public.platform_announcements FROM anon;