CREATE OR REPLACE FUNCTION public.compute_no_dues_eligibility_internal(_society_id uuid, _flat_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_flat_ok boolean;
  v_blockers jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_pending_total numeric := 0;
  v_overdue_count int := 0;
  v_partial_count int := 0;
  v_unpaid_count int := 0;
  v_pending_count int := 0;
  v_unknown_count int := 0;
  v_inconsistent_count int := 0;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.flats f WHERE f.id = _flat_id AND f.society_id = _society_id
  ) INTO v_flat_ok;
  IF NOT v_flat_ok THEN
    RAISE EXCEPTION 'INVALID_FLAT_FOR_SOCIETY';
  END IF;

  WITH settled AS (
    SELECT
      p.bill_id,
      SUM(CASE WHEN p.status IN ('success','verified') THEN p.amount ELSE 0 END)::numeric AS paid,
      BOOL_OR(p.status NOT IN ('success','verified','pending','failed','rejected','cancelled','refunded','reversed'))
        AS has_unknown_status
    FROM public.payments p
    WHERE p.society_id = _society_id AND p.flat_id = _flat_id
    GROUP BY p.bill_id
  ),
  bill_calc AS (
    SELECT
      b.id AS bill_id, b.bill_number, b.due_date,
      COALESCE(b.total_payable, b.amount) AS total_amount,
      COALESCE(s.paid, 0) AS paid_amount,
      GREATEST(0, COALESCE(b.total_payable, b.amount) - COALESCE(s.paid, 0))::numeric AS remaining_amount,
      (b.status = 'paid') AS marked_paid,
      COALESCE(s.has_unknown_status, false) AS has_unknown_status
    FROM public.bills b
    LEFT JOIN settled s ON s.bill_id = b.id
    WHERE b.society_id = _society_id AND b.flat_id = _flat_id
      AND b.cancelled_at IS NULL AND b.status <> 'cancelled'
  ),
  classified AS (
    SELECT bill_id, bill_number, due_date, total_amount, paid_amount, remaining_amount,
      CASE
        WHEN marked_paid AND remaining_amount > 0 THEN 'financial_data_inconsistency'
        WHEN has_unknown_status AND remaining_amount > 0 THEN 'financial_data_inconsistency'
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
    SELECT jsonb_build_object(
      'type', primary_type, 'bill_id', bill_id, 'bill_number', bill_number,
      'due_date', due_date, 'total_amount', total_amount, 'paid_amount', paid_amount,
      'remaining_amount', remaining_amount,
      'payment_state', CASE WHEN paid_amount > 0 AND remaining_amount > 0 THEN 'partial'
                             WHEN remaining_amount = total_amount THEN 'unpaid'
                             ELSE 'other' END,
      'overdue', is_overdue, 'inconsistent', is_inconsistent, 'unknown_status', is_unknown_status
    ) AS blocker,
    is_overdue, is_partial, is_unpaid, is_inconsistent, is_unknown_status, remaining_amount
    FROM classified WHERE primary_type IS NOT NULL
  ),
  pending_pay AS (
    SELECT id, method, amount, created_at,
      jsonb_build_object(
        'type', 'pending_offline_payment',
        'payment_id', id, 'method', method, 'amount', amount, 'created_at', created_at
      ) AS blocker
    FROM public.payments
    WHERE society_id = _society_id AND flat_id = _flat_id AND status = 'pending'
  )
  SELECT
    COALESCE((SELECT SUM(remaining_amount) FROM bill_blockers), 0),
    COALESCE((SELECT SUM(amount) FROM pending_pay), 0),
    COALESCE((SELECT COUNT(*) FROM bill_blockers WHERE is_overdue), 0),
    COALESCE((SELECT COUNT(*) FROM bill_blockers WHERE is_partial), 0),
    COALESCE((SELECT COUNT(*) FROM bill_blockers WHERE is_unpaid AND NOT is_overdue), 0),
    COALESCE((SELECT COUNT(*) FROM pending_pay), 0),
    COALESCE((SELECT COUNT(*) FROM bill_blockers WHERE is_unknown_status), 0),
    COALESCE((SELECT COUNT(*) FROM bill_blockers WHERE is_inconsistent), 0),
    COALESCE(
      (SELECT jsonb_agg(blocker) FROM bill_blockers)
      || COALESCE((SELECT jsonb_agg(blocker) FROM pending_pay), '[]'::jsonb),
      '[]'::jsonb
    )
  INTO v_total, v_pending_total, v_overdue_count, v_partial_count, v_unpaid_count,
       v_pending_count, v_unknown_count, v_inconsistent_count, v_blockers;

  RETURN jsonb_build_object(
    'eligible', (v_total = 0 AND v_pending_count = 0 AND v_unknown_count = 0 AND v_inconsistent_count = 0),
    'total_outstanding', v_total,
    'pending_payment_total', v_pending_total,
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
$function$;

CREATE OR REPLACE FUNCTION public.mark_maintenance_paid_on_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IN ('success','verified') AND NEW.bill_id IS NOT NULL THEN
    UPDATE public.maintenance_periods mp
       SET status = 'paid', paid_at = COALESCE(NEW.paid_at, now()), updated_at = now()
     WHERE mp.bill_id = NEW.bill_id;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.award_payment_points()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE bill_due date;
BEGIN
  IF NEW.user_id IS NULL OR NEW.bill_id IS NULL OR NEW.status NOT IN ('success','verified')
     OR NEW.verified_at IS NULL OR NEW.paid_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.verified_at IS NOT NULL AND OLD.status IN ('success','verified') THEN
    RETURN NEW;
  END IF;
  IF NOT public._finance_plan_enabled(NEW.society_id) THEN RETURN NEW; END IF;
  SELECT due_date INTO bill_due FROM public.bills WHERE id = NEW.bill_id AND society_id = NEW.society_id;
  IF bill_due IS NULL OR NEW.paid_at::date > bill_due THEN RETURN NEW; END IF;
  INSERT INTO public.user_points (user_id, society_id, points, reason, source_ref)
  VALUES (NEW.user_id, NEW.society_id, 2, 'on_time_payment', NEW.id::text)
  ON CONFLICT (society_id, user_id, reason, source_ref) WHERE source_ref IS NOT NULL DO NOTHING;
  INSERT INTO public.achievements (user_id, society_id, code, title, description)
  VALUES (NEW.user_id, NEW.society_id, 'on_time_payer', 'On-Time Payer', 'Verified maintenance payment on or before the due date')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $function$;