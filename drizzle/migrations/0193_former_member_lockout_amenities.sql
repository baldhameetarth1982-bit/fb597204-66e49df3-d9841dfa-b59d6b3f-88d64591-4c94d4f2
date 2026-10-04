SET LOCAL lock_timeout = '5s';
DROP POLICY IF EXISTS "members read active amenities" ON public.amenities;
CREATE POLICY "members read active amenities" ON public.amenities FOR SELECT TO authenticated
USING ((society_id = public._active_member_society_id() AND is_active) OR public._amenity_admin(society_id));
DROP POLICY IF EXISTS "members read amenity blocks" ON public.amenity_blocked_dates;
CREATE POLICY "members read amenity blocks" ON public.amenity_blocked_dates FOR SELECT TO authenticated
USING (society_id = public._active_member_society_id() OR public.current_user_has_society_permission(society_id, 'society.settings'::text, NULL::uuid));