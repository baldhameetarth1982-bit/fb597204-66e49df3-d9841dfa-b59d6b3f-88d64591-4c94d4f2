-- Stage 3C v4 — active-resident authorization + payment detail RPC

-- Helper condition: an active flat_residents row for (uid, flat_id)
-- means is_active = true AND moved_out_at IS NULL.

CREATE OR REPLACE FUNCTION public.get_bill_payment_summary(_bill_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  b record;
  is_resident boolean;
  is_admin boolean;
  total numeric;
  verified_sum numeric;
  pending_sum numeric;
  rejected_sum numeric;
  reversed_sum numeric;
  remaining numeric;
  available numeric;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  SELECT id, society_id, flat_id, status, cancelled_at, total_payable, amount
    INTO b FROM public.bills WHERE id = _bill_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'bill_not_found' USING ERRCODE = '02000'; END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.flat_residents
      WHERE flat_id = b.flat_id
        AND user_id = uid
        AND is_active = true
        AND moved_out_at IS NULL
  ) INTO is_resident;
  is_admin := public.current_user_has_society_permission(b.society_id, 'billing.manage'::text, NULL::uuid)
              OR public.has_role(uid, 'super_admin'::app_role);
  IF NOT (is_resident OR is_admin) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  total := COALESCE(b.total_payable, b.amount, 0);
  SELECT
    COALESCE(SUM(CASE WHEN status='verified' THEN amount ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN status='pending'  THEN amount ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN status='rejected' THEN amount ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN status='reversed' THEN amount ELSE 0 END),0)
    INTO verified_sum, pending_sum, rejected_sum, reversed_sum
    FROM public.payments WHERE bill_id = _bill_id;

  remaining := GREATEST(total - verified_sum, 0);
  available := GREATEST(total - verified_sum - pending_sum, 0);

  RETURN jsonb_build_object(
    'bill_id', b.id,
    'society_id', b.society_id,
    'total_payable', total,
    'verified_amount', verified_sum,
    'pending_amount', pending_sum,
    'rejected_amount', rejected_sum,
    'reversed_amount', reversed_sum,
    'remaining_verified_balance', remaining,
    'available_to_submit', available,
    'status', b.status,
    'cancelled', b.cancelled_at IS NOT NULL
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.get_payment_receipt_lifecycle(_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  SELECT EXISTS(
    SELECT 1 FROM public.flat_residents
      WHERE flat_id = p.flat_id
        AND user_id = uid
        AND is_active = true
        AND moved_out_at IS NULL
  ) INTO is_resident;
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
END; $function$;

CREATE OR REPLACE FUNCTION public.get_resident_payments_v1(_limit integer, _offset integer)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    WHERE p.flat_id IN (
      SELECT flat_id FROM public.flat_residents
        WHERE user_id = uid
          AND is_active = true
          AND moved_out_at IS NULL
    )
    ORDER BY p.submitted_at DESC NULLS LAST, p.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(_limit, 50), 200))
    OFFSET GREATEST(0, COALESCE(_offset, 0));
END; $function$;

CREATE OR REPLACE FUNCTION public.submit_offline_payment(
  _bill_id uuid, _method text, _amount numeric, _payment_date date,
  _reference_no text, _notes text, _idempotency_key text, _actor_role text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  b record;
  pid uuid;
  is_resident boolean;
  is_admin boolean;
  verified_sum numeric;
  pending_sum numeric;
  total numeric;
  available numeric;
  ref_norm text;
  dup_id uuid;
  existing record;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF _method NOT IN ('cash','bank_transfer') THEN
    RAISE EXCEPTION 'invalid_method' USING ERRCODE = '22023'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023'; END IF;
  IF _idempotency_key IS NULL OR length(trim(_idempotency_key)) < 6 THEN
    RAISE EXCEPTION 'invalid_idempotency_key' USING ERRCODE = '22023'; END IF;

  SELECT id, society_id, flat_id, status, cancelled_at, total_payable, amount
    INTO b FROM public.bills WHERE id = _bill_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bill_not_found' USING ERRCODE = '02000'; END IF;
  IF b.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'bill_cancelled' USING ERRCODE = '22023'; END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.flat_residents
      WHERE flat_id = b.flat_id
        AND user_id = uid
        AND is_active = true
        AND moved_out_at IS NULL
  ) INTO is_resident;
  is_admin := public.current_user_has_society_permission(b.society_id, 'billing.manage'::text, NULL::uuid)
              OR public.has_role(uid, 'super_admin'::app_role);

  IF _actor_role = 'resident' THEN
    IF NOT is_resident THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
    IF _method <> 'bank_transfer' THEN
      RAISE EXCEPTION 'resident_cash_not_allowed' USING ERRCODE = '42501';
    END IF;
  ELSIF _actor_role = 'admin' THEN
    IF NOT is_admin THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  ELSE
    RAISE EXCEPTION 'invalid_actor_role' USING ERRCODE = '22023';
  END IF;

  IF _method = 'bank_transfer' AND (_reference_no IS NULL OR length(trim(_reference_no)) = 0) THEN
    RAISE EXCEPTION 'reference_required' USING ERRCODE = '22023';
  END IF;

  SELECT id, bill_id, amount, method, COALESCE(reference_no, '') AS reference_no
    INTO existing
    FROM public.payments
    WHERE idempotency_key = _idempotency_key AND submitted_by = uid;
  IF FOUND THEN
    IF existing.bill_id = _bill_id
       AND existing.amount = _amount
       AND existing.method = _method
       AND existing.reference_no = COALESCE(_reference_no, '')
    THEN
      RETURN existing.id;
    ELSE
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF _method = 'bank_transfer' THEN
    ref_norm := upper(trim(_reference_no));
    SELECT id INTO dup_id FROM public.payments
      WHERE society_id = b.society_id
        AND method = 'bank_transfer'
        AND status IN ('pending', 'verified')
        AND upper(trim(COALESCE(reference_no,''))) = ref_norm
      LIMIT 1;
    IF dup_id IS NOT NULL THEN
      RAISE EXCEPTION 'duplicate_reference' USING ERRCODE = '23505';
    END IF;
  END IF;

  total := COALESCE(b.total_payable, b.amount, 0);
  SELECT
    COALESCE(SUM(CASE WHEN status='verified' THEN amount ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN status='pending'  THEN amount ELSE 0 END),0)
    INTO verified_sum, pending_sum
    FROM public.payments WHERE bill_id = _bill_id;
  available := total - verified_sum - pending_sum;
  IF _amount > available + 0.0001 THEN
    RAISE EXCEPTION 'amount_exceeds_outstanding' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payments(
    bill_id, society_id, flat_id, user_id, amount, method, status,
    reference_no, paid_at, notes,
    submitted_at, submitted_by, source, payment_date, idempotency_key)
  VALUES (b.id, b.society_id, b.flat_id, uid, _amount, _method, 'pending',
    _reference_no, COALESCE(_payment_date::timestamptz, now()), _notes,
    now(), uid,
    CASE WHEN _actor_role = 'admin' THEN 'admin_entry' ELSE 'resident_submission' END,
    _payment_date, _idempotency_key)
  RETURNING id INTO pid;

  INSERT INTO public.audit_log(actor_id, society_id, action, entity_type, entity_id, metadata)
    VALUES (uid, b.society_id, 'payment.submitted', 'payment', pid,
            jsonb_build_object('method',_method,'amount',_amount,'bill_id',b.id,
                               'source', CASE WHEN _actor_role='admin' THEN 'admin_entry' ELSE 'resident_submission' END));
  RETURN pid;
