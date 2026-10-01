DROP POLICY IF EXISTS "Line items visible with bill access" ON public.bill_line_items;
CREATE POLICY "Line items visible with bill access" ON public.bill_line_items
FOR SELECT TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR public.is_society_admin_for(auth.uid(), society_id)
  OR EXISTS (SELECT 1 FROM public.bills b WHERE b.id = bill_line_items.bill_id)
);

DROP POLICY IF EXISTS receipts_resident_read ON public.payment_receipts;
CREATE POLICY receipts_resident_read ON public.payment_receipts
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.payments p WHERE p.id = payment_receipts.payment_id));