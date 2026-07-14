
-- =========================================================================
-- Stage 3A: No-Dues workflow + payment-points idempotency
-- Additive only. Does not modify existing rows.
-- =========================================================================

-- ---------- Enums ----------
DO $$ BEGIN
  CREATE TYPE public.no_dues_status AS ENUM (
    'draft','submitted','under_review','approved','rejected','issued','revoked'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- no_dues_requests ----------
CREATE TABLE IF NOT EXISTS public.no_dues_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id    uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_id       uuid NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  requester_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purpose       text,
  status        public.no_dues_status NOT NULL DEFAULT 'submitted',
  eligibility_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  admin_notes   text,
  rejection_reason text,
  reviewed_by   uuid REFERENCES auth.users(id),
  reviewed_at   timestamptz,
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_no_dues_requests_society ON public.no_dues_requests(society_id);
CREATE INDEX IF NOT EXISTS idx_no_dues_requests_flat ON public.no_dues_requests(flat_id);
CREATE INDEX IF NOT EXISTS idx_no_dues_requests_requester ON public.no_dues_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_no_dues_requests_status ON public.no_dues_requests(society_id, status);

GRANT SELECT, INSERT, UPDATE ON public.no_dues_requests TO authenticated;
GRANT ALL ON public.no_dues_requests TO service_role;

ALTER TABLE public.no_dues_requests ENABLE ROW LEVEL SECURITY;

-- Residents see own requests; society admins see requests in their society
CREATE POLICY "residents view own no_dues requests"
  ON public.no_dues_requests FOR SELECT TO authenticated
  USING (requester_id = auth.uid());

CREATE POLICY "society admins view no_dues in their society"
  ON public.no_dues_requests FOR SELECT TO authenticated
  USING (public.is_society_admin_for(auth.uid(), society_id));

-- Residents can INSERT only for a flat they're actively associated with, in own name, status = submitted, in own society
CREATE POLICY "residents submit no_dues for own flat"
  ON public.no_dues_requests FOR INSERT TO authenticated
  WITH CHECK (
    requester_id = auth.uid()
    AND status = 'submitted'
    AND flat_id IN (
      SELECT fr.flat_id FROM public.flat_residents fr
      WHERE fr.user_id = auth.uid() AND fr.is_active = true
    )
    AND society_id IN (
      SELECT f.society_id FROM public.flats f WHERE f.id = flat_id
    )
  );

-- Residents may cancel (soft, via status = 'draft' -> deletion not allowed) — no client update path.
-- Society admins cannot UPDATE directly; state transitions go through server functions (service role).
-- We intentionally omit UPDATE / DELETE policies to force server-side transitions.

-- ---------- no_dues_certificates ----------
CREATE TABLE IF NOT EXISTS public.no_dues_certificates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         uuid NOT NULL UNIQUE REFERENCES public.no_dues_requests(id) ON DELETE CASCADE,
  society_id         uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_id            uuid NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  certificate_number text NOT NULL,
  verification_token text NOT NULL,
  issued_by          uuid NOT NULL REFERENCES auth.users(id),
  issued_at          timestamptz NOT NULL DEFAULT now(),
  valid_until        date,
  storage_path       text NOT NULL,
  revoked_at         timestamptz,
  revoked_by         uuid REFERENCES auth.users(id),
  revoke_reason      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT no_dues_cert_number_unique UNIQUE (society_id, certificate_number),
  CONSTRAINT no_dues_cert_token_unique UNIQUE (verification_token)
);

CREATE INDEX IF NOT EXISTS idx_no_dues_certificates_society ON public.no_dues_certificates(society_id);
CREATE INDEX IF NOT EXISTS idx_no_dues_certificates_flat ON public.no_dues_certificates(flat_id);

GRANT SELECT ON public.no_dues_certificates TO authenticated;
GRANT ALL ON public.no_dues_certificates TO service_role;

ALTER TABLE public.no_dues_certificates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "residents view own certificates"
  ON public.no_dues_certificates FOR SELECT TO authenticated
  USING (
    request_id IN (
      SELECT r.id FROM public.no_dues_requests r
      WHERE r.requester_id = auth.uid()
    )
  );

CREATE POLICY "society admins view certificates in their society"
  ON public.no_dues_certificates FOR SELECT TO authenticated
  USING (public.is_society_admin_for(auth.uid(), society_id));

-- No client INSERT / UPDATE / DELETE — server-side only via service role.

-- ---------- no_dues_audit ----------
CREATE TABLE IF NOT EXISTS public.no_dues_audit (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id     uuid REFERENCES public.no_dues_requests(id) ON DELETE CASCADE,
  certificate_id uuid REFERENCES public.no_dues_certificates(id) ON DELETE CASCADE,
  society_id     uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  actor_id       uuid REFERENCES auth.users(id),
  action         text NOT NULL,
  previous_status public.no_dues_status,
  new_status      public.no_dues_status,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_no_dues_audit_request ON public.no_dues_audit(request_id);
CREATE INDEX IF NOT EXISTS idx_no_dues_audit_society ON public.no_dues_audit(society_id, created_at DESC);

GRANT SELECT ON public.no_dues_audit TO authenticated;
GRANT ALL ON public.no_dues_audit TO service_role;

ALTER TABLE public.no_dues_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "society admins view no_dues audit in their society"
  ON public.no_dues_audit FOR SELECT TO authenticated
  USING (public.is_society_admin_for(auth.uid(), society_id));

CREATE POLICY "residents view audit for their own requests"
  ON public.no_dues_audit FOR SELECT TO authenticated
  USING (
    request_id IN (
      SELECT r.id FROM public.no_dues_requests r WHERE r.requester_id = auth.uid()
    )
  );

-- No client INSERT/UPDATE/DELETE — append-only from server functions.

-- ---------- Guard triggers: forbid client-controlled status transitions ----------
-- We omitted UPDATE policies entirely, so authenticated clients cannot UPDATE these tables.
-- Service role bypasses RLS for server-side transitions.

-- ---------- updated_at triggers ----------
CREATE OR REPLACE FUNCTION public.no_dues_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_no_dues_requests_updated ON public.no_dues_requests;
CREATE TRIGGER trg_no_dues_requests_updated
  BEFORE UPDATE ON public.no_dues_requests
  FOR EACH ROW EXECUTE FUNCTION public.no_dues_touch_updated_at();

DROP TRIGGER IF EXISTS trg_no_dues_certificates_updated ON public.no_dues_certificates;
CREATE TRIGGER trg_no_dues_certificates_updated
  BEFORE UPDATE ON public.no_dues_certificates
  FOR EACH ROW EXECUTE FUNCTION public.no_dues_touch_updated_at();

-- =========================================================================
-- Payment-points idempotency (additive to existing user_points)
-- =========================================================================

ALTER TABLE public.user_points
  ADD COLUMN IF NOT EXISTS source_ref text;

-- One award per (society, user, reason, source_ref). Payment points use
-- reason='payment_on_time' + source_ref=payment_id, so retries cannot double-award.
CREATE UNIQUE INDEX IF NOT EXISTS user_points_source_ref_unique
  ON public.user_points(society_id, user_id, reason, source_ref)
  WHERE source_ref IS NOT NULL;
