-- Removed (inactive) society admins must lose access everywhere; six legacy policies ignored is_active.
DO $m$
DECLARE p record; q text; w text;
  f text := '(user_roles.role = ''society_admin''::app_role)';
  t text := '(user_roles.role = ''society_admin''::app_role) AND (user_roles.is_active IS NOT FALSE)';
BEGIN
  FOR p IN SELECT c.relname, pol.polname, pg_get_expr(pol.polqual, pol.polrelid) qual, pg_get_expr(pol.polwithcheck, pol.polrelid) chk
    FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('bills','community_digests','payments','poll_options','polls','posts')
      AND (coalesce(pg_get_expr(pol.polqual, pol.polrelid),'') || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid),'')) LIKE '%' || f || '%'
      AND coalesce(pg_get_expr(pol.polqual, pol.polrelid),'') NOT LIKE '%is_active%'
  LOOP
    q := CASE WHEN p.qual IS NOT NULL THEN format(' USING (%s)', replace(p.qual, f, t)) ELSE '' END;
    w := CASE WHEN p.chk IS NOT NULL THEN format(' WITH CHECK (%s)', replace(p.chk, f, t)) ELSE '' END;
    EXECUTE format('ALTER POLICY %I ON public.%I%s%s', p.polname, p.relname, q, w);
  END LOOP;
END $m$;