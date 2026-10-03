-- UPI QR (manual) maintenance payments: society config + resident submission into the canonical payments table.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_method_chk;
ALTER TABLE public.payments ADD CONSTRAINT payments_method_chk
  CHECK (method = ANY (ARRAY['cash','bank_transfer','razorpay','manual','online','other_offline','upi_qr']));

CREATE TABLE public.society_upi_settings (
  society_id uuid PRIMARY KEY REFERENCES public.societies(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  upi_vpa text NOT NULL CHECK (upi_vpa ~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z0-9.-]{2,64}$'),
  payee_name text NOT NULL CHECK (length(btrim(payee_name)) BETWEEN 2 AND 80 AND payee_name !~ '[<>{}]'),
  qr_path text CHECK (qr_path IS NULL OR qr_path ~ '^qr/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$'),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.society_upi_settings TO service_role;
ALTER TABLE public.society_upi_settings ENABLE ROW LEVEL SECURITY;
-- No direct client access: reads/writes only via definer RPCs below.

CREATE UNIQUE INDEX IF NOT EXISTS payments_upi_ref_uniq
  ON public.payments (society_id, upper(btrim(reference_no)))
  WHERE method = 'upi_qr' AND status IN ('pending','verified');

CREATE OR REPLACE FUNCTION public.admin_get_society_upi(_society_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF NOT (public.current_user_has_society_permission(_society_id,'billing.manage'::text,NULL::uuid)
          OR public.has_role(auth.uid(),'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM public.society_upi_settings WHERE society_id=_society_id;
  RETURN jsonb_build_object('plan_enabled', public._online_maintenance_enabled(_society_id),
    'configured', s.society_id IS NOT NULL, 'enabled', coalesce(s.enabled,false),
    'upi_vpa', s.upi_vpa, 'payee_name', s.payee_name, 'qr_path', s.qr_path, 'updated_at', s.updated_at);
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_society_upi(_society_id uuid, _enabled boolean, _upi_vpa text, _payee_name text, _qr_path text, _keep_qr boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); v_qr text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF NOT public.current_user_has_society_permission(_society_id,'billing.manage'::text,NULL::uuid) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF NOT public._online_maintenance_enabled(_society_id) THEN RAISE EXCEPTION 'plan_required' USING ERRCODE='42501'; END IF;
  IF _qr_path IS NOT NULL AND _qr_path NOT LIKE 'qr/' || _society_id::text || '/%' THEN
    RAISE EXCEPTION 'invalid_path' USING ERRCODE='22023'; END IF;
  PERFORM public.touch_rate_limit('upi_cfg', uid::text, 20, 3600);
  SELECT CASE WHEN _keep_qr THEN qr_path ELSE NULL END INTO v_qr FROM public.society_upi_settings WHERE society_id=_society_id;
  INSERT INTO public.society_upi_settings(society_id, enabled, upi_vpa, payee_name, qr_path, updated_by, updated_at)
  VALUES (_society_id, _enabled, btrim(_upi_vpa), btrim(_payee_name), coalesce(_qr_path, v_qr), uid, now())
  ON CONFLICT (society_id) DO UPDATE SET enabled=EXCLUDED.enabled, upi_vpa=EXCLUDED.upi_vpa,
    payee_name=EXCLUDED.payee_name, qr_path=EXCLUDED.qr_path, updated_by=uid, updated_at=now();
  INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
  VALUES (uid, _society_id, 'upi_settings.updated', 'society_upi_settings', _society_id,
    jsonb_build_object('enabled',_enabled,'vpa',btrim(_upi_vpa),'qr_changed',_qr_path IS NOT NULL OR NOT _keep_qr));
END $$;

-- Resident: UPI details for one bill (home, plan, config and amount all server-resolved).
CREATE OR REPLACE FUNCTION public.get_bill_upi_details(_bill_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); b record; s record; due numeric; pend numeric;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  SELECT id, society_id, flat_id, bill_number, cancelled_at INTO b FROM public.bills WHERE id=_bill_id;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.flat_residents fr WHERE fr.flat_id=b.flat_id AND fr.user_id=uid
      AND fr.is_active AND fr.moved_out_at IS NULL) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF NOT public._online_maintenance_enabled(b.society_id) THEN RETURN jsonb_build_object('available',false,'reason','plan_required'); END IF;
  SELECT * INTO s FROM public.society_upi_settings WHERE society_id=b.society_id AND enabled;
  IF NOT FOUND THEN RETURN jsonb_build_object('available',false,'reason','not_configured'); END IF;
  due := public._bill_outstanding(b.id);
  SELECT coalesce(sum(amount),0) INTO pend FROM public.payments WHERE bill_id=b.id AND status='pending';
  RETURN jsonb_build_object('available', b.cancelled_at IS NULL, 'upi_vpa', s.upi_vpa, 'payee_name', s.payee_name,
    'qr_path', s.qr_path, 'amount_due', greatest(due - pend, 0), 'pending_amount', pend, 'bill_number', b.bill_number);
END $$;

-- Resident submission: amount = remaining due (never client-chosen); stays pending until committee verifies.
CREATE OR REPLACE FUNCTION public.submit_upi_qr_payment(_bill_id uuid, _reference_no text, _proof_path text, _idempotency_key text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); b record; ref text; amt numeric; pid uuid; existing record;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  ref := upper(btrim(coalesce(_reference_no,'')));
  IF ref !~ '^[A-Z0-9]{8,35}$' THEN RAISE EXCEPTION 'invalid_reference' USING ERRCODE='22023'; END IF;
  IF _idempotency_key IS NULL OR length(btrim(_idempotency_key)) NOT BETWEEN 6 AND 120 THEN
    RAISE EXCEPTION 'invalid_idempotency_key' USING ERRCODE='22023'; END IF;
  IF _proof_path IS NULL OR _proof_path !~ ('^' || uid::text || '/[0-9a-f-]{36}\.(png|jpg|webp)$') THEN
    RAISE EXCEPTION 'invalid_proof' USING ERRCODE='22023'; END IF;

  SELECT id, bill_id, reference_no INTO existing FROM public.payments WHERE idempotency_key=_idempotency_key AND submitted_by=uid;
  IF FOUND THEN
    IF existing.bill_id=_bill_id AND upper(existing.reference_no)=ref THEN RETURN existing.id; END IF;
    RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023';
  END IF;

  SELECT id, society_id, flat_id, cancelled_at INTO b FROM public.bills WHERE id=_bill_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bill_not_found' USING ERRCODE='02000'; END IF;
  IF b.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'bill_cancelled' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.flat_residents fr WHERE fr.flat_id=b.flat_id AND fr.user_id=uid AND fr.is_active AND fr.moved_out_at IS NULL) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF NOT public._online_maintenance_enabled(b.society_id) THEN RAISE EXCEPTION 'plan_required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.society_upi_settings WHERE society_id=b.society_id AND enabled) THEN
    RAISE EXCEPTION 'not_configured' USING ERRCODE='22023'; END IF;
  PERFORM public.touch_rate_limit('upi_submit', uid::text, 10, 3600);
  IF EXISTS (SELECT 1 FROM public.payments WHERE bill_id=b.id AND status='pending') THEN
    RAISE EXCEPTION 'offline_payment_pending' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.payments WHERE society_id=b.society_id AND method IN ('upi_qr','bank_transfer')
      AND status IN ('pending','verified') AND upper(btrim(coalesce(reference_no,'')))=ref) THEN
    RAISE EXCEPTION 'duplicate_reference' USING ERRCODE='23505'; END IF;
  amt := round(public._bill_outstanding(b.id), 2);
  IF amt <= 0 THEN RAISE EXCEPTION 'nothing_due' USING ERRCODE='22023'; END IF;

  INSERT INTO public.payments(bill_id, society_id, flat_id, user_id, amount, method, status, reference_no, paid_at,
    submitted_at, submitted_by, source, payment_date, idempotency_key, proof_url)
  VALUES (b.id, b.society_id, b.flat_id, uid, amt, 'upi_qr', 'pending', ref, now(), now(), uid,
    'resident_submission', CURRENT_DATE, _idempotency_key, _proof_path)
  RETURNING id INTO pid;
  INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
  VALUES (uid, b.society_id, 'payment.submitted', 'payment', pid,
    jsonb_build_object('method','upi_qr','amount',amt,'bill_id',b.id,'source','resident_submission','has_proof',true));
  RETURN pid;
END $$;

-- Proof path lookup for committee review (or the submitting resident).
CREATE OR REPLACE FUNCTION public.get_payment_proof_path(_payment_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  SELECT society_id, submitted_by, proof_url INTO p FROM public.payments WHERE id=_payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='02000'; END IF;
  IF NOT (p.submitted_by = auth.uid()
      OR public.current_user_has_society_permission(p.society_id,'billing.manage'::text,NULL::uuid)
      OR public.has_role(auth.uid(),'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  RETURN p.proof_url;
END $$;

-- Verified UPI QR money lands in the bank account, same as bank transfer / Razorpay.
CREATE OR REPLACE FUNCTION public._finance_payment_posting_trigger()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_journal uuid; v_original uuid; v_cash_account text;
BEGIN
  IF NOT public._finance_plan_enabled(NEW.society_id) THEN RETURN NEW; END IF;
  IF NEW.status IN ('verified', 'reversed') AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_cash_account := CASE WHEN NEW.method = 'cash' THEN 'cash'
      WHEN NEW.method IN ('bank_transfer','razorpay','upi_qr') THEN 'bank' ELSE NULL END;
    IF v_cash_account IS NULL THEN RAISE EXCEPTION 'unsupported_payment_method' USING ERRCODE = '22023'; END IF;
  END IF;
  IF NEW.status = 'verified' AND OLD.status IS DISTINCT FROM 'verified' THEN
    v_journal := public._finance_post_entry(NEW.society_id, COALESCE(NEW.verified_by, auth.uid()),
      COALESCE(NEW.payment_date, NEW.paid_at::date, NEW.verified_at::date, CURRENT_DATE),
      'Maintenance payment', NEW.reference_no, 'payment', NEW.id, 'post', v_cash_account, 'maintenance_income', NEW.amount, NULL);
    NEW.journal_entry_id := v_journal;
  ELSIF NEW.status = 'reversed' AND OLD.status = 'verified' THEN
    v_original := COALESCE(OLD.journal_entry_id, NEW.journal_entry_id);
    IF v_original IS NULL THEN RAISE EXCEPTION 'journal_missing' USING ERRCODE = '55000'; END IF;
    v_journal := public._finance_post_entry(NEW.society_id, COALESCE(NEW.reversed_by, auth.uid()),
      COALESCE(NEW.reversed_at::date, CURRENT_DATE), 'Reversal: maintenance payment', NEW.reference_no, 'payment_reversal', NEW.id, 'reverse',
      'maintenance_income', v_cash_account, NEW.amount, v_original);
    NEW.reversal_journal_entry_id := v_journal;
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.admin_get_society_upi(uuid), public.admin_set_society_upi(uuid,boolean,text,text,text,boolean),
  public.get_bill_upi_details(uuid), public.submit_upi_qr_payment(uuid,text,text,text), public.get_payment_proof_path(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_society_upi(uuid), public.admin_set_society_upi(uuid,boolean,text,text,text,boolean),
  public.get_bill_upi_details(uuid), public.submit_upi_qr_payment(uuid,text,text,text), public.get_payment_proof_path(uuid) TO authenticated;