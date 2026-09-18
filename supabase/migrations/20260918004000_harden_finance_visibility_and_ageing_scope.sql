CREATE OR REPLACE FUNCTION public.resolve_financial_visibility(_society_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.app_role;
  v_setting text;
BEGIN
  IF v_uid IS NULL OR _society_id IS NULL THEN RETURN 'none'; END IF;
  IF public.current_user_is_super_admin() OR public.current_user_is_society_admin_for(_society_id) THEN
    RETURN 'admin';
  END IF;

  SELECT ur.role INTO v_role
  FROM public.user_roles ur
  WHERE ur.user_id = v_uid
    AND ur.society_id = _society_id
    AND COALESCE(ur.is_active, true)
  ORDER BY CASE ur.role
    WHEN 'society_admin' THEN 1
    WHEN 'block_admin' THEN 2
    WHEN 'security' THEN 3
    WHEN 'resident' THEN 4
    ELSE 5
  END
  LIMIT 1;

  IF v_role IS NULL OR v_role IN ('security', 'block_admin') THEN RETURN 'none'; END IF;
  IF v_role = 'resident' AND NOT EXISTS (
    SELECT 1
    FROM public.flat_residents fr
    JOIN public.flats f ON f.id = fr.flat_id
    WHERE fr.user_id = v_uid
      AND fr.is_active = true
      AND f.society_id = _society_id
  ) THEN
    RETURN 'none';
  END IF;

  SELECT COALESCE(privacy_finances, 'admins_only')
  INTO v_setting
  FROM public.society_settings
  WHERE society_id = _society_id;

  IF v_setting = 'resident_summary' THEN RETURN 'summary'; END IF;
  IF v_setting = 'resident_detailed' THEN RETURN 'detailed'; END IF;
  RETURN 'none';
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_financial_visibility(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_financial_visibility(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.resolve_financial_visibility(uuid) IS 'Resolves society-scoped finance visibility. Resident visibility additionally requires an active flat occupancy in the same society.';

CREATE OR REPLACE FUNCTION public.get_receivables_ageing(_society_id uuid, _as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE(bucket text, amount numeric, bill_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
      AND b.status = 'finalized'
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
$$;
REVOKE ALL ON FUNCTION public.get_receivables_ageing(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_receivables_ageing(uuid,date) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_receivables_ageing(uuid,date) IS 'Server-authoritative society-scoped receivables ageing. Includes only bills finalized by the as-of date and society-matched verified payments through that date.';