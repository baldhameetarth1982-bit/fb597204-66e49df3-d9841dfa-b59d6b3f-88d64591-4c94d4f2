CREATE OR REPLACE FUNCTION public.list_society_flats_public(_society_id uuid)
 RETURNS TABLE(flat_id uuid, flat_number text, floor integer, block_id uuid, block_name text, is_occupied boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT f.id, f.flat_number, f.floor, f.block_id, b.name,
    EXISTS (SELECT 1 FROM public.flat_residents fr WHERE fr.flat_id = f.id AND fr.is_active)
  FROM public.flats f
  LEFT JOIN public.blocks b ON b.id = f.block_id
  WHERE f.society_id = _society_id
  ORDER BY b.name NULLS LAST, f.floor NULLS LAST, f.flat_number ASC
  LIMIT 1000;
$function$;