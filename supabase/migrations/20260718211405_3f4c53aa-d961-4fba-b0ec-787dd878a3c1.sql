
-- Stage 3C v6 — corrective: search_society_open_bills + get_payment_detail

-- 1) Rewrite search_society_open_bills with canonical schema + summary + offset.
DROP FUNCTION IF EXISTS public.search_society_open_bills(uuid, text, integer);
DROP FUNCTION IF EXISTS public.search_society_open_bills(uuid, text, integer, integer);

CREATE OR REPLACE FUNCTION public.search_society_open_bills(
  _society_id uuid,
  _query text,
  _limit integer DEFAULT 20,
  _offset integer DEFAULT 0
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
  v_off int := greatest(coalesce(_offset, 0), 0);
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  v_allowed :=
    public.current_user_has_society_permission(_society_id, 'billing.manage'::text, NULL::uuid)
    OR public.has_role(v_uid, 'super_admin'::app_role);
  IF NOT coalesce(v_allowed, false) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(row_data ORDER BY sort_key DESC, bill_id_txt), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      b.id::text AS bill_id_txt,
      coalesce(b.due_date::text, b.created_at::text) AS sort_key,
      jsonb_build_object(
        'bill_id', b.id,
        'bill_number', b.bill_number,
        'society_id', b.society_id,
        'flat_id', b.flat_id,
        'flat_label', f.flat_number,
        'block_name', bl.name,
        'period_label', b.period_label,
        'due_date', b.due_date,
        'status', b.status,
        'total_payable', total,
        'verified_amount', verified_sum,
        'pending_amount', pending_sum,
        'remaining_verified_balance', GREATEST(total - verified_sum, 0),
        'available_to_submit', GREATEST(total - verified_sum - pending_sum, 0)
      ) AS row_data
    FROM public.bills b
    JOIN public.flats f ON f.id = b.flat_id AND f.is_active = true
    LEFT JOIN public.blocks bl ON bl.id = f.block_id
    CROSS JOIN LATERAL (
      SELECT
        COALESCE(b.total_payable, b.amount, 0)::numeric AS total,
        COALESCE(SUM(CASE WHEN p.status='verified' THEN p.amount ELSE 0 END),0)::numeric AS verified_sum,
        COALESCE(SUM(CASE WHEN p.status='pending'  THEN p.amount ELSE 0 END),0)::numeric AS pending_sum
      FROM public.payments p
      WHERE p.bill_id = b.id
    ) agg
    WHERE b.society_id = _society_id
      AND b.cancelled_at IS NULL
      AND b.status IN ('unpaid','pending','partial','overdue','finalized')
      AND (total - verified_sum - pending_sum) > 0
      AND (
        v_q = ''
        OR b.bill_number ILIKE '%' || v_q || '%'
        OR f.flat_number ILIKE '%' || v_q || '%'
        OR (bl.name IS NOT NULL AND (bl.name || '-' || f.flat_number) ILIKE '%' || v_q || '%')
      )
    ORDER BY sort_key DESC, bill_id_txt
    LIMIT v_lim OFFSET v_off
  ) t;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.search_society_open_bills(uuid,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_society_open_bills(uuid,text,integer,integer) TO authenticated;

-- 2) get_payment_detail — remove blanket EXCEPTION WHEN OTHERS suppression.
CREATE OR REPLACE FUNCTION public.get_payment_detail(_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  p record;
  is_resident boolean;
  is_admin boolean;
  bill_number text;
  flat_label text;
  receipt_json jsonb;
  summary_json jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  SELECT id, bill_id, society_id, flat_id, amount, method, status, reference_no,
         notes, submitted_at, submitted_by, source, payment_date,
         verified_at, verified_by, verification_notes,
         rejected_at, rejected_by, rejection_reason,
         reversed_at, reversed_by, reversal_reason, created_at
    INTO p FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_not_found' USING ERRCODE = '02000'; END IF;

  is_admin := public.current_user_has_society_permission(p.society_id, 'billing.manage'::text, NULL::uuid)
              OR public.has_role(uid, 'super_admin'::app_role);
  SELECT EXISTS(
    SELECT 1 FROM public.flat_residents
      WHERE flat_id = p.flat_id
        AND user_id = uid
        AND is_active = true
        AND moved_out_at IS NULL
  ) INTO is_resident;
  IF NOT (is_admin OR is_resident) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT b.bill_number INTO bill_number FROM public.bills b WHERE b.id = p.bill_id;
  SELECT COALESCE(bl.name || '-','') || f.flat_number
    INTO flat_label
    FROM public.flats f LEFT JOIN public.blocks bl ON bl.id = f.block_id
    WHERE f.id = p.flat_id;

  -- Receipt: only expected null case is "no receipt yet"; other errors must surface.
  SELECT jsonb_build_object(
    'id', r.id,
    'payment_id', r.payment_id,
    'society_id', r.society_id,
    'receipt_number', r.receipt_number,
    'issued_at', r.issued_at,
    'status', r.status,
    'voided_at', r.voided_at,
    'voided_by', r.voided_by::text,
    'void_reason', r.void_reason,
    'amount_snapshot', r.amount_snapshot,
    'method_snapshot', r.method_snapshot,
    'reference_snapshot', r.reference_snapshot,
    'bill_number_snapshot', r.bill_number_snapshot,
    'verified_by', r.verified_by::text,
    'verified_at', r.verified_at
  )
  INTO receipt_json
  FROM public.payment_receipts r
  WHERE r.payment_id = p.id
  LIMIT 1;

  -- Summary: only expected null case is "payment has no bill".
  IF p.bill_id IS NOT NULL THEN
    summary_json := public.get_bill_payment_summary(p.bill_id);
  ELSE
    summary_json := NULL;
  END IF;

  RETURN jsonb_build_object(
    'payment', jsonb_build_object(
      'id', p.id,
      'bill_id', p.bill_id,
      'society_id', p.society_id,
      'flat_id', p.flat_id,
      'amount', p.amount,
      'method', p.method,
      'status', p.status,
      'reference_no', p.reference_no,
      'notes', CASE WHEN is_admin THEN p.notes ELSE NULL END,
      'submitted_at', p.submitted_at,
      'submitted_by', CASE WHEN is_admin THEN p.submitted_by::text ELSE NULL END,
      'source', p.source,
      'payment_date', p.payment_date,
      'verified_at', p.verified_at,
      'verified_by', CASE WHEN is_admin THEN p.verified_by::text ELSE NULL END,
      'verification_notes', CASE WHEN is_admin THEN p.verification_notes ELSE NULL END,
      'rejected_at', p.rejected_at,
      'rejection_reason', p.rejection_reason,
      'reversed_at', p.reversed_at,
      'reversal_reason', p.reversal_reason,
      'created_at', p.created_at
    ),
    'bill_number', bill_number,
    'flat_label', flat_label,
    'summary', summary_json,
    'receipt', receipt_json,
    'audience', CASE WHEN is_admin THEN 'admin' ELSE 'resident' END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_payment_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_payment_detail(uuid) TO authenticated;
