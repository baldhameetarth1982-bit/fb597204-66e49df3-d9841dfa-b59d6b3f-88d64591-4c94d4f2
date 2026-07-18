
GRANT EXECUTE ON FUNCTION public.get_admin_society_ids(uuid) TO anon;

ALTER TABLE public.payment_receipts
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'valid'
    CHECK (status IN ('valid','void')),
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS amount_snapshot numeric,
  ADD COLUMN IF NOT EXISTS method_snapshot text,
  ADD COLUMN IF NOT EXISTS reference_snapshot text,
  ADD COLUMN IF NOT EXISTS bill_number_snapshot text,
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

CREATE TABLE IF NOT EXISTS public.payment_receipt_month_sequences (
  society_id uuid NOT NULL,
  year_month int NOT NULL,
  next_number int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (society_id, year_month)
);
GRANT ALL ON public.payment_receipt_month_sequences TO service_role;
ALTER TABLE public.payment_receipt_month_sequences ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._allocate_receipt_number_monthly(_society_id uuid, _now timestamptz)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ym int := (EXTRACT(YEAR FROM _now)::int * 100 + EXTRACT(MONTH FROM _now)::int);
        n int;
BEGIN
  INSERT INTO public.payment_receipt_month_sequences(society_id, year_month, next_number)
    VALUES (_society_id, ym, 1)
    ON CONFLICT (society_id, year_month) DO UPDATE
      SET next_number = payment_receipt_month_sequences.next_number
    RETURNING next_number INTO n;
  UPDATE public.payment_receipt_month_sequences
    SET next_number = n + 1, updated_at = now()
    WHERE society_id = _society_id AND year_month = ym RETURNING next_number INTO n;
  RETURN 'RCPT/' || ym::text || '/' || LPAD((n - 1)::text, 4, '0');
END; $$;
REVOKE ALL ON FUNCTION public._allocate_receipt_number_monthly(uuid, timestamptz) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.get_bill_payment_summary(_bill_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
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

  SELECT EXISTS(SELECT 1 FROM public.flat_residents
                WHERE flat_id = b.flat_id AND user_id = uid) INTO is_resident;
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
END; $$;
REVOKE ALL ON FUNCTION public.get_bill_payment_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_bill_payment_summary(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.submit_offline_payment(uuid,text,numeric,date,text,text,text,text);

CREATE OR REPLACE FUNCTION public.submit_offline_payment(
  _bill_id uuid,
  _method text,
  _amount numeric,
  _payment_date date,
  _reference_no text,
  _notes text,
  _idempotency_key text,
  _actor_role text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  SELECT EXISTS(SELECT 1 FROM public.flat_residents WHERE flat_id = b.flat_id AND user_id = uid)
    INTO is_resident;
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
END; $$;
REVOKE ALL ON FUNCTION public.submit_offline_payment(uuid,text,numeric,date,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_offline_payment(uuid,text,numeric,date,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.verify_offline_payment(_payment_id uuid, _notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  p record;
  b record;
  verified_sum numeric;
  total numeric;
  remaining numeric;
  rn text;
  rid uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;

  SELECT * INTO p FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_not_found' USING ERRCODE='02000'; END IF;
  IF NOT (public.current_user_has_society_permission(p.society_id,'billing.manage'::text, NULL::uuid)
          OR public.has_role(uid,'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF p.status <> 'pending' THEN
    RAISE EXCEPTION 'payment_not_pending' USING ERRCODE='22023';
  END IF;
  IF p.submitted_by = uid THEN
    RAISE EXCEPTION 'self_verification_not_allowed' USING ERRCODE='42501';
  END IF;

  IF p.bill_id IS NULL THEN
    RAISE EXCEPTION 'bill_not_found' USING ERRCODE='02000';
  END IF;
  SELECT id, cancelled_at, total_payable, amount
    INTO b FROM public.bills WHERE id = p.bill_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bill_not_found' USING ERRCODE='02000'; END IF;
  IF b.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'bill_cancelled' USING ERRCODE='22023';
  END IF;

  total := COALESCE(b.total_payable, b.amount, 0);
  SELECT COALESCE(SUM(amount),0) INTO verified_sum
    FROM public.payments WHERE bill_id = p.bill_id AND status = 'verified';
  remaining := total - verified_sum;
  IF p.amount > remaining + 0.0001 THEN
    RAISE EXCEPTION 'amount_exceeds_outstanding' USING ERRCODE='22023';
  END IF;

  UPDATE public.payments
    SET status='verified', verified_by=uid, verified_at=now(),
        verification_notes=_notes, updated_at=now()
    WHERE id = _payment_id;

  rn := public._allocate_receipt_number_monthly(p.society_id, now());
  INSERT INTO public.payment_receipts(
    payment_id, society_id, receipt_number, issued_by, status,
    amount_snapshot, method_snapshot, reference_snapshot,
    verified_by, verified_at)
  VALUES (_payment_id, p.society_id, rn, uid, 'valid',
          p.amount, p.method, p.reference_no, uid, now())
  RETURNING id INTO rid;

  PERFORM public._sync_bill_payment_state(p.bill_id);

  INSERT INTO public.audit_log(actor_id, society_id, action, entity_type, entity_id, metadata)
    VALUES (uid, p.society_id, 'payment.verified', 'payment', _payment_id,
            jsonb_build_object('receipt_number', rn, 'receipt_id', rid));
  RETURN jsonb_build_object('payment_id', _payment_id, 'receipt_number', rn, 'receipt_id', rid);
END; $$;

CREATE OR REPLACE FUNCTION public.reverse_offline_payment(_payment_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  p record;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF _reason IS NULL OR length(trim(_reason)) = 0 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE='22023';
  END IF;

  SELECT * INTO p FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_not_found' USING ERRCODE='02000'; END IF;
  IF NOT (public.current_user_has_society_permission(p.society_id,'billing.manage'::text, NULL::uuid)
          OR public.has_role(uid,'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF p.status <> 'verified' THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023';
  END IF;

  IF p.bill_id IS NOT NULL THEN
    PERFORM 1 FROM public.bills WHERE id = p.bill_id FOR UPDATE;
  END IF;

  UPDATE public.payments
    SET status='reversed', reversed_by=uid, reversed_at=now(),
        reversal_reason=_reason, updated_at=now()
    WHERE id = _payment_id;

  UPDATE public.payment_receipts
    SET status='void', voided_at=now(), voided_by=uid, void_reason=_reason
    WHERE payment_id = _payment_id AND status = 'valid';

  IF p.bill_id IS NOT NULL THEN PERFORM public._sync_bill_payment_state(p.bill_id); END IF;

  INSERT INTO public.audit_log(actor_id, society_id, action, entity_type, entity_id, metadata)
    VALUES (uid, p.society_id, 'payment.reversed', 'payment', _payment_id,
            jsonb_build_object('reason',_reason));
  INSERT INTO public.audit_log(actor_id, society_id, action, entity_type, entity_id, metadata)
    VALUES (uid, p.society_id, 'receipt.voided', 'payment', _payment_id,
            jsonb_build_object('reason',_reason));
END; $$;
