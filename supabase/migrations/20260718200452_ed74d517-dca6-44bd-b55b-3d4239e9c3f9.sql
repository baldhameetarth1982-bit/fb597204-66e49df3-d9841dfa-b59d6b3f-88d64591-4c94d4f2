
-- Stage 3C closure — routing payment/receipt reads through explicit
-- SECURITY DEFINER authorization RPCs, retiring authenticated SELECT on
-- receipt tables, and adding receipt lifecycle read shape.

-- Receipt reads and sequence tables: authenticated must go through RPCs.
REVOKE SELECT ON public.payment_receipts FROM authenticated;
REVOKE SELECT ON public.payment_receipt_sequences FROM authenticated;
-- payment_receipt_month_sequences has no authenticated grant, but be explicit.
REVOKE SELECT ON public.payment_receipt_month_sequences FROM PUBLIC;
REVOKE SELECT ON public.payment_receipt_month_sequences FROM authenticated;

-- Server-authorized: get receipt lifecycle for a payment. Callers must be
-- an authorized admin for the society, or the resident of the payment's
-- flat. Returns null when no receipt row exists (pending / rejected).
CREATE OR REPLACE FUNCTION public.get_payment_receipt_lifecycle(_payment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  p record;
  is_resident boolean;
  is_admin boolean;
  r record;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  SELECT id, society_id, flat_id, bill_id INTO p
    FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_not_found' USING ERRCODE = '02000'; END IF;

  is_admin := public.current_user_has_society_permission(p.society_id, 'billing.manage'::text, NULL::uuid)
              OR public.has_role(uid, 'super_admin'::app_role);
  SELECT EXISTS(SELECT 1 FROM public.flat_residents
                WHERE flat_id = p.flat_id AND user_id = uid) INTO is_resident;
  IF NOT (is_admin OR is_resident) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT id, payment_id, society_id, receipt_number, issued_at, status,
         voided_at, voided_by, void_reason,
         amount_snapshot, method_snapshot, reference_snapshot, bill_number_snapshot,
         verified_by, verified_at
    INTO r
    FROM public.payment_receipts WHERE payment_id = _payment_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'id', r.id,
    'payment_id', r.payment_id,
    'society_id', r.society_id,
    'receipt_number', r.receipt_number,
    'issued_at', r.issued_at,
    'status', r.status,
    'voided_at', r.voided_at,
    'voided_by', r.voided_by,
    'void_reason', r.void_reason,
    'amount_snapshot', r.amount_snapshot,
    'method_snapshot', r.method_snapshot,
    'reference_snapshot', r.reference_snapshot,
    'bill_number_snapshot', r.bill_number_snapshot,
    'verified_by', r.verified_by,
    'verified_at', r.verified_at
  );
END; $$;
REVOKE ALL ON FUNCTION public.get_payment_receipt_lifecycle(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_payment_receipt_lifecycle(uuid) TO authenticated;

-- Server-authorized: list offline payments for a society. Admin only
-- (billing.manage or super_admin). No proof_url in the projection.
CREATE OR REPLACE FUNCTION public.list_society_payments_v1(
  _society_id uuid, _status text, _limit int, _offset int
) RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  is_admin boolean;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  is_admin := public.current_user_has_society_permission(_society_id, 'billing.manage'::text, NULL::uuid)
              OR public.has_role(uid, 'super_admin'::app_role);
  IF NOT is_admin THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT jsonb_build_object(
      'id', p.id,
      'bill_id', p.bill_id,
      'society_id', p.society_id,
      'flat_id', p.flat_id,
      'amount', p.amount,
      'method', p.method,
      'status', p.status,
      'reference_no', p.reference_no,
      'notes', p.notes,
      'submitted_at', p.submitted_at,
      'submitted_by', p.submitted_by,
      'source', p.source,
      'payment_date', p.payment_date,
      'verified_at', p.verified_at,
      'verified_by', p.verified_by,
      'verification_notes', p.verification_notes,
      'rejected_at', p.rejected_at,
      'rejection_reason', p.rejection_reason,
      'reversed_at', p.reversed_at,
      'reversal_reason', p.reversal_reason,
      'created_at', p.created_at
    )
    FROM public.payments p
    WHERE p.society_id = _society_id
      AND (_status = 'all' OR p.status = _status)
    ORDER BY p.submitted_at DESC NULLS LAST, p.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(_limit, 50), 200))
    OFFSET GREATEST(0, COALESCE(_offset, 0));
END; $$;
REVOKE ALL ON FUNCTION public.list_society_payments_v1(uuid,text,int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_society_payments_v1(uuid,text,int,int) TO authenticated;

-- Server-authorized: resident own-active-flat offline payments.
CREATE OR REPLACE FUNCTION public.get_resident_payments_v1(_limit int, _offset int)
RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT jsonb_build_object(
      'id', p.id,
      'bill_id', p.bill_id,
      'society_id', p.society_id,
      'flat_id', p.flat_id,
      'amount', p.amount,
      'method', p.method,
      'status', p.status,
      'reference_no', p.reference_no,
      'submitted_at', p.submitted_at,
      'payment_date', p.payment_date,
      'verified_at', p.verified_at,
      'rejected_at', p.rejected_at,
      'rejection_reason', p.rejection_reason,
      'reversed_at', p.reversed_at,
      'reversal_reason', p.reversal_reason,
      'created_at', p.created_at
    )
    FROM public.payments p
    WHERE p.flat_id IN (SELECT flat_id FROM public.flat_residents WHERE user_id = uid)
    ORDER BY p.submitted_at DESC NULLS LAST, p.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(_limit, 50), 200))
    OFFSET GREATEST(0, COALESCE(_offset, 0));
END; $$;
REVOKE ALL ON FUNCTION public.get_resident_payments_v1(int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_resident_payments_v1(int,int) TO authenticated;