END; $function$;

-- New: server-authorized payment detail read
CREATE OR REPLACE FUNCTION public.get_payment_detail(_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  p record;
  is_resident boolean;
  is_admin boolean;
  bill_number text;
  flat_label text;
  receipt_json jsonb;
  summary_json jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  SELECT id, bill_id, society_id, flat_id, amount, method, status, reference_no,
         notes, submitted_at, submitted_by, source, payment_date,
         verified_at, verified_by, verification_notes,
         rejected_at, rejected_by, rejection_reason,
         reversed_at, reversed_by, reversal_reason, created_at
    INTO p FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_not_found' USING ERRCODE = '02000'; END IF;

  is_admin := public.current_user_has_society_permission(p.society_id, 'billing.manage'::text, NULL::uuid)
              OR public.has_role(uid, 'super_admin'::app_role);
  SELECT EXISTS(
    SELECT 1 FROM public.flat_residents
      WHERE flat_id = p.flat_id
        AND user_id = uid
        AND is_active = true
        AND moved_out_at IS NULL
  ) INTO is_resident;
  IF NOT (is_admin OR is_resident) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT b.bill_number INTO bill_number FROM public.bills b WHERE b.id = p.bill_id;
  SELECT COALESCE(bl.name || '-','') || f.flat_number
    INTO flat_label
    FROM public.flats f LEFT JOIN public.blocks bl ON bl.id = f.block_id
    WHERE f.id = p.flat_id;

  BEGIN
    SELECT public.get_payment_receipt_lifecycle(p.id) INTO receipt_json;
  EXCEPTION WHEN OTHERS THEN receipt_json := NULL;
  END;
  BEGIN
    IF p.bill_id IS NOT NULL THEN
      SELECT public.get_bill_payment_summary(p.bill_id) INTO summary_json;
    END IF;
  EXCEPTION WHEN OTHERS THEN summary_json := NULL;
  END;

  RETURN jsonb_build_object(
    'payment', jsonb_build_object(
      'id', p.id,
      'bill_id', p.bill_id,
      'society_id', p.society_id,
      'flat_id', p.flat_id,
      'amount', p.amount,
      'method', p.method,
      'status', p.status,
      'reference_no', p.reference_no,
      'notes', CASE WHEN is_admin THEN p.notes ELSE NULL END,
      'submitted_at', p.submitted_at,
      'submitted_by', CASE WHEN is_admin THEN p.submitted_by::text ELSE NULL END,
      'source', p.source,
      'payment_date', p.payment_date,
      'verified_at', p.verified_at,
      'verified_by', CASE WHEN is_admin THEN p.verified_by::text ELSE NULL END,
      'verification_notes', CASE WHEN is_admin THEN p.verification_notes ELSE NULL END,
      'rejected_at', p.rejected_at,
      'rejection_reason', p.rejection_reason,
      'reversed_at', p.reversed_at,
      'reversal_reason', p.reversal_reason,
      'created_at', p.created_at
    ),
    'bill_number', bill_number,
    'flat_label', flat_label,
    'summary', summary_json,
    'receipt', receipt_json,
    'audience', CASE WHEN is_admin THEN 'admin' ELSE 'resident' END
  );
END; $function$;

REVOKE ALL ON FUNCTION public.get_payment_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_payment_detail(uuid) TO authenticated;
