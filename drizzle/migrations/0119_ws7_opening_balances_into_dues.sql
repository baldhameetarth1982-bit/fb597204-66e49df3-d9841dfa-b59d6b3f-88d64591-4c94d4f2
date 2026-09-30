ALTER TABLE public.opening_balances ADD COLUMN IF NOT EXISTS carried_bill_id uuid REFERENCES public.bills(id);

CREATE OR REPLACE FUNCTION public._opening_balances_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'opening_balance_append_only'; END IF;
  IF NEW.amount <> OLD.amount OR NEW.flat_id <> OLD.flat_id OR NEW.society_id <> OLD.society_id
     OR NEW.as_of <> OLD.as_of OR NEW.created_by <> OLD.created_by OR NEW.request_id <> OLD.request_id
     OR NEW.source_ref IS DISTINCT FROM OLD.source_ref THEN
    RAISE EXCEPTION 'opening_balance_immutable';
  END IF;
  IF OLD.status = 'imported_unverified' AND NEW.carried_bill_id IS NULL THEN RETURN NEW; END IF;
  -- Only allowed later change: a confirmed balance is carried once onto a bill.
  IF OLD.status = 'confirmed' AND NEW.status = 'confirmed' AND OLD.carried_bill_id IS NULL AND NEW.carried_bill_id IS NOT NULL
     AND NEW.reviewed_by IS NOT DISTINCT FROM OLD.reviewed_by AND NEW.reviewed_at IS NOT DISTINCT FROM OLD.reviewed_at
     AND NEW.review_note IS NOT DISTINCT FROM OLD.review_note THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'opening_balance_immutable';
END $$;

