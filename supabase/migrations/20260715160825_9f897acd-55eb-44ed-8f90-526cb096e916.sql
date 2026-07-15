
-- Trigger helper: should never be called directly by clients.
REVOKE EXECUTE ON FUNCTION public.enforce_unit_override_flat_society() FROM PUBLIC, anon, authenticated;

-- Society creation must require an authenticated user.
REVOKE EXECUTE ON FUNCTION public.create_society_full(text, text, text, text, text, text, text, integer, text) FROM PUBLIC, anon;
