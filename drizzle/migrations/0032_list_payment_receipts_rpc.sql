CREATE OR REPLACE FUNCTION public.list_payment_receipts_v1(_society_id uuid, _limit int DEFAULT 300)
RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); is_admin boolean := false;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF _society_id IS NOT NULL THEN
    is_admin := public.current_user_has_society_permission(_society_id, 'billing.manage'::text, NULL::uuid)
                OR public.has_role(uid, 'super_admin'::app_role);
    IF NOT is_admin THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN QUERY
    SELECT jsonb_build_object(
      'id', r.id, 'receipt_number', r.receipt_number, 'status', r.status,
      'issued_at', r.issued_at, 'verified_at', r.verified_at, 'voided_at', r.voided_at,
      'void_reason', r.void_reason, 'amount_snapshot', r.amount_snapshot,
      'method_snapshot', r.method_snapshot, 'reference_snapshot', r.reference_snapshot,
      'bill_number_snapshot', r.bill_number_snapshot,
      'home', CASE WHEN is_admin THEN f.flat_number ELSE NULL END)
    FROM public.payment_receipts r
    JOIN public.payments p ON p.id = r.payment_id
    LEFT JOIN public.flats f ON f.id = p.flat_id
    WHERE (is_admin AND r.society_id = _society_id)
       OR (NOT is_admin AND p.flat_id IN (SELECT fr.flat_id FROM public.flat_residents fr WHERE fr.user_id = uid))
    ORDER BY r.issued_at DESC NULLS LAST
    LIMIT GREATEST(1, LEAST(COALESCE(_limit, 300), 500));
END; $$;
REVOKE ALL ON FUNCTION public.list_payment_receipts_v1(uuid,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_payment_receipts_v1(uuid,int) TO authenticated;