CREATE OR REPLACE FUNCTION public._bill_run_rows(_society_id uuid, _cycle_config_id uuid)
RETURNS TABLE (flat_id uuid, flat_number text, unit_type text, area_sqft numeric,
  current_charges numeric, previous_balance numeric, overdue_balance numeric,
  late_fee numeric, total numeric, problems text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cycle record; _s record; _f record; _l record;
  _amt numeric(14,2); _has_area boolean; _has_type boolean; _type_hit boolean;
  _probs text[];
BEGIN
  SELECT * INTO _cycle FROM billing_cycle_configs WHERE id = _cycle_config_id AND society_id = _society_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'cycle_not_found'; END IF;
  SELECT coalesce(late_fee_enabled,false) AS en, coalesce(late_fee_type,'flat') AS typ,
         coalesce(late_fee_amount,0)::numeric AS amt, coalesce(grace_days,0) AS grace
    INTO _s FROM society_settings WHERE society_id = _society_id;
  IF NOT FOUND THEN _s := ROW(false,'flat',0::numeric,0); END IF;
  SELECT bool_or(rule_type='area_based'), bool_or(rule_type='unit_type_amount')
    INTO _has_area, _has_type FROM billing_template_lines WHERE template_id = _cycle.template_id AND active;

  FOR _f IN
    SELECT fl.id, fl.flat_number, fl.area_sqft,
           coalesce(nullif(btrim(fl.unit_type),''), nullif(btrim(fl.type),''), '') AS ut
      FROM flats fl WHERE fl.society_id = _society_id AND fl.is_active = true ORDER BY fl.flat_number, fl.id
  LOOP
    _probs := '{}';
    current_charges := 0; _type_hit := false;
    FOR _l IN SELECT * FROM billing_template_lines WHERE template_id = _cycle.template_id AND active ORDER BY sort_order LOOP
      _amt := 0;
      IF _l.rule_type = 'fixed_per_unit' THEN _amt := coalesce(_l.amount,0);
      ELSIF _l.rule_type = 'unit_type_amount' THEN
        IF coalesce(_l.unit_type,'') = _f.ut THEN _amt := coalesce(_l.amount,0); _type_hit := true; END IF;
      ELSIF _l.rule_type = 'area_based' THEN
        IF _f.area_sqft IS NOT NULL AND _f.area_sqft > 0 AND _l.rate_per_area IS NOT NULL THEN
          _amt := round((_f.area_sqft * _l.rate_per_area)::numeric, 2);
        END IF;
      END IF;
      current_charges := current_charges + _amt;
    END LOOP;

    SELECT coalesce(sum(greatest(coalesce(b.total_payable,b.amount,0) + coalesce((SELECT sum(a.amount) FROM bill_adjustments a WHERE a.bill_id=b.id),0) -
        coalesce((SELECT sum(p.amount) FROM payments p WHERE p.bill_id=b.id AND p.status='verified'),0), 0)),0),
      coalesce(sum(greatest(coalesce(b.total_payable,b.amount,0) + coalesce((SELECT sum(a.amount) FROM bill_adjustments a WHERE a.bill_id=b.id),0) -
        coalesce((SELECT sum(p.amount) FROM payments p WHERE p.bill_id=b.id AND p.status='verified'),0), 0))
        FILTER (WHERE b.due_date + _s.grace < _cycle.period_start),0)
      INTO previous_balance, overdue_balance
      FROM bills b
     WHERE b.society_id=_society_id AND b.flat_id=_f.id AND b.status IN ('unpaid','partially_paid','overdue')
       AND b.cancelled_at IS NULL AND b.due_date < _cycle.period_start;

    -- Committee-confirmed opening balances not yet carried: added once as previous dues (never late-fee basis).
    previous_balance := previous_balance + coalesce((SELECT sum(ob.amount) FROM opening_balances ob
      WHERE ob.society_id=_society_id AND ob.flat_id=_f.id AND ob.status='confirmed' AND ob.carried_bill_id IS NULL),0);

    late_fee := 0;
    IF _s.en AND overdue_balance > 0 AND _s.amt > 0 THEN
      IF _s.typ = 'percent' THEN late_fee := round(overdue_balance * least(_s.amt,100) / 100, 2);
      ELSE late_fee := least(_s.amt, 100000); END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM flat_residents fr WHERE fr.flat_id=_f.id AND fr.is_active) THEN _probs := _probs || 'no_occupant'; END IF;
    IF current_charges = 0 THEN _probs := _probs || 'zero_charges'; END IF;
    IF coalesce(_has_area,false) AND (_f.area_sqft IS NULL OR _f.area_sqft <= 0) THEN _probs := _probs || 'missing_area'; END IF;
    IF coalesce(_has_type,false) AND NOT _type_hit THEN _probs := _probs || 'no_unit_type_rule'; END IF;

    flat_id := _f.id; flat_number := _f.flat_number; unit_type := _f.ut; area_sqft := _f.area_sqft;
    total := current_charges + previous_balance + late_fee; problems := _probs;
    RETURN NEXT;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public._bill_run_rows(uuid, uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.finalize_bill_batch(_society_id uuid, _cycle_config_id uuid, _request_id text, _prefix text DEFAULT 'RR'::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _cycle record; _template record; _existing record; _batch_id uuid; _r record;
  _bill_id uuid; _num text; _created int := 0; _total numeric(14,2) := 0;
  _appr record; _need_appr boolean; _late_total numeric(14,2) := 0;
BEGIN
  PERFORM public._billing_require_admin(_society_id);
  IF _request_id IS NULL OR btrim(_request_id) = '' THEN RAISE EXCEPTION 'invalid_request_id'; END IF;

  SELECT * INTO _existing FROM public.bill_generation_batches
    WHERE society_id=_society_id AND cycle_config_id=_cycle_config_id AND request_id=_request_id;
  IF FOUND THEN
    RETURN jsonb_build_object('idempotent_replay', true, 'batch_id', _existing.id,
      'bills_created', _existing.bills_created, 'total_amount', _existing.total_amount);
  END IF;

  SELECT * INTO _cycle FROM public.billing_cycle_configs WHERE id=_cycle_config_id AND society_id=_society_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'cycle_not_found'; END IF;
  IF _cycle.status <> 'ready' THEN RAISE EXCEPTION 'cycle_not_ready'; END IF;
  SELECT * INTO _template FROM public.billing_templates WHERE id=_cycle.template_id AND society_id=_society_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'template_not_found'; END IF;
  IF _template.status <> 'active' THEN RAISE EXCEPTION 'template_not_active'; END IF;
  IF EXISTS (SELECT 1 FROM public.bills WHERE society_id=_society_id AND cycle_config_id=_cycle_config_id AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'duplicate_bills_for_cycle';
  END IF;

  SELECT coalesce(bill_run_approval_required,false) INTO _need_appr FROM society_settings WHERE society_id=_society_id;
  IF coalesce(_need_appr,false) THEN
    SELECT * INTO _appr FROM bill_run_approvals
      WHERE society_id=_society_id AND cycle_config_id=_cycle_config_id AND status='approved' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'approval_required'; END IF;
    IF public._bill_run_fingerprint(_society_id, _cycle_config_id) <> _appr.fingerprint THEN
      UPDATE bill_run_approvals SET status='superseded' WHERE id=_appr.id;
      RAISE EXCEPTION 'run_changed_since_approval';
    END IF;
  END IF;

  -- Freeze opening-balance reviews for this society while the run is built.
  PERFORM 1 FROM opening_balances WHERE society_id=_society_id AND status IN ('imported_unverified','confirmed') AND carried_bill_id IS NULL FOR UPDATE;

  INSERT INTO public.bill_generation_batches (society_id, cycle_config_id, template_id, request_id, status, created_by, approval_id)
    VALUES (_society_id, _cycle_config_id, _template.id, _request_id, 'in_progress', auth.uid(), _appr.id)
    RETURNING id INTO _batch_id;

  FOR _r IN SELECT * FROM public._bill_run_rows(_society_id, _cycle_config_id) LOOP
    _num := public._allocate_bill_number(_society_id, _cycle.period_start, _prefix);
    INSERT INTO public.bills
      (society_id, flat_id, cycle_config_id, template_id, period_label, period_start, period_end, amount, due_date,
       status, bill_number, bill_date, current_charges, previous_balance, penalties, adjustments, tax_amount, total_payable,
       generated_by, finalized_at, generation_batch_id, calc_snapshot)
    VALUES (_society_id, _r.flat_id, _cycle_config_id, _template.id, _cycle.cycle_name, _cycle.period_start, _cycle.period_end,
       _r.total, _cycle.due_date, 'unpaid', _num, CURRENT_DATE, _r.current_charges, _r.previous_balance, _r.late_fee, 0, 0, _r.total,
       auth.uid(), now(), _batch_id,
       jsonb_build_object('template_id', _template.id, 'cycle_id', _cycle_config_id,
         'late_fee', _r.late_fee, 'late_fee_overdue_basis', _r.overdue_balance, 'approval_id', _appr.id))
    RETURNING id INTO _bill_id;

    INSERT INTO public.bill_line_items (bill_id, society_id, kind, description, amount)
    SELECT _bill_id, _society_id, l.rule_type, h.name,
      CASE l.rule_type
        WHEN 'fixed_per_unit' THEN coalesce(l.amount, 0)
        WHEN 'unit_type_amount' THEN CASE WHEN coalesce(l.unit_type,'')=_r.unit_type THEN coalesce(l.amount,0) ELSE 0 END
        WHEN 'area_based' THEN CASE WHEN _r.area_sqft IS NOT NULL AND _r.area_sqft>0 AND l.rate_per_area IS NOT NULL
          THEN round((_r.area_sqft * l.rate_per_area)::numeric, 2) ELSE 0 END
        ELSE 0 END
    FROM public.billing_template_lines l JOIN public.billing_charge_heads h ON h.id = l.charge_head_id
    WHERE l.template_id = _template.id AND l.active = true;

    UPDATE opening_balances SET carried_bill_id=_bill_id
      WHERE society_id=_society_id AND flat_id=_r.flat_id AND status='confirmed' AND carried_bill_id IS NULL;

    IF _r.late_fee > 0 THEN
      INSERT INTO public.bill_line_items (bill_id, society_id, kind, description, amount)
        VALUES (_bill_id, _society_id, 'additional', 'Late fee on overdue dues', _r.late_fee);
      _late_total := _late_total + _r.late_fee;
    END IF;
    _created := _created + 1;
    _total := _total + _r.total;
  END LOOP;

  UPDATE public.bill_generation_batches SET status='finalized', bills_created=_created, total_amount=_total, finalized_at=now()
    WHERE id=_batch_id;
  IF _appr.id IS NOT NULL THEN
    UPDATE bill_run_approvals SET status='consumed', consumed_batch_id=_batch_id WHERE id=_appr.id;
  END IF;

  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'billing.batch_finalized', 'bill_generation_batches', _batch_id::text, _society_id,
    jsonb_build_object('cycle_config_id', _cycle_config_id, 'bills_created', _created, 'total_amount', _total,
      'late_fee_total', _late_total, 'approval_id', _appr.id, 'request_id', _request_id));

  RETURN jsonb_build_object('idempotent_replay', false, 'batch_id', _batch_id, 'bills_created', _created, 'total_amount', _total);
END $function$;

CREATE OR REPLACE FUNCTION public.get_receivables_ageing(_society_id uuid, _as_of date DEFAULT CURRENT_DATE)
 RETURNS TABLE(bucket text, amount numeric, bill_count bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_visibility text;
BEGIN
  v_visibility := public.resolve_financial_visibility(_society_id);
  IF v_visibility <> 'admin' OR NOT public._finance_plan_enabled(_society_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF _as_of IS NULL OR _as_of > CURRENT_DATE THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
  WITH balances AS (
    SELECT b.due_date,
      GREATEST(0, COALESCE(b.total_payable, b.amount, 0)
        + COALESCE((SELECT sum(a.amount) FROM public.bill_adjustments a WHERE a.bill_id=b.id AND a.created_at::date <= _as_of),0)
        - COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.bill_id=b.id AND p.society_id=b.society_id AND p.status='verified' AND p.verified_at::date <= _as_of),0)
      ) AS outstanding
    FROM public.bills b
    WHERE b.society_id = _society_id AND b.cancelled_at IS NULL AND b.status NOT IN ('cancelled','draft')
      AND COALESCE(b.finalized_at::date, b.created_at::date) <= _as_of
    UNION ALL
    -- Committee-confirmed opening balances not yet carried onto a bill (unverified/rejected never count).
    SELECT ob.as_of, ob.amount FROM public.opening_balances ob
    WHERE ob.society_id = _society_id AND ob.status = 'confirmed' AND ob.reviewed_at::date <= _as_of
      AND (ob.carried_bill_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.bills cb WHERE cb.id = ob.carried_bill_id
           AND COALESCE(cb.finalized_at::date, cb.created_at::date) <= _as_of AND cb.cancelled_at IS NULL))
  ), bucketed AS (
    SELECT CASE WHEN due_date >= _as_of THEN 'current' WHEN _as_of - due_date <= 30 THEN '1_30'
      WHEN _as_of - due_date <= 60 THEN '31_60' WHEN _as_of - due_date <= 90 THEN '61_90' ELSE '90_plus' END AS bucket, outstanding
    FROM balances WHERE outstanding > 0
  )
  SELECT bb.bucket, sum(bb.outstanding), count(*) FROM bucketed bb GROUP BY bb.bucket;
END;
$function$;

CREATE OR REPLACE FUNCTION public.compute_no_dues_eligibility_internal(_society_id uuid, _flat_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_flat_ok boolean;
  v_blockers jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_pending_total numeric := 0;
  v_overdue_count int := 0;
  v_partial_count int := 0;
  v_unpaid_count int := 0;
  v_pending_count int := 0;
  v_unknown_count int := 0;
  v_inconsistent_count int := 0;
  v_ob_confirmed numeric := 0;
  v_ob_review int := 0;
  v_ob_blockers jsonb := '[]'::jsonb;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.flats f WHERE f.id = _flat_id AND f.society_id = _society_id
  ) INTO v_flat_ok;
  IF NOT v_flat_ok THEN
    RAISE EXCEPTION 'INVALID_FLAT_FOR_SOCIETY';
  END IF;

  WITH settled AS (
    SELECT
      p.bill_id,
      SUM(CASE WHEN p.status IN ('success','verified') THEN p.amount ELSE 0 END)::numeric AS paid,
      BOOL_OR(p.status NOT IN ('success','verified','pending','failed','rejected','cancelled','refunded','reversed'))
        AS has_unknown_status
    FROM public.payments p
    WHERE p.society_id = _society_id AND p.flat_id = _flat_id
    GROUP BY p.bill_id
  ),
  adj AS (
    SELECT a.bill_id, SUM(a.amount)::numeric AS amt FROM public.bill_adjustments a
    WHERE a.society_id = _society_id GROUP BY a.bill_id
  ),
  bill_calc AS (
    SELECT
      b.id AS bill_id, b.bill_number, b.due_date,
      GREATEST(0, COALESCE(b.total_payable, b.amount) + COALESCE(ad.amt, 0)) AS total_amount,
      COALESCE(s.paid, 0) AS paid_amount,
      GREATEST(0, COALESCE(b.total_payable, b.amount) + COALESCE(ad.amt, 0) - COALESCE(s.paid, 0))::numeric AS remaining_amount,
      (b.status = 'paid') AS marked_paid,
      COALESCE(s.has_unknown_status, false) AS has_unknown_status
    FROM public.bills b
    LEFT JOIN settled s ON s.bill_id = b.id
    LEFT JOIN adj ad ON ad.bill_id = b.id
    WHERE b.society_id = _society_id AND b.flat_id = _flat_id
      AND b.cancelled_at IS NULL AND b.status <> 'cancelled'
  ),
  classified AS (
    SELECT bill_id, bill_number, due_date, total_amount, paid_amount, remaining_amount,
      CASE
        WHEN marked_paid AND remaining_amount > 0 THEN 'financial_data_inconsistency'
        WHEN has_unknown_status AND remaining_amount > 0 THEN 'financial_data_inconsistency'
        WHEN remaining_amount > 0 THEN 'bill_due'
        ELSE NULL
      END AS primary_type,
      (remaining_amount > 0 AND due_date < CURRENT_DATE) AS is_overdue,
      (remaining_amount > 0 AND paid_amount > 0 AND remaining_amount < total_amount) AS is_partial,
      (remaining_amount > 0 AND paid_amount = 0) AS is_unpaid,
      (marked_paid AND remaining_amount > 0) AS is_inconsistent,
      (has_unknown_status AND remaining_amount > 0 AND NOT marked_paid) AS is_unknown_status
    FROM bill_calc
  ),
  bill_blockers AS (
    SELECT jsonb_build_object(
      'type', primary_type, 'bill_id', bill_id, 'bill_number', bill_number,
      'due_date', due_date, 'total_amount', total_amount, 'paid_amount', paid_amount,
      'remaining_amount', remaining_amount,
      'payment_state', CASE WHEN paid_amount > 0 AND remaining_amount > 0 THEN 'partial'
                             WHEN remaining_amount = total_amount THEN 'unpaid'
                             ELSE 'other' END,
      'overdue', is_overdue, 'inconsistent', is_inconsistent, 'unknown_status', is_unknown_status
    ) AS blocker,
    is_overdue, is_partial, is_unpaid, is_inconsistent, is_unknown_status, remaining_amount
    FROM classified WHERE primary_type IS NOT NULL
  ),
  pending_pay AS (
    SELECT id, method, amount, created_at,
      jsonb_build_object(
        'type', 'pending_offline_payment',
        'payment_id', id, 'method', method, 'amount', amount, 'created_at', created_at
      ) AS blocker
    FROM public.payments
    WHERE society_id = _society_id AND flat_id = _flat_id AND status = 'pending'
  )
  SELECT
    COALESCE((SELECT SUM(remaining_amount) FROM bill_blockers), 0),
    COALESCE((SELECT SUM(amount) FROM pending_pay), 0),
    COALESCE((SELECT COUNT(*) FROM bill_blockers WHERE is_overdue), 0),
    COALESCE((SELECT COUNT(*) FROM bill_blockers WHERE is_partial), 0),
    COALESCE((SELECT COUNT(*) FROM bill_blockers WHERE is_unpaid AND NOT is_overdue), 0),
    COALESCE((SELECT COUNT(*) FROM pending_pay), 0),
    COALESCE((SELECT COUNT(*) FROM bill_blockers WHERE is_unknown_status), 0),
    COALESCE((SELECT COUNT(*) FROM bill_blockers WHERE is_inconsistent), 0),
    COALESCE(
      (SELECT jsonb_agg(blocker) FROM bill_blockers)
      || COALESCE((SELECT jsonb_agg(blocker) FROM pending_pay), '[]'::jsonb),
      '[]'::jsonb
    )
  INTO v_total, v_pending_total, v_overdue_count, v_partial_count, v_unpaid_count,
       v_pending_count, v_unknown_count, v_inconsistent_count, v_blockers;

  -- Opening balances not yet on a bill: confirmed ones are payable; unverified ones add no amount but need review first.
  SELECT COALESCE(SUM(ob.amount) FILTER (WHERE ob.status='confirmed'),0),
         COUNT(*) FILTER (WHERE ob.status='imported_unverified'),
         COALESCE(jsonb_agg(jsonb_build_object(
           'type', CASE WHEN ob.status='confirmed' THEN 'opening_balance_due' ELSE 'opening_balance_under_review' END,
           'opening_balance_id', ob.id, 'as_of', ob.as_of,
           'remaining_amount', CASE WHEN ob.status='confirmed' THEN ob.amount ELSE 0 END)), '[]'::jsonb)
    INTO v_ob_confirmed, v_ob_review, v_ob_blockers
    FROM public.opening_balances ob
   WHERE ob.society_id=_society_id AND ob.flat_id=_flat_id AND ob.carried_bill_id IS NULL
     AND ob.status IN ('confirmed','imported_unverified');
  v_total := v_total + v_ob_confirmed;
  v_blockers := v_blockers || v_ob_blockers;

  RETURN jsonb_build_object(
    'eligible', (v_ob_review = 0 AND v_total = 0 AND v_pending_count = 0 AND v_unknown_count = 0 AND v_inconsistent_count = 0),
    'total_outstanding', v_total,
    'pending_payment_total', v_pending_total,
    'counts', jsonb_build_object(
      'overdue', v_overdue_count,
      'partial', v_partial_count,
      'unpaid', v_unpaid_count,
      'pending_offline', v_pending_count,
      'unknown_status', v_unknown_count,
      'inconsistent', v_inconsistent_count,
      'opening_balance_under_review', v_ob_review
    ),
    'blockers', v_blockers,
    'calculated_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._bill_run_rows(uuid, uuid) FROM public, anon, authenticated;