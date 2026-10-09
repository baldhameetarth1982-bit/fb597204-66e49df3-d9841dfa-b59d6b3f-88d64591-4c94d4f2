-- Re-assert strict audit immutability for every role (supersedes 0009 on any environment).
CREATE OR REPLACE FUNCTION public._protect_audit_log_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'audit_log_immutable' USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION public._protect_audit_log_history() FROM PUBLIC, anon, authenticated, service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_log FROM PUBLIC, anon, authenticated, service_role;

-- audit_log_actor_id_fkey (ON DELETE SET NULL) made every account deletion attempt an
-- UPDATE of immutable audit rows, which the trigger rightly rejects ("Database error
-- deleting user"). Audit history keeps the historical actor id as a plain uuid instead.
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_actor_id_fkey;
COMMENT ON COLUMN public.audit_log.actor_id IS 'Historical actor user id, preserved verbatim after account deletion; intentionally not a foreign key so audit rows are never mutated.';