CREATE TABLE public.maintenance_payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  flat_id uuid NOT NULL REFERENCES public.flats(id) ON DELETE RESTRICT,
  bill_id uuid NOT NULL REFERENCES public.bills(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 8 AND 80),
  amount_paise bigint NOT NULL CHECK (amount_paise > 0 AND amount_paise <= 10000000000),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  status text NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed','created','paid','failed','expired','needs_refund')),
  razorpay_order_id text UNIQUE,
  razorpay_payment_id text UNIQUE,
  payment_id uuid UNIQUE REFERENCES public.payments(id) ON DELETE RESTRICT,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, request_id)
);
CREATE INDEX maintenance_payment_orders_bill_idx ON public.maintenance_payment_orders(bill_id, status);
CREATE INDEX maintenance_payment_orders_society_idx ON public.maintenance_payment_orders(society_id, created_at DESC);
GRANT SELECT ON public.maintenance_payment_orders TO authenticated;
GRANT ALL ON public.maintenance_payment_orders TO service_role;
ALTER TABLE public.maintenance_payment_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY mpo_own_read ON public.maintenance_payment_orders FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY mpo_finance_read ON public.maintenance_payment_orders FOR SELECT TO authenticated USING (public._finance_reader_for(society_id));

CREATE TABLE public.maintenance_payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  payload_sha256 text NOT NULL,
  order_id uuid REFERENCES public.maintenance_payment_orders(id) ON DELETE RESTRICT,
  society_id uuid,
  processing_status text NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received','processed','ignored','failed')),
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
GRANT SELECT ON public.maintenance_payment_events TO authenticated;
GRANT ALL ON public.maintenance_payment_events TO service_role;
ALTER TABLE public.maintenance_payment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY mpe_finance_read ON public.maintenance_payment_events FOR SELECT TO authenticated USING (society_id IS NOT NULL AND public._finance_reader_for(society_id));

-- Online maintenance entitlement: top plan (premium, shown as Pro) or live trial.
CREATE OR REPLACE FUNCTION public._online_maintenance_enabled(_society_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.societies s WHERE s.id=_society_id
    AND lower(btrim(coalesce(s.status,'active')))='active'
    AND CASE WHEN lower(coalesce(s.plan_status,'')) IN ('trial','trialing') THEN s.trial_ends_at IS NOT NULL AND s.trial_ends_at > now()
      ELSE lower(coalesce(s.plan_id,''))='premium' AND lower(coalesce(s.plan_status,''))='active'
           AND (s.plan_expires_at IS NULL OR s.plan_expires_at > now()) END)
