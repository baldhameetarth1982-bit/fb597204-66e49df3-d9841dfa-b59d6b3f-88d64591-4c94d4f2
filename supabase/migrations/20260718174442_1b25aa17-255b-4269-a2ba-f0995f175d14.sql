
-- ============ Stage 3B: extend bills ============
ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS cycle_config_id uuid REFERENCES public.billing_cycle_configs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.billing_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS current_charges numeric(14,2),
  ADD COLUMN IF NOT EXISTS previous_balance numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS penalties numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjustments numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_payable numeric(14,2),
  ADD COLUMN IF NOT EXISTS generated_by uuid,
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS generation_batch_id uuid,
  ADD COLUMN IF NOT EXISTS calc_snapshot jsonb;

-- ============ bill_generation_batches ============
CREATE TABLE IF NOT EXISTS public.bill_generation_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  cycle_config_id uuid NOT NULL REFERENCES public.billing_cycle_configs(id) ON DELETE RESTRICT,
  template_id uuid NOT NULL REFERENCES public.billing_templates(id) ON DELETE RESTRICT,
  request_id text NOT NULL,
  status text NOT NULL DEFAULT 'finalized',
  bills_created int NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (society_id, cycle_config_id, request_id)
);
GRANT SELECT ON public.bill_generation_batches TO authenticated;
GRANT ALL ON public.bill_generation_batches TO service_role;
ALTER TABLE public.bill_generation_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "batches_admin_read" ON public.bill_generation_batches
  FOR SELECT TO authenticated
  USING (public.current_user_has_society_permission(society_id, 'billing.manage'::text, NULL::uuid));

-- FK for bills.generation_batch_id
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bills_generation_batch_id_fkey'
  ) THEN
    ALTER TABLE public.bills
      ADD CONSTRAINT bills_generation_batch_id_fkey
      FOREIGN KEY (generation_batch_id) REFERENCES public.bill_generation_batches(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============ bill_number_sequences ============
CREATE TABLE IF NOT EXISTS public.bill_number_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  period_yyyymm text NOT NULL,
  prefix text NOT NULL DEFAULT 'RR',
  last_number int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (society_id, period_yyyymm, prefix)
);
GRANT SELECT ON public.bill_number_sequences TO authenticated;
GRANT ALL ON public.bill_number_sequences TO service_role;
ALTER TABLE public.bill_number_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bill_number_sequences_admin_read" ON public.bill_number_sequences
  FOR SELECT TO authenticated
  USING (public.current_user_has_society_permission(society_id, 'billing.manage'::text, NULL::uuid));

-- Unique index guaranteeing no duplicate bill numbers per society (non-null only)
CREATE UNIQUE INDEX IF NOT EXISTS bills_society_bill_number_unique
  ON public.bills (society_id, bill_number) WHERE bill_number IS NOT NULL;

