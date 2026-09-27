DROP POLICY IF EXISTS "users upload own post images" ON storage.objects;
CREATE POLICY "users upload own post images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'posts'
  AND auth.uid()::text = (storage.foldername(name))[1]
  AND lower(storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp', 'gif')
  AND lower(COALESCE(metadata->>'mimetype', '')) IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
);

DROP POLICY IF EXISTS "posts owner update" ON storage.objects;
CREATE POLICY "posts owner update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'posts'
  AND auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'posts'
  AND auth.uid()::text = (storage.foldername(name))[1]
  AND lower(storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp', 'gif')
  AND lower(COALESCE(metadata->>'mimetype', '')) IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
);

DROP POLICY IF EXISTS branding_write_admin ON storage.objects;
CREATE POLICY branding_write_admin
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'branding'
  AND lower(storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp', 'gif')
  AND lower(COALESCE(metadata->>'mimetype', '')) IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
  AND (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = ANY (ARRAY['society_admin'::public.app_role, 'block_admin'::public.app_role])
        AND ur.society_id::text = (storage.foldername(objects.name))[1]
    )
  )
);

DROP POLICY IF EXISTS branding_update_admin ON storage.objects;
CREATE POLICY branding_update_admin
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'branding'
  AND (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = ANY (ARRAY['society_admin'::public.app_role, 'block_admin'::public.app_role])
        AND ur.society_id::text = (storage.foldername(objects.name))[1]
    )
  )
)
WITH CHECK (
  bucket_id = 'branding'
  AND lower(storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp', 'gif')
  AND lower(COALESCE(metadata->>'mimetype', '')) IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
  AND (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = ANY (ARRAY['society_admin'::public.app_role, 'block_admin'::public.app_role])
        AND ur.society_id::text = (storage.foldername(objects.name))[1]
    )
  )
);