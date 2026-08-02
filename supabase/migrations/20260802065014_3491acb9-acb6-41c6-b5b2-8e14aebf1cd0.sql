CREATE OR REPLACE FUNCTION public.search_society_open_bills(
  _society_id uuid,
  _query text DEFAULT ''::text,
  _limit integer DEFAULT 20,
  _offset integer DEFAULT 0
)
RETURNS TABLE(
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
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  q text;
  q_escaped text;
  qlike text;
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

  -- ---- strict input bounds: no silent clamping, one canonical token ----
  IF _limit IS NULL OR _limit < 1 OR _limit > 50 THEN
    RAISE EXCEPTION 'invalid_search_input';
  END IF;

  IF _offset IS NULL OR _offset < 0 THEN
    RAISE EXCEPTION 'invalid_search_input';
  END IF;

  q := btrim(COALESCE(_query, ''));

  IF length(q) > 120 THEN
    RAISE EXCEPTION 'invalid_search_input';
  END IF;

  IF q = '' THEN
    qlike := NULL;
  ELSE
    -- Literal substring semantics. Escape the escape character FIRST,
    -- then the two LIKE metacharacters, then wrap with '%'.
    q_escaped := replace(q,         '\', '\\');
    q_escaped := replace(q_escaped, '%', '\%');
    q_escaped := replace(q_escaped, '_', '\_');
    qlike := '%' || q_escaped || '%';
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
      OR f.flat_number  ILIKE qlike ESCAPE '\'
      OR bl.name        ILIKE qlike ESCAPE '\'
      OR b.bill_number  ILIKE qlike ESCAPE '\'
      OR b.period_label ILIKE qlike ESCAPE '\'
    )
  ORDER BY b.due_date NULLS LAST, b.bill_number NULLS LAST, b.id
  LIMIT _limit
  OFFSET _offset;
END;
$function$;

REVOKE ALL ON FUNCTION public.search_society_open_bills(uuid, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_society_open_bills(uuid, text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_society_open_bills(uuid, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_society_open_bills(uuid, text, integer, integer) TO service_role;