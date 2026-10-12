CREATE OR REPLACE FUNCTION public._user_personal_storage_objects(_uid uuid)
RETURNS TABLE(bucket_id text, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, storage AS $$
  SELECT o.bucket_id, o.name FROM storage.objects o
  WHERE o.owner_id = _uid::text
    AND o.bucket_id IN ('kyc','community','posts','uploads')
  LIMIT 2000
$$;
REVOKE ALL ON FUNCTION public._user_personal_storage_objects(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._user_personal_storage_objects(uuid) TO service_role;
COMMENT ON FUNCTION public._user_personal_storage_objects(uuid) IS 'Account deletion: lists a person''s own personal files (never payment/legal evidence). service_role only.';