CREATE OR REPLACE FUNCTION public.get_resident_finance_transparency(
  _society_id uuid,
  _from date,
  _to date,
  _limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_visibility text;
  v_is_admin boolean := false;
  v_is_active_resident boolean := false;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF _society_id IS NULL OR _from IS NULL OR _to IS NULL OR _from > _to OR _to - _from > 730 OR _limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid_period' USING ERRCODE = '22023';
  END IF;

  v_is_admin := public.current_user_is_super_admin()
    OR public.current_user_is_society_admin_for(_society_id);

  SELECT EXISTS (
    SELECT 1
    FROM public.flat_residents fr
    JOIN public.flats f
      ON f.id = fr.flat_id
     AND f.society_id = _society_id
    WHERE fr.user_id = v_uid
      AND fr.is_active = true
      AND fr.moved_out_at IS NULL
      AND COALESCE(f.is_active, true)
  ) INTO v_is_active_resident;

  IF NOT v_is_admin AND NOT v_is_active_resident THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  v_visibility := public.resolve_financial_visibility(_society_id);
  IF v_visibility NOT IN ('admin', 'summary', 'detailed') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public._finance_plan_enabled(_society_id) THEN
    RAISE EXCEPTION 'plan_required' USING ERRCODE = '42501';
  END IF;

  WITH scoped_lines AS (
    SELECT
      j.id,
      j.transaction_date,
      j.description,
      j.source_type,
      j.created_at,
      a.account_type,
      a.name AS account_name,
      l.debit,
      l.credit
    FROM public.finance_journal_entries j
    JOIN public.finance_journal_lines l
      ON l.journal_entry_id = j.id AND l.society_id = j.society_id
    JOIN public.finance_accounts a
      ON a.id = l.account_id AND a.society_id = l.society_id
    WHERE j.society_id = _society_id
      AND j.status IN ('posted', 'reversed')
      AND j.transaction_date BETWEEN _from AND _to
  ), totals AS (
    SELECT
      COALESCE(sum(credit - debit) FILTER (WHERE account_type = 'income'), 0) AS income,
      COALESCE(sum(debit - credit) FILTER (WHERE account_type = 'expense'), 0) AS expense
    FROM scoped_lines
  ), categories AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('category', account_name, 'amount', amount) ORDER BY amount DESC, account_name), '[]'::jsonb) AS rows
    FROM (
      SELECT account_name, sum(debit - credit) AS amount
      FROM scoped_lines
      WHERE account_type = 'expense'
      GROUP BY account_name
      HAVING sum(debit - credit) <> 0
    ) c
  ), transactions AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'transaction_date', transaction_date,
      'description', description,
      'source_type', source_type,
      'kind', kind,
      'amount', amount
    ) ORDER BY transaction_date DESC, created_at DESC), '[]'::jsonb) AS rows
    FROM (
      SELECT
        id,
        transaction_date,
        min(description) AS description,
        min(source_type) AS source_type,
        min(created_at) AS created_at,
        CASE
          WHEN COALESCE(sum(credit - debit) FILTER (WHERE account_type = 'income'), 0) <> 0 THEN 'income'
          ELSE 'expense'
        END AS kind,
        COALESCE(
          NULLIF(sum(credit - debit) FILTER (WHERE account_type = 'income'), 0),
          sum(credit - debit) FILTER (WHERE account_type = 'expense')
        ) AS amount
      FROM scoped_lines
      GROUP BY id, transaction_date
      HAVING COALESCE(sum(credit - debit) FILTER (WHERE account_type = 'income'), 0) <> 0
          OR COALESCE(sum(debit - credit) FILTER (WHERE account_type = 'expense'), 0) <> 0
      ORDER BY transaction_date DESC, created_at DESC
      LIMIT _limit
    ) t
  )
  SELECT jsonb_build_object(
    'visibility', v_visibility,
    'from', _from,
    'to', _to,
    'income', totals.income,
    'expense', totals.expense,
    'net_movement', totals.income - totals.expense,
    'categories', categories.rows,
    'transactions', CASE WHEN v_visibility IN ('admin', 'detailed') THEN transactions.rows ELSE '[]'::jsonb END
  )
  INTO v_result
  FROM totals CROSS JOIN categories CROSS JOIN transactions;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_resident_finance_transparency(uuid,date,date,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_resident_finance_transparency(uuid,date,date,integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_resident_finance_transparency(uuid,date,date,integer) IS 'Authorization-first resident finance projection. Society and super administrators are authorized explicitly; every other caller must have an active, non-ended flat relationship in the requested society. Visibility and plan checks occur only after authorization. Income is positive, expense movement is negative, and reversals compensate the original movement.';

CREATE OR REPLACE FUNCTION public._protect_audit_log_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log_immutable' USING ERRCODE = '55000';
END;
$$;

REVOKE ALL ON FUNCTION public._protect_audit_log_history() FROM PUBLIC, anon, authenticated, service_role;

REVOKE UPDATE, DELETE ON TABLE public.audit_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.audit_log TO authenticated;
GRANT SELECT, INSERT ON TABLE public.audit_log TO service_role;

DROP TRIGGER IF EXISTS audit_log_immutable ON public.audit_log;
CREATE TRIGGER audit_log_immutable
BEFORE UPDATE OR DELETE ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION public._protect_audit_log_history();

COMMENT ON FUNCTION public._protect_audit_log_history() IS 'Rejects every audit_log update and deletion, including requests made with service-role privileges. Disposable test cleanup must destroy the isolated database or schema instead of mutating audit history.';
COMMENT ON TRIGGER audit_log_immutable ON public.audit_log IS 'Makes canonical audit history immutable for every application database role, including service_role.';
REVOKE INSERT ON TABLE public.audit_log FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON TABLE public.audit_log FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.audit_log TO authenticated;
GRANT SELECT, INSERT ON TABLE public.audit_log TO service_role;

COMMENT ON TABLE public.audit_log IS 'Append-only canonical audit history. Browser roles cannot insert, update, or delete rows; canonical server-side writers append with service-role privileges, and configured RLS policies govern authenticated reads.';