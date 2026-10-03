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
  IF NOT (SELECT allowed FROM public.touch_rate_limit('mpo_claim', uid::text, 10, 3600)) THEN RAISE EXCEPTION 'rate_limited' USING ERRCODE='54000'; END IF;
  UPDATE public.maintenance_payment_orders SET status='expired', updated_at=now()
    WHERE bill_id=_bill_id AND status IN ('claimed','created') AND created_at < now() - interval '30 minutes';
  SELECT * INTO o FROM public.maintenance_payment_orders WHERE bill_id=_bill_id AND user_id=uid AND status IN ('claimed','created') ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('order_id',o.id,'amount_paise',o.amount_paise,'status',o.status,'razorpay_order_id',o.razorpay_order_id);
  END IF;
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