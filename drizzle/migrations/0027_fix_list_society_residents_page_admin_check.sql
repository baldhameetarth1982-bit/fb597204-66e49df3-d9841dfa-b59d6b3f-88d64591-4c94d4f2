CREATE OR REPLACE FUNCTION public.list_society_residents_page(_society_id uuid, _search text DEFAULT NULL::text, _flat_id uuid DEFAULT NULL::uuid, _relationship text DEFAULT NULL::text, _active_only boolean DEFAULT true, _limit integer DEFAULT 25, _offset integer DEFAULT 0)
 RETURNS TABLE(user_id uuid, full_name text, avatar_url text, flat_id uuid, flat_number text, block_name text, structure_mode text, relationship text, is_active boolean, is_primary boolean, moved_in_at timestamp with time zone, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_limit int := LEAST(GREATEST(coalesce(_limit,25),1),100);
  v_offset int := GREATEST(coalesce(_offset,0),0);
  v_search text := nullif(trim(coalesce(_search,'')),'');
  v_mode text;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_society_admin_for(auth.uid(), _society_id) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT structure_mode INTO v_mode FROM public.societies WHERE id = _society_id;

  RETURN QUERY
  WITH base AS (
    SELECT p.id AS user_id, p.full_name, p.avatar_url, fr.flat_id, f.flat_number, b.name AS block_name,
      fr.relationship, fr.is_active, fr.is_primary, fr.moved_in_at,
      row_number() OVER (PARTITION BY p.id ORDER BY fr.is_primary DESC NULLS LAST, fr.is_active DESC, fr.moved_in_at DESC NULLS LAST) AS rn
    FROM public.profiles p
    LEFT JOIN public.flat_residents fr ON fr.user_id = p.id
    LEFT JOIN public.flats f ON f.id = fr.flat_id AND f.society_id = _society_id
    LEFT JOIN public.blocks b ON b.id = f.block_id
    WHERE p.society_id = _society_id
  ),
  filtered AS (
    SELECT * FROM base
    WHERE rn = 1
      AND (v_search IS NULL OR base.full_name ILIKE '%'||v_search||'%')
      AND (_flat_id IS NULL OR base.flat_id = _flat_id)
      AND (_relationship IS NULL OR base.relationship = _relationship)
      AND (NOT coalesce(_active_only,true) OR coalesce(base.is_active,true) = true)
  ),
  counted AS (SELECT count(*) AS total_count FROM filtered)
  SELECT f.user_id, f.full_name, f.avatar_url, f.flat_id, f.flat_number, f.block_name, v_mode,
    f.relationship, coalesce(f.is_active,false), coalesce(f.is_primary,false), f.moved_in_at, c.total_count
  FROM filtered f, counted c
  ORDER BY f.full_name ASC NULLS LAST, f.user_id ASC
  LIMIT v_limit OFFSET v_offset;
END; $function$;

REVOKE ALL ON FUNCTION public.list_society_residents_page(uuid,text,uuid,text,boolean,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_society_residents_page(uuid,text,uuid,text,boolean,integer,integer) TO authenticated;