
-- 1) Per-society certificate number sequence -------------------------------
CREATE TABLE IF NOT EXISTS public.no_dues_cert_counters (
  society_id uuid PRIMARY KEY REFERENCES public.societies(id) ON DELETE CASCADE,
  last_seq integer NOT NULL DEFAULT 0,
  year integer NOT NULL DEFAULT EXTRACT(YEAR FROM now())::int,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.no_dues_cert_counters TO authenticated;
GRANT ALL ON public.no_dues_cert_counters TO service_role;
ALTER TABLE public.no_dues_cert_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "counters readable by society admins"
  ON public.no_dues_cert_counters FOR SELECT TO authenticated
  USING (public.is_society_admin_for(auth.uid(), society_id) OR public.is_super_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.next_no_dues_cert_number(_society_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year int := EXTRACT(YEAR FROM now())::int;
  v_seq int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  IF NOT (public.is_society_admin_for(auth.uid(), _society_id) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  INSERT INTO public.no_dues_cert_counters (society_id, last_seq, year)
    VALUES (_society_id, 1, v_year)
  ON CONFLICT (society_id) DO UPDATE
    SET last_seq = CASE WHEN public.no_dues_cert_counters.year = v_year
                        THEN public.no_dues_cert_counters.last_seq + 1
                        ELSE 1 END,
        year = v_year,
        updated_at = now()
  RETURNING last_seq INTO v_seq;

  RETURN 'ND-' || v_year::text || '-' || lpad(v_seq::text, 5, '0');
END $$;
REVOKE ALL ON FUNCTION public.next_no_dues_cert_number(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.next_no_dues_cert_number(uuid) TO authenticated, service_role;

-- 2) One certificate per request (idempotent DB-level guard) ---------------
CREATE UNIQUE INDEX IF NOT EXISTS no_dues_certificates_request_unique
  ON public.no_dues_certificates(request_id);

-- 3) Atomic finalize RPC ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_no_dues_issuance(
  _request_id uuid,
  _certificate_number text,
  _verification_token_hash text,
  _storage_path text,
  _valid_until date
) RETURNS TABLE(certificate_id uuid, certificate_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_req public.no_dues_requests%ROWTYPE;
  v_cert_id uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;

  SELECT * INTO v_req FROM public.no_dues_requests WHERE id = _request_id FOR UPDATE;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;

  IF NOT (public.is_society_admin_for(v_actor, v_req.society_id) OR public.is_super_admin(v_actor)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF v_req.status <> 'approved'::public.no_dues_status THEN
    -- Idempotent: if already issued and cert exists, return it
    IF v_req.status = 'issued'::public.no_dues_status THEN
      SELECT c.id, c.certificate_number
        INTO certificate_id, certificate_number
        FROM public.no_dues_certificates c
        WHERE c.request_id = _request_id AND c.revoked_at IS NULL
        LIMIT 1;
      IF certificate_id IS NOT NULL THEN RETURN NEXT; RETURN; END IF;
    END IF;
    RAISE EXCEPTION 'INVALID_TRANSITION';
  END IF;

  INSERT INTO public.no_dues_certificates (
    request_id, society_id, flat_id, certificate_number,
    verification_token_hash, issued_by, issued_at, valid_until, storage_path
  ) VALUES (
    v_req.id, v_req.society_id, v_req.flat_id, _certificate_number,
    _verification_token_hash, v_actor, now(), _valid_until, _storage_path
  )
  RETURNING id INTO v_cert_id;

  UPDATE public.no_dues_requests
     SET status = 'issued'::public.no_dues_status,
         updated_at = now()
   WHERE id = _request_id;

  INSERT INTO public.no_dues_audit(
    request_id, certificate_id, society_id, actor_id,
    action, previous_status, new_status, metadata
  ) VALUES (
    v_req.id, v_cert_id, v_req.society_id, v_actor,
    'issued', v_req.status, 'issued'::public.no_dues_status,
    jsonb_build_object('certificate_number', _certificate_number)
  );

  certificate_id := v_cert_id;
  certificate_number := _certificate_number;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.finalize_no_dues_issuance(uuid, text, text, text, date) FROM public;
GRANT EXECUTE ON FUNCTION public.finalize_no_dues_issuance(uuid, text, text, text, date) TO authenticated, service_role;

-- 4) Revoke certificate RPC (audit + atomic) -------------------------------
CREATE OR REPLACE FUNCTION public.revoke_no_dues_certificate(
  _certificate_id uuid,
  _reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_cert public.no_dues_certificates%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;

  SELECT * INTO v_cert FROM public.no_dues_certificates WHERE id = _certificate_id FOR UPDATE;
  IF v_cert.id IS NULL THEN RAISE EXCEPTION 'CERTIFICATE_NOT_FOUND'; END IF;
  IF NOT (public.is_society_admin_for(v_actor, v_cert.society_id) OR public.is_super_admin(v_actor)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF v_cert.revoked_at IS NOT NULL THEN RETURN; END IF;

  UPDATE public.no_dues_certificates
     SET revoked_at = now(), revoked_by = v_actor, revoke_reason = btrim(_reason), updated_at = now()
   WHERE id = _certificate_id;

  UPDATE public.no_dues_requests
     SET status = 'revoked'::public.no_dues_status, updated_at = now()
   WHERE id = v_cert.request_id;

  INSERT INTO public.no_dues_audit(
    request_id, certificate_id, society_id, actor_id,
    action, previous_status, new_status, metadata
  ) VALUES (
    v_cert.request_id, v_cert.id, v_cert.society_id, v_actor,
    'revoked', 'issued'::public.no_dues_status, 'revoked'::public.no_dues_status,
    jsonb_build_object('reason', btrim(_reason))
  );
END $$;
REVOKE ALL ON FUNCTION public.revoke_no_dues_certificate(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.revoke_no_dues_certificate(uuid, text) TO authenticated, service_role;

-- 5) Lock audit against user tampering -------------------------------------
DROP POLICY IF EXISTS "audit insert by service" ON public.no_dues_audit;
DROP POLICY IF EXISTS "audit no update" ON public.no_dues_audit;
DROP POLICY IF EXISTS "audit no delete" ON public.no_dues_audit;
CREATE POLICY "audit insert by service" ON public.no_dues_audit
  FOR INSERT TO service_role WITH CHECK (true);
-- (no UPDATE/DELETE policy for anyone → denied by default under RLS)
REVOKE UPDATE, DELETE ON public.no_dues_audit FROM authenticated;
