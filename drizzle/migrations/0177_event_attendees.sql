CREATE OR REPLACE FUNCTION public.admin_event_attendees(_event_id uuid)
RETURNS TABLE(full_name text, homes text, status text, guests integer, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _sid uuid;
BEGIN
  SELECT e.society_id INTO _sid FROM public.community_events e WHERE e.id = _event_id;
  IF _sid IS NULL OR NOT public.current_user_has_society_permission(_sid, 'society.settings', NULL) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT p.full_name,
         (SELECT string_agg(DISTINCT f.flat_number, ', ') FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
           WHERE fr.user_id = r.user_id AND fr.is_active AND f.society_id = _sid),
         r.status, r.guests::integer, r.created_at
  FROM public.community_event_rsvps r
  LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE r.event_id = _event_id
  ORDER BY (r.status = 'going') DESC, r.created_at
  LIMIT 1000;
END $$;
REVOKE ALL ON FUNCTION public.admin_event_attendees(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_attendees(uuid) TO authenticated;