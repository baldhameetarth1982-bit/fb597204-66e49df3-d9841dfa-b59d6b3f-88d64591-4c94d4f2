CREATE OR REPLACE FUNCTION public.explorer_flat_dues_summary(_society_id uuid)
RETURNS TABLE(flat_id uuid, outstanding numeric, status_rank int)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH paid AS (
    SELECT p.bill_id, sum(p.amount) AS paid
    FROM payments p
    JOIN bills b ON b.id = p.bill_id AND b.society_id = _society_id
    WHERE p.status = 'success'
    GROUP BY p.bill_id
  )
  SELECT b.flat_id,
         sum(greatest(0, b.amount - coalesce(pd.paid, 0))) AS outstanding,
         max(CASE
               WHEN b.amount <= coalesce(pd.paid, 0) + 0.001 THEN 0
               WHEN (b.due_date::timestamp AT TIME ZONE 'UTC') < now() THEN 2
               ELSE 1
             END)::int AS status_rank
  FROM bills b
  LEFT JOIN paid pd ON pd.bill_id = b.id
  WHERE b.society_id = _society_id
    AND b.status IS DISTINCT FROM 'cancelled'
  GROUP BY b.flat_id;
$$;