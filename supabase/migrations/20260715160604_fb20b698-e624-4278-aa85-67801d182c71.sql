
-- Storage policies for public-assets (private bucket, signed URLs only)

CREATE POLICY "public_assets_insert_authenticated"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'public-assets'
  AND (storage.foldername(name))[1] = 'logos'
  AND owner = auth.uid()
);

CREATE POLICY "public_assets_select_own"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'public-assets' AND owner = auth.uid());

CREATE POLICY "public_assets_update_own"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'public-assets' AND owner = auth.uid())
WITH CHECK (bucket_id = 'public-assets' AND owner = auth.uid());

CREATE POLICY "public_assets_delete_own"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'public-assets' AND owner = auth.uid());
