
CREATE TABLE IF NOT EXISTS public.flat360_ai_summary_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  society_id UUID NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_id UUID NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  snapshot_fingerprint TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  result_json JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT flat360_ai_cache_unique UNIQUE (society_id, flat_id, snapshot_fingerprint, schema_version)
);

CREATE INDEX IF NOT EXISTS flat360_ai_cache_expires_idx
  ON public.flat360_ai_summary_cache (expires_at);

-- Server-only: no anon / authenticated access.
GRANT ALL ON public.flat360_ai_summary_cache TO service_role;

ALTER TABLE public.flat360_ai_summary_cache ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: only service_role (which bypasses RLS) can read/write.
