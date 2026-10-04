SET LOCAL lock_timeout = '10s';
DROP POLICY IF EXISTS "residents view their society billing schedule" ON public.billing_schedules;
CREATE POLICY "residents view their society billing schedule" ON public.billing_schedules FOR SELECT TO authenticated
USING (society_id = public._active_member_society_id());