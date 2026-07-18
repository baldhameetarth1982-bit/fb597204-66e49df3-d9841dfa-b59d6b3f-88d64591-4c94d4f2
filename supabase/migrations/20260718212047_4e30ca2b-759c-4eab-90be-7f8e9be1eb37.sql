
-- Stage 3C v6 — corrective RPC rewrites (canonical schema + canonical balances).

DROP FUNCTION IF EXISTS public.search_society_open_bills(uuid, text, int);
DROP FUNCTION IF EXISTS public.search_society_open_bills(uuid, text, int, int);

CREATE OR REPLACE FUNCTION public.search_society_open_bills(
  _society_id uuid,
  _query text DEFAULT '',
  _limit int DEFAULT 20,
  _offset int DEFAULT 0
)
RETURNS TABLE (
  bill_id uuid,
  bill_number text,
  society_id uuid,
  flat_id uuid,
  flat_label text,
  block_name text,
  period_label text,
  due_date date,
  status text,
  total_payable numeric,
  verified_amount numeric,
  pending_amount numeric,
  remaining_verified_balance numeric,
  available_to_submit numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  q text := COALESCE(NULLIF(btrim(_query), ''), NULL);
  qlike text := CASE WHEN q IS NULL THEN NULL ELSE '%' || q || '%' END;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT (
    public.has_role(uid, 'super_admin'::app_role)
    OR public.current_user_has_society_permission(_society_id, 'billing.manage')
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  WITH pay AS (
    SELECT
      p.bill_id,
      COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'verified'), 0)::numeric AS verified_amount,
      COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'pending'),  0)::numeric AS pending_amount
    FROM public.payments p
    WHERE p.society_id = _society_id
    GROUP BY p.bill_id
  )
  SELECT
    b.id                                            AS bill_id,
    b.bill_number                                   AS bill_number,
    b.society_id                                    AS society_id,
    b.flat_id                                       AS flat_id,
    f.flat_number                                   AS flat_label,
    bl.name                                         AS block_name,
    b.period_label                                  AS period_label,
    b.due_date                                      AS due_date,
    b.status                                        AS status,
    COALESCE(b.total_payable, 0)::numeric           AS total_payable,
    COALESCE(pay.verified_amount, 0)                AS verified_amount,
    COALESCE(pay.pending_amount,  0)                AS pending_amount,
    GREATEST(COALESCE(b.total_payable,0) - COALESCE(pay.verified_amount,0), 0)::numeric
                                                    AS remaining_verified_balance,
    GREATEST(
      COALESCE(b.total_payable,0)
        - COALESCE(pay.verified_amount,0)
        - COALESCE(pay.pending_amount,0),
      0
    )::numeric                                      AS available_to_submit
  FROM public.bills b
  LEFT JOIN public.flats  f  ON f.id = b.flat_id
  LEFT JOIN public.blocks bl ON bl.id = f.block_id
  LEFT JOIN pay ON pay.bill_id = b.id
  WHERE b.society_id = _society_id
    AND b.status NOT IN ('paid','cancelled')
    AND b.cancelled_at IS NULL
    AND GREATEST(
          COALESCE(b.total_payable,0)
            - COALESCE(pay.verified_amount,0)
            - COALESCE(pay.pending_amount,0),
          0
        ) > 0
    AND (
      qlike IS NULL
      OR f.flat_number ILIKE qlike
      OR bl.name ILIKE qlike
      OR b.bill_number ILIKE qlike
      OR b.period_label ILIKE qlike
    )
  ORDER BY b.due_date NULLS LAST, b.bill_number NULLS LAST
  LIMIT GREATEST(_limit, 1)
  OFFSET GREATEST(_offset, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.search_society_open_bills(uuid, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_society_open_bills(uuid, text, int, int) TO authenticated;

-- Rewrite get_payment_detail without the EXCEPTION WHEN OTHERS catch-all.
CREATE OR REPLACE FUNCTION public.get_payment_detail(_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO p FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  is_admin :=
    public.has_role(uid, 'super_admin'::app_role)
    OR public.current_user_has_society_permission(p.society_id, 'billing.manage');

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
      RAISE EXCEPTION 'not_authorized';
    END IF;
  END IF;

  SELECT b.bill_number, f.flat_number
    INTO bill_num, flat_lbl
    FROM public.bills b
    LEFT JOIN public.flats f ON f.id = b.flat_id
    WHERE b.id = p.bill_id;

  summary := public.get_bill_payment_summary(p.bill_id);
  receipt := public.get_payment_receipt_lifecycle(p.id);

  RETURN jsonb_build_object(
    'payment', to_jsonb(p),
    'bill_number', bill_num,
    'flat_label', flat_lbl,
    'summary', summary,
    'receipt', receipt,
    'audience', CASE WHEN is_admin THEN 'admin' ELSE 'resident' END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_payment_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_payment_detail(uuid) TO authenticated;
