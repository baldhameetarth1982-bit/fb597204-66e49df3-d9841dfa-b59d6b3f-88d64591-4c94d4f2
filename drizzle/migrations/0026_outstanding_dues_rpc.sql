CREATE OR REPLACE FUNCTION public.get_outstanding_dues(_society_id uuid)
RETURNS TABLE (
  bill_id uuid,
  flat_id uuid,
  flat_label text,
  period_label text,
  due_date date,
  total_payable numeric,
  verified_paid numeric,
  outstanding numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Authorization is derived from the caller, never from input: _society_id
  -- only narrows results. A bill is included only if the caller may manage
  -- billing for that society/block, is a block admin of the bill's block, or
  -- is a super admin. Verified payments are summed server-side over the
  -- COMPLETE payment set for each authorized bill, so the amount is never
  -- computed from a partial, RLS-narrowed payment list. Reversed, rejected
  -- and pending payments do not reduce dues. Individual payments are not
  -- returned.
  SELECT
    b.id,
    b.flat_id,
    COALESCE(bl.name || '-', '') || f.flat_number,
    b.period_label,
    b.due_date::date,
    COALESCE(b.total_payable, b.amount, 0)::numeric,
    COALESCE(p.paid, 0)::numeric,
    (COALESCE(b.total_payable, b.amount, 0) - COALESCE(p.paid, 0))::numeric
  FROM bills b
  JOIN flats f ON f.id = b.flat_id
  LEFT JOIN blocks bl ON bl.id = f.block_id
  LEFT JOIN LATERAL (
    SELECT SUM(pm.amount) AS paid
    FROM payments pm
    WHERE pm.bill_id = b.id AND pm.status = 'verified'
  ) p ON true
  WHERE auth.uid() IS NOT NULL
    AND b.society_id = _society_id
    AND b.cancelled_at IS NULL
    AND b.status IN ('unpaid', 'partially_paid', 'overdue')
    AND (
      public.current_user_has_society_permission(b.society_id, 'billing.manage', f.block_id)
      OR f.block_id IN (SELECT public.get_admin_block_ids(auth.uid()))
      OR public.has_role(auth.uid(), 'super_admin'::app_role)
    )
    AND (COALESCE(b.total_payable, b.amount, 0) - COALESCE(p.paid, 0)) > 0
  ORDER BY b.due_date ASC NULLS LAST
  LIMIT 5000;
$$;

REVOKE ALL ON FUNCTION public.get_outstanding_dues(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_outstanding_dues(uuid) TO authenticated;