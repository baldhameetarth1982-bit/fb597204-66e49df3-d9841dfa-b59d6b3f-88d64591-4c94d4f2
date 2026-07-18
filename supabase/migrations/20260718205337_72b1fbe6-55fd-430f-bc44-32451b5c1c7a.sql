
-- Stage 3C v5 — Admin bill search for offline payment entry.
-- Returns bills that are not fully paid / cancelled, scoped to societies the
-- caller is authorized to manage billing in.

CREATE OR REPLACE FUNCTION public.search_society_open_bills(
  _society_id uuid,
  _query text,
  _limit int DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed boolean;
  v_q text := coalesce(nullif(trim(_query), ''), '');
  v_lim int := least(greatest(coalesce(_limit, 20), 1), 50);
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT public.current_user_has_society_permission(_society_id, 'manage_billing')
    INTO v_allowed;
  IF NOT coalesce(v_allowed, false) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT coalesce(jsonb_agg(row_data ORDER BY sort_key), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      jsonb_build_object(
        'bill_id', b.id,
        'bill_number', b.bill_number,
        'flat_id', b.flat_id,
        'flat_label', f.unit_number,
        'block_name', bl.name,
        'total_payable', b.total_amount,
        'status', b.status,
        'due_date', b.due_date,
        'period_label', b.period_label
      ) AS row_data,
      coalesce(b.due_date::text, b.created_at::text) AS sort_key
    FROM public.bills b
    LEFT JOIN public.flats f ON f.id = b.flat_id
    LEFT JOIN public.blocks bl ON bl.id = f.block_id
    WHERE b.society_id = _society_id
      AND b.status IN ('pending', 'partial', 'overdue', 'finalized', 'unpaid')
      AND (
        v_q = ''
        OR b.bill_number ILIKE '%' || v_q || '%'
        OR f.unit_number ILIKE '%' || v_q || '%'
      )
    ORDER BY coalesce(b.due_date::text, b.created_at::text) DESC
    LIMIT v_lim
  ) t;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.search_society_open_bills(uuid, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_society_open_bills(uuid, text, int) TO authenticated;
