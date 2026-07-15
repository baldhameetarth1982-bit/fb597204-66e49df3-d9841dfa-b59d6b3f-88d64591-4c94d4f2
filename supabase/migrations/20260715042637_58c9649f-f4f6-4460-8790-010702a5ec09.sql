
-- ============================================================
-- Stage 3B — Turn 18A: Income architecture + non-member payment foundation
-- Additive only. No changes to existing bills/payments/expenses/ledger.
-- ============================================================

-- 1) Income categories -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.society_income_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  key text NOT NULL,
  display_name text NOT NULL,
  description text,
  category_group text,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT society_income_categories_key_len CHECK (char_length(key) BETWEEN 1 AND 64),
  CONSTRAINT society_income_categories_name_len CHECK (char_length(display_name) BETWEEN 1 AND 120),
  CONSTRAINT society_income_categories_desc_len CHECK (description IS NULL OR char_length(description) <= 500),
  CONSTRAINT society_income_categories_group_len CHECK (category_group IS NULL OR char_length(category_group) <= 64)
);

CREATE UNIQUE INDEX IF NOT EXISTS society_income_categories_soc_key_uidx
  ON public.society_income_categories (society_id, lower(key));

CREATE INDEX IF NOT EXISTS society_income_categories_soc_active_idx
  ON public.society_income_categories (society_id, is_active);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.society_income_categories TO authenticated;
GRANT ALL ON public.society_income_categories TO service_role;

ALTER TABLE public.society_income_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sic_admin_select" ON public.society_income_categories
  FOR SELECT TO authenticated
  USING (public.is_society_admin_for(auth.uid(), society_id) OR public.is_super_admin(auth.uid()));

CREATE POLICY "sic_admin_insert" ON public.society_income_categories
  FOR INSERT TO authenticated
  WITH CHECK (public.is_society_admin_for(auth.uid(), society_id) OR public.is_super_admin(auth.uid()));

CREATE POLICY "sic_admin_update" ON public.society_income_categories
  FOR UPDATE TO authenticated
  USING (public.is_society_admin_for(auth.uid(), society_id) OR public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_society_admin_for(auth.uid(), society_id) OR public.is_super_admin(auth.uid()));

CREATE POLICY "sic_admin_delete" ON public.society_income_categories
  FOR DELETE TO authenticated
  USING (public.is_society_admin_for(auth.uid(), society_id) OR public.is_super_admin(auth.uid()));

-- 2) Non-member payers -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.non_member_payers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  payer_type text NOT NULL,
  display_name text NOT NULL,
  organization_name text,
  phone text,
  email text,
  reference_code text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nmp_type_check CHECK (payer_type IN (
    'vendor','advertiser','coach','event_organizer','shop','guest','temporary','other'
  )),
  CONSTRAINT nmp_name_len CHECK (char_length(display_name) BETWEEN 1 AND 120),
  CONSTRAINT nmp_org_len CHECK (organization_name IS NULL OR char_length(organization_name) <= 160),
  CONSTRAINT nmp_phone_len CHECK (phone IS NULL OR char_length(phone) BETWEEN 6 AND 20),
  CONSTRAINT nmp_email_len CHECK (email IS NULL OR char_length(email) <= 254),
  CONSTRAINT nmp_ref_len CHECK (reference_code IS NULL OR char_length(reference_code) <= 64),
  CONSTRAINT nmp_notes_len CHECK (notes IS NULL OR char_length(notes) <= 1000)
);

CREATE INDEX IF NOT EXISTS nmp_soc_active_idx
  ON public.non_member_payers (society_id, is_active);
CREATE INDEX IF NOT EXISTS nmp_soc_name_idx
  ON public.non_member_payers (society_id, lower(display_name));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.non_member_payers TO authenticated;
GRANT ALL ON public.non_member_payers TO service_role;

ALTER TABLE public.non_member_payers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nmp_admin_select" ON public.non_member_payers
  FOR SELECT TO authenticated
  USING (public.is_society_admin_for(auth.uid(), society_id) OR public.is_super_admin(auth.uid()));

CREATE POLICY "nmp_admin_insert" ON public.non_member_payers
  FOR INSERT TO authenticated
  WITH CHECK (public.is_society_admin_for(auth.uid(), society_id) OR public.is_super_admin(auth.uid()));

CREATE POLICY "nmp_admin_update" ON public.non_member_payers
  FOR UPDATE TO authenticated
  USING (public.is_society_admin_for(auth.uid(), society_id) OR public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_society_admin_for(auth.uid(), society_id) OR public.is_super_admin(auth.uid()));

CREATE POLICY "nmp_admin_delete" ON public.non_member_payers
  FOR DELETE TO authenticated
  USING (public.is_society_admin_for(auth.uid(), society_id) OR public.is_super_admin(auth.uid()));

