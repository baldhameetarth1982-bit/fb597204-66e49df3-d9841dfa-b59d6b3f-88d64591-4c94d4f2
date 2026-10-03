CREATE OR REPLACE FUNCTION public.get_society_register(_section text, _search text DEFAULT NULL, _offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _sid uuid := public._gov_admin_society(); _q text := '%' || lower(coalesce(trim(_search),'')) || '%'; _off int := greatest(coalesce(_offset,0),0); _rows jsonb;
BEGIN
  IF _sid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  IF _section = 'members' THEN
    SELECT coalesce(jsonb_agg(r),'[]') INTO _rows FROM (SELECT p.full_name AS name, f.flat_number AS unit, fr.relationship, fr.is_primary, fr.moved_in_at::date AS since, fr.is_active AS current, p.share_certificate_number AS share_cert
      FROM flat_residents fr JOIN flats f ON f.id=fr.flat_id LEFT JOIN profiles p ON p.id=fr.user_id
      WHERE f.society_id=_sid AND fr.relationship IN ('owner','self','primary') AND lower(coalesce(p.full_name,'')||' '||f.flat_number) LIKE _q
      ORDER BY f.flat_number, fr.moved_in_at DESC LIMIT 200 OFFSET _off) r;
  ELSIF _section = 'occupancy' THEN
    SELECT coalesce(jsonb_agg(r),'[]') INTO _rows FROM (SELECT p.full_name AS name, f.flat_number AS unit, fr.relationship, fr.moved_in_at::date AS moved_in, fr.moved_out_at::date AS moved_out, fr.lease_starts_on, fr.lease_ends_on, fr.ended_reason
      FROM flat_residents fr JOIN flats f ON f.id=fr.flat_id LEFT JOIN profiles p ON p.id=fr.user_id
      WHERE f.society_id=_sid AND lower(coalesce(p.full_name,'')||' '||f.flat_number||' '||fr.relationship) LIKE _q
      ORDER BY coalesce(fr.moved_out_at, fr.moved_in_at, fr.created_at) DESC LIMIT 200 OFFSET _off) r;
  ELSIF _section = 'committee' THEN
    SELECT coalesce(jsonb_agg(r),'[]') INTO _rows FROM (SELECT p.full_name AS name, ur.role::text AS role, ur.created_at::date AS from_date, ur.deactivated_at::date AS to_date, ur.is_active AS current, ur.revoked_reason
      FROM user_roles ur LEFT JOIN profiles p ON p.id=ur.user_id
      WHERE ur.society_id=_sid AND ur.role::text IN ('society_admin','block_admin','auditor') AND lower(coalesce(p.full_name,'')||' '||ur.role::text) LIKE _q
      ORDER BY ur.created_at DESC LIMIT 200 OFFSET _off) r;
  ELSIF _section = 'meetings' THEN
    SELECT coalesce(jsonb_agg(r),'[]') INTO _rows FROM (SELECT m.title, m.starts_at, m.location, m.status,
      (SELECT count(*) FROM meeting_attendance a WHERE a.meeting_id=m.id AND a.present) AS present,
      (SELECT count(*) FROM meeting_resolutions x WHERE x.meeting_id=m.id) AS resolutions
      FROM meetings m WHERE m.society_id=_sid AND lower(m.title) LIKE _q ORDER BY m.starts_at DESC LIMIT 200 OFFSET _off) r;
  ELSIF _section = 'resolutions' THEN
    SELECT coalesce(jsonb_agg(r),'[]') INTO _rows FROM (SELECT m.title AS meeting, m.starts_at::date AS date, x.seq, x.text AS resolution, x.outcome
      FROM meeting_resolutions x JOIN meetings m ON m.id=x.meeting_id WHERE x.society_id=_sid AND lower(x.text||' '||m.title) LIKE _q
      ORDER BY m.starts_at DESC, x.seq LIMIT 200 OFFSET _off) r;
  ELSIF _section = 'elections' THEN
    SELECT coalesce(jsonb_agg(r),'[]') INTO _rows FROM (SELECT e.title, e.status, e.voting_opens_at::date AS voting_from, e.voting_closes_at::date AS voting_to, e.results_published_at::date AS results_published
      FROM elections e WHERE e.society_id=_sid AND lower(e.title) LIKE _q ORDER BY e.created_at DESC LIMIT 200 OFFSET _off) r;
  ELSIF _section = 'notices' THEN
    SELECT coalesce(jsonb_agg(r),'[]') INTO _rows FROM (SELECT n.title, n.category, n.priority, n.status, n.published_at::date AS published, n.expires_at::date AS expires
      FROM notices n WHERE n.society_id=_sid AND lower(n.title) LIKE _q ORDER BY coalesce(n.published_at,n.created_at) DESC LIMIT 200 OFFSET _off) r;
  ELSIF _section = 'moves' THEN
    SELECT coalesce(jsonb_agg(r),'[]') INTO _rows FROM (SELECT f.flat_number AS unit, mp.kind, mp.valid_from::date AS date, mp.status, mp.contractor_name, mp.checked_in_at::date AS used_on
      FROM material_passes mp JOIN flats f ON f.id=mp.flat_id WHERE mp.society_id=_sid AND lower(f.flat_number||' '||mp.kind) LIKE _q
      ORDER BY mp.valid_from DESC LIMIT 200 OFFSET _off) r;
  ELSE RAISE EXCEPTION 'Unknown register'; END IF;
  RETURN _rows;
END $$;
REVOKE ALL ON FUNCTION public.get_society_register(text,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_society_register(text,text,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.log_register_export(_section text, _rows integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sid uuid := public._gov_admin_society();
BEGIN
  IF _sid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  INSERT INTO audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'register.export', 'registers', left(_section,40), _sid, jsonb_build_object('rows', _rows));
END $$;
REVOKE ALL ON FUNCTION public.log_register_export(text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_register_export(text,integer) TO authenticated;