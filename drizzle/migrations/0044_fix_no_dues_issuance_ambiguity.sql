CREATE OR REPLACE FUNCTION public.finalize_no_dues_issuance_internal(_actor_id uuid, _request_id uuid, _certificate_number text, _verification_token_hash text, _verification_token_ciphertext text, _verification_token_iv text, _verification_token_key_version smallint, _storage_path text, _valid_until date)
 RETURNS TABLE(certificate_id uuid, certificate_number text, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_req record;
  v_elig jsonb;
  v_cert_id uuid;
BEGIN
  IF _actor_id IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;

  SELECT id, society_id, flat_id, status, requester_id
    INTO v_req
    FROM public.no_dues_requests
    WHERE id = _request_id
    FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  IF NOT public.can_manage_flat_internal(_actor_id, v_req.flat_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF v_req.status <> 'approved' THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;

  IF _verification_token_hash IS NULL OR _verification_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_REQUEST';
  END IF;
  IF _verification_token_ciphertext IS NULL OR length(_verification_token_ciphertext) = 0 THEN
    RAISE EXCEPTION 'INVALID_REQUEST';
  END IF;
  IF _verification_token_iv IS NULL OR length(_verification_token_iv) = 0 THEN
    RAISE EXCEPTION 'INVALID_REQUEST';
  END IF;
  IF _verification_token_key_version IS NULL OR _verification_token_key_version <= 0 THEN
    RAISE EXCEPTION 'INVALID_REQUEST';
  END IF;
  IF _storage_path IS NULL OR position('..' in _storage_path) > 0
     OR position('\' in _storage_path) > 0
     OR _storage_path ~ '^https?://' THEN
    RAISE EXCEPTION 'INVALID_REQUEST';
  END IF;

  v_elig := public.compute_no_dues_eligibility_internal(v_req.society_id, v_req.flat_id);
  IF NOT (v_elig ->> 'eligible')::boolean THEN
    UPDATE public.no_dues_requests
       SET status = 'blocked_by_dues',
           eligibility_snapshot = v_elig
     WHERE id = _request_id;
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'blocked_by_dues'::text;
    RETURN;
  END IF;

  INSERT INTO public.no_dues_certificates (
    request_id, society_id, flat_id, certificate_number,
    verification_token_hash,
    verification_token_ciphertext, verification_token_iv, verification_token_key_version,
    token_storage_version,
    storage_path, valid_until, issued_at, issued_by
  ) VALUES (
    v_req.id, v_req.society_id, v_req.flat_id, _certificate_number,
    _verification_token_hash,
    _verification_token_ciphertext, _verification_token_iv, _verification_token_key_version,
    1,
    _storage_path, _valid_until, now(), _actor_id
  ) RETURNING id INTO v_cert_id;

  UPDATE public.no_dues_requests SET status = 'issued' WHERE id = _request_id;

  INSERT INTO public.no_dues_audit(request_id, society_id, certificate_id, action, previous_status, new_status, actor_id, metadata)
  VALUES (_request_id, v_req.society_id, v_cert_id, 'issued', 'approved', 'issued', _actor_id,
    jsonb_build_object('certificate_id', v_cert_id, 'certificate_number', _certificate_number));

  RETURN QUERY SELECT v_cert_id, _certificate_number, 'issued'::text;
END $function$;