-- 3) Society income records -----------------------------------------------
CREATE TABLE IF NOT EXISTS public.society_income_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.society_income_categories(id) ON DELETE RESTRICT,
  payer_kind text NOT NULL,
  resident_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  non_member_payer_id uuid REFERENCES public.non_member_payers(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL,
  payment_method text NOT NULL,
  payment_status text NOT NULL DEFAULT 'pending',
  payment_date timestamptz NOT NULL DEFAULT now(),
  reference_number text,
  description text,
  verification_status text NOT NULL DEFAULT 'pending',
  reconciliation_status text NOT NULL DEFAULT 'unreconciled',
  source text NOT NULL DEFAULT 'manual',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reversed_at timestamptz,
  reversed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reversal_reason text,
  CONSTRAINT sir_amount_positive CHECK (amount > 0),
  CONSTRAINT sir_payer_kind CHECK (payer_kind IN ('resident','non_member','anonymous')),
  CONSTRAINT sir_method CHECK (payment_method IN ('cash','bank_transfer','other_offline')),
  CONSTRAINT sir_pay_status CHECK (payment_status IN ('pending','received','failed')),
  CONSTRAINT sir_verify_status CHECK (verification_status IN ('pending','verified','rejected','reversed')),
  CONSTRAINT sir_recon_status CHECK (reconciliation_status IN (
    'unreconciled','matched','partially_matched','needs_review','reversed'
  )),
  CONSTRAINT sir_source CHECK (source IN ('manual','import','webhook')),
  CONSTRAINT sir_ref_len CHECK (reference_number IS NULL OR char_length(reference_number) <= 128),
  CONSTRAINT sir_desc_len CHECK (description IS NULL OR char_length(description) <= 500),
  CONSTRAINT sir_reversal_len CHECK (reversal_reason IS NULL OR char_length(reversal_reason) <= 500),
  CONSTRAINT sir_exactly_one_payer CHECK (
    (payer_kind = 'resident'   AND resident_user_id IS NOT NULL AND non_member_payer_id IS NULL) OR
    (payer_kind = 'non_member' AND non_member_payer_id IS NOT NULL AND resident_user_id IS NULL) OR
    (payer_kind = 'anonymous'  AND resident_user_id IS NULL AND non_member_payer_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS sir_soc_date_idx
  ON public.society_income_records (society_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS sir_soc_category_idx
  ON public.society_income_records (society_id, category_id);
CREATE INDEX IF NOT EXISTS sir_soc_payer_idx
  ON public.society_income_records (society_id, non_member_payer_id);
CREATE INDEX IF NOT EXISTS sir_soc_verify_idx
  ON public.society_income_records (society_id, verification_status);
CREATE INDEX IF NOT EXISTS sir_soc_recon_idx
  ON public.society_income_records (society_id, reconciliation_status);

GRANT SELECT, INSERT, UPDATE ON public.society_income_records TO authenticated;
GRANT ALL ON public.society_income_records TO service_role;
-- Deliberately no DELETE grant to authenticated: financial records are audit-preserved via reversal.

ALTER TABLE public.society_income_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sir_admin_select" ON public.society_income_records
  FOR SELECT TO authenticated
  USING (public.is_society_admin_for(auth.uid(), society_id) OR public.is_super_admin(auth.uid()));

CREATE POLICY "sir_admin_insert" ON public.society_income_records
  FOR INSERT TO authenticated
  WITH CHECK (public.is_society_admin_for(auth.uid(), society_id) OR public.is_super_admin(auth.uid()));

CREATE POLICY "sir_admin_update" ON public.society_income_records
  FOR UPDATE TO authenticated
  USING (public.is_society_admin_for(auth.uid(), society_id) OR public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_society_admin_for(auth.uid(), society_id) OR public.is_super_admin(auth.uid()));

-- 4) Cross-table society consistency trigger ------------------------------
CREATE OR REPLACE FUNCTION public.enforce_income_record_society_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cat_soc uuid;
  payer_soc uuid;
BEGIN
  SELECT society_id INTO cat_soc FROM public.society_income_categories WHERE id = NEW.category_id;
  IF cat_soc IS NULL OR cat_soc <> NEW.society_id THEN
    RAISE EXCEPTION 'Category does not belong to society' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.non_member_payer_id IS NOT NULL THEN
    SELECT society_id INTO payer_soc FROM public.non_member_payers WHERE id = NEW.non_member_payer_id;
    IF payer_soc IS NULL OR payer_soc <> NEW.society_id THEN
      RAISE EXCEPTION 'Payer does not belong to society' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sir_society_consistency ON public.society_income_records;
CREATE TRIGGER trg_sir_society_consistency
  BEFORE INSERT OR UPDATE ON public.society_income_records
  FOR EACH ROW EXECUTE FUNCTION public.enforce_income_record_society_consistency();

-- 5) updated_at trigger (reuse existing helper if present) ----------------
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_sic_touch ON public.society_income_categories;
CREATE TRIGGER trg_sic_touch BEFORE UPDATE ON public.society_income_categories
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS trg_nmp_touch ON public.non_member_payers;
CREATE TRIGGER trg_nmp_touch BEFORE UPDATE ON public.non_member_payers
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS trg_sir_touch ON public.society_income_records;
CREATE TRIGGER trg_sir_touch BEFORE UPDATE ON public.society_income_records
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

COMMENT ON TABLE public.society_income_categories IS 'Stage 3B: society-scoped income category taxonomy.';
COMMENT ON TABLE public.non_member_payers IS 'Stage 3B: society-scoped non-member/external payer directory.';
COMMENT ON TABLE public.society_income_records IS 'Stage 3B: society income records incl. non-member payments. Reconciliation-ready.';
