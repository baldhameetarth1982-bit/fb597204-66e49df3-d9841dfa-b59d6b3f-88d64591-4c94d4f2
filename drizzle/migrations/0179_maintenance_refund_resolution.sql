ALTER TABLE public.maintenance_payment_orders
  ADD COLUMN IF NOT EXISTS refund_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_resolved_by uuid,
  ADD COLUMN IF NOT EXISTS refund_reference text CHECK (refund_reference IS NULL OR char_length(refund_reference) BETWEEN 4 AND 80),
  ADD COLUMN IF NOT EXISTS refund_note text CHECK (refund_note IS NULL OR char_length(refund_note) BETWEEN 10 AND 500);

CREATE OR REPLACE FUNCTION public.admin_list_refund_needed_orders(_society_id uuid)
RETURNS TABLE(id uuid, flat_number text, amount_paise bigint, razorpay_payment_id text, failure_code text, created_at timestamptz, refund_resolved_at timestamptz, refund_reference text, refund_note text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.current_user_has_society_permission(_society_id,'billing.manage'::text,NULL::uuid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT o.id, f.flat_number, o.amount_paise, o.razorpay_payment_id, o.failure_code, o.created_at, o.refund_resolved_at, o.refund_reference, o.refund_note
    FROM public.maintenance_payment_orders o JOIN public.flats f ON f.id=o.flat_id
    WHERE o.society_id=_society_id AND o.status='needs_refund'
    ORDER BY (o.refund_resolved_at IS NOT NULL), o.created_at DESC LIMIT 200;
END $$;

CREATE OR REPLACE FUNCTION public.admin_mark_order_refunded(_order_id uuid, _reference text, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.maintenance_payment_orders;
BEGIN
  SELECT * INTO o FROM public.maintenance_payment_orders WHERE id=_order_id FOR UPDATE;
  IF NOT FOUND OR NOT public.current_user_has_society_permission(o.society_id,'billing.manage'::text,NULL::uuid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE='42501';
  END IF;
  IF o.status <> 'needs_refund' THEN RAISE EXCEPTION 'not_refund_needed'; END IF;
  IF o.refund_resolved_at IS NOT NULL THEN RETURN; END IF;
  IF char_length(btrim(coalesce(_reference,''))) NOT BETWEEN 4 AND 80 OR char_length(btrim(coalesce(_note,''))) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;
  UPDATE public.maintenance_payment_orders SET refund_resolved_at=now(), refund_resolved_by=auth.uid(),
    refund_reference=btrim(_reference), refund_note=btrim(_note), updated_at=now() WHERE id=_order_id;
  INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
    VALUES (auth.uid(), o.society_id, 'maintenance_payment.refund_recorded', 'maintenance_payment_orders', o.id,
      jsonb_build_object('amount_paise', o.amount_paise, 'reference', btrim(_reference)));
END $$;

REVOKE ALL ON FUNCTION public.admin_list_refund_needed_orders(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_mark_order_refunded(uuid,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_refund_needed_orders(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_order_refunded(uuid,text,text) TO authenticated;