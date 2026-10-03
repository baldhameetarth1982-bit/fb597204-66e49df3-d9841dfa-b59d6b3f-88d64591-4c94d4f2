CREATE OR REPLACE FUNCTION public.my_household_history()
RETURNS TABLE(flat_number text, full_name text, relationship text, is_you boolean, moved_in_at timestamptz, moved_out_at timestamptz, ended_reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _flat uuid; _rel text; _since timestamptz;
BEGIN
  SELECT f.flat_id INTO _flat FROM public._my_active_flat() f LIMIT 1;
  IF _flat IS NULL THEN RETURN; END IF;
  SELECT fr.relationship, fr.moved_in_at INTO _rel, _since FROM public.flat_residents fr
   WHERE fr.flat_id = _flat AND fr.user_id = auth.uid() AND fr.is_active ORDER BY fr.moved_in_at DESC NULLS LAST LIMIT 1;
  IF _rel IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT fl.flat_number, p.full_name, fr.relationship, fr.user_id = auth.uid(), fr.moved_in_at, fr.moved_out_at, fr.ended_reason
  FROM public.flat_residents fr
  JOIN public.flats fl ON fl.id = fr.flat_id
  LEFT JOIN public.profiles p ON p.id = fr.user_id
  WHERE fr.flat_id = _flat
    AND (_rel = 'owner' OR fr.user_id = auth.uid() OR fr.moved_out_at IS NULL OR fr.moved_out_at >= COALESCE(_since, now()))
  ORDER BY fr.moved_in_at DESC NULLS LAST
  LIMIT 200;
END $$;
REVOKE ALL ON FUNCTION public.my_household_history() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_household_history() TO authenticated;