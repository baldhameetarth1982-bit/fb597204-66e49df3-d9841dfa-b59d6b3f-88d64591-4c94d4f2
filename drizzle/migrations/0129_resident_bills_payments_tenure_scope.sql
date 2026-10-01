-- Former residents may keep seeing their own-era history, but never bills/payments
-- created after they left (e.g. the next tenant's dues).
DROP POLICY IF EXISTS "residents view bills for their flats" ON public.bills;
CREATE POLICY "residents view bills for their flats" ON public.bills
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.flat_residents fr
  WHERE fr.flat_id = bills.flat_id AND fr.user_id = auth.uid()
    AND (
      (fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL)
      OR (fr.moved_out_at IS NOT NULL AND bills.created_at < (fr.moved_out_at::timestamptz + interval '1 day'))
    )
));

DROP POLICY IF EXISTS "residents view payments for their flats" ON public.payments;
CREATE POLICY "residents view payments for their flats" ON public.payments
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.flat_residents fr
  WHERE fr.flat_id = payments.flat_id AND fr.user_id = auth.uid()
    AND (
      (fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL)
      OR (fr.moved_out_at IS NOT NULL AND payments.created_at < (fr.moved_out_at::timestamptz + interval '1 day'))
    )
));