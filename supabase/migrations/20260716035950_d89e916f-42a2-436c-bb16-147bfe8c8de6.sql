-- Stage 1D — server-side idempotency for offline income creation.
-- Additive. No backfill. No changes to existing rows or existing policies.

ALTER TABLE public.society_income_records
  ADD COLUMN IF NOT EXISTS creation_request_id uuid;

-- Unique per (society, creator, request-id). Nulls are ignored, so legacy
-- rows and any future non-idempotent path continue to work unchanged.
CREATE UNIQUE INDEX IF NOT EXISTS society_income_records_creation_request_uidx
  ON public.society_income_records (society_id, created_by, creation_request_id)
  WHERE creation_request_id IS NOT NULL;
