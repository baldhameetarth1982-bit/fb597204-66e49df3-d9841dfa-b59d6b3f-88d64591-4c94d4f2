
CREATE OR REPLACE FUNCTION public.migration_set_storage_path(_job_id UUID, _storage_path TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _job RECORD; _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN FALSE; END IF;
  SELECT * INTO _job FROM public.migration_jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF NOT public.current_user_can_admin_migrations(_job.society_id) THEN RETURN FALSE; END IF;
  IF _job.status <> 'uploaded' THEN RETURN FALSE; END IF;
  IF _storage_path IS NULL OR length(_storage_path) < 5 OR length(_storage_path) > 400 THEN
    RETURN FALSE;
  END IF;
  UPDATE public.migration_jobs SET storage_path = _storage_path, updated_at = now()
    WHERE id = _job_id;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.migration_set_storage_path(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.migration_set_storage_path(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.migration_set_storage_path(UUID, TEXT) TO authenticated;
