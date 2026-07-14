
-- 1) Additive column
ALTER TABLE public.no_dues_certificates
  ADD COLUMN IF NOT EXISTS token_storage_version smallint NULL;

COMMENT ON COLUMN public.no_dues_certificates.token_storage_version IS
  'When set (=1) row uses AES-GCM encrypted token storage and MUST pass the ck_no_dues_certificates_v1 check. NULL = legacy row.';

-- 2) Uniqueness invariants
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public'
      AND indexname='no_dues_certificates_one_active_per_request'
  ) THEN
    CREATE UNIQUE INDEX no_dues_certificates_one_active_per_request
      ON public.no_dues_certificates(request_id)
      WHERE revoked_at IS NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public'
      AND indexname='no_dues_certificates_number_per_society'
  ) THEN
    CREATE UNIQUE INDEX no_dues_certificates_number_per_society
      ON public.no_dues_certificates(society_id, certificate_number);
  END IF;
END $$;

-- 3) Invariant for newly issued (v1) rows only — legacy rows preserved
ALTER TABLE public.no_dues_certificates
  DROP CONSTRAINT IF EXISTS ck_no_dues_certificates_v1;

ALTER TABLE public.no_dues_certificates
  ADD CONSTRAINT ck_no_dues_certificates_v1 CHECK (
    token_storage_version IS NULL OR (
      token_storage_version = 1
      AND verification_token IS NULL
      AND verification_token_hash ~ '^[0-9a-f]{64}$'
      AND verification_token_ciphertext IS NOT NULL AND length(verification_token_ciphertext) > 0
      AND verification_token_iv IS NOT NULL AND length(verification_token_iv) > 0
      AND verification_token_key_version IS NOT NULL AND verification_token_key_version > 0
      AND storage_path IS NOT NULL AND length(storage_path) > 0
      AND request_id IS NOT NULL
      AND society_id IS NOT NULL
      AND flat_id IS NOT NULL
      AND certificate_number IS NOT NULL AND length(certificate_number) > 0
    )
  ) NOT VALID;

-- Validate against existing rows (all currently have token_storage_version IS NULL,
-- so this is a no-op for legacy data but locks the shape for future rows).
ALTER TABLE public.no_dues_certificates VALIDATE CONSTRAINT ck_no_dues_certificates_v1;

-- 4) Revoke base-table SELECT from client-facing roles.
-- All reads must go through server functions that use supabaseAdmin and
-- return only safe metadata. Existing internal RPCs run as service_role
-- and remain unaffected.
REVOKE SELECT ON public.no_dues_certificates FROM PUBLIC;
REVOKE SELECT ON public.no_dues_certificates FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.no_dues_certificates FROM authenticated;
GRANT ALL ON public.no_dues_certificates TO service_role;

-- 5) Update finalize RPC to stamp token_storage_version = 1 on every new row.
DROP FUNCTION IF EXISTS public.finalize_no_dues_issuance_internal(uuid, uuid, text, text, text, text, smallint, text, date);

CREATE OR REPLACE FUNCTION public.finalize_no_dues_issuance_internal(
  _actor_id uuid,
  _request_id uuid,
  _certificate_number text,
  _verification_token_hash text,
  _verification_token_ciphertext text,
  _verification_token_iv text,
  _verification_token_key_version smallint,
  _storage_path text,
  _valid_until date
) RETURNS TABLE(certificate_id uuid, certificate_number text, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Format checks (defence in depth alongside CHECK constraint)
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

  INSERT INTO public.no_dues_audit(request_id, action, previous_status, new_status, actor_id, metadata)
  VALUES (_request_id, 'issued', 'approved', 'issued', _actor_id,
    jsonb_build_object('certificate_id', v_cert_id, 'certificate_number', _certificate_number));

  RETURN QUERY SELECT v_cert_id, _certificate_number, 'issued'::text;
END $$;

REVOKE ALL ON FUNCTION public.finalize_no_dues_issuance_internal(uuid, uuid, text, text, text, text, smallint, text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_no_dues_issuance_internal(uuid, uuid, text, text, text, text, smallint, text, date) TO service_role;
