DROP POLICY IF EXISTS "members read categories" ON public.community_listing_categories;
CREATE POLICY "members read categories" ON public.community_listing_categories FOR SELECT TO authenticated
USING (society_id IS NULL OR society_id = public._active_member_society_id());