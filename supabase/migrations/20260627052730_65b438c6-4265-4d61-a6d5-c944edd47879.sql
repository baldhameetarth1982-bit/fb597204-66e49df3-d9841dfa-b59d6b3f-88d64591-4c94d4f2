-- Residents must not self-record payments
DROP POLICY IF EXISTS "residents create their own payments" ON public.payments;

-- Block admins: read-only access to bills/payments for flats in their block
DROP POLICY IF EXISTS "block admins view bills in their block" ON public.bills;
CREATE POLICY "block admins view bills in their block"
ON public.bills
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.flats f
    WHERE f.id = bills.flat_id
      AND f.block_id IN (SELECT public.get_admin_block_ids(auth.uid()))
  )
);

DROP POLICY IF EXISTS "block admins view payments in their block" ON public.payments;
CREATE POLICY "block admins view payments in their block"
ON public.payments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.flats f
    WHERE f.id = payments.flat_id
      AND f.block_id IN (SELECT public.get_admin_block_ids(auth.uid()))
  )
);

-- Ensure RLS stays enabled
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Helpful index for status filtering on payments
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status);

-- get_admin_block_ids is needed by RLS for authenticated users
GRANT EXECUTE ON FUNCTION public.get_admin_block_ids(uuid) TO authenticated;