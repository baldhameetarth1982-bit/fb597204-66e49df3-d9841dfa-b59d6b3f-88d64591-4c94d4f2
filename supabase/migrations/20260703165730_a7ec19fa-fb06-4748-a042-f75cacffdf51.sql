
CREATE POLICY "uploads_authenticated_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'uploads');

CREATE POLICY "uploads_authenticated_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'uploads');

CREATE POLICY "uploads_public_select" ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'uploads');

CREATE POLICY "uploads_authenticated_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'uploads' AND owner = auth.uid());
