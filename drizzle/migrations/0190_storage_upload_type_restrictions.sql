DROP POLICY IF EXISTS "kyc owner insert" ON storage.objects;
CREATE POLICY "kyc owner insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'kyc' AND (auth.uid())::text = (storage.foldername(name))[1]
  AND lower(storage.extension(name)) = ANY (ARRAY['jpg','jpeg','png','webp','pdf'])
  AND lower(coalesce(metadata->>'mimetype','')) = ANY (ARRAY['image/jpeg','image/png','image/webp','application/pdf']));

DROP POLICY IF EXISTS "kyc owner update" ON storage.objects;
CREATE POLICY "kyc owner update" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'kyc' AND (auth.uid())::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'kyc' AND (auth.uid())::text = (storage.foldername(name))[1]
  AND lower(storage.extension(name)) = ANY (ARRAY['jpg','jpeg','png','webp','pdf'])
  AND lower(coalesce(metadata->>'mimetype','')) = ANY (ARRAY['image/jpeg','image/png','image/webp','application/pdf']));

DROP POLICY IF EXISTS "kyc-admin: users manage own folder - insert" ON storage.objects;
CREATE POLICY "kyc-admin: users manage own folder - insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'kyc-admin' AND (storage.foldername(name))[1] = (auth.uid())::text
  AND lower(coalesce(metadata->>'mimetype','')) = ANY (ARRAY['image/jpeg','image/png','image/webp']));

DROP POLICY IF EXISTS public_assets_insert_authenticated ON storage.objects;
CREATE POLICY public_assets_insert_authenticated ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'public-assets' AND (storage.foldername(name))[1] = 'logos' AND owner = auth.uid()
  AND lower(storage.extension(name)) = ANY (ARRAY['jpg','jpeg','png','webp'])
  AND lower(coalesce(metadata->>'mimetype','')) = ANY (ARRAY['image/jpeg','image/png','image/webp']));

DROP POLICY IF EXISTS public_assets_update_own ON storage.objects;
CREATE POLICY public_assets_update_own ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'public-assets' AND owner = auth.uid())
WITH CHECK (bucket_id = 'public-assets' AND owner = auth.uid()
  AND lower(coalesce(metadata->>'mimetype','')) = ANY (ARRAY['image/jpeg','image/png','image/webp']));