
-- =============================================================
-- No-Dues transactional foundation (Stage 3A · Turn 6)
-- =============================================================

-- 1. Drop old public RPCs that relied on auth.uid()
DROP FUNCTION IF EXISTS public.next_no_dues_cert_number(uuid);
DROP FUNCTION IF EXISTS public.finalize_no_dues_issuance(uuid, text, text, text, date);
DROP FUNCTION IF EXISTS public.revoke_no_dues_certificate(uuid, text);

-- 2. Actor-aware internal RPCs (service_role only)

-- 2a. Cert number reservation
CREATE OR REPLACE FUNCTION public.next_no_dues_cert_number_internal(
  _actor_id uuid, _society_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_year int := EXTRACT(YEAR FROM now())::int; v_seq int;
BEGIN
  IF _actor_id IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  IF NOT (public.is_society_admin_for(_actor_id, _society_id) OR public.is_super_admin(_actor_id)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  INSERT INTO public.no_dues_cert_counters(society_id, last_seq, year)
    VALUES (_society_id, 1, v_year)
  ON CONFLICT (society_id) DO UPDATE
    SET last_seq = CASE WHEN public.no_dues_cert_counters.year = v_year
                        THEN public.no_dues_cert_counters.last_seq + 1
                        ELSE 1 END,
        year = v_year,
        updated_at = now()
  RETURNING last_seq INTO v_seq;
  RETURN 'ND-' || v_year::text || '-' || lpad(v_seq::text, 5, '0');
END $$;

-- 2b. Submit request
CREATE OR REPLACE FUNCTION public.submit_no_dues_request_internal(
  _actor_id uuid,
  _society_id uuid,
  _flat_id uuid,
  _purpose text,
  _snapshot jsonb,
  _eligible boolean
) RETURNS TABLE(request_id uuid, status public.no_dues_status)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_status public.no_dues_status; v_id uuid; v_ok boolean;
BEGIN
  IF _actor_id IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.flat_residents fr
      JOIN public.flats f ON f.id = fr.flat_id
      WHERE fr.user_id = _actor_id AND fr.flat_id = _flat_id
        AND fr.is_active = true AND f.society_id = _society_id
  ) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  v_status := CASE WHEN _eligible THEN 'submitted'::public.no_dues_status
                   ELSE 'blocked_by_dues'::public.no_dues_status END;

  INSERT INTO public.no_dues_requests(society_id, flat_id, requester_id, purpose, status, eligibility_snapshot)
    VALUES (_society_id, _flat_id, _actor_id, NULLIF(btrim(COALESCE(_purpose,'')), ''), v_status, _snapshot)
  RETURNING id INTO v_id;

  INSERT INTO public.no_dues_audit(request_id, society_id, actor_id, action, new_status, metadata)
    VALUES (v_id, _society_id, _actor_id, 'submitted', v_status,
            jsonb_build_object('eligible', _eligible));

  request_id := v_id; status := v_status;
  RETURN NEXT;
END $$;

-- 2c. Transition (approve / reject / block)
CREATE OR REPLACE FUNCTION public.transition_no_dues_request_internal(
  _actor_id uuid,
  _request_id uuid,
  _decision text,             -- 'approve' | 'reject' | 'block'
  _notes text,
  _reason text,
  _new_snapshot jsonb         -- required for 'block' after re-eligibility
) RETURNS TABLE(new_status public.no_dues_status)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_req public.no_dues_requests%ROWTYPE; v_next public.no_dues_status;
BEGIN
  IF _actor_id IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  IF _decision NOT IN ('approve','reject','block') THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  IF _decision = 'reject' AND (_reason IS NULL OR length(btrim(_reason)) < 3) THEN
    RAISE EXCEPTION 'INVALID_REQUEST'; END IF;

  SELECT * INTO v_req FROM public.no_dues_requests WHERE id = _request_id FOR UPDATE;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  IF NOT (public.is_society_admin_for(_actor_id, v_req.society_id) OR public.is_super_admin(_actor_id)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  v_next := CASE _decision
    WHEN 'approve' THEN 'approved'::public.no_dues_status
    WHEN 'reject'  THEN 'rejected'::public.no_dues_status
    WHEN 'block'   THEN 'blocked_by_dues'::public.no_dues_status
  END;

  -- Allowed source statuses
  IF _decision IN ('approve','reject','block')
     AND v_req.status NOT IN ('submitted'::public.no_dues_status,
                              'under_review'::public.no_dues_status,
                              'blocked_by_dues'::public.no_dues_status) THEN
    RAISE EXCEPTION 'INVALID_TRANSITION';
  END IF;

  UPDATE public.no_dues_requests
    SET status = v_next,
        reviewed_by = _actor_id,
        reviewed_at = now(),
        admin_notes = COALESCE(NULLIF(btrim(COALESCE(_notes,'')),''), admin_notes),
        rejection_reason = CASE WHEN _decision='reject' THEN btrim(_reason) ELSE rejection_reason END,
        eligibility_snapshot = COALESCE(_new_snapshot, eligibility_snapshot),
        updated_at = now()
  WHERE id = _request_id;

  INSERT INTO public.no_dues_audit(request_id, society_id, actor_id, action, previous_status, new_status, metadata)
    VALUES (_request_id, v_req.society_id, _actor_id,
            CASE _decision WHEN 'approve' THEN 'approved'
                           WHEN 'reject'  THEN 'rejected'
                           ELSE 'blocked_by_dues' END,
            v_req.status, v_next,
            jsonb_build_object('reason', _reason, 'notes', _notes));

  new_status := v_next;
  RETURN NEXT;
END $$;

-- 2d. Finalize issuance (re-checks eligibility inside transaction)
CREATE OR REPLACE FUNCTION public.finalize_no_dues_issuance_internal(
  _actor_id uuid,
  _request_id uuid,
  _certificate_number text,
  _verification_token_hash text,
  _storage_path text,
  _valid_until date,
  _eligibility_snapshot jsonb,
  _eligible boolean
) RETURNS TABLE(certificate_id uuid, certificate_number text, status public.no_dues_status)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_req public.no_dues_requests%ROWTYPE; v_cert_id uuid;
BEGIN
  IF _actor_id IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;

  SELECT * INTO v_req FROM public.no_dues_requests WHERE id = _request_id FOR UPDATE;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  IF NOT (public.is_society_admin_for(_actor_id, v_req.society_id) OR public.is_super_admin(_actor_id)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- Idempotent short-circuit
  IF v_req.status = 'issued'::public.no_dues_status THEN
    SELECT c.id, c.certificate_number INTO v_cert_id, certificate_number
      FROM public.no_dues_certificates c
      WHERE c.request_id = _request_id AND c.revoked_at IS NULL LIMIT 1;
    IF v_cert_id IS NOT NULL THEN
      certificate_id := v_cert_id; status := 'issued'::public.no_dues_status; RETURN NEXT; RETURN;
    END IF;
  END IF;

  IF v_req.status <> 'approved'::public.no_dues_status THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;

  -- Finalization-time eligibility gate
  IF NOT _eligible THEN
    UPDATE public.no_dues_requests
       SET status = 'blocked_by_dues'::public.no_dues_status,
           eligibility_snapshot = COALESCE(_eligibility_snapshot, eligibility_snapshot),
           reviewed_by = _actor_id, reviewed_at = now(), updated_at = now()
     WHERE id = _request_id;
    INSERT INTO public.no_dues_audit(request_id, society_id, actor_id, action, previous_status, new_status, metadata)
      VALUES (_request_id, v_req.society_id, _actor_id, 'blocked_by_dues',
              v_req.status, 'blocked_by_dues'::public.no_dues_status,
              jsonb_build_object('phase','finalize'));
    certificate_id := NULL; certificate_number := NULL;
    status := 'blocked_by_dues'::public.no_dues_status;
    RETURN NEXT; RETURN;
  END IF;

  INSERT INTO public.no_dues_certificates(
    request_id, society_id, flat_id, certificate_number,
    verification_token_hash, issued_by, issued_at, valid_until, storage_path
  ) VALUES (
    v_req.id, v_req.society_id, v_req.flat_id, _certificate_number,
    _verification_token_hash, _actor_id, now(), _valid_until, _storage_path
  ) RETURNING id INTO v_cert_id;

  UPDATE public.no_dues_requests
     SET status = 'issued'::public.no_dues_status,
         eligibility_snapshot = COALESCE(_eligibility_snapshot, eligibility_snapshot),
         updated_at = now()
   WHERE id = _request_id;

  INSERT INTO public.no_dues_audit(request_id, certificate_id, society_id, actor_id, action, previous_status, new_status, metadata)
    VALUES (v_req.id, v_cert_id, v_req.society_id, _actor_id,
            'issued', v_req.status, 'issued'::public.no_dues_status,
            jsonb_build_object('certificate_number', _certificate_number));

  certificate_id := v_cert_id;
  certificate_number := _certificate_number;
  status := 'issued'::public.no_dues_status;
  RETURN NEXT;
END $$;

-- 2e. Revoke
CREATE OR REPLACE FUNCTION public.revoke_no_dues_certificate_internal(
  _actor_id uuid, _certificate_id uuid, _reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_cert public.no_dues_certificates%ROWTYPE;
BEGIN
  IF _actor_id IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  SELECT * INTO v_cert FROM public.no_dues_certificates WHERE id = _certificate_id FOR UPDATE;
  IF v_cert.id IS NULL THEN RAISE EXCEPTION 'CERTIFICATE_NOT_FOUND'; END IF;
  IF NOT (public.is_society_admin_for(_actor_id, v_cert.society_id) OR public.is_super_admin(_actor_id)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF v_cert.revoked_at IS NOT NULL THEN RETURN; END IF;

  UPDATE public.no_dues_certificates
     SET revoked_at = now(), revoked_by = _actor_id,
         revoke_reason = btrim(_reason), updated_at = now()
   WHERE id = _certificate_id;
  UPDATE public.no_dues_requests
     SET status = 'revoked'::public.no_dues_status, updated_at = now()
   WHERE id = v_cert.request_id;
  INSERT INTO public.no_dues_audit(request_id, certificate_id, society_id, actor_id, action, previous_status, new_status, metadata)
    VALUES (v_cert.request_id, v_cert.id, v_cert.society_id, _actor_id,
            'revoked', 'issued'::public.no_dues_status, 'revoked'::public.no_dues_status,
            jsonb_build_object('reason', btrim(_reason)));
END $$;

-- 3. Grants — service_role only
REVOKE EXECUTE ON FUNCTION public.next_no_dues_cert_number_internal(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_no_dues_request_internal(uuid,uuid,uuid,text,jsonb,boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.transition_no_dues_request_internal(uuid,uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finalize_no_dues_issuance_internal(uuid,uuid,text,text,text,date,jsonb,boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_no_dues_certificate_internal(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_no_dues_cert_number_internal(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_no_dues_request_internal(uuid,uuid,uuid,text,jsonb,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_no_dues_request_internal(uuid,uuid,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_no_dues_issuance_internal(uuid,uuid,text,text,text,date,jsonb,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_no_dues_certificate_internal(uuid,uuid,text) TO service_role;

-- 4. Close direct client INSERT — submissions must go through server function
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT polname FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='no_dues_requests' AND polcmd='a'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.no_dues_requests', r.polname);
  END LOOP;
END $$;
REVOKE INSERT ON TABLE public.no_dues_requests FROM anon, authenticated;

-- 5. Atomic rate limiter
CREATE OR REPLACE FUNCTION public.touch_rate_limit(
  _bucket text, _subject text, _limit int, _window_seconds int
) RETURNS TABLE(allowed boolean, remaining int, retry_after_seconds int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_now timestamptz := now();
        v_win timestamptz := date_trunc('second', v_now) - make_interval(secs => (extract(epoch FROM v_now)::bigint % _window_seconds));
        v_count int;
BEGIN
  -- Purge old buckets opportunistically (bounded work)
  DELETE FROM public.rate_limits
    WHERE bucket = _bucket AND window_start < v_now - make_interval(secs => _window_seconds * 4);

  INSERT INTO public.rate_limits(bucket, subject, window_start, count)
    VALUES (_bucket, _subject, v_win, 1)
  ON CONFLICT (bucket, subject, window_start) DO UPDATE
    SET count = public.rate_limits.count + 1
  RETURNING count INTO v_count;

  allowed := v_count <= _limit;
  remaining := GREATEST(0, _limit - v_count);
  retry_after_seconds := CASE WHEN allowed THEN 0
    ELSE GREATEST(1, _window_seconds - EXTRACT(EPOCH FROM (v_now - v_win))::int) END;
  RETURN NEXT;
END $$;

REVOKE EXECUTE ON FUNCTION public.touch_rate_limit(text,text,int,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_rate_limit(text,text,int,int) TO service_role;

-- Ensure rate_limits has unique key for ON CONFLICT
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rate_limits_bucket_subject_window_key'
  ) THEN
    ALTER TABLE public.rate_limits
      ADD CONSTRAINT rate_limits_bucket_subject_window_key
      UNIQUE (bucket, subject, window_start);
  END IF;
END $$;
