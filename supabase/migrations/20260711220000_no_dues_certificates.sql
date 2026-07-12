-- Automated, verifiable No-Dues Certificates.
-- Eligibility is calculated inside the database so clients cannot bypass it.

CREATE TABLE IF NOT EXISTS public.no_dues_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_id uuid NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  certificate_number text NOT NULL UNIQUE,
  verification_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'expired')),
  outstanding_amount numeric(12,2) NOT NULL DEFAULT 0,
  open_ticket_count integer NOT NULL DEFAULT 0,
  eligibility_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  issued_by uuid NOT NULL REFERENCES auth.users(id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz NOT NULL,
  revoked_by uuid REFERENCES auth.users(id),
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS no_dues_certificates_society_idx
  ON public.no_dues_certificates (society_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS no_dues_certificates_flat_idx
  ON public.no_dues_certificates (flat_id, issued_at DESC);

ALTER TABLE public.no_dues_certificates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "society admins manage no dues certificates"
ON public.no_dues_certificates
FOR ALL TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR public.is_society_admin_for(auth.uid(), society_id)
)
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR public.is_society_admin_for(auth.uid(), society_id)
);

CREATE POLICY "residents view their no dues certificates"
ON public.no_dues_certificates
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.flat_residents fr
    WHERE fr.flat_id = no_dues_certificates.flat_id
      AND fr.user_id = auth.uid()
      AND fr.is_active = true
  )
);

CREATE OR REPLACE FUNCTION public.issue_no_dues_certificate(
  _flat_id uuid,
  _valid_days integer DEFAULT 30
)
RETURNS public.no_dues_certificates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_society_id uuid;
  v_outstanding numeric(12,2);
  v_open_tickets integer;
  v_certificate public.no_dues_certificates;
  v_valid_days integer := LEAST(GREATEST(COALESCE(_valid_days, 30), 1), 365);
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT society_id INTO v_society_id
  FROM public.flats
  WHERE id = _flat_id;

  IF v_society_id IS NULL THEN
    RAISE EXCEPTION 'Unit not found';
  END IF;

  IF NOT (
    public.is_super_admin(v_user)
    OR public.is_society_admin_for(v_user, v_society_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT COALESCE(SUM(GREATEST(b.amount - COALESCE(p.paid, 0), 0)), 0)
  INTO v_outstanding
  FROM public.bills b
  LEFT JOIN (
    SELECT bill_id, SUM(amount) AS paid
    FROM public.payments
    WHERE status = 'success'
    GROUP BY bill_id
  ) p ON p.bill_id = b.id
  WHERE b.flat_id = _flat_id
    AND b.status <> 'cancelled';

  SELECT COUNT(*)::integer
  INTO v_open_tickets
  FROM public.support_tickets st
  WHERE st.user_id IN (
    SELECT fr.user_id
    FROM public.flat_residents fr
    WHERE fr.flat_id = _flat_id AND fr.is_active = true
  )
    AND st.status IN ('open', 'in_progress');

  IF v_outstanding > 0 THEN
    RAISE EXCEPTION 'Unit has outstanding dues of INR %', v_outstanding;
  END IF;
  IF v_open_tickets > 0 THEN
    RAISE EXCEPTION 'Unit has % unresolved ticket(s)', v_open_tickets;
  END IF;

  INSERT INTO public.no_dues_certificates (
    society_id,
    flat_id,
    certificate_number,
    status,
    outstanding_amount,
    open_ticket_count,
    eligibility_snapshot,
    issued_by,
    valid_until
  ) VALUES (
    v_society_id,
    _flat_id,
    'SH-ND-' || to_char(now(), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
    'active',
    v_outstanding,
    v_open_tickets,
    jsonb_build_object(
      'outstanding_amount', v_outstanding,
      'open_ticket_count', v_open_tickets,
      'checked_at', now()
    ),
    v_user,
    now() + make_interval(days => v_valid_days)
  )
  RETURNING * INTO v_certificate;

  RETURN v_certificate;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_no_dues_certificate(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_no_dues_certificate(uuid, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.verify_no_dues_certificate(_token uuid)
RETURNS TABLE (
  certificate_number text,
  status text,
  society_name text,
  block_name text,
  flat_number text,
  issued_at timestamptz,
  valid_until timestamptz,
  revoked_at timestamptz,
  revocation_reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.certificate_number,
    CASE
      WHEN c.status = 'active' AND c.valid_until < now() THEN 'expired'
      ELSE c.status
    END,
    s.name,
    b.name,
    f.flat_number,
    c.issued_at,
    c.valid_until,
    c.revoked_at,
    c.revocation_reason
  FROM public.no_dues_certificates c
  JOIN public.societies s ON s.id = c.society_id
  JOIN public.flats f ON f.id = c.flat_id
  LEFT JOIN public.blocks b ON b.id = f.block_id
  WHERE c.verification_token = _token
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.verify_no_dues_certificate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_no_dues_certificate(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.revoke_no_dues_certificate(
  _certificate_id uuid,
  _reason text
)
RETURNS public.no_dues_certificates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_certificate public.no_dues_certificates;
  v_reason text := NULLIF(trim(COALESCE(_reason, '')), '');
BEGIN
  SELECT * INTO v_certificate
  FROM public.no_dues_certificates
  WHERE id = _certificate_id;

  IF v_certificate.id IS NULL THEN
    RAISE EXCEPTION 'Certificate not found';
  END IF;
  IF v_reason IS NULL OR length(v_reason) > 300 THEN
    RAISE EXCEPTION 'Revocation reason is required (max 300 characters)';
  END IF;
  IF NOT (
    public.is_super_admin(v_user)
    OR public.is_society_admin_for(v_user, v_certificate.society_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.no_dues_certificates
  SET status = 'revoked',
      revoked_by = v_user,
      revoked_at = now(),
      revocation_reason = v_reason,
      updated_at = now()
  WHERE id = _certificate_id AND status = 'active'
  RETURNING * INTO v_certificate;

  RETURN v_certificate;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_no_dues_certificate(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_no_dues_certificate(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
