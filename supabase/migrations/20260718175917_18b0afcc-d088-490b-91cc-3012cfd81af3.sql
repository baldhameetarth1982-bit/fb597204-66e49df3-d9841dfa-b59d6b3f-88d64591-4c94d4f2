
-- Stage 3B closure: audit logging in finalize/cancel and richer preview totals

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
  _unit_count int := 0;
  _current_charges_total numeric(14,2) := 0;
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

  -- Derive server-authoritative totals from the template preview payload
  SELECT COALESCE(SUM((u->>'unit_total')::numeric), 0), COALESCE(COUNT(u), 0)
    INTO _current_charges_total, _unit_count
  FROM jsonb_array_elements(COALESCE(_preview->'units', '[]'::jsonb)) AS u;

  IF _unit_count = 0 THEN
    _warnings := _warnings || jsonb_build_array('no_active_units');
  END IF;

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
    'unit_count', _unit_count,
    'current_charges_total', _current_charges_total,
    'previous_dues_total', _prev_dues,
    'total_payable', (_current_charges_total + _prev_dues),
    'existing_bill_count', _existing_count,
    'warnings', _warnings
  );
END $$;
REVOKE ALL ON FUNCTION public.preview_bill_batch(uuid, uuid, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_bill_batch(uuid, uuid, int, int) TO authenticated;

-- finalize_bill_batch with audit_log insert
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

  -- Audit log
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'billing.batch_finalized', 'bill_generation_batches', _batch_id::text, _society_id,
    jsonb_build_object('cycle_config_id', _cycle_config_id, 'bills_created', _created, 'total_amount', _total, 'request_id', _request_id));

  RETURN jsonb_build_object(
    'idempotent_replay', false,
    'batch_id', _batch_id,
    'bills_created', _created,
    'total_amount', _total
  );
END $$;
REVOKE ALL ON FUNCTION public.finalize_bill_batch(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_bill_batch(uuid, uuid, text, text) TO authenticated;

-- cancel_bill with audit_log
CREATE OR REPLACE FUNCTION public.cancel_bill(
  _society_id uuid,
  _bill_id uuid,
  _reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _bill record;
  _paid numeric(14,2);
  _clean_reason text;
BEGIN
  PERFORM public._billing_require_admin(_society_id);
  SELECT * INTO _bill FROM public.bills WHERE id=_bill_id AND society_id=_society_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'bill_not_found'; END IF;
  IF _bill.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'already_cancelled'; END IF;

  SELECT COALESCE(SUM(amount),0) INTO _paid FROM public.payments WHERE bill_id=_bill_id AND status='verified';
  IF _paid > 0 THEN RAISE EXCEPTION 'bill_has_payments'; END IF;

  _clean_reason := COALESCE(NULLIF(btrim(_reason),''), 'cancelled');
  UPDATE public.bills
     SET cancelled_at = now(), cancelled_by = auth.uid(),
         cancel_reason = _clean_reason,
         status = 'cancelled', updated_at = now()
   WHERE id = _bill_id;

  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'billing.bill_cancelled', 'bills', _bill_id::text, _society_id,
    jsonb_build_object('reason', _clean_reason, 'bill_number', _bill.bill_number));

  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.cancel_bill(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_bill(uuid, uuid, text) TO authenticated;
