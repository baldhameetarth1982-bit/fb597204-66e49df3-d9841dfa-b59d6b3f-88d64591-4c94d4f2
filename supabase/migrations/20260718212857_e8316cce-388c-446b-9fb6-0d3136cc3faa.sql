-- Stage 3C v7 — safely shape get_payment_detail per audience.
-- Removes to_jsonb(p) whole-row exposure. Admin-only fields are only
-- populated when audience = 'admin'. proof_url and idempotency_key are
-- never returned on any audience.
CREATE OR REPLACE FUNCTION public.get_payment_detail(_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  p   public.payments%ROWTYPE;
  is_admin boolean := false;
  is_owner boolean := false;
  bill_num text;
  flat_lbl text;
  summary  jsonb;
  receipt  jsonb;
  common_payment jsonb;
  audience text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO p FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  is_admin :=
    public.has_role(uid, 'super_admin'::app_role)
    OR public.current_user_has_society_permission(p.society_id, 'billing.manage'::text, NULL::uuid);

  IF NOT is_admin THEN
    SELECT EXISTS (
      SELECT 1 FROM public.flat_residents fr
       JOIN public.bills b ON b.flat_id = fr.flat_id
       WHERE b.id = p.bill_id
         AND fr.user_id = uid
         AND fr.is_active = true
         AND fr.moved_out_at IS NULL
    ) INTO is_owner;
    IF NOT is_owner THEN
      RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  audience := CASE WHEN is_admin THEN 'admin' ELSE 'resident' END;

  SELECT b.bill_number, f.flat_number
    INTO bill_num, flat_lbl
    FROM public.bills b
    LEFT JOIN public.flats f ON f.id = b.flat_id
    WHERE b.id = p.bill_id;

  summary := public.get_bill_payment_summary(p.bill_id);
  receipt := public.get_payment_receipt_lifecycle(p.id);

  -- Common safe fields returned to every audience.
  common_payment := jsonb_build_object(
    'id', p.id,
    'bill_id', p.bill_id,
    'society_id', p.society_id,
    'flat_id', p.flat_id,
    'amount', p.amount,
    'method', p.method,
    'status', p.status,
    'reference_no', p.reference_no,
    'submitted_at', p.submitted_at,
    'source', p.source,
    'payment_date', p.payment_date,
    'verified_at', p.verified_at,
    'rejected_at', p.rejected_at,
    'rejection_reason', p.rejection_reason,
    'reversed_at', p.reversed_at,
    'reversal_reason', p.reversal_reason,
    'created_at', p.created_at
  );

  IF is_admin THEN
    common_payment := common_payment || jsonb_build_object(
      'notes', p.notes,
      'submitted_by', p.submitted_by,
      'verified_by', p.verified_by,
      'verification_notes', p.verification_notes,
      'rejected_by', p.rejected_by,
      'reversed_by', p.reversed_by
    );
  END IF;

  RETURN jsonb_build_object(
    'payment', common_payment,
    'bill_number', bill_num,
    'flat_label', flat_lbl,
    'summary', summary,
    'receipt', receipt,
    'audience', audience
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_payment_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_payment_detail(uuid) TO authenticated;