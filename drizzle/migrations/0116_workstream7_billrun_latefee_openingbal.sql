-- Workstream 7 completion: bill-run review, optional second approver, opt-in late fees,
-- opening balances (imported, unverified), partial migration hold, compare-only, handover/pack/export.

ALTER TABLE public.society_settings
  ADD COLUMN IF NOT EXISTS late_fee_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bill_run_approval_required boolean NOT NULL DEFAULT false;

-- Billing controls change only through admin_set_billing_controls (audited).
CREATE OR REPLACE FUNCTION public._protect_billing_controls()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (NEW.late_fee_enabled IS DISTINCT FROM OLD.late_fee_enabled
      OR NEW.bill_run_approval_required IS DISTINCT FROM OLD.bill_run_approval_required)
     AND coalesce(current_setting('app.billing_controls', true), '') <> 'on' THEN
    RAISE EXCEPTION 'billing_controls_rpc_only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_protect_billing_controls ON public.society_settings;
CREATE TRIGGER trg_protect_billing_controls BEFORE UPDATE ON public.society_settings
  FOR EACH ROW EXECUTE FUNCTION public._protect_billing_controls();

CREATE OR REPLACE FUNCTION public.admin_set_billing_controls(_society_id uuid, _late_fee_enabled boolean, _approval_required boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old record;
BEGIN
  PERFORM public._billing_require_admin(_society_id);
  IF _late_fee_enabled IS NULL OR _approval_required IS NULL THEN RAISE EXCEPTION 'invalid_input'; END IF;
  PERFORM public._rate_hit('billing_controls', auth.uid()::text, 30, interval '1 hour');
  SELECT late_fee_enabled, bill_run_approval_required, late_fee_amount, late_fee_type INTO v_old
    FROM society_settings WHERE society_id = _society_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'settings_missing'; END IF;
  IF _late_fee_enabled AND (coalesce(v_old.late_fee_amount,0) <= 0
      OR (v_old.late_fee_type = 'percent' AND v_old.late_fee_amount > 100)
      OR (v_old.late_fee_type <> 'percent' AND v_old.late_fee_amount > 100000)) THEN
    RAISE EXCEPTION 'late_fee_invalid_amount';
  END IF;
  PERFORM set_config('app.billing_controls', 'on', true);
  UPDATE society_settings SET late_fee_enabled = _late_fee_enabled, bill_run_approval_required = _approval_required
    WHERE society_id = _society_id;
  PERFORM set_config('app.billing_controls', '', true);
  INSERT INTO audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'billing.controls_updated', 'society_settings', _society_id::text, _society_id,
    jsonb_build_object('late_fee_enabled', _late_fee_enabled, 'was_late_fee_enabled', v_old.late_fee_enabled,
      'approval_required', _approval_required, 'was_approval_required', v_old.bill_run_approval_required));
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.admin_set_billing_controls(uuid, boolean, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_billing_controls(uuid, boolean, boolean) TO authenticated;

-- Shared, deterministic per-flat computation used by review, approval and finalize.
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

    SELECT coalesce(sum(greatest(coalesce(b.total_payable,b.amount,0) -
        coalesce((SELECT sum(p.amount) FROM payments p WHERE p.bill_id=b.id AND p.status='verified'),0), 0)),0),
      coalesce(sum(greatest(coalesce(b.total_payable,b.amount,0) -
        coalesce((SELECT sum(p.amount) FROM payments p WHERE p.bill_id=b.id AND p.status='verified'),0), 0))
        FILTER (WHERE b.due_date + _s.grace < _cycle.period_start),0)
      INTO previous_balance, overdue_balance
      FROM bills b
     WHERE b.society_id=_society_id AND b.flat_id=_f.id AND b.status IN ('unpaid','partially_paid','overdue')
       AND b.cancelled_at IS NULL AND b.due_date < _cycle.period_start;

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

CREATE OR REPLACE FUNCTION public._bill_run_fingerprint(_society_id uuid, _cycle_config_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT md5(coalesce((SELECT c.template_id::text||'|'||c.period_start||'|'||c.period_end||'|'||c.due_date
      FROM billing_cycle_configs c WHERE c.id=_cycle_config_id),'') || '#' ||
    coalesce((SELECT string_agg(r.flat_id||':'||r.current_charges||':'||r.previous_balance||':'||r.late_fee, '|' ORDER BY r.flat_id)
      FROM public._bill_run_rows(_society_id, _cycle_config_id) r), ''))
$$;
REVOKE ALL ON FUNCTION public._bill_run_fingerprint(uuid, uuid) FROM public, anon, authenticated;

CREATE TABLE public.bill_run_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  cycle_config_id uuid NOT NULL REFERENCES public.billing_cycle_configs(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  unit_count int NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','superseded','consumed')),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text CHECK (decision_note IS NULL OR length(decision_note) <= 500),
  consumed_batch_id uuid
);
CREATE UNIQUE INDEX bill_run_approvals_one_open ON public.bill_run_approvals (cycle_config_id) WHERE status IN ('requested','approved');
GRANT SELECT ON public.bill_run_approvals TO authenticated;
GRANT ALL ON public.bill_run_approvals TO service_role;
ALTER TABLE public.bill_run_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Billing admins read bill run approvals" ON public.bill_run_approvals FOR SELECT TO authenticated
  USING (public.current_user_has_society_permission(society_id, 'billing.manage', NULL::uuid));

CREATE OR REPLACE FUNCTION public.get_bill_run_review(_society_id uuid, _cycle_config_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb; a record; s record;
BEGIN
  PERFORM public._billing_require_admin(_society_id);
  SELECT coalesce(late_fee_enabled,false) en, late_fee_type, late_fee_amount, coalesce(grace_days,0) grace,
         coalesce(bill_run_approval_required,false) appr
    INTO s FROM society_settings WHERE society_id=_society_id;
  SELECT * INTO a FROM bill_run_approvals WHERE cycle_config_id=_cycle_config_id AND society_id=_society_id
    ORDER BY requested_at DESC LIMIT 1;
  WITH r AS (SELECT * FROM public._bill_run_rows(_society_id, _cycle_config_id))
  SELECT jsonb_build_object(
    'unit_count', (SELECT count(*) FROM r),
    'current_total', (SELECT coalesce(sum(current_charges),0) FROM r),
    'previous_total', (SELECT coalesce(sum(previous_balance),0) FROM r),
    'late_fee_total', (SELECT coalesce(sum(late_fee),0) FROM r),
    'late_fee_count', (SELECT count(*) FROM r WHERE late_fee > 0),
    'grand_total', (SELECT coalesce(sum(total),0) FROM r),
    'problem_count', (SELECT count(*) FROM r WHERE cardinality(problems) > 0),
    'problems', (SELECT coalesce(jsonb_agg(jsonb_build_object('flat_id',flat_id,'flat_number',flat_number,'codes',problems,'current_charges',current_charges) ORDER BY flat_number), '[]'::jsonb)
                 FROM (SELECT * FROM r WHERE cardinality(problems) > 0 ORDER BY flat_number LIMIT 500) p),
    'late_fees', (SELECT coalesce(jsonb_agg(jsonb_build_object('flat_id',flat_id,'flat_number',flat_number,'overdue',overdue_balance,'late_fee',late_fee) ORDER BY flat_number), '[]'::jsonb)
                 FROM (SELECT * FROM r WHERE late_fee > 0 ORDER BY flat_number LIMIT 500) p)
  ) INTO v;
  RETURN v || jsonb_build_object(
    'fingerprint', public._bill_run_fingerprint(_society_id, _cycle_config_id),
    'late_fee', jsonb_build_object('enabled', coalesce(s.en,false), 'type', s.late_fee_type, 'value', s.late_fee_amount, 'grace_days', coalesce(s.grace,0)),
    'approval_required', coalesce(s.appr,false),
    'approval', CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', a.id, 'status', a.status, 'requested_at', a.requested_at, 'decided_at', a.decided_at,
      'decision_note', a.decision_note, 'requested_by_me', a.requested_by = auth.uid(),
      'decided_by_me', a.decided_by = auth.uid(), 'fingerprint', a.fingerprint,
      'total_amount', a.total_amount, 'unit_count', a.unit_count) END);
END $$;
REVOKE ALL ON FUNCTION public.get_bill_run_review(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_bill_run_review(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_bill_run_approval(_society_id uuid, _cycle_config_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_fp text; v_cnt int; v_tot numeric;
BEGIN
  PERFORM public._billing_require_admin(_society_id);
  PERFORM public._rate_hit('bill_run_approval', auth.uid()::text, 30, interval '1 hour');
  IF NOT EXISTS (SELECT 1 FROM billing_cycle_configs WHERE id=_cycle_config_id AND society_id=_society_id AND status='ready') THEN
    RAISE EXCEPTION 'cycle_not_ready';
  END IF;
  IF EXISTS (SELECT 1 FROM bills WHERE society_id=_society_id AND cycle_config_id=_cycle_config_id AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'duplicate_bills_for_cycle';
  END IF;
  UPDATE bill_run_approvals SET status='superseded', decided_at=coalesce(decided_at, now())
    WHERE cycle_config_id=_cycle_config_id AND society_id=_society_id AND status IN ('requested','approved');
  v_fp := public._bill_run_fingerprint(_society_id, _cycle_config_id);
  SELECT count(*), coalesce(sum(total),0) INTO v_cnt, v_tot FROM public._bill_run_rows(_society_id, _cycle_config_id);
  INSERT INTO bill_run_approvals (society_id, cycle_config_id, fingerprint, unit_count, total_amount, requested_by)
    VALUES (_society_id, _cycle_config_id, v_fp, v_cnt, v_tot, auth.uid()) RETURNING id INTO v_id;
  INSERT INTO audit_log (actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (auth.uid(), 'billing.run_approval_requested', 'bill_run_approvals', v_id::text, _society_id,
      jsonb_build_object('cycle_config_id', _cycle_config_id, 'units', v_cnt, 'total', v_tot));
  RETURN jsonb_build_object('id', v_id, 'status', 'requested');
END $$;
REVOKE ALL ON FUNCTION public.request_bill_run_approval(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.request_bill_run_approval(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.decide_bill_run_approval(_approval_id uuid, _approve boolean, _note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; v_note text := nullif(btrim(coalesce(_note,'')), '');
BEGIN
  SELECT * INTO a FROM bill_run_approvals WHERE id=_approval_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unavailable' USING ERRCODE='P0002'; END IF;
  PERFORM public._billing_require_admin(a.society_id);
  PERFORM public._rate_hit('bill_run_approval', auth.uid()::text, 30, interval '1 hour');
  IF a.status <> 'requested' THEN RAISE EXCEPTION 'approval_not_pending'; END IF;
  IF a.requested_by = auth.uid() THEN RAISE EXCEPTION 'same_user_cannot_approve'; END IF;
  IF _approve IS NULL THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF NOT _approve AND v_note IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF _approve AND public._bill_run_fingerprint(a.society_id, a.cycle_config_id) <> a.fingerprint THEN
    UPDATE bill_run_approvals SET status='superseded', decided_at=now() WHERE id=a.id;
    RETURN jsonb_build_object('status','run_changed');
  END IF;
  UPDATE bill_run_approvals SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
    decided_by = auth.uid(), decided_at = now(), decision_note = v_note WHERE id=a.id;
  INSERT INTO audit_log (actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (auth.uid(), CASE WHEN _approve THEN 'billing.run_approved' ELSE 'billing.run_rejected' END,
      'bill_run_approvals', a.id::text, a.society_id, jsonb_build_object('cycle_config_id', a.cycle_config_id, 'note', v_note));
  RETURN jsonb_build_object('status', CASE WHEN _approve THEN 'approved' ELSE 'rejected' END);
END $$;
REVOKE ALL ON FUNCTION public.decide_bill_run_approval(uuid, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.decide_bill_run_approval(uuid, boolean, text) TO authenticated;

ALTER TABLE public.bill_generation_batches ADD COLUMN IF NOT EXISTS approval_id uuid;

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

-- Opening balances: imported evidence, never payments or verified money.
CREATE TABLE public.opening_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_id uuid NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0 AND amount <= 10000000),
  as_of date NOT NULL,
  source text NOT NULL DEFAULT 'import' CHECK (source IN ('import')),
  source_ref text CHECK (source_ref IS NULL OR length(source_ref) <= 120),
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 8 AND 80),
  status text NOT NULL DEFAULT 'imported_unverified' CHECK (status IN ('imported_unverified','confirmed','rejected')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text CHECK (review_note IS NULL OR length(review_note) <= 500)
);
CREATE UNIQUE INDEX opening_balances_one_active ON public.opening_balances (society_id, flat_id) WHERE status <> 'rejected';
CREATE INDEX opening_balances_society ON public.opening_balances (society_id, status);
GRANT SELECT ON public.opening_balances TO authenticated;
GRANT ALL ON public.opening_balances TO service_role;
ALTER TABLE public.opening_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Billing admins read opening balances" ON public.opening_balances FOR SELECT TO authenticated
  USING (public.current_user_has_society_permission(society_id, 'billing.manage', NULL::uuid));

CREATE OR REPLACE FUNCTION public._opening_balances_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'opening_balance_append_only'; END IF;
  IF NEW.amount <> OLD.amount OR NEW.flat_id <> OLD.flat_id OR NEW.society_id <> OLD.society_id
     OR NEW.as_of <> OLD.as_of OR NEW.created_by <> OLD.created_by OR OLD.status <> 'imported_unverified' THEN
    RAISE EXCEPTION 'opening_balance_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_opening_balances_guard BEFORE UPDATE OR DELETE ON public.opening_balances
  FOR EACH ROW EXECUTE FUNCTION public._opening_balances_guard();

CREATE OR REPLACE FUNCTION public.import_opening_balances(_society_id uuid, _request_id text, _source_ref text, _rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid(); v_row jsonb; v_i int := 0; v_flat uuid; v_n int;
  v_block text; v_unit text; v_amt text; v_date text; v_d date;
  v_ok int := 0; v_rej jsonb := '[]'::jsonb; v_seen text[] := '{}'; v_key text;
BEGIN
  PERFORM public._billing_require_admin(_society_id);
  IF _request_id IS NULL OR length(_request_id) NOT BETWEEN 8 AND 80 THEN RAISE EXCEPTION 'invalid_request_id'; END IF;
  IF jsonb_typeof(_rows) <> 'array' OR jsonb_array_length(_rows) = 0 OR jsonb_array_length(_rows) > 5000 THEN RAISE EXCEPTION 'invalid_rows'; END IF;
  IF EXISTS (SELECT 1 FROM opening_balances WHERE society_id=_society_id AND request_id=_request_id) THEN
    RETURN jsonb_build_object('idempotent_replay', true,
      'imported', (SELECT count(*) FROM opening_balances WHERE society_id=_society_id AND request_id=_request_id), 'rejected', '[]'::jsonb);
  END IF;
  PERFORM public._rate_hit('opening_balance_import', v_uid::text, 10, interval '1 hour');

  FOR v_row IN SELECT value FROM jsonb_array_elements(_rows) LOOP
    v_i := v_i + 1;
    v_block := left(btrim(coalesce(v_row->>'block','')), 80);
    v_unit := left(btrim(coalesce(v_row->>'unit','')), 40);
    v_amt := btrim(coalesce(v_row->>'amount',''));
    v_date := btrim(coalesce(v_row->>'as_of',''));
    IF v_unit = '' THEN v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'missing_unit'); CONTINUE; END IF;
    IF v_amt !~ '^\d{1,8}(\.\d{1,2})?$' OR v_amt::numeric <= 0 OR v_amt::numeric > 10000000 THEN
      v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'invalid_amount'); CONTINUE; END IF;
    IF v_date !~ '^\d{4}-\d{2}-\d{2}$' THEN v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'invalid_date'); CONTINUE; END IF;
    BEGIN v_d := v_date::date; EXCEPTION WHEN others THEN
      v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'invalid_date'); CONTINUE; END;
    IF v_d > CURRENT_DATE OR v_d < DATE '2000-01-01' THEN v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'invalid_date'); CONTINUE; END IF;

    SELECT count(*), min(f.id::text)::uuid INTO v_n, v_flat
      FROM flats f LEFT JOIN blocks b ON b.id = f.block_id
     WHERE f.society_id=_society_id AND f.is_active AND lower(f.flat_number) = lower(v_unit)
       AND (v_block = '' OR lower(coalesce(b.name,'')) = lower(v_block));
    IF v_n = 0 THEN v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'unit_not_found'); CONTINUE; END IF;
    IF v_n > 1 THEN v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'ambiguous_unit'); CONTINUE; END IF;
    v_key := v_flat::text;
    IF v_key = ANY(v_seen) THEN v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'duplicate_in_file'); CONTINUE; END IF;
    v_seen := v_seen || v_key;
    IF EXISTS (SELECT 1 FROM opening_balances WHERE society_id=_society_id AND flat_id=v_flat AND status <> 'rejected') THEN
      v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'already_imported'); CONTINUE; END IF;

    INSERT INTO opening_balances (society_id, flat_id, amount, as_of, source_ref, request_id, created_by)
      VALUES (_society_id, v_flat, v_amt::numeric, v_d, left(nullif(btrim(coalesce(_source_ref,'')),''),120), _request_id, v_uid);
    v_ok := v_ok + 1;
  END LOOP;

  INSERT INTO audit_log (actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (v_uid, 'billing.opening_balances_imported', 'opening_balances', _request_id, _society_id,
      jsonb_build_object('imported', v_ok, 'rejected', jsonb_array_length(v_rej), 'source_ref', left(coalesce(_source_ref,''),120)));
  RETURN jsonb_build_object('idempotent_replay', false, 'imported', v_ok, 'rejected', v_rej);
END $$;
REVOKE ALL ON FUNCTION public.import_opening_balances(uuid, text, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_opening_balances(uuid, text, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_opening_balance(_id uuid, _confirm boolean, _note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_note text := nullif(btrim(coalesce(_note,'')),'');
BEGIN
  SELECT * INTO r FROM opening_balances WHERE id=_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unavailable' USING ERRCODE='P0002'; END IF;
  PERFORM public._billing_require_admin(r.society_id);
  PERFORM public._rate_hit('opening_balance_review', auth.uid()::text, 200, interval '1 hour');
  IF r.status <> 'imported_unverified' THEN RAISE EXCEPTION 'already_reviewed'; END IF;
  IF _confirm IS NULL OR (v_note IS NOT NULL AND length(v_note) > 500) THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF NOT _confirm AND v_note IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
  UPDATE opening_balances SET status = CASE WHEN _confirm THEN 'confirmed' ELSE 'rejected' END,
    reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_note WHERE id=_id;
  INSERT INTO audit_log (actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (auth.uid(), CASE WHEN _confirm THEN 'billing.opening_balance_confirmed' ELSE 'billing.opening_balance_rejected' END,
      'opening_balances', _id::text, r.society_id, jsonb_build_object('amount', r.amount, 'note', v_note));
  RETURN jsonb_build_object('status', CASE WHEN _confirm THEN 'confirmed' ELSE 'rejected' END);
END $$;
REVOKE ALL ON FUNCTION public.review_opening_balance(uuid, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.review_opening_balance(uuid, boolean, text) TO authenticated;

-- Partial migration: hold problem rows for review, commit the rest.
ALTER TABLE public.migration_rows
  ADD COLUMN IF NOT EXISTS held_for_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS held_status text,
  ADD COLUMN IF NOT EXISTS held_action text;

CREATE OR REPLACE FUNCTION public.migration_hold_problem_rows(_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j record; v_good int; v_held int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  SELECT * INTO j FROM migration_jobs WHERE id=_job_id FOR UPDATE;
  IF NOT FOUND OR NOT public.user_can_admin_migrations(auth.uid(), j.society_id) THEN
    RETURN jsonb_build_object('status','unavailable'); END IF;
  IF j.status <> 'ready' THEN RETURN jsonb_build_object('status','job_not_ready'); END IF;
  PERFORM public._rate_hit('migration_hold', auth.uid()::text, 30, interval '1 hour');
  SELECT count(*) INTO v_good FROM migration_rows
    WHERE job_id=_job_id AND status IN ('valid','warning') AND action IN ('create','match_existing');
  IF v_good = 0 THEN RETURN jsonb_build_object('status','nothing_to_import'); END IF;
  UPDATE migration_rows SET held_for_review = true, held_status = status::text, held_action = action::text,
      status = 'skipped', action = 'skip', updated_at = now()
    WHERE job_id=_job_id AND (status = 'error' OR action = 'conflict');
  GET DIAGNOSTICS v_held = ROW_COUNT;
  INSERT INTO audit_log (actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (auth.uid(), 'migration.rows_held_for_review', 'migration_jobs', _job_id::text, j.society_id,
      jsonb_build_object('held', v_held, 'importable', v_good));
  RETURN jsonb_build_object('status','ok', 'held', v_held, 'importable', v_good);
END $$;
REVOKE ALL ON FUNCTION public.migration_hold_problem_rows(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.migration_hold_problem_rows(uuid) TO authenticated;

-- Compare-only: source units vs current SociyoHub units. Never writes.
CREATE OR REPLACE FUNCTION public.compare_migration_units(_society_id uuid, _rows jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row jsonb; v_i int := 0; v_out jsonb := '[]'::jsonb; v_blk text; v_unit text; v_area text; v_type text;
  v_n int; f record; v_key text; v_keys text[] := '{}'; v_dups text[] := '{}'; v_status text; v_diff text[];
  c_m int := 0; c_c int := 0; c_x int := 0; c_k int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_can_admin_migrations(auth.uid(), _society_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(_rows) <> 'array' OR jsonb_array_length(_rows) = 0 OR jsonb_array_length(_rows) > 5000 THEN RAISE EXCEPTION 'invalid_rows'; END IF;
  SELECT array_agg(k) INTO v_dups FROM (
    SELECT lower(btrim(coalesce(e->>'structure','')))||'/'||lower(btrim(coalesce(e->>'unit',''))) k
      FROM jsonb_array_elements(_rows) e GROUP BY 1 HAVING count(*) > 1) d;
  v_dups := coalesce(v_dups, '{}');
  FOR v_row IN SELECT value FROM jsonb_array_elements(_rows) LOOP
    v_i := v_i + 1;
    v_blk := left(btrim(coalesce(v_row->>'structure','')),80); v_unit := left(btrim(coalesce(v_row->>'unit','')),40);
    v_area := btrim(coalesce(v_row->>'area_sqft','')); v_type := left(btrim(coalesce(v_row->>'unit_type','')),40);
    v_key := lower(v_blk)||'/'||lower(v_unit); v_diff := '{}';
    IF v_unit = '' THEN v_status := 'unresolved';
    ELSIF v_key = ANY(v_dups) THEN v_status := 'conflicting';
    ELSE
      SELECT count(*) INTO v_n FROM flats fl LEFT JOIN blocks b ON b.id=fl.block_id
        WHERE fl.society_id=_society_id AND fl.is_active AND lower(fl.flat_number)=lower(v_unit)
          AND (v_blk='' OR lower(coalesce(b.name,''))=lower(v_blk));
      IF v_n = 0 THEN v_status := 'missing';
      ELSIF v_n > 1 THEN v_status := 'conflicting';
      ELSE
        SELECT fl.id, fl.area_sqft, coalesce(nullif(btrim(fl.unit_type),''), nullif(btrim(fl.type),''), '') ut INTO f
          FROM flats fl LEFT JOIN blocks b ON b.id=fl.block_id
          WHERE fl.society_id=_society_id AND fl.is_active AND lower(fl.flat_number)=lower(v_unit)
            AND (v_blk='' OR lower(coalesce(b.name,''))=lower(v_blk));
        v_keys := v_keys || f.id::text;
        IF v_area ~ '^\d{1,6}(\.\d{1,2})?$' AND coalesce(f.area_sqft,-1) <> v_area::numeric THEN v_diff := v_diff || 'area_sqft'; END IF;
        IF v_type <> '' AND lower(v_type) <> lower(f.ut) THEN v_diff := v_diff || 'unit_type'; END IF;
        v_status := CASE WHEN cardinality(v_diff) > 0 THEN 'changed' ELSE 'matched' END;
      END IF;
    END IF;
    IF v_status='matched' THEN c_m := c_m+1; ELSIF v_status='changed' THEN c_c := c_c+1;
    ELSIF v_status='missing' THEN c_x := c_x+1; ELSE c_k := c_k+1; END IF;
    IF v_status <> 'matched' AND jsonb_array_length(v_out) < 1000 THEN
      v_out := v_out || jsonb_build_object('row', v_i, 'structure', v_blk, 'unit', v_unit, 'status', v_status, 'fields', to_jsonb(v_diff));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('matched', c_m, 'changed', c_c, 'missing', c_x,
    'conflicting_or_unresolved', c_k, 'rows', v_out,
    'only_in_sociyohub', (SELECT count(*) FROM flats fl WHERE fl.society_id=_society_id AND fl.is_active AND NOT (fl.id::text = ANY(v_keys))));
END $$;
REVOKE ALL ON FUNCTION public.compare_migration_units(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.compare_migration_units(uuid, jsonb) TO authenticated;

-- Handover summary: add opening balances, held import rows, pending bill-run approvals.
CREATE OR REPLACE FUNCTION public.get_handover_summary(_society_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_uid uuid := auth.uid(); r jsonb;
BEGIN
  IF v_uid IS NULL OR _society_id IS NULL OR NOT public.current_user_has_society_permission(_society_id,'society.settings',NULL::uuid) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object(
    'status', COALESCE(s.handover_status,'not_started'), 'note', s.handover_note, 'updated_at', s.handover_updated_at,
    'blocks', (SELECT count(*) FROM blocks WHERE society_id=_society_id),
    'flats', (SELECT count(*) FROM flats WHERE society_id=_society_id AND is_active),
    'occupied_flats', (SELECT count(DISTINCT fr.flat_id) FROM flat_residents fr JOIN flats f ON f.id=fr.flat_id WHERE f.society_id=_society_id AND fr.is_active),
    'admins', (SELECT count(*) FROM user_roles WHERE society_id=_society_id AND is_active AND role='society_admin'),
    'documents', (SELECT count(*) FROM society_knowledge_sources WHERE society_id=_society_id AND archived_at IS NULL AND kind<>'faq'),
    'completed_imports', (SELECT count(*) FROM migration_jobs WHERE society_id=_society_id AND status='completed'),
    'open_imports', (SELECT count(*) FROM migration_jobs WHERE society_id=_society_id AND status IN ('uploaded','mapping','validating','ready','committing')),
    'failed_imports', (SELECT count(*) FROM migration_jobs WHERE society_id=_society_id AND status='failed'),
    'import_conflict_rows', (SELECT COALESCE(sum(error_rows),0) FROM migration_jobs WHERE society_id=_society_id AND status IN ('ready','validating','mapping')),
    'held_import_rows', (SELECT count(*) FROM migration_rows WHERE society_id=_society_id AND held_for_review),
    'opening_balance_set', s.opening_balance_date IS NOT NULL,
    'opening_balances_unverified', (SELECT count(*) FROM opening_balances WHERE society_id=_society_id AND status='imported_unverified'),
    'opening_balances_confirmed', (SELECT count(*) FROM opening_balances WHERE society_id=_society_id AND status='confirmed'),
    'pending_bill_run_approvals', (SELECT count(*) FROM bill_run_approvals WHERE society_id=_society_id AND status='requested'),
    'bills', (SELECT count(*) FROM bills WHERE society_id=_society_id AND cancelled_at IS NULL),
    'setup_completed', s.setup_completed_at IS NOT NULL
  ) INTO r FROM (SELECT 1) one LEFT JOIN society_settings s ON s.society_id=_society_id;
  RETURN r;
END $function$;

-- Auditor Pack extras: same finance-admin gate and rate bucket as the pack itself.
CREATE OR REPLACE FUNCTION public.get_auditor_pack_extras(_society_id uuid, _from date, _to date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid;
BEGIN
  IF _from IS NULL OR _to IS NULL OR _from > _to OR _to - _from > 730 OR _to > CURRENT_DATE + 1 THEN
    RAISE EXCEPTION 'invalid_period' USING ERRCODE='22023'; END IF;
  v_uid := public._finance_require_admin(_society_id);
  PERFORM public._rate_hit('auditor_pack', v_uid::text, 20, interval '1 hour');
  RETURN jsonb_build_object(
    'adjustments', (SELECT jsonb_build_object('total', count(*), 'rows', coalesce(jsonb_agg(x) FILTER (WHERE x.rn <= 1000), '[]'::jsonb)) FROM (
       SELECT row_number() OVER (ORDER BY a.created_at) rn, a.created_at::date AS date, b.bill_number, f.flat_number,
         a.amount, a.reason, CASE WHEN a.counter_of IS NOT NULL THEN 'correction' ELSE 'entry' END AS kind,
         a.counter_of, a.id
       FROM bill_adjustments a JOIN bills b ON b.id=a.bill_id LEFT JOIN flats f ON f.id=b.flat_id
       WHERE a.society_id=_society_id AND a.created_at::date BETWEEN _from AND _to) x),
    'opening_balances', (SELECT jsonb_build_object('total', count(*), 'rows', coalesce(jsonb_agg(x) FILTER (WHERE x.rn <= 1000), '[]'::jsonb)) FROM (
       SELECT row_number() OVER (ORDER BY o.as_of, f.flat_number) rn, o.as_of, f.flat_number, o.amount, o.status, o.reviewed_at::date AS reviewed_on, o.id
       FROM opening_balances o JOIN flats f ON f.id=o.flat_id WHERE o.society_id=_society_id) x),
    'resolutions', (SELECT jsonb_build_object('total', count(*), 'rows', coalesce(jsonb_agg(x) FILTER (WHERE x.rn <= 1000), '[]'::jsonb)) FROM (
       SELECT row_number() OVER (ORDER BY m.scheduled_at, r.seq) rn, m.scheduled_at::date AS meeting_date, m.title AS meeting,
         r.seq, left(r.text, 300) AS resolution, r.outcome, r.id
       FROM meeting_resolutions r JOIN meetings m ON m.id=r.meeting_id
       WHERE r.society_id=_society_id AND m.scheduled_at::date BETWEEN _from AND _to) x)
  );
END $$;
REVOKE ALL ON FUNCTION public.get_auditor_pack_extras(uuid, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_auditor_pack_extras(uuid, date, date) TO authenticated;

-- Export: add opening balances and bill-run approvals (whitelisted columns only).
DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.get_society_export_section'::regproc);
  IF position('WHEN ''opening_balances''' in d) = 0 THEN
    d := replace(d, 'WHEN ''bill_adjustments'' THEN',
      'WHEN ''opening_balances'' THEN ''SELECT id,flat_id,amount,as_of,status,source,source_ref,created_by,created_at,reviewed_by,reviewed_at,review_note FROM opening_balances WHERE society_id=$1'' '
      || 'WHEN ''bill_run_approvals'' THEN ''SELECT id,cycle_config_id,unit_count,total_amount,status,requested_by,requested_at,decided_by,decided_at,decision_note,consumed_batch_id FROM bill_run_approvals WHERE society_id=$1'' '
      || 'WHEN ''bill_adjustments'' THEN');
    EXECUTE d;
  END IF;
END $do$;