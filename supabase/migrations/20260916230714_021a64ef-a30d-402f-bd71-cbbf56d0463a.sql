-- Recover the canonical submit_offline_payment security contract after the
-- audit-column repair, without rewriting shared migration history.
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

  INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
    VALUES (uid, b.society_id, 'payment.submitted', 'payment', pid,
            jsonb_build_object('method',_method,'amount',_amount,'bill_id',b.id,
                               'source', CASE WHEN _actor_role='admin' THEN 'admin_entry' ELSE 'resident_submission' END));
  RETURN pid;
END; $function$;

DROP POLICY IF EXISTS "residents create their own payments" ON public.payments;
REVOKE INSERT, UPDATE, DELETE ON public.payments FROM authenticated;
ALTER TABLE public.payments ALTER COLUMN status SET DEFAULT 'pending';

DO $payment_security_check$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.submit_offline_payment(uuid,text,numeric,date,text,text,text,text)'::regprocedure)
    INTO v_definition;

  IF v_definition !~* 'flat_id[[:space:]]*=[[:space:]]*b[.]flat_id[[:space:]]+AND[[:space:]]+user_id[[:space:]]*=[[:space:]]*uid[[:space:]]+AND[[:space:]]+is_active[[:space:]]*=[[:space:]]*true[[:space:]]+AND[[:space:]]+moved_out_at[[:space:]]+IS[[:space:]]+NULL' THEN
    RAISE EXCEPTION 'submit_offline_payment active occupancy guard is missing';
  END IF;

  IF v_definition ~* 'insert[[:space:]]+into[[:space:]]+(public[.])?audit_log[[:space:]]*[(][^)]*(entity_type|entity_id|meta)([[:space:],)]|$)' THEN
    RAISE EXCEPTION 'submit_offline_payment uses noncanonical audit columns';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'payments'
       AND cmd = 'INSERT' AND 'authenticated' = ANY(roles)
  ) THEN
    RAISE EXCEPTION 'authenticated payment INSERT policy remains';
  END IF;

  IF has_table_privilege('authenticated', 'public.payments', 'INSERT')
     OR has_table_privilege('authenticated', 'public.payments', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.payments', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated direct payment mutation privilege remains';
  END IF;
END;
$payment_security_check$;