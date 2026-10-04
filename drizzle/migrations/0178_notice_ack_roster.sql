-- Committee view of who has / hasn't acknowledged a notice. Same audience rule as notice_delivery_stats.
CREATE OR REPLACE FUNCTION public.admin_notice_ack_roster(_notice_id uuid)
RETURNS TABLE(full_name text, homes text, opened_at timestamptz, acked_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE n public.notices; sid uuid := public._notice_admin_society();
BEGIN
  SELECT * INTO n FROM public.notices WHERE id = _notice_id;
  IF sid IS NULL OR n.id IS NULL OR n.society_id <> sid THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT p.full_name,
    (SELECT string_agg(DISTINCT f.flat_number, ', ') FROM public.flat_residents fr JOIN public.flats f ON f.id = fr.flat_id
      WHERE fr.user_id = a.user_id AND fr.moved_out_at IS NULL AND fr.is_active IS NOT FALSE AND f.society_id = sid),
    (SELECT r.read_at FROM public.notice_reads r WHERE r.notice_id = n.id AND r.user_id = a.user_id LIMIT 1),
    (SELECT k.acked_at FROM public.notice_acks k WHERE k.notice_id = n.id AND k.user_id = a.user_id LIMIT 1)
  FROM public._notice_audience(n) a
  LEFT JOIN public.profiles p ON p.id = a.user_id
  ORDER BY 4 NULLS FIRST, 1
  LIMIT 2000;
END $$;
REVOKE ALL ON FUNCTION public.admin_notice_ack_roster(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_notice_ack_roster(uuid) TO authenticated;