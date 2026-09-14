DO $$
BEGIN
  IF to_regclass('public.bills') IS NULL THEN
    CREATE TABLE public.bills (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      society_id uuid NOT NULL,
      flat_id uuid NOT NULL,
      period_label text NOT NULL,
      period_start date NOT NULL,
      period_end date NOT NULL,
      amount numeric(12,2) NOT NULL CHECK (amount >= 0),
      due_date date NOT NULL,
      status text NOT NULL DEFAULT 'unpaid',
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    GRANT SELECT, INSERT, UPDATE, DELETE ON public.bills TO authenticated;
    GRANT ALL ON public.bills TO service_role;

    CREATE INDEX idx_bills_society ON public.bills(society_id);
    CREATE INDEX idx_bills_flat ON public.bills(flat_id);
    CREATE INDEX idx_bills_status ON public.bills(status);

    ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "society admins manage bills in their society"
    ON public.bills FOR ALL TO authenticated
    USING (society_id IN (
      SELECT society_id FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'society_admin'
    ))
    WITH CHECK (society_id IN (
      SELECT society_id FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'society_admin'
    ));

    CREATE POLICY "super admins full access to bills"
    ON public.bills FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'super_admin'))
    WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

    CREATE POLICY "residents view bills for their flats"
    ON public.bills FOR SELECT TO authenticated
    USING (flat_id IN (
      SELECT flat_id FROM public.flat_residents WHERE user_id = auth.uid()
    ));

    CREATE TRIGGER trg_bills_updated_at
    BEFORE UPDATE ON public.bills
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.payments') IS NULL THEN
    CREATE TABLE public.payments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bill_id uuid NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
      society_id uuid NOT NULL,
      flat_id uuid NOT NULL,
      user_id uuid,
      amount numeric(12,2) NOT NULL CHECK (amount > 0),
      method text NOT NULL DEFAULT 'manual',
      status text NOT NULL DEFAULT 'success',
      reference_no text,
      paid_at timestamptz NOT NULL DEFAULT now(),
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
    GRANT ALL ON public.payments TO service_role;

    CREATE INDEX idx_payments_bill ON public.payments(bill_id);
    CREATE INDEX idx_payments_society ON public.payments(society_id);
    CREATE INDEX idx_payments_flat ON public.payments(flat_id);

    ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "society admins manage payments in their society"
    ON public.payments FOR ALL TO authenticated
    USING (society_id IN (
      SELECT society_id FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'society_admin'
    ))
    WITH CHECK (society_id IN (
      SELECT society_id FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'society_admin'
    ));

    CREATE POLICY "super admins full access to payments"
    ON public.payments FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'super_admin'))
    WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

    CREATE POLICY "residents view payments for their flats"
    ON public.payments FOR SELECT TO authenticated
    USING (flat_id IN (
      SELECT flat_id FROM public.flat_residents WHERE user_id = auth.uid()
    ));

    CREATE POLICY "residents create their own payments"
    ON public.payments FOR INSERT TO authenticated
    WITH CHECK (
      user_id = auth.uid()
      AND flat_id IN (
        SELECT flat_id FROM public.flat_residents WHERE user_id = auth.uid()
      )
    );

    CREATE TRIGGER trg_payments_updated_at
    BEFORE UPDATE ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END
$$;