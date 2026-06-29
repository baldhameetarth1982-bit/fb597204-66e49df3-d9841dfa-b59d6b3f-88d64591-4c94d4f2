
-- 1. Society payout fields
ALTER TABLE public.societies
  ADD COLUMN IF NOT EXISTS razorpay_account_id text,
  ADD COLUMN IF NOT EXISTS payout_status text NOT NULL DEFAULT 'not_setup',
  ADD COLUMN IF NOT EXISTS payout_bank_last4 text,
  ADD COLUMN IF NOT EXISTS payout_holder_name text;

DO $$ BEGIN
  ALTER TABLE public.societies
    ADD CONSTRAINT societies_payout_status_chk
    CHECK (payout_status IN ('not_setup','pending','active','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Payments fee split + Razorpay refs
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS platform_fee_paise integer,
  ADD COLUMN IF NOT EXISTS society_share_paise integer,
  ADD COLUMN IF NOT EXISTS razorpay_order_id text,
  ADD COLUMN IF NOT EXISTS razorpay_payment_id text,
  ADD COLUMN IF NOT EXISTS razorpay_signature text;

CREATE UNIQUE INDEX IF NOT EXISTS payments_razorpay_payment_id_uq
  ON public.payments(razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;

-- 3. Platform fee setting
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS maintenance_fee_percent numeric NOT NULL DEFAULT 1.5;

-- 4. One-off bills RPC
CREATE OR REPLACE FUNCTION public.create_oneoff_bills(
  _society_id uuid,
  _scope text,
  _block_id uuid,
  _flat_id uuid,
  _amount numeric,
  _title text,
  _due_date date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count integer := 0;
  _today date := current_date;
  _period_end date;
BEGIN
  IF NOT (public.is_society_admin_for(auth.uid(), _society_id) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF _scope NOT IN ('society','block','flat') THEN RAISE EXCEPTION 'Invalid scope'; END IF;
  IF _due_date IS NULL THEN _due_date := _today + 10; END IF;
  _period_end := _due_date;

  IF _scope = 'flat' THEN
    IF _flat_id IS NULL THEN RAISE EXCEPTION 'flat_id required'; END IF;
    INSERT INTO public.bills (society_id, flat_id, amount, bill_date, due_date, period_label, period_start, period_end, status, notes)
    SELECT _society_id, f.id, _amount, _today, _due_date, _title, _today, _period_end, 'unpaid', 'One-off charge'
      FROM public.flats f WHERE f.id = _flat_id AND f.society_id = _society_id;
    GET DIAGNOSTICS _count = ROW_COUNT;
  ELSIF _scope = 'block' THEN
    IF _block_id IS NULL THEN RAISE EXCEPTION 'block_id required'; END IF;
    INSERT INTO public.bills (society_id, flat_id, amount, bill_date, due_date, period_label, period_start, period_end, status, notes)
    SELECT _society_id, f.id, _amount, _today, _due_date, _title, _today, _period_end, 'unpaid', 'One-off charge'
      FROM public.flats f WHERE f.society_id = _society_id AND f.block_id = _block_id;
    GET DIAGNOSTICS _count = ROW_COUNT;
  ELSE
    INSERT INTO public.bills (society_id, flat_id, amount, bill_date, due_date, period_label, period_start, period_end, status, notes)
    SELECT _society_id, f.id, _amount, _today, _due_date, _title, _today, _period_end, 'unpaid', 'One-off charge'
      FROM public.flats f WHERE f.society_id = _society_id;
    GET DIAGNOSTICS _count = ROW_COUNT;
  END IF;

  RETURN _count;
END;
$$;

REVOKE ALL ON FUNCTION public.create_oneoff_bills(uuid, text, uuid, uuid, numeric, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_oneoff_bills(uuid, text, uuid, uuid, numeric, text, date) TO authenticated;

-- 5. Society admin-only writes for payout fields handled at app layer
-- (society already has owner/admin RLS for UPDATE)

-- 6. Tighten offline_residents — only admins/super admins can SELECT contact info
DROP POLICY IF EXISTS "society members view offline residents" ON public.offline_residents;
DROP POLICY IF EXISTS "Society members view offline residents" ON public.offline_residents;

CREATE POLICY "admins view offline residents"
  ON public.offline_residents
  FOR SELECT
  TO authenticated
  USING (
    public.is_society_admin_for(auth.uid(), society_id)
    OR public.is_super_admin(auth.uid())
  );
