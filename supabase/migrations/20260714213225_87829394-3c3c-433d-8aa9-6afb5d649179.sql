-- Turn 12: role-scope fix, encrypted-token finalization, resident recheck

-- 1) Correct block-admin scope: society_admin gets society-wide; block_admin is flat-scoped
CREATE OR REPLACE FUNCTION public.is_society_admin_for_internal(_actor_id uuid, _society_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _actor_id
      AND ur.role = 'society_admin'::public.app_role
      AND ur.society_id = _society_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_block_admin_for_flat_internal(_actor_id uuid, _flat_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.flats f ON f.id = _flat_id
    WHERE ur.user_id = _actor_id
      AND ur.role = 'block_admin'::public.app_role
      AND ur.society_id = f.society_id
      AND ur.block_id = f.block_id
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_flat_internal(_actor_id uuid, _flat_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    public.is_super_admin_internal(_actor_id)
    OR EXISTS (
      SELECT 1 FROM public.flats f
      WHERE f.id = _flat_id
        AND public.is_society_admin_for_internal(_actor_id, f.society_id)
    )
    OR public.is_block_admin_for_flat_internal(_actor_id, _flat_id);
$$;

CREATE OR REPLACE FUNCTION public.current_user_can_manage_flat(_flat_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(public.can_manage_flat_internal(auth.uid(), _flat_id), false);
$$;

REVOKE ALL ON FUNCTION public.is_society_admin_for_internal(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_super_admin_internal(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_block_admin_for_flat_internal(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_manage_flat_internal(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_can_manage_flat(uuid) TO authenticated;

-- Revoke arbitrary-user role probes from client
REVOKE EXECUTE ON FUNCTION public.is_society_admin_for(uuid, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM anon, authenticated;

-- 2) Allow verification_token to be null (new certs store encrypted only)
ALTER TABLE public.no_dues_certificates ALTER COLUMN verification_token DROP NOT NULL;

-- 3) Replace finalize RPC with encrypted-token variant (drop old + create new)
DROP FUNCTION IF EXISTS public.finalize_no_dues_issuance_internal(uuid, uuid, text, text, text, date);

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
)
RETURNS TABLE(status text, certificate_id uuid, certificate_number text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_req record;
  v_can boolean;
  v_elig jsonb;
  v_existing_id uuid;
  v_existing_num text;
  v_new_id uuid;
BEGIN
  IF _actor_id IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;

  SELECT id, society_id, flat_id, requester_id, status INTO v_req
    FROM public.no_dues_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;

  v_can := public.can_manage_flat_internal(_actor_id, v_req.flat_id);
  IF NOT COALESCE(v_can, false) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT id, certificate_number INTO v_existing_id, v_existing_num
    FROM public.no_dues_certificates WHERE request_id = _request_id AND revoked_at IS NULL LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY SELECT 'issued'::text, v_existing_id, v_existing_num;
    RETURN;
  END IF;

  IF v_req.status <> 'approved'::no_dues_status THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;

  v_elig := public.compute_no_dues_eligibility_internal(v_req.society_id, v_req.flat_id);
  IF NOT (v_elig->>'eligible')::boolean THEN
    UPDATE public.no_dues_requests
      SET status = 'blocked_by_dues'::no_dues_status, eligibility_snapshot = v_elig
      WHERE id = _request_id;
    INSERT INTO public.no_dues_audit(request_id, society_id, actor_id, action, previous_status, new_status, metadata)
    VALUES (_request_id, v_req.society_id, _actor_id, 'finalize_blocked', 'approved'::no_dues_status,
            'blocked_by_dues'::no_dues_status, jsonb_build_object('eligibility', v_elig));
    RETURN QUERY SELECT 'blocked_by_dues'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  INSERT INTO public.no_dues_certificates(
    request_id, society_id, flat_id, certificate_number,
    verification_token_hash,
    verification_token_ciphertext, verification_token_iv, verification_token_key_version,
    storage_path, valid_until, issued_at, issued_by
  ) VALUES (
    _request_id, v_req.society_id, v_req.flat_id, _certificate_number,
    _verification_token_hash,
    _verification_token_ciphertext, _verification_token_iv, _verification_token_key_version,
    _storage_path, _valid_until, now(), _actor_id
  ) RETURNING id INTO v_new_id;

  UPDATE public.no_dues_requests
    SET status = 'issued'::no_dues_status, eligibility_snapshot = v_elig
    WHERE id = _request_id;

  INSERT INTO public.no_dues_audit(request_id, certificate_id, society_id, actor_id, action, previous_status, new_status, metadata)
  VALUES (_request_id, v_new_id, v_req.society_id, _actor_id, 'issue', 'approved'::no_dues_status,
          'issued'::no_dues_status, jsonb_build_object('certificate_number', _certificate_number));

  RETURN QUERY SELECT 'issued'::text, v_new_id, _certificate_number;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_no_dues_issuance_internal(uuid, uuid, text, text, text, text, smallint, text, date) FROM PUBLIC, anon, authenticated;

-- 4) Resident recheck-and-resubmit RPC
CREATE OR REPLACE FUNCTION public.recheck_no_dues_request_internal(_actor_id uuid, _request_id uuid)
RETURNS TABLE(new_status text, eligibility jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_req record;
  v_elig jsonb;
  v_is_active boolean;
  v_prev no_dues_status;
  v_new no_dues_status;
BEGIN
  IF _actor_id IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  SELECT id, society_id, flat_id, requester_id, status INTO v_req
    FROM public.no_dues_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  IF v_req.requester_id <> _actor_id THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.flat_residents fr
    WHERE fr.user_id = _actor_id AND fr.flat_id = v_req.flat_id AND fr.is_active = true
  ) INTO v_is_active;
  IF NOT v_is_active THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  IF v_req.status <> 'blocked_by_dues'::no_dues_status THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;

  v_elig := public.compute_no_dues_eligibility_internal(v_req.society_id, v_req.flat_id);
  v_prev := v_req.status;

  IF (v_elig->>'eligible')::boolean THEN
    v_new := 'submitted'::no_dues_status;
    UPDATE public.no_dues_requests
      SET status = v_new, eligibility_snapshot = v_elig, submitted_at = now()
      WHERE id = _request_id;
    INSERT INTO public.no_dues_audit(request_id, society_id, actor_id, action, previous_status, new_status, metadata)
      VALUES (_request_id, v_req.society_id, _actor_id, 'resubmit', v_prev, v_new, jsonb_build_object('eligibility', v_elig));
  ELSE
    v_new := v_prev;
    UPDATE public.no_dues_requests
      SET eligibility_snapshot = v_elig WHERE id = _request_id;
    INSERT INTO public.no_dues_audit(request_id, society_id, actor_id, action, previous_status, new_status, metadata)
      VALUES (_request_id, v_req.society_id, _actor_id, 'recheck', v_prev, v_new, jsonb_build_object('eligibility', v_elig));
  END IF;

  RETURN QUERY SELECT v_new::text, v_elig;
END;
$$;

REVOKE ALL ON FUNCTION public.recheck_no_dues_request_internal(uuid, uuid) FROM PUBLIC, anon, authenticated;