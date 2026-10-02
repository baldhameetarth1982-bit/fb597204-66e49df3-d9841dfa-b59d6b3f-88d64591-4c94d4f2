CREATE TABLE public.parking_violation_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  violation_id uuid NOT NULL REFERENCES public.parking_violations(id) ON DELETE RESTRICT,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  path text NOT NULL UNIQUE,
  mime text NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp')),
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  removed_by uuid,
  remove_reason text
);
CREATE INDEX parking_violation_evidence_violation_idx ON public.parking_violation_evidence(violation_id, created_at);
GRANT SELECT ON public.parking_violation_evidence TO authenticated;
GRANT ALL ON public.parking_violation_evidence TO service_role;
ALTER TABLE public.parking_violation_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Gate staff and committee read evidence" ON public.parking_violation_evidence
  FOR SELECT TO authenticated
  USING (society_id = public._gate_society() OR society_id = public._parking_admin_society());

CREATE OR REPLACE FUNCTION public.parking_evidence_target(_violation uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sid uuid := coalesce(public._gate_society(), public._parking_admin_society()); v record;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  SELECT id, society_id, status INTO v FROM public.parking_violations WHERE id = _violation AND society_id = sid;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF v.status IN ('resolved','dismissed') THEN RAISE EXCEPTION 'locked' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM public.parking_violation_evidence WHERE violation_id = _violation AND removed_at IS NULL) >= 5 THEN
    RAISE EXCEPTION 'too_many_files' USING ERRCODE='22023'; END IF;
  RETURN sid;
END $$;

CREATE OR REPLACE FUNCTION public.parking_record_evidence(_violation uuid, _path text, _mime text, _size integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sid uuid; nid uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('parking_evidence:' || _violation::text));
  sid := public.parking_evidence_target(_violation);
  PERFORM public._rate_hit('parking_evidence', auth.uid()::text, 40, interval '1 hour');
  IF _path IS NULL OR _path !~ ('^' || sid::text || '/' || _violation::text || '/[0-9a-f]{32}\.(jpg|png|webp)$') THEN
    RAISE EXCEPTION 'invalid_file' USING ERRCODE='22023'; END IF;
  IF coalesce(_mime,'') NOT IN ('image/jpeg','image/png','image/webp') OR _size IS NULL OR _size <= 0 OR _size > 5242880 THEN
    RAISE EXCEPTION 'invalid_file' USING ERRCODE='22023'; END IF;
  INSERT INTO public.parking_violation_evidence(violation_id, society_id, path, mime, size_bytes, uploaded_by)
  VALUES (_violation, sid, _path, _mime, _size, auth.uid()) RETURNING id INTO nid;
  PERFORM public._parking_audit(sid, 'parking.evidence_added', 'parking_violation_evidence', nid, jsonb_build_object('violation_id', _violation));
  RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.parking_remove_evidence(_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sid uuid := public._parking_admin_society(); e record;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF public._visitor_clean(_reason, 300) IS NULL THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  SELECT * INTO e FROM public.parking_violation_evidence WHERE id = _id AND society_id = sid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF e.removed_at IS NOT NULL THEN RETURN; END IF;
  UPDATE public.parking_violation_evidence SET removed_at = now(), removed_by = auth.uid(), remove_reason = public._visitor_clean(_reason, 300) WHERE id = _id;
  PERFORM public._parking_audit(sid, 'parking.evidence_removed', 'parking_violation_evidence', _id, jsonb_build_object('violation_id', e.violation_id));
END $$;

REVOKE ALL ON FUNCTION public.parking_evidence_target(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parking_record_evidence(uuid, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parking_remove_evidence(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parking_evidence_target(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.parking_record_evidence(uuid, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.parking_remove_evidence(uuid, text) TO authenticated;