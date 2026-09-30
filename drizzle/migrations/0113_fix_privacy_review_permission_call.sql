CREATE OR REPLACE FUNCTION public.privacy_request_review(_id uuid, _status text, _outcome text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gov_admin_society(); r public.privacy_requests; ret jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.current_user_has_society_permission(sid, 'residents.manage'::text, NULL::uuid) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM public.privacy_requests WHERE id = _id AND society_id = sid FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF r.user_id = auth.uid() THEN RAISE EXCEPTION 'self_review' USING ERRCODE='42501'; END IF;
  IF NOT ((r.status = 'pending' AND _status IN ('under_review','completed','partially_completed','declined'))
       OR (r.status = 'under_review' AND _status IN ('completed','partially_completed','declined'))) THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF _status <> 'under_review' AND char_length(btrim(coalesce(_outcome,''))) < 10 THEN RAISE EXCEPTION 'outcome_required' USING ERRCODE='22023'; END IF;
  IF r.kind = 'deletion' AND _status IN ('completed','partially_completed','declined') THEN
    ret := '["Bills, payments and receipts (financial law)","Ledger and accounting entries","Gate and visitor security logs","Audit history"]'::jsonb;
    IF _status = 'completed' THEN _status := 'partially_completed'; END IF;
  END IF;
  PERFORM public._rate_hit('privacy_review', auth.uid()::text, 60, interval '1 hour');
  UPDATE public.privacy_requests SET status = _status, outcome = nullif(btrim(coalesce(_outcome,'')),''), retained = ret,
    reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now() WHERE id = _id;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'privacy.' || _status, 'privacy_requests', _id::text, sid, jsonb_build_object('kind', r.kind, 'retained', ret));
  PERFORM public._notify_user(r.user_id, sid, 'privacy', 'Privacy request update',
    'Your ' || r.kind || ' request is now ' || replace(_status,'_',' ') || '.', '/app/privacy-requests');
END $$;