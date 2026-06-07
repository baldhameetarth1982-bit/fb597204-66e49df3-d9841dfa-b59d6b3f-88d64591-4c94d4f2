
-- Helper: get the society_id from a user's profile (SECURITY DEFINER bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_user_society_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT society_id FROM public.profiles WHERE id = _user_id LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_user_society_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_society_id(uuid) TO authenticated, service_role;

-- Helper: society_ids the user admins
CREATE OR REPLACE FUNCTION public.get_admin_society_ids(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT society_id FROM public.user_roles
  WHERE user_id = _user_id AND role = 'society_admin'::public.app_role AND society_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.get_admin_society_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_society_ids(uuid) TO authenticated, service_role;

-- Helper: block_ids the user admins
CREATE OR REPLACE FUNCTION public.get_admin_block_ids(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT block_id FROM public.user_roles
  WHERE user_id = _user_id AND role = 'block_admin'::public.app_role AND block_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.get_admin_block_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_block_ids(uuid) TO authenticated, service_role;

-- ============ PROFILES ============
DROP POLICY IF EXISTS "society admins view profiles in their society" ON public.profiles;
CREATE POLICY "society admins view profiles in their society"
ON public.profiles FOR SELECT
USING (society_id IN (SELECT public.get_admin_society_ids(auth.uid())));

DROP POLICY IF EXISTS "block admins view profiles in their block" ON public.profiles;
CREATE POLICY "block admins view profiles in their block"
ON public.profiles FOR SELECT
USING (
  id IN (
    SELECT fr.user_id FROM public.flat_residents fr
    JOIN public.flats f ON f.id = fr.flat_id
    WHERE f.block_id IN (SELECT public.get_admin_block_ids(auth.uid()))
  )
);

-- ============ SOCIETIES ============
DROP POLICY IF EXISTS "residents view their society" ON public.societies;
CREATE POLICY "residents view their society"
ON public.societies FOR SELECT
USING (id = public.get_user_society_id(auth.uid()));

DROP POLICY IF EXISTS "society admins view their society" ON public.societies;
CREATE POLICY "society admins view their society"
ON public.societies FOR SELECT
USING (id IN (SELECT public.get_admin_society_ids(auth.uid())));

DROP POLICY IF EXISTS "society admins update their society" ON public.societies;
CREATE POLICY "society admins update their society"
ON public.societies FOR UPDATE
USING (id IN (SELECT public.get_admin_society_ids(auth.uid())));

-- ============ BLOCKS ============
DROP POLICY IF EXISTS "residents view blocks in their society" ON public.blocks;
CREATE POLICY "residents view blocks in their society"
ON public.blocks FOR SELECT
USING (society_id = public.get_user_society_id(auth.uid()));

DROP POLICY IF EXISTS "society admins manage blocks in their society" ON public.blocks;
CREATE POLICY "society admins manage blocks in their society"
ON public.blocks FOR ALL
USING (society_id IN (SELECT public.get_admin_society_ids(auth.uid())))
WITH CHECK (society_id IN (SELECT public.get_admin_society_ids(auth.uid())));

-- ============ FLATS ============
DROP POLICY IF EXISTS "residents view flats in their society" ON public.flats;
CREATE POLICY "residents view flats in their society"
ON public.flats FOR SELECT
USING (society_id = public.get_user_society_id(auth.uid()));

DROP POLICY IF EXISTS "society admins manage flats in their society" ON public.flats;
CREATE POLICY "society admins manage flats in their society"
ON public.flats FOR ALL
USING (society_id IN (SELECT public.get_admin_society_ids(auth.uid())))
WITH CHECK (society_id IN (SELECT public.get_admin_society_ids(auth.uid())));

DROP POLICY IF EXISTS "block admins view their block flats" ON public.flats;
CREATE POLICY "block admins view their block flats"
ON public.flats FOR SELECT
USING (block_id IN (SELECT public.get_admin_block_ids(auth.uid())));

-- ============ FLAT_RESIDENTS ============
DROP POLICY IF EXISTS "society admins manage flat_residents in their society" ON public.flat_residents;
CREATE POLICY "society admins manage flat_residents in their society"
ON public.flat_residents FOR ALL
USING (flat_id IN (SELECT f.id FROM public.flats f WHERE f.society_id IN (SELECT public.get_admin_society_ids(auth.uid()))))
WITH CHECK (flat_id IN (SELECT f.id FROM public.flats f WHERE f.society_id IN (SELECT public.get_admin_society_ids(auth.uid()))));

DROP POLICY IF EXISTS "block admins view flat_residents in their block" ON public.flat_residents;
CREATE POLICY "block admins view flat_residents in their block"
ON public.flat_residents FOR SELECT
USING (flat_id IN (SELECT f.id FROM public.flats f WHERE f.block_id IN (SELECT public.get_admin_block_ids(auth.uid()))));

-- ============ POSTS / REACTIONS / COMMENTS ============
DROP POLICY IF EXISTS "society members view posts" ON public.posts;
CREATE POLICY "society members view posts"
ON public.posts FOR SELECT
USING (society_id = public.get_user_society_id(auth.uid()));

DROP POLICY IF EXISTS "society members view reactions" ON public.post_reactions;
CREATE POLICY "society members view reactions"
ON public.post_reactions FOR SELECT
USING (post_id IN (SELECT id FROM public.posts WHERE society_id = public.get_user_society_id(auth.uid())));

DROP POLICY IF EXISTS "society members view comments" ON public.post_comments;
CREATE POLICY "society members view comments"
ON public.post_comments FOR SELECT
USING (post_id IN (SELECT id FROM public.posts WHERE society_id = public.get_user_society_id(auth.uid())));

-- ============ POLLS ============
DROP POLICY IF EXISTS "society members view polls" ON public.polls;
CREATE POLICY "society members view polls"
ON public.polls FOR SELECT
USING (society_id = public.get_user_society_id(auth.uid()) OR society_id IN (SELECT public.get_admin_society_ids(auth.uid())));

-- ============ LEDGER / DIGESTS / POINTS / ACHIEVEMENTS ============
DROP POLICY IF EXISTS "society members view ledger" ON public.ledger_entries;
CREATE POLICY "society members view ledger"
ON public.ledger_entries FOR SELECT
USING (society_id = public.get_user_society_id(auth.uid()));

DROP POLICY IF EXISTS "society members view digests" ON public.community_digests;
CREATE POLICY "society members view digests"
ON public.community_digests FOR SELECT
USING (society_id = public.get_user_society_id(auth.uid()));

DROP POLICY IF EXISTS "society members view points" ON public.user_points;
CREATE POLICY "society members view points"
ON public.user_points FOR SELECT
USING (society_id = public.get_user_society_id(auth.uid()));

DROP POLICY IF EXISTS "society members view achievements" ON public.achievements;
CREATE POLICY "society members view achievements"
ON public.achievements FOR SELECT
USING (society_id = public.get_user_society_id(auth.uid()));
