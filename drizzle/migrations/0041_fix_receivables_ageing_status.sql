CREATE OR REPLACE FUNCTION public.get_receivables_ageing(_society_id uuid, _as_of date DEFAULT CURRENT_DATE)
 RETURNS TABLE(bucket text, amount numeric, bill_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_visibility text;
BEGIN
  v_visibility := public.resolve_financial_visibility(_society_id);
  IF v_visibility <> 'admin' OR NOT public._finance_plan_enabled(_society_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF _as_of IS NULL OR _as_of > CURRENT_DATE THEN
    RAISE EXCEPTION 'invalid_date' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH balances AS (
    SELECT
      b.id,
      b.due_date,
      GREATEST(
        0,
        COALESCE(b.total_payable, b.amount, 0)
          - COALESCE(sum(p.amount) FILTER (
              WHERE p.status = 'verified'
                AND p.verified_at::date <= _as_of
            ), 0)
      ) AS outstanding
    FROM public.bills b
    LEFT JOIN public.payments p
      ON p.bill_id = b.id
     AND p.society_id = b.society_id
    WHERE b.society_id = _society_id
      AND b.cancelled_at IS NULL
      AND b.status NOT IN ('cancelled', 'draft')
      AND COALESCE(b.finalized_at::date, b.created_at::date) <= _as_of
    GROUP BY b.id, b.due_date, b.total_payable, b.amount
  ), bucketed AS (
    SELECT
      CASE
        WHEN due_date >= _as_of THEN 'current'
        WHEN _as_of - due_date <= 30 THEN '1_30'
        WHEN _as_of - due_date <= 60 THEN '31_60'
        WHEN _as_of - due_date <= 90 THEN '61_90'
        ELSE '90_plus'
      END AS bucket,
      outstanding
    FROM balances
    WHERE outstanding > 0
  )
  SELECT b.bucket, sum(b.outstanding), count(*)
  FROM bucketed b
  GROUP BY b.bucket;
END;
$function$;