-- ============ Bill numbering allocator ============
CREATE OR REPLACE FUNCTION public._allocate_bill_number(
  _society_id uuid,
  _period_start date,
  _prefix text DEFAULT 'RR'
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _yyyymm text := to_char(_period_start, 'YYYYMM');
  _prefix_safe text := COALESCE(NULLIF(btrim(_prefix), ''), 'RR');
  _next int;
BEGIN
  INSERT INTO public.bill_number_sequences (society_id, period_yyyymm, prefix, last_number)
    VALUES (_society_id, _yyyymm, _prefix_safe, 1)
  ON CONFLICT (society_id, period_yyyymm, prefix)
    DO UPDATE SET last_number = public.bill_number_sequences.last_number + 1,
                  updated_at = now()
  RETURNING last_number INTO _next;
  RETURN _prefix_safe || '/' || _yyyymm || '/' || lpad(_next::text, 4, '0');
END $$;
REVOKE ALL ON FUNCTION public._allocate_bill_number(uuid, date, text) FROM PUBLIC, anon, authenticated;

-- ============ preview_bill_batch RPC ============
CREATE OR REPLACE FUNCTION public.preview_bill_batch(
  _society_id uuid,
  _cycle_config_id uuid,
  _limit int DEFAULT 50,
  _offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  _cycle record;
  _preview jsonb;
  _prev_dues numeric(14,2) := 0;
  _existing_count int := 0;
  _warnings jsonb := '[]'::jsonb;
BEGIN
  PERFORM public._billing_require_admin(_society_id);

  SELECT c.*, t.status AS template_status
    INTO _cycle
    FROM public.billing_cycle_configs c
    JOIN public.billing_templates t ON t.id = c.template_id
    WHERE c.id = _cycle_config_id AND c.society_id = _society_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'cycle_not_found'; END IF;
  IF _cycle.status <> 'ready' THEN _warnings := _warnings || jsonb_build_array('cycle_not_ready'); END IF;
  IF _cycle.template_status <> 'active' THEN _warnings := _warnings || jsonb_build_array('template_not_active'); END IF;

  _preview := public.preview_billing_template(_society_id, _cycle.template_id, _limit, _offset);

  SELECT COALESCE(SUM(GREATEST(COALESCE(b.total_payable, b.amount, 0) - COALESCE(
      (SELECT SUM(p.amount) FROM public.payments p WHERE p.bill_id = b.id AND p.status='verified'), 0), 0)), 0)
    INTO _prev_dues
    FROM public.bills b
    WHERE b.society_id = _society_id
      AND b.status IN ('unpaid','partially_paid','overdue')
      AND (b.cancelled_at IS NULL)
      AND b.due_date < _cycle.period_start;

  SELECT count(*) INTO _existing_count FROM public.bills
    WHERE society_id = _society_id AND cycle_config_id = _cycle_config_id AND cancelled_at IS NULL;
  IF _existing_count > 0 THEN
    _warnings := _warnings || jsonb_build_array('duplicate_existing_bills');
  END IF;

  RETURN jsonb_build_object(
    'preview_only', true,
    'cycle', jsonb_build_object(
      'id', _cycle.id, 'name', _cycle.cycle_name,
      'period_start', _cycle.period_start, 'period_end', _cycle.period_end,
      'due_date', _cycle.due_date, 'status', _cycle.status,
      'template_id', _cycle.template_id, 'template_status', _cycle.template_status
    ),
    'template_preview', _preview,
    'previous_dues_total', _prev_dues,
    'existing_bill_count', _existing_count,
    'warnings', _warnings
  );
END $$;
REVOKE ALL ON FUNCTION public.preview_bill_batch(uuid, uuid, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_bill_batch(uuid, uuid, int, int) TO authenticated;

-- ============ finalize_bill_batch RPC ============
CREATE OR REPLACE FUNCTION public.finalize_bill_batch(
  _society_id uuid,
  _cycle_config_id uuid,
  _request_id text,
  _prefix text DEFAULT 'RR'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cycle record;
  _template record;
  _existing record;
  _batch_id uuid;
  _flat record;
  _line record;
  _unit_total numeric(14,2);
  _line_amount numeric(14,2);
  _prev_bal numeric(14,2);
  _penalty numeric(14,2) := 0;
  _adjust numeric(14,2) := 0;
  _bill_id uuid;
  _num text;
  _created int := 0;
  _total numeric(14,2) := 0;
BEGIN
  PERFORM public._billing_require_admin(_society_id);
  IF _request_id IS NULL OR btrim(_request_id) = '' THEN RAISE EXCEPTION 'invalid_request_id'; END IF;

  SELECT * INTO _existing FROM public.bill_generation_batches
    WHERE society_id=_society_id AND cycle_config_id=_cycle_config_id AND request_id=_request_id;
  IF FOUND THEN
    RETURN jsonb_build_object('idempotent_replay', true, 'batch_id', _existing.id,
      'bills_created', _existing.bills_created, 'total_amount', _existing.total_amount);
  END IF;

  SELECT * INTO _cycle FROM public.billing_cycle_configs
    WHERE id=_cycle_config_id AND society_id=_society_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'cycle_not_found'; END IF;
  IF _cycle.status <> 'ready' THEN RAISE EXCEPTION 'cycle_not_ready'; END IF;

  SELECT * INTO _template FROM public.billing_templates
    WHERE id=_cycle.template_id AND society_id=_society_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'template_not_found'; END IF;
  IF _template.status <> 'active' THEN RAISE EXCEPTION 'template_not_active'; END IF;

  -- Prevent duplicate bills for this cycle
  IF EXISTS (SELECT 1 FROM public.bills WHERE society_id=_society_id AND cycle_config_id=_cycle_config_id AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'duplicate_bills_for_cycle';
  END IF;

  INSERT INTO public.bill_generation_batches
    (society_id, cycle_config_id, template_id, request_id, status, created_by)
    VALUES (_society_id, _cycle_config_id, _template.id, _request_id, 'in_progress', auth.uid())
    RETURNING id INTO _batch_id;

  FOR _flat IN
    SELECT f.id, f.flat_number, f.area_sqft,
           COALESCE(NULLIF(btrim(f.unit_type),''), NULLIF(btrim(f.type),''), '') AS unit_type
    FROM public.flats f
    WHERE f.society_id = _society_id AND f.is_active = true
  LOOP
    _unit_total := 0;

    -- Compute line breakdown for this flat
    FOR _line IN
      SELECT l.*, h.name AS charge_head_name
      FROM public.billing_template_lines l
      JOIN public.billing_charge_heads h ON h.id = l.charge_head_id
      WHERE l.template_id = _template.id AND l.active = true
      ORDER BY l.sort_order
    LOOP
      _line_amount := 0;
      IF _line.rule_type = 'fixed_per_unit' THEN
        _line_amount := COALESCE(_line.amount, 0);
      ELSIF _line.rule_type = 'unit_type_amount' THEN
        IF COALESCE(_line.unit_type,'') = _flat.unit_type THEN
          _line_amount := COALESCE(_line.amount, 0);
        END IF;
      ELSIF _line.rule_type = 'area_based' THEN
        IF _flat.area_sqft IS NOT NULL AND _flat.area_sqft > 0 AND _line.rate_per_area IS NOT NULL THEN
          _line_amount := round((_flat.area_sqft * _line.rate_per_area)::numeric, 2);
        END IF;
      END IF;
      _unit_total := _unit_total + _line_amount;
    END LOOP;

    -- Previous balance for this flat: unpaid finalized bills with due_date before this cycle
    SELECT COALESCE(SUM(GREATEST(COALESCE(b.total_payable, b.amount, 0) -
        COALESCE((SELECT SUM(p.amount) FROM public.payments p WHERE p.bill_id=b.id AND p.status='verified'), 0), 0)), 0)
      INTO _prev_bal
      FROM public.bills b
      WHERE b.society_id=_society_id AND b.flat_id=_flat.id
        AND b.status IN ('unpaid','partially_paid','overdue')
        AND b.cancelled_at IS NULL
        AND b.due_date < _cycle.period_start;

    _num := public._allocate_bill_number(_society_id, _cycle.period_start, _prefix);

    INSERT INTO public.bills
      (society_id, flat_id, cycle_config_id, template_id, period_label,
       period_start, period_end, amount, due_date, status, bill_number, bill_date,
       current_charges, previous_balance, penalties, adjustments, tax_amount, total_payable,
       generated_by, finalized_at, generation_batch_id, calc_snapshot)
    VALUES (_society_id, _flat.id, _cycle_config_id, _template.id, _cycle.cycle_name,
       _cycle.period_start, _cycle.period_end,
       (_unit_total + _prev_bal + _penalty + _adjust),
       _cycle.due_date, 'unpaid', _num, CURRENT_DATE,
       _unit_total, _prev_bal, _penalty, _adjust, 0,
       (_unit_total + _prev_bal + _penalty + _adjust),
       auth.uid(), now(), _batch_id,
       jsonb_build_object('template_id', _template.id, 'cycle_id', _cycle_config_id))
    RETURNING id INTO _bill_id;

    -- Line items
    INSERT INTO public.bill_line_items (bill_id, society_id, kind, description, amount)
    SELECT _bill_id, _society_id, l.rule_type, h.name,
      CASE l.rule_type
        WHEN 'fixed_per_unit' THEN COALESCE(l.amount, 0)
        WHEN 'unit_type_amount' THEN CASE WHEN COALESCE(l.unit_type,'')=_flat.unit_type THEN COALESCE(l.amount,0) ELSE 0 END
        WHEN 'area_based' THEN CASE WHEN _flat.area_sqft IS NOT NULL AND _flat.area_sqft>0 AND l.rate_per_area IS NOT NULL
          THEN round((_flat.area_sqft * l.rate_per_area)::numeric, 2) ELSE 0 END
        ELSE 0 END
    FROM public.billing_template_lines l
    JOIN public.billing_charge_heads h ON h.id = l.charge_head_id
    WHERE l.template_id = _template.id AND l.active = true;

    _created := _created + 1;
    _total := _total + (_unit_total + _prev_bal + _penalty + _adjust);
  END LOOP;

  UPDATE public.bill_generation_batches
    SET status='finalized', bills_created=_created, total_amount=_total, finalized_at=now()
    WHERE id=_batch_id;

  RETURN jsonb_build_object(
    'idempotent_replay', false,
    'batch_id', _batch_id,
    'bills_created', _created,
    'total_amount', _total
  );
END $$;
REVOKE ALL ON FUNCTION public.finalize_bill_batch(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_bill_batch(uuid, uuid, text, text) TO authenticated;

-- ============ cancel_bill RPC ============
CREATE OR REPLACE FUNCTION public.cancel_bill(
  _society_id uuid,
  _bill_id uuid,
  _reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _bill record;
  _paid numeric(14,2);
BEGIN
  PERFORM public._billing_require_admin(_society_id);
  SELECT * INTO _bill FROM public.bills WHERE id=_bill_id AND society_id=_society_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'bill_not_found'; END IF;
  IF _bill.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'already_cancelled'; END IF;

  SELECT COALESCE(SUM(amount),0) INTO _paid FROM public.payments WHERE bill_id=_bill_id AND status='verified';
  IF _paid > 0 THEN RAISE EXCEPTION 'bill_has_payments'; END IF;

  UPDATE public.bills
     SET cancelled_at = now(), cancelled_by = auth.uid(),
         cancel_reason = COALESCE(NULLIF(btrim(_reason),''), 'cancelled'),
         status = 'cancelled', updated_at = now()
   WHERE id = _bill_id;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.cancel_bill(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_bill(uuid, uuid, text) TO authenticated;
