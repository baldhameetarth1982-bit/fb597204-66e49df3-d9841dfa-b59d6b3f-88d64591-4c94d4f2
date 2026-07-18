
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_notes text,
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS reversed_by uuid,
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS proof_url text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS payment_date date;

CREATE UNIQUE INDEX IF NOT EXISTS payments_idempotency_key_key
  ON public.payments (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_status_society_idx ON public.payments (society_id, status);
CREATE INDEX IF NOT EXISTS payments_bill_id_idx ON public.payments (bill_id);

CREATE TABLE IF NOT EXISTS public.payment_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL UNIQUE REFERENCES public.payments(id) ON DELETE RESTRICT,
  society_id uuid NOT NULL,
  receipt_number text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (society_id, receipt_number)
);
GRANT SELECT ON public.payment_receipts TO authenticated;
GRANT ALL ON public.payment_receipts TO service_role;
ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY receipts_admin_read ON public.payment_receipts
  FOR SELECT TO authenticated
  USING (public.current_user_has_society_permission(society_id, 'billing.manage'::text, NULL::uuid)
         OR public.has_role(auth.uid(), 'super_admin'::app_role));
CREATE POLICY receipts_resident_read ON public.payment_receipts
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.payments p
    JOIN public.flat_residents fr ON fr.flat_id = p.flat_id
    WHERE p.id = payment_receipts.payment_id AND fr.user_id = auth.uid()
  ));

CREATE TABLE IF NOT EXISTS public.payment_receipt_sequences (
  society_id uuid NOT NULL,
  year int NOT NULL,
  next_number int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (society_id, year)
);
GRANT SELECT ON public.payment_receipt_sequences TO authenticated;
GRANT ALL ON public.payment_receipt_sequences TO service_role;
ALTER TABLE public.payment_receipt_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY receipt_seq_admin_read ON public.payment_receipt_sequences
  FOR SELECT TO authenticated
  USING (public.current_user_has_society_permission(society_id,'billing.manage'::text, NULL::uuid)
         OR public.has_role(auth.uid(),'super_admin'::app_role));

CREATE OR REPLACE FUNCTION public._allocate_receipt_number(_society_id uuid, _now timestamptz)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE y int := EXTRACT(YEAR FROM _now)::int; n int;
BEGIN
  INSERT INTO public.payment_receipt_sequences(society_id, year, next_number)
    VALUES (_society_id, y, 1)
    ON CONFLICT (society_id, year) DO UPDATE SET next_number = payment_receipt_sequences.next_number
    RETURNING next_number INTO n;
  UPDATE public.payment_receipt_sequences
    SET next_number = n + 1, updated_at = now()
    WHERE society_id = _society_id AND year = y RETURNING next_number INTO n;
  RETURN 'RCP/'||y::text||'/'||LPAD((n-1)::text, 4, '0');
END; $$;
REVOKE ALL ON FUNCTION public._allocate_receipt_number(uuid, timestamptz) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public._sync_bill_payment_state(_bill_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b record; paid_sum numeric; total numeric; new_status text;
BEGIN
  SELECT id,status,cancelled_at,total_payable,amount,due_date INTO b
    FROM public.bills WHERE id=_bill_id FOR UPDATE;
  IF NOT FOUND OR b.cancelled_at IS NOT NULL THEN RETURN; END IF;
  SELECT COALESCE(SUM(amount),0) INTO paid_sum FROM public.payments
    WHERE bill_id=_bill_id AND status='verified';
  total := COALESCE(b.total_payable, b.amount, 0);
  IF paid_sum <= 0 THEN
    new_status := CASE WHEN b.due_date IS NOT NULL AND b.due_date < CURRENT_DATE
                       THEN 'overdue' ELSE 'unpaid' END;
    UPDATE public.bills SET status=new_status, paid_at=NULL, updated_at=now() WHERE id=_bill_id;
  ELSIF paid_sum >= total THEN
    UPDATE public.bills SET status='paid', paid_at=now(), updated_at=now() WHERE id=_bill_id;
  ELSE
    UPDATE public.bills SET status='partially_paid', paid_at=NULL, updated_at=now() WHERE id=_bill_id;
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public._sync_bill_payment_state(uuid) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.submit_offline_payment(
  _bill_id uuid, _method text, _amount numeric, _payment_date date,
  _reference_no text, _notes text, _proof_url text, _idempotency_key text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); b record; pid uuid;
        is_resident boolean; is_admin boolean; existing uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF _method NOT IN ('cash','bank_transfer') THEN
    RAISE EXCEPTION 'invalid_method' USING ERRCODE='22023'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE='22023'; END IF;
  IF _idempotency_key IS NOT NULL THEN
    SELECT id INTO existing FROM public.payments
      WHERE idempotency_key=_idempotency_key AND submitted_by=uid;
    IF existing IS NOT NULL THEN RETURN existing; END IF;
  END IF;
  SELECT id,society_id,flat_id,status,cancelled_at,total_payable,amount INTO b
    FROM public.bills WHERE id=_bill_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'bill_not_found' USING ERRCODE='02000'; END IF;
  IF b.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'bill_cancelled' USING ERRCODE='22023'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.flat_residents WHERE flat_id=b.flat_id AND user_id=uid)
    INTO is_resident;
  is_admin := public.current_user_has_society_permission(b.society_id,'billing.manage'::text, NULL::uuid)
              OR public.has_role(uid,'super_admin'::app_role);
  IF NOT (is_resident OR is_admin) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF _method = 'bank_transfer' AND (_reference_no IS NULL OR length(trim(_reference_no))=0) THEN
    RAISE EXCEPTION 'reference_required' USING ERRCODE='22023'; END IF;

  INSERT INTO public.payments(
    bill_id, society_id, flat_id, user_id, amount, method, status,
    reference_no, paid_at, notes,
    submitted_at, submitted_by, source, payment_date, proof_url, idempotency_key)
  VALUES (b.id, b.society_id, b.flat_id, uid, _amount, _method, 'pending',
    _reference_no, COALESCE(_payment_date::timestamptz, now()), _notes,
    now(), uid,
    CASE WHEN is_admin AND NOT is_resident THEN 'admin_entry' ELSE 'resident_submission' END,
    _payment_date, _proof_url, _idempotency_key)
  RETURNING id INTO pid;

  INSERT INTO public.audit_log(actor_id, society_id, action, entity_type, entity_id, metadata)
    VALUES (uid, b.society_id, 'payment.submitted', 'payment', pid,
            jsonb_build_object('method',_method,'amount',_amount,'bill_id',b.id));
  RETURN pid;
