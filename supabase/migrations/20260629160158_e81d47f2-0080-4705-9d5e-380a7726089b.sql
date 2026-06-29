
-- 1. Society payout fields
ALTER TABLE public.societies
  ADD COLUMN IF NOT EXISTS razorpay_account_id TEXT,
  ADD COLUMN IF NOT EXISTS payout_status TEXT NOT NULL DEFAULT 'not_setup'
    CHECK (payout_status IN ('not_setup','pending','active','rejected')),
  ADD COLUMN IF NOT EXISTS payout_bank_last4 TEXT,
  ADD COLUMN IF NOT EXISTS payout_holder_name TEXT;

-- 2. Platform fee %
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS maintenance_fee_percent NUMERIC(5,2) NOT NULL DEFAULT 1.5;

INSERT INTO public.platform_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- 3. Payments split tracking (only add columns if table already exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='payments') THEN
    ALTER TABLE public.payments
      ADD COLUMN IF NOT EXISTS bill_id UUID REFERENCES public.bills(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS society_share_paise BIGINT,
      ADD COLUMN IF NOT EXISTS platform_share_paise BIGINT,
      ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT,
      ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT;
  END IF;
END $$;

-- 4. One-off bill RPC
CREATE OR REPLACE FUNCTION public.create_oneoff_bills(
  _society_id UUID,
  _target TEXT,                 -- 'all' | 'block' | 'flat'
  _block_id UUID,
  _flat_id UUID,
  _amount NUMERIC,
  _label TEXT,
  _due_date DATE,
  _notes TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.is_society_admin_for(v_uid, _society_id) OR public.is_super_admin(v_uid)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF _target NOT IN ('all','block','flat') THEN RAISE EXCEPTION 'Invalid target'; END IF;

  IF _target = 'flat' THEN
    INSERT INTO public.bills (society_id, flat_id, amount, period_label, period_start, period_end, due_date, bill_date, status, notes)
    SELECT _society_id, f.id, _amount, _label, CURRENT_DATE, _due_date, _due_date, CURRENT_DATE, 'unpaid', _notes
      FROM public.flats f
     WHERE f.id = _flat_id AND f.society_id = _society_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSIF _target = 'block' THEN
    INSERT INTO public.bills (society_id, flat_id, amount, period_label, period_start, period_end, due_date, bill_date, status, notes)
    SELECT _society_id, f.id, _amount, _label, CURRENT_DATE, _due_date, _due_date, CURRENT_DATE, 'unpaid', _notes
      FROM public.flats f
     WHERE f.society_id = _society_id AND f.block_id = _block_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSE
    INSERT INTO public.bills (society_id, flat_id, amount, period_label, period_start, period_end, due_date, bill_date, status, notes)
    SELECT _society_id, f.id, _amount, _label, CURRENT_DATE, _due_date, _due_date, CURRENT_DATE, 'unpaid', _notes
      FROM public.flats f
     WHERE f.society_id = _society_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.create_oneoff_bills(UUID, TEXT, UUID, UUID, NUMERIC, TEXT, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_oneoff_bills(UUID, TEXT, UUID, UUID, NUMERIC, TEXT, DATE, TEXT) TO authenticated;