$$;
REVOKE ALL ON FUNCTION public._online_maintenance_enabled(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public._online_maintenance_enabled(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._bill_outstanding(_bill_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(b.total_payable, b.amount, 0)
    + COALESCE((SELECT sum(amount) FROM public.bill_adjustments a WHERE a.bill_id=b.id),0)
    - COALESCE((SELECT sum(amount) FROM public.payments p WHERE p.bill_id=b.id AND p.status='verified'),0)
  FROM public.bills b WHERE b.id=_bill_id
$$;
REVOKE ALL ON FUNCTION public._bill_outstanding(uuid) FROM public, anon, authenticated;

-- Resident claims an order: amount, society, flat and bill all resolved here.
CREATE OR REPLACE FUNCTION public.claim_maintenance_payment_order(_bill_id uuid, _request_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); b record; o public.maintenance_payment_orders%ROWTYPE; v_out numeric; v_paise bigint;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF _request_id IS NULL OR char_length(_request_id) NOT BETWEEN 8 AND 80 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
  SELECT * INTO o FROM public.maintenance_payment_orders WHERE user_id=uid AND request_id=_request_id;
  IF FOUND THEN
    IF o.bill_id <> _bill_id THEN RAISE EXCEPTION 'request_conflict' USING ERRCODE='22023'; END IF;
    RETURN jsonb_build_object('order_id',o.id,'amount_paise',o.amount_paise,'status',o.status,'razorpay_order_id',o.razorpay_order_id);
  END IF;
  SELECT id, society_id, flat_id, cancelled_at INTO b FROM public.bills WHERE id=_bill_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bill_not_found' USING ERRCODE='02000'; END IF;
  IF b.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'bill_cancelled' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.flat_residents fr WHERE fr.flat_id=b.flat_id AND fr.user_id=uid
      AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF NOT public._online_maintenance_enabled(b.society_id) THEN RAISE EXCEPTION 'plan_required' USING ERRCODE='42501'; END IF;
  PERFORM public.check_rate_limit('mpo:'||uid::text, 10, 3600) WHERE to_regprocedure('public.check_rate_limit(text,integer,integer)') IS NOT NULL;
  -- Expire stale open orders, block a second live checkout for the same bill.
  UPDATE public.maintenance_payment_orders SET status='expired', updated_at=now()
    WHERE bill_id=_bill_id AND status IN ('claimed','created') AND created_at < now() - interval '30 minutes';
  IF EXISTS (SELECT 1 FROM public.maintenance_payment_orders WHERE bill_id=_bill_id AND status IN ('claimed','created')) THEN
    RAISE EXCEPTION 'payment_in_progress' USING ERRCODE='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payments WHERE bill_id=_bill_id AND status='pending') THEN
    RAISE EXCEPTION 'offline_payment_pending' USING ERRCODE='55000';
  END IF;
  v_out := public._bill_outstanding(_bill_id);
  IF v_out IS NULL OR v_out <= 0 THEN RAISE EXCEPTION 'nothing_due' USING ERRCODE='22023'; END IF;
  v_paise := round(v_out * 100)::bigint;
  INSERT INTO public.maintenance_payment_orders(society_id,flat_id,bill_id,user_id,request_id,amount_paise)
    VALUES (b.society_id,b.flat_id,_bill_id,uid,_request_id,v_paise) RETURNING * INTO o;
  INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
    VALUES (uid, b.society_id, 'online_payment.order_claimed', 'maintenance_payment_orders', o.id, jsonb_build_object('bill_id',_bill_id,'amount_paise',v_paise));
  RETURN jsonb_build_object('order_id',o.id,'amount_paise',o.amount_paise,'status',o.status,'razorpay_order_id',NULL);
END $$;
REVOKE ALL ON FUNCTION public.claim_maintenance_payment_order(uuid,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_maintenance_payment_order(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.attach_maintenance_razorpay_order(_order_id uuid, _razorpay_order_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.maintenance_payment_orders SET razorpay_order_id=_razorpay_order_id, status='created', updated_at=now()
    WHERE id=_order_id AND status='claimed' AND razorpay_order_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_claimable' USING ERRCODE='55000'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.attach_maintenance_razorpay_order(uuid,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_maintenance_razorpay_order(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.fail_maintenance_payment_order(_razorpay_order_id text, _code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.maintenance_payment_orders SET status='failed', failure_code=left(_code,64), updated_at=now()
    WHERE razorpay_order_id=_razorpay_order_id AND status IN ('claimed','created');
END $$;
REVOKE ALL ON FUNCTION public.fail_maintenance_payment_order(text,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_maintenance_payment_order(text,text) TO service_role;

-- Canonical finalizer (service only): one order -> one payment -> one receipt -> one journal.
CREATE OR REPLACE FUNCTION public.finalize_maintenance_online_payment(_razorpay_order_id text, _razorpay_payment_id text, _amount_paise bigint, _currency text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.maintenance_payment_orders%ROWTYPE; v_out numeric; v_pid uuid; rn text; rid uuid;
BEGIN
  SELECT * INTO o FROM public.maintenance_payment_orders WHERE razorpay_order_id=_razorpay_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE='02000'; END IF;
  IF o.status='paid' THEN
    IF o.razorpay_payment_id IS DISTINCT FROM _razorpay_payment_id THEN
      RETURN jsonb_build_object('status','duplicate_capture','order_id',o.id);
    END IF;
    RETURN jsonb_build_object('status','paid','order_id',o.id,'payment_id',o.payment_id,'already',true);
  END IF;
  IF o.status='needs_refund' THEN RETURN jsonb_build_object('status','needs_refund','order_id',o.id); END IF;
  IF _amount_paise <> o.amount_paise OR _currency <> o.currency THEN
    UPDATE public.maintenance_payment_orders SET status='needs_refund', failure_code='amount_mismatch', razorpay_payment_id=_razorpay_payment_id, updated_at=now() WHERE id=o.id;
    RETURN jsonb_build_object('status','needs_refund','order_id',o.id);
  END IF;
  PERFORM 1 FROM public.bills WHERE id=o.bill_id AND cancelled_at IS NULL FOR UPDATE;
  v_out := public._bill_outstanding(o.bill_id);
  IF NOT FOUND OR v_out IS NULL OR (o.amount_paise::numeric/100) > v_out + 0.0001 THEN
    UPDATE public.maintenance_payment_orders SET status='needs_refund', failure_code='no_longer_due', razorpay_payment_id=_razorpay_payment_id, updated_at=now() WHERE id=o.id;
    INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
      VALUES (o.user_id, o.society_id, 'online_payment.needs_refund', 'maintenance_payment_orders', o.id, jsonb_build_object('razorpay_payment_id',_razorpay_payment_id));
    PERFORM public._notify_user(o.user_id, o.society_id, 'payment', 'Payment received — refund needed', 'This bill was already settled. The committee will refund your online payment.', '/app/bills/'||o.bill_id::text);
    RETURN jsonb_build_object('status','needs_refund','order_id',o.id);
  END IF;
  INSERT INTO public.payments(bill_id, society_id, flat_id, user_id, amount, method, status, reference_no, paid_at, payment_date,
      razorpay_order_id, razorpay_payment_id, submitted_by, submitted_at, source, idempotency_key)
    VALUES (o.bill_id, o.society_id, o.flat_id, o.user_id, o.amount_paise::numeric/100, 'razorpay', 'pending', _razorpay_payment_id, now(), CURRENT_DATE,
      _razorpay_order_id, _razorpay_payment_id, o.user_id, now(), 'online', 'rzp:'||_razorpay_payment_id)
    RETURNING id INTO v_pid;
  UPDATE public.payments SET status='verified', verified_by=o.user_id, verified_at=now(),
      verification_notes='Online payment confirmed by Razorpay' WHERE id=v_pid;
  rn := public._allocate_receipt_number_monthly(o.society_id, now());
  INSERT INTO public.payment_receipts(payment_id, society_id, receipt_number, issued_by, status, amount_snapshot, method_snapshot, reference_snapshot, verified_by, verified_at)
    VALUES (v_pid, o.society_id, rn, o.user_id, 'valid', o.amount_paise::numeric/100, 'razorpay', _razorpay_payment_id, o.user_id, now()) RETURNING id INTO rid;
  PERFORM public._sync_bill_payment_state(o.bill_id);
  UPDATE public.maintenance_payment_orders SET status='paid', razorpay_payment_id=_razorpay_payment_id, payment_id=v_pid, updated_at=now() WHERE id=o.id;
  INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
    VALUES (o.user_id, o.society_id, 'payment.online_verified', 'payment', v_pid, jsonb_build_object('receipt_number',rn,'razorpay_payment_id',_razorpay_payment_id,'order_id',o.id));
  PERFORM public._notify_user(o.user_id, o.society_id, 'payment', 'Payment received', 'Receipt '||rn||' is ready in My receipts.', '/app/receipts');
  RETURN jsonb_build_object('status','paid','order_id',o.id,'payment_id',v_pid,'receipt_number',rn);
END $$;
REVOKE ALL ON FUNCTION public.finalize_maintenance_online_payment(text,text,bigint,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_maintenance_online_payment(text,text,bigint,text) TO service_role;

-- Ledger: online (Razorpay) settlements post to Bank, same as bank transfers.
CREATE OR REPLACE FUNCTION public._finance_payment_posting_trigger()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_journal uuid; v_original uuid; v_cash_account text;
BEGIN
  IF NOT public._finance_plan_enabled(NEW.society_id) THEN RETURN NEW; END IF;
  IF NEW.status IN ('verified', 'reversed') AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_cash_account := CASE WHEN NEW.method = 'cash' THEN 'cash'
      WHEN NEW.method IN ('bank_transfer','razorpay') THEN 'bank' ELSE NULL END;
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