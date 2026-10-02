CREATE OR REPLACE FUNCTION public.agm_save(_id uuid, _title text, _fy text, _starts timestamp with time zone, _location text, _link text, _agenda text, _basis text, _qtype text, _qvalue numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE sid uuid := public._gov_admin_society(); a public.agms; mid uuid;
  ag text := coalesce(nullif(btrim(coalesce(_agenda,'')),''), 'Annual General Meeting — see the AGM agenda.');
BEGIN
  IF char_length(btrim(coalesce(_title,''))) < 3 THEN RAISE EXCEPTION 'invalid_title' USING ERRCODE='22023'; END IF;
  IF coalesce(_fy,'') !~ '^[0-9]{4}-[0-9]{2}$' THEN RAISE EXCEPTION 'invalid_fy' USING ERRCODE='22023'; END IF;
  IF _starts IS NULL OR _starts < now() THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE='22023'; END IF;
  IF nullif(btrim(coalesce(_location,'')),'') IS NULL AND nullif(btrim(coalesce(_link,'')),'') IS NULL THEN RAISE EXCEPTION 'place_required' USING ERRCODE='22023'; END IF;
  IF nullif(btrim(coalesce(_link,'')),'') IS NOT NULL AND btrim(_link) !~ '^https://' THEN RAISE EXCEPTION 'invalid_link' USING ERRCODE='22023'; END IF;
  IF _qvalue IS NULL OR _qvalue <= 0 OR (coalesce(_qtype,'percent') = 'percent' AND _qvalue > 100) THEN RAISE EXCEPTION 'invalid_quorum' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('agm_write', auth.uid()::text, 120, interval '1 hour');
  IF _id IS NULL THEN
    INSERT INTO public.meetings (society_id, title, agenda, starts_at, location, meeting_link, audience, status, created_by)
    VALUES (sid, left('AGM: ' || btrim(_title), 140), ag, _starts, nullif(btrim(coalesce(_location,'')),''), nullif(btrim(coalesce(_link,'')),''), 'all', 'draft', auth.uid())
    RETURNING id INTO mid;
    INSERT INTO public.agms (society_id, meeting_id, title, financial_year, quorum_basis, quorum_type, quorum_value, created_by)
    VALUES (sid, mid, btrim(_title), _fy, coalesce(_basis,'home'), coalesce(_qtype,'percent'), _qvalue, auth.uid()) RETURNING * INTO a;
    PERFORM public._agm_audit(a, 'created', jsonb_build_object('financial_year', _fy, 'meeting', mid));
    RETURN a.id;
  END IF;
  SELECT * INTO a FROM public.agms WHERE id = _id AND society_id = sid FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF a.status <> 'draft' THEN RAISE EXCEPTION 'agm_locked' USING ERRCODE='22023'; END IF;
  UPDATE public.agms SET title = btrim(_title), financial_year = _fy, quorum_basis = coalesce(_basis, quorum_basis), quorum_type = coalesce(_qtype, quorum_type), quorum_value = _qvalue, updated_at = now() WHERE id = _id;
  UPDATE public.meetings SET title = left('AGM: ' || btrim(_title), 140), agenda = ag, starts_at = _starts,
    location = nullif(btrim(coalesce(_location,'')),''), meeting_link = nullif(btrim(coalesce(_link,'')),''), updated_at = now() WHERE id = a.meeting_id;
  PERFORM public._agm_audit(a, 'configured', '{}'::jsonb);
  RETURN _id;
END $function$;