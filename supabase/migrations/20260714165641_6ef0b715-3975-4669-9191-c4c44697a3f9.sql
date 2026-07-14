
-- Add token hash for public verification (raw token only appears in URL/QR, never stored plaintext going forward)
ALTER TABLE public.no_dues_certificates
  ADD COLUMN IF NOT EXISTS verification_token_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS no_dues_certificates_token_hash_uidx
  ON public.no_dues_certificates (verification_token_hash)
  WHERE verification_token_hash IS NOT NULL;

-- Allow verification_token to be null for new records (we use hash now)
ALTER TABLE public.no_dues_certificates
  ALTER COLUMN verification_token DROP NOT NULL;

-- Add blocked_by_dues to enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='no_dues_status' AND e.enumlabel='blocked_by_dues') THEN
    ALTER TYPE public.no_dues_status ADD VALUE 'blocked_by_dues';
  END IF;
END $$;
