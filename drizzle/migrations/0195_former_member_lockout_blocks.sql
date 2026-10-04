SET LOCAL lock_timeout = '20s';
DROP POLICY IF EXISTS "residents view blocks in their society" ON public.blocks;
CREATE POLICY "residents view blocks in their society" ON public.blocks FOR SELECT TO authenticated
USING (society_id = public._active_member_society_id());