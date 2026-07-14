
-- =======================================================================
-- 1.  CANONICAL ELIGIBILITY FUNCTION
-- =======================================================================
CREATE OR REPLACE FUNCTION public.compute_no_dues_eligibility_internal(
  _society_id uuid,
  _flat_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_flat_ok boolean;
  v_bills jsonb := '[]'::jsonb;
  v_overdue jsonb := '[]'::jsonb;
  v_partial jsonb := '[]'::jsonb;
  v_pending_cash jsonb := '[]'::jsonb;
  v_pending_bank jsonb := '[]'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_total numeric := 0;
BEGIN
  -- Society/flat pairing check
  SELECT EXISTS (SELECT 1 FROM public.flats f WHERE f.id = _flat_id AND f.society_id = _society_id)
    INTO v_flat_ok;
  IF NOT v_flat_ok THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'total_outstanding', 0,
      'unpaid_bills', '[]'::jsonb,
      'overdue_bills', '[]'::jsonb,
      'partially_paid_bills', '[]'::jsonb,
      'pending_cash_payments', '[]'::jsonb,
      'pending_bank_transfer_payments', '[]'::jsonb,
      'blockers', jsonb_build_array(jsonb_build_object('type','invalid_flat')),
      'calculated_at', now()
    );
  END IF;

  -- Per-bill remaining calc: bill.amount − sum(successful payments on that bill).
  -- Successful = payments.status = 'success'. Rejected / pending / failed / reversed do NOT reduce dues.
  -- Cancelled bills (cancelled_at IS NOT NULL or status='cancelled') contribute zero.
  WITH bill_remainder AS (
    SELECT
      b.id,
      b.bill_number,
      b.due_date,
      b.status,
      b.period_label,
      GREATEST(
        0,
        b.amount - COALESCE((
          SELECT SUM(p.amount)
          FROM public.payments p
          WHERE p.bill_id = b.id
            AND p.society_id = _society_id
            AND p.flat_id = _flat_id
            AND p.status = 'success'
        ), 0)
      )::numeric AS remaining,
      b.amount AS total_amount
    FROM public.bills b
    WHERE b.society_id = _society_id
      AND b.flat_id = _flat_id
      AND b.cancelled_at IS NULL
      AND b.status <> 'cancelled'
      AND b.status <> 'paid'
  )
  SELECT
    COALESCE(SUM(remaining), 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'type','unpaid_bill',
      'bill_id', id,
      'bill_number', bill_number,
      'due_date', due_date,
      'remaining_amount', remaining
    )) FILTER (WHERE remaining > 0 AND remaining = total_amount), '[]'::jsonb),
    COALESCE(jsonb_agg(jsonb_build_object(
      'type','overdue_bill',
      'bill_id', id,
      'bill_number', bill_number,
      'due_date', due_date,
      'remaining_amount', remaining
    )) FILTER (WHERE remaining > 0 AND due_date < CURRENT_DATE), '[]'::jsonb),
    COALESCE(jsonb_agg(jsonb_build_object(
      'type','partially_paid_bill',
      'bill_id', id,
      'bill_number', bill_number,
      'due_date', due_date,
      'remaining_amount', remaining
    )) FILTER (WHERE remaining > 0 AND remaining < total_amount), '[]'::jsonb)
  INTO v_total, v_bills, v_overdue, v_partial
  FROM bill_remainder;

  -- Pending Cash + Bank Transfer payments = blockers (awaiting admin verification)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'type','pending_cash_payment',
    'payment_id', id,
    'amount', amount
  )), '[]'::jsonb)
  INTO v_pending_cash
  FROM public.payments
  WHERE society_id = _society_id
    AND flat_id = _flat_id
    AND status = 'pending'
    AND method = 'cash';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'type','pending_bank_transfer_payment',
    'payment_id', id,
    'amount', amount
  )), '[]'::jsonb)
  INTO v_pending_bank
  FROM public.payments
  WHERE society_id = _society_id
    AND flat_id = _flat_id
    AND status = 'pending'
    AND method IN ('bank_transfer','bank','netbanking','neft','imps','upi_manual');

  v_blockers := v_bills || v_overdue || v_partial || v_pending_cash || v_pending_bank;

  RETURN jsonb_build_object(
    'eligible', (v_total = 0 AND jsonb_array_length(v_pending_cash) = 0 AND jsonb_array_length(v_pending_bank) = 0),
    'total_outstanding', v_total,
    'unpaid_bills', v_bills,
    'overdue_bills', v_overdue,
    'partially_paid_bills', v_partial,
    'pending_cash_payments', v_pending_cash,
    'pending_bank_transfer_payments', v_pending_bank,
    'blockers', v_blockers,
    'calculated_at', now()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_no_dues_eligibility_internal(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.compute_no_dues_eligibility_internal(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_no_dues_eligibility_internal(uuid, uuid) TO service_role;

-- =======================================================================
-- 2.  REWRITE SUBMIT RPC — no trusted eligibility inputs
-- =======================================================================
DROP FUNCTION IF EXISTS public.submit_no_dues_request_internal(uuid, uuid, uuid, text, jsonb, boolean);

CREATE OR REPLACE FUNCTION public.submit_no_dues_request_internal(
  _actor_id uuid,
  _society_id uuid,
  _flat_id uuid,
  _purpose text
) RETURNS TABLE(request_id uuid, status no_dues_status, eligibility jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_resident_ok boolean;
  v_elig jsonb;
  v_status no_dues_status;
  v_new_id uuid;
BEGIN
  IF _actor_id IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.flat_residents fr
    JOIN public.flats f ON f.id = fr.flat_id
    WHERE fr.user_id = _actor_id
      AND fr.flat_id = _flat_id
      AND fr.is_active = true
      AND f.society_id = _society_id
  ) INTO v_resident_ok;
  IF NOT v_resident_ok THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  v_elig := public.compute_no_dues_eligibility_internal(_society_id, _flat_id);
  v_status := CASE WHEN (v_elig->>'eligible')::boolean THEN 'submitted'::no_dues_status
                   ELSE 'blocked_by_dues'::no_dues_status END;

  INSERT INTO public.no_dues_requests(society_id, flat_id, requester_id, purpose, status, eligibility_snapshot, submitted_at)
  VALUES (_society_id, _flat_id, _actor_id, _purpose, v_status, v_elig, now())
  RETURNING id INTO v_new_id;

  INSERT INTO public.no_dues_audit(request_id, society_id, actor_id, action, previous_status, new_status, metadata)
  VALUES (v_new_id, _society_id, _actor_id, 'submit', NULL, v_status, jsonb_build_object('eligibility', v_elig));

  RETURN QUERY SELECT v_new_id, v_status, v_elig;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_no_dues_request_internal(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_no_dues_request_internal(uuid, uuid, uuid, text) TO service_role;

-- =======================================================================
-- 3.  REWRITE TRANSITION RPC — no trusted eligibility input
-- =======================================================================
DROP FUNCTION IF EXISTS public.transition_no_dues_request_internal(uuid, uuid, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.transition_no_dues_request_internal(
  _actor_id uuid,
  _request_id uuid,
  _decision text,        -- 'approve' | 'reject' | 'resubmit'
  _notes text,
  _reason text
) RETURNS TABLE(new_status no_dues_status, eligibility jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req record;
  v_is_admin boolean;
  v_is_super boolean;
  v_elig jsonb;
  v_new no_dues_status;
  v_prev no_dues_status;
BEGIN
  IF _actor_id IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;

  SELECT id, society_id, flat_id, requester_id, status INTO v_req
    FROM public.no_dues_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  v_prev := v_req.status;

  SELECT public.is_society_admin_for(_actor_id, v_req.society_id) INTO v_is_admin;
  SELECT public.is_super_admin(_actor_id) INTO v_is_super;

  IF _decision = 'approve' THEN
    IF NOT (COALESCE(v_is_admin,false) OR COALESCE(v_is_super,false)) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
    IF v_prev <> 'submitted'::no_dues_status THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
    v_elig := public.compute_no_dues_eligibility_internal(v_req.society_id, v_req.flat_id);
    IF (v_elig->>'eligible')::boolean THEN
      v_new := 'approved'::no_dues_status;
    ELSE
      v_new := 'blocked_by_dues'::no_dues_status;
    END IF;
    UPDATE public.no_dues_requests
      SET status = v_new, admin_notes = COALESCE(_notes, admin_notes),
          eligibility_snapshot = v_elig, reviewed_at = now(), reviewer_id = _actor_id
      WHERE id = _request_id;

  ELSIF _decision = 'reject' THEN
    IF NOT (COALESCE(v_is_admin,false) OR COALESCE(v_is_super,false)) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
    IF _reason IS NULL OR length(trim(_reason)) < 3 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
    IF v_prev <> 'submitted'::no_dues_status THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
    v_new := 'rejected'::no_dues_status;
    v_elig := public.compute_no_dues_eligibility_internal(v_req.society_id, v_req.flat_id);
    UPDATE public.no_dues_requests
      SET status = v_new, rejection_reason = _reason, admin_notes = COALESCE(_notes, admin_notes),
          reviewed_at = now(), reviewer_id = _actor_id
      WHERE id = _request_id;

  ELSIF _decision = 'resubmit' THEN
    -- Resident-only path from blocked_by_dues → submitted (if eligible now)
    IF v_req.requester_id <> _actor_id THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
    IF v_prev <> 'blocked_by_dues'::no_dues_status THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
    v_elig := public.compute_no_dues_eligibility_internal(v_req.society_id, v_req.flat_id);
    IF (v_elig->>'eligible')::boolean THEN
      v_new := 'submitted'::no_dues_status;
      UPDATE public.no_dues_requests SET status = v_new, eligibility_snapshot = v_elig WHERE id = _request_id;
    ELSE
      v_new := 'blocked_by_dues'::no_dues_status;
      UPDATE public.no_dues_requests SET eligibility_snapshot = v_elig WHERE id = _request_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'INVALID_REQUEST';
  END IF;

  INSERT INTO public.no_dues_audit(request_id, society_id, actor_id, action, previous_status, new_status, metadata)
  VALUES (_request_id, v_req.society_id, _actor_id, _decision, v_prev, v_new,
          jsonb_build_object('eligibility', v_elig, 'notes', _notes, 'reason', _reason));

  RETURN QUERY SELECT v_new, v_elig;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.transition_no_dues_request_internal(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_no_dues_request_internal(uuid, uuid, text, text, text) TO service_role;

-- =======================================================================
-- 4.  REWRITE FINALIZATION RPC — no trusted eligibility inputs
-- =======================================================================
DROP FUNCTION IF EXISTS public.finalize_no_dues_issuance_internal(uuid, uuid, text, text, text, date, jsonb, boolean);

CREATE OR REPLACE FUNCTION public.finalize_no_dues_issuance_internal(
  _actor_id uuid,
  _request_id uuid,
  _certificate_number text,
  _verification_token_hash text,
  _storage_path text,
  _valid_until date
) RETURNS TABLE(status text, certificate_id uuid, certificate_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req record;
  v_is_admin boolean;
  v_is_super boolean;
  v_elig jsonb;
  v_existing_id uuid;
  v_existing_num text;
  v_new_id uuid;
BEGIN
  IF _actor_id IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;

  SELECT id, society_id, flat_id, requester_id, status INTO v_req
    FROM public.no_dues_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;

  SELECT public.is_society_admin_for(_actor_id, v_req.society_id) INTO v_is_admin;
  SELECT public.is_super_admin(_actor_id) INTO v_is_super;
  IF NOT (COALESCE(v_is_admin,false) OR COALESCE(v_is_super,false)) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;

  -- Idempotency
  SELECT id, certificate_number INTO v_existing_id, v_existing_num
    FROM public.no_dues_certificates WHERE request_id = _request_id AND revoked_at IS NULL LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY SELECT 'issued'::text, v_existing_id, v_existing_num;
    RETURN;
  END IF;

  IF v_req.status <> 'approved'::no_dues_status THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;

  -- Independent eligibility recheck inside the transaction
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
    verification_token_hash, storage_path, valid_until,
    issued_at, issued_by
  ) VALUES (
    _request_id, v_req.society_id, v_req.flat_id, _certificate_number,
    _verification_token_hash, _storage_path, _valid_until,
    now(), _actor_id
  ) RETURNING id INTO v_new_id;

  UPDATE public.no_dues_requests
    SET status = 'issued'::no_dues_status, eligibility_snapshot = v_elig
    WHERE id = _request_id;

  INSERT INTO public.no_dues_audit(request_id, certificate_id, society_id, actor_id, action, previous_status, new_status, metadata)
  VALUES (_request_id, v_new_id, v_req.society_id, _actor_id, 'issue', 'approved'::no_dues_status,
          'issued'::no_dues_status, jsonb_build_object('certificate_number', _certificate_number, 'eligibility', v_elig));

  RETURN QUERY SELECT 'issued'::text, v_new_id, _certificate_number;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finalize_no_dues_issuance_internal(uuid, uuid, text, text, text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_no_dues_issuance_internal(uuid, uuid, text, text, text, date) TO service_role;
