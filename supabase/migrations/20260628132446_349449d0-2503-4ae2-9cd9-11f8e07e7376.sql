
-- =========================================================
-- Phase 4: Maintenance + Billing engines
-- =========================================================

-- 1. Bills: add immutability & numbering columns
ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS bill_number text,
  ADD COLUMN IF NOT EXISTS bill_date date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS replaced_by_bill_id uuid REFERENCES public.bills(id);

CREATE UNIQUE INDEX IF NOT EXISTS bills_society_billno_uidx
  ON public.bills(society_id, bill_number) WHERE bill_number IS NOT NULL;

-- 2. Bill line items
CREATE TABLE IF NOT EXISTS public.bill_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('maintenance','additional')),
  description text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  maintenance_period_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bill_line_items TO authenticated;
GRANT ALL ON public.bill_line_items TO service_role;

ALTER TABLE public.bill_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Line items visible with bill access" ON public.bill_line_items
  FOR SELECT TO authenticated USING (
    public.is_super_admin(auth.uid())
    OR public.is_society_admin_for(auth.uid(), society_id)
    OR EXISTS (
      SELECT 1 FROM public.bills b
      JOIN public.flat_residents fr ON fr.flat_id = b.flat_id
      WHERE b.id = bill_line_items.bill_id AND fr.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins manage line items" ON public.bill_line_items
  FOR ALL TO authenticated USING (
    public.is_super_admin(auth.uid())
    OR public.is_society_admin_for(auth.uid(), society_id)
  ) WITH CHECK (
    public.is_super_admin(auth.uid())
    OR public.is_society_admin_for(auth.uid(), society_id)
  );

CREATE INDEX IF NOT EXISTS bill_line_items_bill_idx ON public.bill_line_items(bill_id);

-- 3. Maintenance periods (independent of bills)
CREATE TABLE IF NOT EXISTS public.maintenance_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_id uuid NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  period_label text NOT NULL,
  amount_due numeric(12,2) NOT NULL CHECK (amount_due >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('upcoming','pending','paid','outstanding')),
  due_date date,
  bill_id uuid REFERENCES public.bills(id) ON DELETE SET NULL,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flat_id, period_start)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_periods TO authenticated;
GRANT ALL ON public.maintenance_periods TO service_role;

ALTER TABLE public.maintenance_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Residents view own maintenance" ON public.maintenance_periods
  FOR SELECT TO authenticated USING (
    public.is_super_admin(auth.uid())
    OR public.is_society_admin_for(auth.uid(), society_id)
    OR EXISTS (
      SELECT 1 FROM public.flat_residents fr
      WHERE fr.flat_id = maintenance_periods.flat_id AND fr.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins manage maintenance" ON public.maintenance_periods
  FOR ALL TO authenticated USING (
    public.is_super_admin(auth.uid())
    OR public.is_society_admin_for(auth.uid(), society_id)
  ) WITH CHECK (
    public.is_super_admin(auth.uid())
    OR public.is_society_admin_for(auth.uid(), society_id)
  );

CREATE INDEX IF NOT EXISTS maintenance_periods_flat_idx ON public.maintenance_periods(flat_id, period_start);
CREATE INDEX IF NOT EXISTS maintenance_periods_society_status_idx ON public.maintenance_periods(society_id, status);

CREATE TRIGGER trg_maintenance_periods_touch
  BEFORE UPDATE ON public.maintenance_periods
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4. Bill immutability trigger (only status & cancellation fields can change)
CREATE OR REPLACE FUNCTION public.enforce_bill_immutability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session_role text := current_setting('role', true);
  v_is_priv boolean := COALESCE(v_session_role,'') = 'service_role'
                       OR public.is_super_admin(auth.uid());
BEGIN
  IF v_is_priv THEN RETURN NEW; END IF;
  IF NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.flat_id IS DISTINCT FROM OLD.flat_id
     OR NEW.society_id IS DISTINCT FROM OLD.society_id
     OR NEW.period_start IS DISTINCT FROM OLD.period_start
     OR NEW.period_end IS DISTINCT FROM OLD.period_end
     OR NEW.period_label IS DISTINCT FROM OLD.period_label
     OR NEW.bill_number IS DISTINCT FROM OLD.bill_number
     OR NEW.bill_date IS DISTINCT FROM OLD.bill_date THEN
    RAISE EXCEPTION 'Bills are immutable. Cancel & re-issue instead.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bills_immutable ON public.bills;
CREATE TRIGGER trg_bills_immutable
  BEFORE UPDATE ON public.bills
  FOR EACH ROW EXECUTE FUNCTION public.enforce_bill_immutability();

-- 5. RPC: ensure_maintenance_period (admin upsert)
CREATE OR REPLACE FUNCTION public.ensure_maintenance_period(
  _flat_id uuid, _period_start date, _amount numeric, _due_date date DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_society uuid;
  v_end date;
  v_label text;
  v_id uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT society_id INTO v_society FROM public.flats WHERE id = _flat_id;
  IF v_society IS NULL THEN RAISE EXCEPTION 'Flat not found'; END IF;
  IF NOT (public.is_society_admin_for(v_caller, v_society) OR public.is_super_admin(v_caller)) THEN
    RAISE EXCEPTION 'Not authorized'; END IF;

  v_end := (date_trunc('month', _period_start) + interval '1 month - 1 day')::date;
  v_label := to_char(_period_start, 'FMMonth YYYY');

  INSERT INTO public.maintenance_periods
    (society_id, flat_id, period_start, period_end, period_label, amount_due, due_date, status)
  VALUES (v_society, _flat_id, date_trunc('month', _period_start)::date, v_end, v_label, _amount, _due_date, 'pending')
  ON CONFLICT (flat_id, period_start) DO UPDATE
    SET amount_due = EXCLUDED.amount_due,
        due_date = EXCLUDED.due_date,
        updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 6. RPC: generate_flat_bill
CREATE OR REPLACE FUNCTION public.generate_flat_bill(
  _flat_id uuid,
  _period_ids uuid[],
  _additional jsonb DEFAULT '[]'::jsonb,
  _due_date date DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_society uuid;
  v_total numeric(12,2) := 0;
  v_bill_id uuid;
  v_bill_no text;
  v_seq int;
  v_period_label text := '';
  v_first_start date;
  v_last_end date;
  v_due date;
  r record;
  c jsonb;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT society_id INTO v_society FROM public.flats WHERE id = _flat_id;
  IF v_society IS NULL THEN RAISE EXCEPTION 'Flat not found'; END IF;
  IF NOT (public.is_society_admin_for(v_caller, v_society) OR public.is_super_admin(v_caller)) THEN
    RAISE EXCEPTION 'Not authorized'; END IF;
  IF (COALESCE(array_length(_period_ids,1),0) = 0) AND (jsonb_array_length(COALESCE(_additional,'[]'::jsonb)) = 0) THEN
    RAISE EXCEPTION 'Add at least one maintenance period or additional charge';
  END IF;

  -- Validate periods belong to this flat & are unbilled
  FOR r IN SELECT * FROM public.maintenance_periods
           WHERE id = ANY(COALESCE(_period_ids, ARRAY[]::uuid[])) LOOP
    IF r.flat_id <> _flat_id THEN RAISE EXCEPTION 'Period flat mismatch'; END IF;
    IF r.status = 'paid' THEN RAISE EXCEPTION 'Period already paid'; END IF;
    IF r.bill_id IS NOT NULL THEN RAISE EXCEPTION 'Period already on bill %', r.bill_id; END IF;
    v_total := v_total + r.amount_due;
    IF v_first_start IS NULL OR r.period_start < v_first_start THEN v_first_start := r.period_start; END IF;
    IF v_last_end IS NULL OR r.period_end > v_last_end THEN v_last_end := r.period_end; END IF;
    IF v_period_label = '' THEN v_period_label := r.period_label;
    ELSE v_period_label := v_period_label || ', ' || r.period_label; END IF;
  END LOOP;

  FOR c IN SELECT * FROM jsonb_array_elements(COALESCE(_additional,'[]'::jsonb)) LOOP
    v_total := v_total + COALESCE((c->>'amount')::numeric, 0);
  END LOOP;

  IF v_first_start IS NULL THEN
    v_first_start := date_trunc('month', CURRENT_DATE)::date;
    v_last_end := (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date;
    v_period_label := COALESCE(NULLIF(v_period_label,''), to_char(CURRENT_DATE,'FMMonth YYYY'));
  END IF;
  v_due := COALESCE(_due_date, CURRENT_DATE + 10);

  -- Bill number: per-society incremental
  SELECT COALESCE(MAX( NULLIF(regexp_replace(bill_number,'\D','','g'),'')::int ),0)+1
    INTO v_seq FROM public.bills WHERE society_id = v_society;
  v_bill_no := 'B-' || lpad(v_seq::text, 5, '0');

  INSERT INTO public.bills
    (society_id, flat_id, period_label, period_start, period_end, amount, due_date,
     status, bill_number, bill_date, notes)
  VALUES (v_society, _flat_id, v_period_label, v_first_start, v_last_end, v_total, v_due,
          'unpaid', v_bill_no, CURRENT_DATE, _notes)
  RETURNING id INTO v_bill_id;

  -- Line items + link maintenance periods
  FOR r IN SELECT * FROM public.maintenance_periods
           WHERE id = ANY(COALESCE(_period_ids, ARRAY[]::uuid[])) LOOP
    INSERT INTO public.bill_line_items (bill_id, society_id, kind, description, amount, maintenance_period_id)
    VALUES (v_bill_id, v_society, 'maintenance', 'Maintenance — ' || r.period_label, r.amount_due, r.id);
    UPDATE public.maintenance_periods SET bill_id = v_bill_id, updated_at = now() WHERE id = r.id;
  END LOOP;

  FOR c IN SELECT * FROM jsonb_array_elements(COALESCE(_additional,'[]'::jsonb)) LOOP
    INSERT INTO public.bill_line_items (bill_id, society_id, kind, description, amount)
    VALUES (v_bill_id, v_society, 'additional',
            COALESCE(c->>'description','Additional charge'),
            COALESCE((c->>'amount')::numeric,0));
  END LOOP;

  RETURN v_bill_id;
END $$;

-- 7. RPC: cancel_bill
CREATE OR REPLACE FUNCTION public.cancel_bill(_bill_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_society uuid;
  v_status text;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT society_id, status INTO v_society, v_status FROM public.bills WHERE id = _bill_id;
  IF v_society IS NULL THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF NOT (public.is_society_admin_for(v_caller, v_society) OR public.is_super_admin(v_caller)) THEN
    RAISE EXCEPTION 'Not authorized'; END IF;
  IF v_status = 'paid' THEN RAISE EXCEPTION 'Paid bills cannot be cancelled'; END IF;
  IF NULLIF(trim(COALESCE(_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Cancellation reason required'; END IF;

  -- Release periods back to pending
  UPDATE public.maintenance_periods
     SET bill_id = NULL, status = 'pending', updated_at = now()
   WHERE bill_id = _bill_id;

  UPDATE public.bills
     SET status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = v_caller,
         cancel_reason = trim(_reason),
         updated_at = now()
   WHERE id = _bill_id;
END $$;

-- 8. Trigger: on successful payment, mark linked maintenance periods paid
CREATE OR REPLACE FUNCTION public.mark_maintenance_paid_on_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'success' AND NEW.bill_id IS NOT NULL THEN
    UPDATE public.maintenance_periods mp
       SET status = 'paid', paid_at = COALESCE(NEW.paid_at, now()), updated_at = now()
     WHERE mp.bill_id = NEW.bill_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payments_mark_maintenance ON public.payments;
CREATE TRIGGER trg_payments_mark_maintenance
  AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.mark_maintenance_paid_on_payment();

REVOKE EXECUTE ON FUNCTION public.enforce_bill_immutability() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_maintenance_paid_on_payment() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_maintenance_period(uuid,date,numeric,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_flat_bill(uuid,uuid[],jsonb,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_bill(uuid,text) TO authenticated;
