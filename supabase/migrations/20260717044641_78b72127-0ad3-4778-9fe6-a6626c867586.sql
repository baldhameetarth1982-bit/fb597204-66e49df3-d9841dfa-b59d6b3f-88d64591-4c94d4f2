
-- Stage 2D — Migration & Bulk Import pipeline (staging + provenance)

DO $$ BEGIN
  CREATE TYPE public.migration_job_status AS ENUM (
    'uploaded','mapping','validating','ready','committing',
    'completed','failed','cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.migration_entity_type AS ENUM (
    'structure','unit','resident','occupancy','family','vehicle'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.migration_row_action AS ENUM (
    'create','match_existing','skip','conflict'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.migration_row_status AS ENUM (
    'pending','valid','warning','error','committed','skipped'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.migration_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id UUID NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL CHECK (source_type IN ('sociyohub','generic','mygate','adda','nobrokerhood')),
  source_filename TEXT NOT NULL CHECK (length(source_filename) BETWEEN 1 AND 240),
  file_checksum TEXT NOT NULL CHECK (length(file_checksum) BETWEEN 8 AND 128),
  storage_path TEXT,
  status public.migration_job_status NOT NULL DEFAULT 'uploaded',
  structure_mode TEXT CHECK (structure_mode IN ('structured','serial')),
  mapping_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_rows INTEGER NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  valid_rows INTEGER NOT NULL DEFAULT 0 CHECK (valid_rows >= 0),
  warning_rows INTEGER NOT NULL DEFAULT 0 CHECK (warning_rows >= 0),
  error_rows INTEGER NOT NULL DEFAULT 0 CHECK (error_rows >= 0),
  committed_rows INTEGER NOT NULL DEFAULT 0 CHECK (committed_rows >= 0),
  idempotency_key TEXT,
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  validated_at TIMESTAMPTZ,
  committed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS migration_jobs_society_idx ON public.migration_jobs(society_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS migration_jobs_idempotency_uk
  ON public.migration_jobs(society_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON public.migration_jobs TO authenticated;
GRANT ALL ON public.migration_jobs TO service_role;
ALTER TABLE public.migration_jobs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.migration_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.migration_jobs(id) ON DELETE CASCADE,
  society_id UUID NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL CHECK (row_number > 0),
  entity_type public.migration_entity_type NOT NULL,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  mapped_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_key TEXT,
  row_checksum TEXT NOT NULL,
  action public.migration_row_action NOT NULL DEFAULT 'create',
  status public.migration_row_status NOT NULL DEFAULT 'pending',
  error_codes TEXT[] NOT NULL DEFAULT '{}'::text[],
  warning_codes TEXT[] NOT NULL DEFAULT '{}'::text[],
  resolved_entity_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS migration_rows_job_idx ON public.migration_rows(job_id, row_number);
CREATE INDEX IF NOT EXISTS migration_rows_entity_idx ON public.migration_rows(job_id, entity_type, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.migration_rows TO authenticated;
GRANT ALL ON public.migration_rows TO service_role;
ALTER TABLE public.migration_rows ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.migration_entity_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id UUID NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.migration_jobs(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL,
  entity_type public.migration_entity_type NOT NULL,
  source_key TEXT NOT NULL,
  canonical_entity_id UUID NOT NULL,
  source_checksum TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS migration_entity_links_uk
  ON public.migration_entity_links(society_id, source_type, entity_type, source_key);

GRANT SELECT ON public.migration_entity_links TO authenticated;
GRANT ALL ON public.migration_entity_links TO service_role;
ALTER TABLE public.migration_entity_links ENABLE ROW LEVEL SECURITY;

-- Access helper: caller is Society Admin of the society or Super Admin.
CREATE OR REPLACE FUNCTION public.current_user_can_admin_migrations(_society_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.is_active = true
      AND (
        (ur.role = 'super_admin')
        OR (ur.role = 'society_admin' AND ur.society_id = _society_id)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_can_admin_migrations(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_can_admin_migrations(UUID) TO authenticated;

-- Policies (admin-scoped only; residents/guards/block admins denied)
DROP POLICY IF EXISTS migration_jobs_admin_all ON public.migration_jobs;
CREATE POLICY migration_jobs_admin_all ON public.migration_jobs
  FOR ALL TO authenticated
  USING (public.current_user_can_admin_migrations(society_id))
  WITH CHECK (public.current_user_can_admin_migrations(society_id));

DROP POLICY IF EXISTS migration_rows_admin_all ON public.migration_rows;
CREATE POLICY migration_rows_admin_all ON public.migration_rows
  FOR ALL TO authenticated
  USING (public.current_user_can_admin_migrations(society_id))
  WITH CHECK (public.current_user_can_admin_migrations(society_id));

DROP POLICY IF EXISTS migration_entity_links_admin_read ON public.migration_entity_links;
CREATE POLICY migration_entity_links_admin_read ON public.migration_entity_links
  FOR SELECT TO authenticated
  USING (public.current_user_can_admin_migrations(society_id));

-- updated_at trigger reuse
CREATE OR REPLACE FUNCTION public.tg_migration_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS migration_jobs_touch ON public.migration_jobs;
CREATE TRIGGER migration_jobs_touch BEFORE UPDATE ON public.migration_jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_migration_touch_updated_at();

DROP TRIGGER IF EXISTS migration_rows_touch ON public.migration_rows;
CREATE TRIGGER migration_rows_touch BEFORE UPDATE ON public.migration_rows
  FOR EACH ROW EXECUTE FUNCTION public.tg_migration_touch_updated_at();
