-- Phase 4C: the "members read classes" policy called
-- _authorize_membership_internal(), which signed-in users cannot execute, so
-- every class-list read failed with a permission error (residents and admins).
-- Use the public membership wrapper instead. It applies the same membership
-- rules but only answers for the caller (auth.uid()); society_id comes from
-- the class row, never from the client. No broad grant on the internal helper.
DROP POLICY IF EXISTS "members read classes" ON public.amenity_classes;
CREATE POLICY "members read classes" ON public.amenity_classes FOR SELECT TO authenticated
USING (public._amenity_admin(society_id) OR public.authorize_membership(auth.uid(), society_id));