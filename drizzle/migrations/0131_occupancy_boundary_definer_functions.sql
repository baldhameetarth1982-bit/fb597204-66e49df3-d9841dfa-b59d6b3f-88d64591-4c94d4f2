CREATE OR REPLACE FUNCTION public.list_payment_receipts_v1(_society_id uuid, _limit integer DEFAULT 300)
 RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
       OR (NOT is_admin AND EXISTS (
            SELECT 1 FROM public.flat_residents fr
            WHERE fr.flat_id = p.flat_id AND fr.user_id = uid
              AND (((fr.is_active IS NOT FALSE) AND fr.moved_out_at IS NULL)
                   OR (fr.moved_out_at IS NOT NULL AND p.created_at < (fr.moved_out_at::timestamptz + interval '1 day')))))
    ORDER BY r.issued_at DESC NULLS LAST
    LIMIT GREATEST(1, LEAST(COALESCE(_limit, 300), 500));
END; $function$;

CREATE OR REPLACE FUNCTION public.flat_outstanding(_flat_id uuid)
 RETURNS TABLE(pending numeric, overdue_count integer, next_due date)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_caller uuid := auth.uid(); v_society uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT society_id INTO v_society FROM public.flats WHERE id = _flat_id;
  IF v_society IS NULL THEN RAISE EXCEPTION 'Flat not found'; END IF;
  IF NOT (
    public.is_super_admin(v_caller)
    OR public.is_society_admin_for(v_caller, v_society)
    OR EXISTS (SELECT 1 FROM public.flat_residents fr
               WHERE fr.flat_id = _flat_id AND fr.user_id = v_caller
                 AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL)
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE WHEN b.status IN ('unpaid','overdue') THEN b.amount ELSE 0 END), 0)::numeric,
    COALESCE(SUM(CASE WHEN b.status = 'overdue' OR (b.status = 'unpaid' AND b.due_date < CURRENT_DATE) THEN 1 ELSE 0 END), 0)::int,
    MIN(CASE WHEN b.status IN ('unpaid','overdue') THEN b.due_date END)
  FROM public.bills b WHERE b.flat_id = _flat_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.apply_overdue_point_decay()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE affected INTEGER := 0;
BEGIN
  INSERT INTO public.user_points (user_id, society_id, points, reason)
  SELECT fr.user_id, b.society_id,
         -GREATEST(0, (CURRENT_DATE - COALESCE(b.last_decay_date, b.due_date)))::int,
         'Overdue decay'
  FROM public.bills b
  JOIN public.flat_residents fr ON fr.flat_id = b.flat_id
   AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL
  WHERE b.status NOT IN ('paid','cancelled')
    AND b.due_date < CURRENT_DATE
    AND (b.last_decay_date IS NULL OR b.last_decay_date < CURRENT_DATE)
    AND (CURRENT_DATE - COALESCE(b.last_decay_date, b.due_date)) > 0;
  UPDATE public.bills b SET last_decay_date = CURRENT_DATE
  WHERE b.status NOT IN ('paid','cancelled')
    AND b.due_date < CURRENT_DATE
    AND (b.last_decay_date IS NULL OR b.last_decay_date < CURRENT_DATE);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END $function$;