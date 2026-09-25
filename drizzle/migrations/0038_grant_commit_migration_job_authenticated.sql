-- The committee's own session calls this; it checks auth.uid() + migration admin scope internally.
GRANT EXECUTE ON FUNCTION public.commit_migration_job(uuid, text, text) TO authenticated;