CREATE OR REPLACE FUNCTION public.is_society_admin_for(_society_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL AND public.is_society_admin_for(auth.uid(), _society_id)
$$;
REVOKE ALL ON FUNCTION public.is_society_admin_for(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_society_admin_for(uuid) TO authenticated;

DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.list_society_residents_page(uuid,text,uuid,text,boolean,integer,integer)'::regprocedure);
  d := replace(d, 'SELECT structure_mode INTO v_mode FROM public.societies WHERE id = _society_id;',
                  'SELECT s.structure_mode INTO v_mode FROM public.societies s WHERE s.id = _society_id;');
  EXECUTE d;
END $do$;