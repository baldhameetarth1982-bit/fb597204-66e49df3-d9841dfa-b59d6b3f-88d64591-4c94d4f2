CREATE OR REPLACE FUNCTION public.get_resident_payments_v1(_limit integer, _offset integer)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  has_active_residency boolean;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.flat_residents
      WHERE user_id = uid
        AND is_active = true
        AND moved_out_at IS NULL
  ) INTO has_active_residency;

  IF NOT has_active_residency THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

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