END; $$;
REVOKE ALL ON FUNCTION public.submit_offline_payment(uuid,text,numeric,date,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_offline_payment(uuid,text,numeric,date,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.verify_offline_payment(_payment_id uuid, _notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); p record; rn text; rid uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO p FROM public.payments WHERE id=_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_not_found' USING ERRCODE='02000'; END IF;
  IF NOT (public.current_user_has_society_permission(p.society_id,'billing.manage'::text, NULL::uuid)
          OR public.has_role(uid,'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF p.status <> 'pending' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  UPDATE public.payments SET status='verified', verified_by=uid, verified_at=now(),
    verification_notes=_notes, updated_at=now() WHERE id=_payment_id;
  rn := public._allocate_receipt_number(p.society_id, now());
  INSERT INTO public.payment_receipts(payment_id, society_id, receipt_number, issued_by)
    VALUES (_payment_id, p.society_id, rn, uid) RETURNING id INTO rid;
  IF p.bill_id IS NOT NULL THEN PERFORM public._sync_bill_payment_state(p.bill_id); END IF;
  INSERT INTO public.audit_log(actor_id, society_id, action, entity_type, entity_id, metadata)
    VALUES (uid, p.society_id, 'payment.verified', 'payment', _payment_id,
            jsonb_build_object('receipt_number',rn,'receipt_id',rid));
  RETURN jsonb_build_object('payment_id',_payment_id,'receipt_number',rn,'receipt_id',rid);
END; $$;
REVOKE ALL ON FUNCTION public.verify_offline_payment(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_offline_payment(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_offline_payment(_payment_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); p record;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF _reason IS NULL OR length(trim(_reason))=0 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  SELECT * INTO p FROM public.payments WHERE id=_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_not_found' USING ERRCODE='02000'; END IF;
  IF NOT (public.current_user_has_society_permission(p.society_id,'billing.manage'::text, NULL::uuid)
          OR public.has_role(uid,'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF p.status <> 'pending' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  UPDATE public.payments SET status='rejected', rejected_by=uid, rejected_at=now(),
    rejection_reason=_reason, updated_at=now() WHERE id=_payment_id;
  INSERT INTO public.audit_log(actor_id, society_id, action, entity_type, entity_id, metadata)
    VALUES (uid, p.society_id, 'payment.rejected', 'payment', _payment_id,
            jsonb_build_object('reason',_reason));
END; $$;
REVOKE ALL ON FUNCTION public.reject_offline_payment(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_offline_payment(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reverse_offline_payment(_payment_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); p record;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF _reason IS NULL OR length(trim(_reason))=0 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  SELECT * INTO p FROM public.payments WHERE id=_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_not_found' USING ERRCODE='02000'; END IF;
  IF NOT (public.current_user_has_society_permission(p.society_id,'billing.manage'::text, NULL::uuid)
          OR public.has_role(uid,'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF p.status <> 'verified' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  UPDATE public.payments SET status='reversed', reversed_by=uid, reversed_at=now(),
    reversal_reason=_reason, updated_at=now() WHERE id=_payment_id;
  IF p.bill_id IS NOT NULL THEN PERFORM public._sync_bill_payment_state(p.bill_id); END IF;
  INSERT INTO public.audit_log(actor_id, society_id, action, entity_type, entity_id, metadata)
    VALUES (uid, p.society_id, 'payment.reversed', 'payment', _payment_id,
            jsonb_build_object('reason',_reason));
END; $$;
REVOKE ALL ON FUNCTION public.reverse_offline_payment(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_offline_payment(uuid,text) TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.payments FROM authenticated;
