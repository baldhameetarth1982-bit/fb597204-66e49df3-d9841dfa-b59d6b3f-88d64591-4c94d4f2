
-- Part 1: Privileged No-Dues RPC hardening.
-- Revoke direct client execution on internal transition/certificate RPCs and
-- lock down no_dues_cert_counters. Server functions must call these only via
-- supabaseAdmin (service_role) after requireSupabaseAuth + role/membership checks.

-- 1. Revoke EXECUTE from client-facing roles on privileged RPCs.
REVOKE EXECUTE ON FUNCTION public.next_no_dues_cert_number(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finalize_no_dues_issuance(uuid, text, text, text, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_no_dues_certificate(uuid, text) FROM PUBLIC, anon, authenticated;

-- Grant only to service_role explicitly (idempotent).
GRANT EXECUTE ON FUNCTION public.next_no_dues_cert_number(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_no_dues_issuance(uuid, text, text, text, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_no_dues_certificate(uuid, text) TO service_role;

-- 2. Lock down cert counters — implementation detail, no client visibility.
REVOKE ALL ON TABLE public.no_dues_cert_counters FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.no_dues_cert_counters TO service_role;

-- Drop any authenticated read policy that may exist (idempotent).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT polname FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'no_dues_cert_counters'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.no_dues_cert_counters', r.polname);
  END LOOP;
END $$;

-- Ensure RLS remains enabled (no policies => no client access, service_role bypasses).
ALTER TABLE public.no_dues_cert_counters ENABLE ROW LEVEL SECURITY;

-- 3. Also tighten no_dues_audit — clients must never insert/update/delete audit rows.
-- SELECT policies remain as-is (society admin/resident visibility). Write access
-- is service_role only, enforced by the absence of INSERT/UPDATE/DELETE policies
-- for authenticated. Belt-and-braces: revoke direct table write privileges.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.no_dues_audit FROM anon, authenticated;

-- 4. Prevent clients from directly flipping protected no_dues_requests statuses.
-- We keep the resident INSERT policy (submit) and admin visibility, but revoke
-- direct UPDATE from authenticated. State transitions must go through
-- service-role-only transactional RPCs (added in the next migration).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT polname, polcmd FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'no_dues_requests' AND polcmd = 'w'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.no_dues_requests', r.polname);
  END LOOP;
END $$;

REVOKE UPDATE, DELETE ON TABLE public.no_dues_requests FROM anon, authenticated;

-- Similarly for certificates — issuance/revocation only through service_role.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.no_dues_certificates FROM anon, authenticated;
