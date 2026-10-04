SET LOCAL lock_timeout = '55s';
DROP POLICY IF EXISTS "residents view flats in their society" ON public.flats;
CREATE POLICY "residents view flats in their society" ON public.flats FOR SELECT TO authenticated
USING (society_id = public._active_member_society_id());