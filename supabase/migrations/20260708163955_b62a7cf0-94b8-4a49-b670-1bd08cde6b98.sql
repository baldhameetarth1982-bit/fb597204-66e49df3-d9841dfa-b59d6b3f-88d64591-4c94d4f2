-- Restore anon EXECUTE on functions needed by public/pre-auth code paths.
-- get_public_pricing_settings + get_applicable_plans power the public /pricing page.
-- get_user_society_id is invoked by RLS policies across many tables; anon reads
-- against those tables (e.g. auth pages, landing) must be able to evaluate the policy
-- (it will just return NULL for anon) rather than error with "permission denied".

GRANT EXECUTE ON FUNCTION public.get_public_pricing_settings() TO anon;
GRANT EXECUTE ON FUNCTION public.get_applicable_plans(integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_user_society_id(uuid) TO anon;