
-- Canonical eligibility v2: deduplicated blockers, primary_type + flags, safer status classification.
CREATE OR REPLACE FUNCTION public.compute_no_dues_eligibility_internal(
  _society_id uuid,
  _flat_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_flat_ok boolean;
  v_blockers jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_overdue_count int := 0;
  v_partial_count int := 0;
  v_unpaid_count int := 0;
  v_pending_count int := 0;
  v_unknown_count int := 0;
  v_inconsistent_count int := 0;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.flats f
    WHERE f.id = _flat_id AND f.society_id = _society_id
  ) INTO v_flat_ok;
  IF NOT v_flat_ok THEN
    RAISE EXCEPTION 'INVALID_FLAT_FOR_SOCIETY';
  END IF;

  -- Per-bill dedup: one row per bill, classified once.
  WITH settled AS (
    SELECT
      p.bill_id,
      SUM(CASE WHEN p.status = 'success' THEN p.amount ELSE 0 END)::numeric AS paid,
      BOOL_OR(p.status NOT IN ('success','pending','failed','rejected','cancelled','refunded','reversed'))
        AS has_unknown_status
    FROM public.payments p
    WHERE p.society_id = _society_id AND p.flat_id = _flat_id
    GROUP BY p.bill_id
  ),
  bill_calc AS (
    SELECT
      b.id AS bill_id,
      b.bill_number,
      b.due_date,
      b.amount AS total_amount,
      COALESCE(s.paid, 0) AS paid_amount,
      GREATEST(0, b.amount - COALESCE(s.paid, 0))::numeric AS remaining_amount,
      (b.status = 'paid') AS marked_paid,
      COALESCE(s.has_unknown_status, false) AS has_unknown_status,
      b.status AS bill_status
    FROM public.bills b
    LEFT JOIN settled s ON s.bill_id = b.id
    WHERE b.society_id = _society_id
      AND b.flat_id = _flat_id
      AND b.cancelled_at IS NULL
      AND b.status <> 'cancelled'
  ),
  classified AS (
    SELECT
      bill_id, bill_number, due_date, total_amount, paid_amount, remaining_amount,
      -- Financial data inconsistency: bill marked paid but remaining > 0.
      CASE
        WHEN marked_paid AND remaining_amount > 0 THEN 'financial_data_inconsistency'
        WHEN has_unknown_status AND remaining_amount > 0 THEN 'financial_data_inconsistency'
        WHEN remaining_amount > 0 AND due_date < CURRENT_DATE THEN 'bill_due'
        WHEN remaining_amount > 0 THEN 'bill_due'
        ELSE NULL
      END AS primary_type,
      (remaining_amount > 0 AND due_date < CURRENT_DATE) AS is_overdue,
      (remaining_amount > 0 AND paid_amount > 0 AND remaining_amount < total_amount) AS is_partial,
      (remaining_amount > 0 AND paid_amount = 0) AS is_unpaid,
      (marked_paid AND remaining_amount > 0) AS is_inconsistent,
      (has_unknown_status AND remaining_amount > 0 AND NOT marked_paid) AS is_unknown_status
    FROM bill_calc
  ),
  bill_blockers AS (
    SELECT
      jsonb_build_object(
        'type', primary_type,
        'bill_id', bill_id,
        'bill_number', bill_number,
        'due_date', due_date,
        'total_amount', total_amount,
        'paid_amount', paid_amount,
        'remaining_amount', remaining_amount,
        'payment_state', CASE WHEN paid_amount > 0 AND remaining_amount > 0 THEN 'partial'
                              WHEN remaining_amount = total_amount THEN 'unpaid'
                              ELSE 'other' END,
        'overdue', is_overdue,
        'inconsistent', is_inconsistent,
        'unknown_status', is_unknown_status
      ) AS blocker,
      is_overdue, is_partial, is_unpaid, is_inconsistent, is_unknown_status,
      due_date, bill_number, remaining_amount
    FROM classified
    WHERE primary_type IS NOT NULL
  ),
  pending_pay AS (
    SELECT jsonb_build_object(
      'type', 'pending_offline_payment',
      'payment_id', id,
      'method', method,
      'amount', amount
    ) AS blocker
    FROM public.payments
    WHERE society_id = _society_id
      AND flat_id = _flat_id
      AND status = 'pending'
  )
  SELECT
    COALESCE((SELECT SUM(remaining_amount) FROM bill_blockers), 0)
      + COALESCE((SELECT SUM(amount) FROM public.payments
                  WHERE society_id = _society_id AND flat_id = _flat_id AND status = 'pending'), 0),
    COALESCE((SELECT COUNT(*) FROM bill_blockers WHERE is_overdue), 0),
    COALESCE((SELECT COUNT(*) FROM bill_blockers WHERE is_partial), 0),
    COALESCE((SELECT COUNT(*) FROM bill_blockers WHERE is_unpaid AND NOT is_overdue), 0),
    COALESCE((SELECT COUNT(*) FROM pending_pay), 0),
    COALESCE((SELECT COUNT(*) FROM bill_blockers WHERE is_unknown_status), 0),
    COALESCE((SELECT COUNT(*) FROM bill_blockers WHERE is_inconsistent), 0),
    (
      SELECT COALESCE(jsonb_agg(blocker ORDER BY is_overdue DESC, due_date ASC NULLS LAST, bill_number ASC), '[]'::jsonb)
      FROM bill_blockers
    ) || (SELECT COALESCE(jsonb_agg(blocker), '[]'::jsonb) FROM pending_pay)
  INTO v_total, v_overdue_count, v_partial_count, v_unpaid_count, v_pending_count, v_unknown_count, v_inconsistent_count, v_blockers;

  RETURN jsonb_build_object(
    'eligible', (jsonb_array_length(v_blockers) = 0),
    'total_outstanding', v_total,
    'counts', jsonb_build_object(
      'overdue', v_overdue_count,
      'partial', v_partial_count,
      'unpaid', v_unpaid_count,
      'pending_offline', v_pending_count,
      'unknown_status', v_unknown_count,
      'inconsistent', v_inconsistent_count
    ),
    'blockers', v_blockers,
    'calculated_at', now()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_no_dues_eligibility_internal(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.compute_no_dues_eligibility_internal(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_no_dues_eligibility_internal(uuid, uuid) TO service_role;
