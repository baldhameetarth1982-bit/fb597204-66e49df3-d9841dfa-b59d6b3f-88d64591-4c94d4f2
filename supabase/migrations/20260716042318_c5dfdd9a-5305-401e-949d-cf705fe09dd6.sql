-- Stage 1D correctness pass: additive column for same-key/different-payload
-- idempotency conflict detection. Populated by the createNonMemberIncomeRecordFn
-- server function; nullable so legacy rows are unaffected.
ALTER TABLE public.society_income_records
  ADD COLUMN IF NOT EXISTS creation_payload_hash TEXT;

COMMENT ON COLUMN public.society_income_records.creation_payload_hash IS
  'Stage 1D — canonical hash of material create-record fields. Compared against a duplicate creation_request_id retry to distinguish a legitimate replay (same hash → return original) from a changed-payload collision (different hash → idempotency_conflict).';