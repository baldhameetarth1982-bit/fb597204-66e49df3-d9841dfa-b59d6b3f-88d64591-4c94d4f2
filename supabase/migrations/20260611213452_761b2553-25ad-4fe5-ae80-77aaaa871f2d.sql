
-- KYC bucket RLS: residents upload/read their own; society admins read residents in their society
CREATE POLICY "kyc owner read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'kyc' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "kyc owner insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'kyc' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "kyc owner update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'kyc' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "kyc owner delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'kyc' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "kyc society admin read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'kyc'
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id::text = (storage.foldername(storage.objects.name))[1]
      AND p.society_id IS NOT NULL
      AND public.is_society_admin_for(auth.uid(), p.society_id)
  )
);
