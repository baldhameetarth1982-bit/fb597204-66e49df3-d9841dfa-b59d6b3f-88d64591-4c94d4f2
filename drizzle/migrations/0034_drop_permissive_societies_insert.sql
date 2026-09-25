-- Security scan fix: drop the permissive direct-insert policy on public.societies.
-- Society creation goes through SECURITY DEFINER RPCs (create_society_full,
-- create_society_for_current_user, commit_society_wizard), which bypass RLS,
-- so no client needs direct INSERT. Removing it stops any signed-in user from
-- inserting arbitrary society rows.
DROP POLICY IF EXISTS "any authenticated user can create a society" ON public.societies;