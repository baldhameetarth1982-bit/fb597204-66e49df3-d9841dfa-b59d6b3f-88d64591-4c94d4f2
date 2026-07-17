
-- Society-scoped storage RLS for migration uploads.
DROP POLICY IF EXISTS migration_uploads_admin_all ON storage.objects;
CREATE POLICY migration_uploads_admin_all ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'migration-uploads'
    AND public.current_user_can_admin_migrations((storage.foldername(name))[1]::uuid)
  )
  WITH CHECK (
    bucket_id = 'migration-uploads'
    AND public.current_user_can_admin_migrations((storage.foldername(name))[1]::uuid)
  );
