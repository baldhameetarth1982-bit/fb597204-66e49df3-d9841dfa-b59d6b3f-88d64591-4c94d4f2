-- 7. GST / TDS calculation layer (calculation + reporting only; never claims filing)
CREATE TABLE public.society_tax_settings (
  society_id uuid PRIMARY KEY REFERENCES public.societies(id) ON DELETE RESTRICT,
  gst_registered boolean NOT NULL DEFAULT false,
  gst_state_code text CHECK (gst_state_code IS NULL OR gst_state_code ~ '^[0-9]{2}$'),
  tds_deductor boolean NOT NULL DEFAULT false,
  tan text CHECK (tan IS NULL OR tan ~ '^[A-Z]{4}[0-9]{5}[A-Z]$'),
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.society_tax_settings TO authenticated;
GRANT ALL ON public.society_tax_settings TO service_role;
ALTER TABLE public.society_tax_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY society_tax_settings_admin_read ON public.society_tax_settings FOR SELECT TO authenticated
  USING (public.resolve_financial_visibility(society_id) = 'admin');

CREATE TABLE public.finance_vendor_tax (
  vendor_id uuid PRIMARY KEY REFERENCES public.finance_vendors(id) ON DELETE RESTRICT,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  gstin text CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  pan text CHECK (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  state_code text CHECK (state_code IS NULL OR state_code ~ '^[0-9]{2}$'),
  gst_rate numeric(5,2) CHECK (gst_rate IS NULL OR gst_rate IN (0,0.25,3,5,12,18,28,40)),
  tds_section text CHECK (tds_section IS NULL OR tds_section ~ '^[0-9A-Z]{2,8}$'),
  tds_rate numeric(5,2) CHECK (tds_rate IS NULL OR (tds_rate >= 0 AND tds_rate <= 30)),
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.finance_vendor_tax TO authenticated;
GRANT ALL ON public.finance_vendor_tax TO service_role;
ALTER TABLE public.finance_vendor_tax ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_vendor_tax_admin_read ON public.finance_vendor_tax FOR SELECT TO authenticated
  USING (public.resolve_financial_visibility(society_id) = 'admin');

CREATE TABLE public.expense_tax_calculations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  expense_id uuid NOT NULL UNIQUE REFERENCES public.expenses(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('calculated','needs_configuration')),
  missing text[] NOT NULL DEFAULT '{}',
  gross_amount numeric(14,2) NOT NULL,
  amount_includes_gst boolean NOT NULL DEFAULT true,
  supply_type text CHECK (supply_type IS NULL OR supply_type IN ('intra','inter','none')),
  gst_rate numeric(5,2), taxable_amount numeric(14,2),
  cgst numeric(14,2), sgst numeric(14,2), igst numeric(14,2), total_gst numeric(14,2),
  tds_applicable boolean, tds_section text, tds_rate numeric(5,2), tds_amount numeric(14,2),
  net_payable numeric(14,2),
  inputs jsonb NOT NULL,
  calc_version smallint NOT NULL DEFAULT 1,
  calculated_by uuid NOT NULL, calculated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expense_tax_calc_society_idx ON public.expense_tax_calculations(society_id, status);
GRANT SELECT ON public.expense_tax_calculations TO authenticated;
GRANT ALL ON public.expense_tax_calculations TO service_role;
ALTER TABLE public.expense_tax_calculations ENABLE ROW LEVEL SECURITY;
CREATE POLICY expense_tax_calc_admin_read ON public.expense_tax_calculations FOR SELECT TO authenticated
  USING (public.resolve_financial_visibility(society_id) = 'admin');

-- Pure, deterministic tax maths (no lookups). GST split: CGST = half rounded, SGST = remainder.
CREATE OR REPLACE FUNCTION public.fin_compute_tax(_amount numeric, _includes_gst boolean, _gst_rate numeric, _supply_type text, _tds_rate numeric)
 RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE v_taxable numeric; v_gst numeric := 0; v_cgst numeric := 0; v_sgst numeric := 0; v_igst numeric := 0; v_gross numeric; v_tds numeric := 0;
BEGIN
  IF _amount IS NULL OR _amount < 0 OR _amount <> round(_amount,2) THEN RAISE EXCEPTION 'invalid_amount' USING ERRCODE='22023'; END IF;
  IF coalesce(_gst_rate,0) = 0 OR _supply_type = 'none' THEN
    v_taxable := _amount; v_gross := _amount;
  ELSIF _includes_gst THEN
    v_taxable := round(_amount * 100 / (100 + _gst_rate), 2); v_gst := _amount - v_taxable; v_gross := _amount;
  ELSE
    v_taxable := _amount; v_gst := round(_amount * _gst_rate / 100, 2); v_gross := _amount + v_gst;
  END IF;
  IF v_gst > 0 THEN
    IF _supply_type = 'inter' THEN v_igst := v_gst;
    ELSE v_cgst := round(v_gst / 2, 2); v_sgst := v_gst - v_cgst; END IF;
  END IF;
  IF coalesce(_tds_rate,0) > 0 THEN v_tds := round(v_taxable * _tds_rate / 100, 2); END IF; -- TDS on value excluding GST
  RETURN jsonb_build_object('taxable_amount',v_taxable,'cgst',v_cgst,'sgst',v_sgst,'igst',v_igst,'total_gst',v_gst,
    'gross_amount',v_gross,'tds_amount',v_tds,'net_payable',v_gross - v_tds);
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_society_tax_settings(_society_id uuid, _gst_registered boolean, _gst_state_code text, _tds_deductor boolean, _tan text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := public._finance_require_admin(_society_id);
BEGIN
  PERFORM public._rate_hit('fin_tax_cfg', v_uid::text, 60, interval '1 hour');
  INSERT INTO public.society_tax_settings(society_id, gst_registered, gst_state_code, tds_deductor, tan, updated_by, updated_at)
  VALUES (_society_id, coalesce(_gst_registered,false), nullif(btrim(_gst_state_code),''), coalesce(_tds_deductor,false), nullif(upper(btrim(_tan)),''), v_uid, now())
  ON CONFLICT (society_id) DO UPDATE SET gst_registered=EXCLUDED.gst_registered, gst_state_code=EXCLUDED.gst_state_code,
    tds_deductor=EXCLUDED.tds_deductor, tan=EXCLUDED.tan, updated_by=v_uid, updated_at=now();
  INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
  VALUES (v_uid, _society_id, 'finance.tax_settings_update', 'society_tax_settings', _society_id,
          jsonb_build_object('gst_registered', _gst_registered, 'tds_deductor', _tds_deductor, 'state', _gst_state_code));
EXCEPTION WHEN check_violation THEN RAISE EXCEPTION 'invalid_tax_config' USING ERRCODE='22023';
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_vendor_tax(_vendor_id uuid, _gstin text, _pan text, _state_code text, _gst_rate numeric, _tds_section text, _tds_rate numeric)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_society uuid; v_uid uuid; v_gstin text := nullif(upper(btrim(coalesce(_gstin,''))),''); v_state text := nullif(btrim(coalesce(_state_code,'')),'');
BEGIN
  SELECT society_id INTO v_society FROM public.finance_vendors WHERE id=_vendor_id;
  IF v_society IS NULL THEN RAISE EXCEPTION 'vendor_not_found' USING ERRCODE='22023'; END IF;
  v_uid := public._finance_require_admin(v_society);
  PERFORM public._rate_hit('fin_tax_cfg', v_uid::text, 60, interval '1 hour');
  IF v_gstin IS NOT NULL THEN
    IF v_state IS NOT NULL AND v_state <> left(v_gstin,2) THEN RAISE EXCEPTION 'invalid_tax_config' USING ERRCODE='22023'; END IF;
    v_state := left(v_gstin,2);
  END IF;
  INSERT INTO public.finance_vendor_tax(vendor_id, society_id, gstin, pan, state_code, gst_rate, tds_section, tds_rate, updated_by, updated_at)
  VALUES (_vendor_id, v_society, v_gstin, nullif(upper(btrim(coalesce(_pan,''))),''), v_state, _gst_rate, nullif(upper(btrim(coalesce(_tds_section,''))),''), _tds_rate, v_uid, now())
  ON CONFLICT (vendor_id) DO UPDATE SET gstin=EXCLUDED.gstin, pan=EXCLUDED.pan, state_code=EXCLUDED.state_code, gst_rate=EXCLUDED.gst_rate,
    tds_section=EXCLUDED.tds_section, tds_rate=EXCLUDED.tds_rate, updated_by=v_uid, updated_at=now();
  INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
  VALUES (v_uid, v_society, 'finance.vendor_tax_update', 'finance_vendor_tax', _vendor_id,
          jsonb_build_object('gst_rate', _gst_rate, 'tds_section', _tds_section, 'tds_rate', _tds_rate, 'has_gstin', v_gstin IS NOT NULL));
EXCEPTION WHEN check_violation THEN RAISE EXCEPTION 'invalid_tax_config' USING ERRCODE='22023';
END $$;

-- Calculate (or recalculate) tax for one expense. Explicit overrides win; otherwise vendor profile.
-- Ambiguous cases are stored as needs_configuration with the missing items listed; nothing is guessed.
CREATE OR REPLACE FUNCTION public.admin_calculate_expense_tax(_expense_id uuid, _includes_gst boolean DEFAULT true, _gst_rate numeric DEFAULT NULL, _supply_type text DEFAULT NULL, _tds_section text DEFAULT NULL, _tds_rate numeric DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_x public.expenses%ROWTYPE; v_uid uuid; v_s public.society_tax_settings%ROWTYPE; v_v public.finance_vendor_tax%ROWTYPE;
  v_rate numeric; v_supply text; v_tds_rate numeric; v_tds_sec text; v_tds_app boolean; v_missing text[] := '{}'; v_calc jsonb; v_status text; v_prev jsonb;
BEGIN
  SELECT * INTO v_x FROM public.expenses WHERE id=_expense_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='22023'; END IF;
  v_uid := public._finance_require_admin(v_x.society_id);
  PERFORM public._rate_hit('fin_tax_calc', v_uid::text, 300, interval '1 hour');
  IF v_x.status = 'reversed' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='55000'; END IF;
  IF _gst_rate IS NOT NULL AND _gst_rate NOT IN (0,0.25,3,5,12,18,28,40) THEN RAISE EXCEPTION 'invalid_tax_config' USING ERRCODE='22023'; END IF;
  IF _tds_rate IS NOT NULL AND (_tds_rate < 0 OR _tds_rate > 30) THEN RAISE EXCEPTION 'invalid_tax_config' USING ERRCODE='22023'; END IF;
  IF _supply_type IS NOT NULL AND _supply_type NOT IN ('intra','inter','none') THEN RAISE EXCEPTION 'invalid_tax_config' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_s FROM public.society_tax_settings WHERE society_id=v_x.society_id;
  IF v_x.vendor_id IS NOT NULL THEN SELECT * INTO v_v FROM public.finance_vendor_tax WHERE vendor_id=v_x.vendor_id; END IF;

  v_rate := coalesce(_gst_rate, v_v.gst_rate);
  IF v_rate IS NULL THEN v_missing := v_missing || 'gst_rate'; END IF;
  IF coalesce(v_rate,0) = 0 THEN v_supply := 'none';
  ELSE
    v_supply := _supply_type;
    IF v_supply IS NULL AND v_v.state_code IS NOT NULL AND v_s.gst_state_code IS NOT NULL THEN
      v_supply := CASE WHEN v_v.state_code = v_s.gst_state_code THEN 'intra' ELSE 'inter' END;
    END IF;
    IF v_supply IS NULL THEN v_missing := v_missing || 'supply_type'; END IF;
  END IF;

  IF NOT coalesce(v_s.tds_deductor,false) AND _tds_rate IS NULL THEN v_tds_app := false; v_tds_rate := 0;
  ELSE
    v_tds_rate := coalesce(_tds_rate, v_v.tds_rate); v_tds_sec := coalesce(nullif(upper(btrim(coalesce(_tds_section,''))),''), v_v.tds_section);
    IF v_tds_rate IS NULL THEN v_missing := v_missing || 'tds_rate'; END IF;
    v_tds_app := coalesce(v_tds_rate,0) > 0;
    IF v_tds_app AND v_tds_sec IS NULL THEN v_missing := v_missing || 'tds_section'; END IF;
  END IF;

  v_status := CASE WHEN cardinality(v_missing) = 0 THEN 'calculated' ELSE 'needs_configuration' END;
  IF v_status = 'calculated' THEN
    v_calc := public.fin_compute_tax(v_x.amount, coalesce(_includes_gst,true), v_rate, v_supply, v_tds_rate);
  END IF;

  SELECT to_jsonb(t) - 'inputs' INTO v_prev FROM public.expense_tax_calculations t WHERE expense_id=_expense_id;
  INSERT INTO public.expense_tax_calculations AS t(society_id, expense_id, status, missing, gross_amount, amount_includes_gst, supply_type, gst_rate, taxable_amount,
     cgst, sgst, igst, total_gst, tds_applicable, tds_section, tds_rate, tds_amount, net_payable, inputs, calculated_by, calculated_at)
  VALUES (v_x.society_id, _expense_id, v_status, v_missing, coalesce((v_calc->>'gross_amount')::numeric, v_x.amount), coalesce(_includes_gst,true), v_supply, v_rate,
     (v_calc->>'taxable_amount')::numeric, (v_calc->>'cgst')::numeric, (v_calc->>'sgst')::numeric, (v_calc->>'igst')::numeric, (v_calc->>'total_gst')::numeric,
     v_tds_app, v_tds_sec, v_tds_rate, (v_calc->>'tds_amount')::numeric, (v_calc->>'net_payable')::numeric,
     jsonb_build_object('expense_amount', v_x.amount, 'includes_gst', coalesce(_includes_gst,true), 'gst_rate', v_rate, 'supply_type', v_supply,
                        'tds_rate', v_tds_rate, 'tds_section', v_tds_sec, 'society_state', v_s.gst_state_code, 'vendor_state', v_v.state_code,
                        'override', jsonb_strip_nulls(jsonb_build_object('gst_rate',_gst_rate,'supply_type',_supply_type,'tds_rate',_tds_rate,'tds_section',_tds_section))),
     v_uid, now())
  ON CONFLICT (expense_id) DO UPDATE SET status=EXCLUDED.status, missing=EXCLUDED.missing, gross_amount=EXCLUDED.gross_amount, amount_includes_gst=EXCLUDED.amount_includes_gst,
     supply_type=EXCLUDED.supply_type, gst_rate=EXCLUDED.gst_rate, taxable_amount=EXCLUDED.taxable_amount, cgst=EXCLUDED.cgst, sgst=EXCLUDED.sgst, igst=EXCLUDED.igst,
     total_gst=EXCLUDED.total_gst, tds_applicable=EXCLUDED.tds_applicable, tds_section=EXCLUDED.tds_section, tds_rate=EXCLUDED.tds_rate, tds_amount=EXCLUDED.tds_amount,
     net_payable=EXCLUDED.net_payable, inputs=EXCLUDED.inputs, calculated_by=v_uid, calculated_at=now();
  INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
  VALUES (v_uid, v_x.society_id, 'finance.expense_tax_calculate', 'expense_tax_calculations', _expense_id,
          jsonb_build_object('status', v_status, 'missing', v_missing, 'result', v_calc, 'previous', v_prev));
  RETURN jsonb_build_object('status', v_status, 'missing', to_jsonb(v_missing), 'result', v_calc);
END $$;

CREATE OR REPLACE FUNCTION public.fin_tax_report(_society_id uuid, _from date, _to date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_s public.society_tax_settings%ROWTYPE;
BEGIN
  PERFORM public._finance_require_admin(_society_id);
  IF _from IS NULL OR _to IS NULL OR _from > _to OR _to - _from > 3660 THEN RAISE EXCEPTION 'invalid_period' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_s FROM public.society_tax_settings WHERE society_id=_society_id;
  RETURN jsonb_build_object(
    'settings', jsonb_build_object('gst_registered', coalesce(v_s.gst_registered,false), 'gst_state_code', v_s.gst_state_code, 'tds_deductor', coalesce(v_s.tds_deductor,false), 'tan', v_s.tan, 'configured', v_s.society_id IS NOT NULL),
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_object('expense_id', x.id, 'spent_on', x.spent_on, 'category', x.category, 'amount', x.amount, 'expense_status', x.status,
                'vendor', v.name, 'tax_status', coalesce(t.status,'not_calculated'), 'missing', coalesce(to_jsonb(t.missing),'[]'::jsonb), 'gst_rate', t.gst_rate, 'supply_type', t.supply_type,
                'taxable_amount', t.taxable_amount, 'cgst', t.cgst, 'sgst', t.sgst, 'igst', t.igst, 'total_gst', t.total_gst,
                'tds_section', t.tds_section, 'tds_rate', t.tds_rate, 'tds_amount', t.tds_amount, 'net_payable', t.net_payable, 'calculated_at', t.calculated_at)
              ORDER BY x.spent_on DESC, x.created_at DESC)
       FROM public.expenses x LEFT JOIN public.finance_vendors v ON v.id=x.vendor_id LEFT JOIN public.expense_tax_calculations t ON t.expense_id=x.id
       WHERE x.society_id=_society_id AND x.status='posted' AND x.spent_on BETWEEN _from AND _to), '[]'::jsonb),
    'totals', (SELECT jsonb_build_object('taxable', coalesce(sum(t.taxable_amount),0), 'cgst', coalesce(sum(t.cgst),0), 'sgst', coalesce(sum(t.sgst),0),
                'igst', coalesce(sum(t.igst),0), 'total_gst', coalesce(sum(t.total_gst),0), 'tds', coalesce(sum(t.tds_amount),0),
                'calculated', count(*) FILTER (WHERE t.status='calculated'), 'needs_configuration', count(*) FILTER (WHERE t.status='needs_configuration'),
                'not_calculated', count(*) FILTER (WHERE t.id IS NULL))
       FROM public.expenses x LEFT JOIN public.expense_tax_calculations t ON t.expense_id=x.id AND t.status='calculated'
       WHERE x.society_id=_society_id AND x.status='posted' AND x.spent_on BETWEEN _from AND _to),
    'filing_status', 'not_filed_by_sociyohub');
END $$;

-- 6b. Year status (date columns corrected), close and reopen
CREATE OR REPLACE FUNCTION public.fin_year_status(_society_id uuid, _fy_start date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_end date; v_fy public.finance_fiscal_years%ROWTYPE; v_tb jsonb;
BEGIN
  PERFORM public._finance_require_admin(_society_id);
  IF _fy_start IS NULL OR _fy_start <> public.fin_fy_start(_fy_start) THEN RAISE EXCEPTION 'invalid_period' USING ERRCODE='22023'; END IF;
  v_end := (_fy_start + interval '1 year' - interval '1 day')::date;
  SELECT * INTO v_fy FROM public.finance_fiscal_years WHERE society_id=_society_id AND fy_start=_fy_start;
  v_tb := public.fin_trial_balance(_society_id, _fy_start, v_end);
  RETURN jsonb_build_object(
    'fy_start', _fy_start, 'fy_end', v_end, 'status', coalesce(v_fy.status,'open'),
    'closed_at', v_fy.closed_at, 'reopened_at', v_fy.reopened_at, 'reopen_reason', v_fy.reopen_reason, 'snapshot', v_fy.close_snapshot,
    'year_ended', v_end < CURRENT_DATE,
    'blockers', jsonb_build_object(
      'manual_drafts', (SELECT count(*) FROM public.finance_journal_entries WHERE society_id=_society_id AND source_type='manual' AND status IN ('draft','in_review') AND transaction_date BETWEEN _fy_start AND v_end),
      'payments_unposted', (SELECT count(*) FROM public.payments WHERE society_id=_society_id AND status='verified' AND journal_entry_id IS NULL AND method IN ('cash','bank_transfer') AND payment_date::date BETWEEN _fy_start AND v_end),
      'income_unposted', (SELECT count(*) FROM public.society_income_records WHERE society_id=_society_id AND verification_status='verified' AND journal_entry_id IS NULL AND payment_method IN ('cash','bank_transfer') AND payment_date::date BETWEEN _fy_start AND v_end),
      'expenses_unposted', (SELECT count(*) FROM public.expenses WHERE society_id=_society_id AND status IN ('draft','pending') AND spent_on BETWEEN _fy_start AND v_end),
      'trial_balance_unbalanced', ((v_tb->'totals'->>'closing_debit')::numeric <> (v_tb->'totals'->>'closing_credit')::numeric)),
    'warnings', jsonb_build_object(
      'bank_lines_unreconciled', (SELECT count(*) FROM public.bank_statement_lines WHERE society_id=_society_id AND status IN ('unmatched','suggested','conflict') AND txn_date BETWEEN _fy_start AND v_end),
      'tax_needs_configuration', (SELECT count(*) FROM public.expense_tax_calculations t JOIN public.expenses x ON x.id=t.expense_id WHERE t.society_id=_society_id AND t.status='needs_configuration' AND x.spent_on BETWEEN _fy_start AND v_end)),
    'totals', v_tb->'totals');
END $$;

CREATE OR REPLACE FUNCTION public.fin_close_year(_society_id uuid, _fy_start date, _confirm text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := public._finance_require_admin(_society_id); v_st jsonb; v_b jsonb; v_fy public.finance_fiscal_years%ROWTYPE; v_end date; v_label text; v_ie jsonb;
BEGIN
  PERFORM public._rate_hit('fin_close', v_uid::text, 20, interval '1 hour');
  PERFORM pg_advisory_xact_lock(hashtext('fin_close:' || _society_id::text));
  v_st := public.fin_year_status(_society_id, _fy_start);
  v_end := (v_st->>'fy_end')::date;
  v_label := 'FY ' || extract(year FROM _fy_start)::int || '-' || lpad(((extract(year FROM _fy_start)::int + 1) % 100)::text, 2, '0');
  IF coalesce(_confirm,'') <> 'CLOSE ' || v_label THEN RAISE EXCEPTION 'confirmation_mismatch' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_fy FROM public.finance_fiscal_years WHERE society_id=_society_id AND fy_start=_fy_start FOR UPDATE;
  IF FOUND AND v_fy.status='closed' THEN RETURN jsonb_build_object('status','already_closed','fy_start',_fy_start); END IF;
  IF NOT (v_st->>'year_ended')::boolean THEN RAISE EXCEPTION 'year_not_ended' USING ERRCODE='55000'; END IF;
  v_b := v_st->'blockers';
  IF (v_b->>'manual_drafts')::int > 0 OR (v_b->>'payments_unposted')::int > 0 OR (v_b->>'income_unposted')::int > 0
     OR (v_b->>'expenses_unposted')::int > 0 OR (v_b->>'trial_balance_unbalanced')::boolean THEN
    RAISE EXCEPTION 'close_blocked' USING ERRCODE='55000';
  END IF;
  v_ie := public._fin_ie_section(_society_id, _fy_start, v_end);
  INSERT INTO public.finance_fiscal_years AS f(society_id, fy_start, fy_end, status, closed_at, closed_by, close_snapshot)
  VALUES (_society_id, _fy_start, v_end, 'closed', now(), v_uid,
          jsonb_build_object('totals', v_st->'totals', 'surplus', v_ie->'surplus', 'total_income', v_ie->'total_income', 'total_expenditure', v_ie->'total_expenditure', 'warnings', v_st->'warnings'))
  ON CONFLICT (society_id, fy_start) DO UPDATE SET status='closed', closed_at=now(), closed_by=v_uid, close_snapshot=EXCLUDED.close_snapshot, updated_at=now();
  INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
  VALUES (v_uid, _society_id, 'finance.year_close', 'finance_fiscal_years', NULL, jsonb_build_object('fy_start', _fy_start, 'surplus', v_ie->'surplus', 'warnings', v_st->'warnings'));
  RETURN jsonb_build_object('status','closed','fy_start',_fy_start);
END $$;

CREATE OR REPLACE FUNCTION public.fin_reopen_year(_society_id uuid, _fy_start date, _reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := public._finance_require_admin(_society_id); v_reason text := btrim(coalesce(_reason,''));
BEGIN
  PERFORM public._rate_hit('fin_close', v_uid::text, 20, interval '1 hour');
  PERFORM pg_advisory_xact_lock(hashtext('fin_close:' || _society_id::text));
  IF char_length(v_reason) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.finance_fiscal_years WHERE society_id=_society_id AND fy_start=_fy_start AND status='closed') THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.finance_fiscal_years WHERE society_id=_society_id AND fy_start>_fy_start AND status='closed') THEN
    RAISE EXCEPTION 'later_year_closed' USING ERRCODE='55000';
  END IF;
  UPDATE public.finance_fiscal_years SET status='open', reopened_at=now(), reopened_by=v_uid, reopen_reason=v_reason, updated_at=now()
  WHERE society_id=_society_id AND fy_start=_fy_start;
  INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
  VALUES (v_uid, _society_id, 'finance.year_reopen', 'finance_fiscal_years', NULL, jsonb_build_object('fy_start', _fy_start, 'reason', v_reason));
  RETURN jsonb_build_object('status','open','fy_start',_fy_start);
END $$;

-- 8. Tally-ready export data (read-only; audit row only, never mutates accounting)
CREATE OR REPLACE FUNCTION public.fin_tally_export(_society_id uuid, _from date, _to date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := public._finance_require_admin(_society_id); v_res jsonb;
BEGIN
  PERFORM public._rate_hit('fin_export', v_uid::text, 30, interval '1 hour');
  IF _from IS NULL OR _to IS NULL OR _from > _to OR _to - _from > 3660 THEN RAISE EXCEPTION 'invalid_period' USING ERRCODE='22023'; END IF;
  SELECT jsonb_build_object(
    'society', (SELECT name FROM public.societies WHERE id=_society_id),
    'from', _from, 'to', _to,
    'ledgers', coalesce((SELECT jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name || ' (' || a.code || ')', 'group',
        CASE WHEN a.system_key='cash' THEN 'Cash-in-Hand' WHEN a.system_key IN ('bank') THEN 'Bank Accounts'
             WHEN a.system_key IN ('maintenance_receivable','other_receivable') THEN 'Sundry Debtors'
             WHEN a.system_key='vendor_payable' THEN 'Sundry Creditors'
             WHEN a.account_type='asset' THEN 'Current Assets' WHEN a.account_type='liability' THEN 'Current Liabilities'
             WHEN a.account_type='equity' THEN 'Capital Account' WHEN a.account_type='income' THEN 'Indirect Incomes' ELSE 'Indirect Expenses' END,
        'opening', coalesce((SELECT sum(l.debit - l.credit) FROM public.finance_journal_lines l JOIN public.finance_journal_entries e ON e.id=l.journal_entry_id
                             WHERE l.account_id=a.id AND e.status IN ('posted','reversed') AND e.transaction_date < _from
                               AND (a.account_type NOT IN ('income','expense') OR e.transaction_date >= public.fin_fy_start(_from))), 0)) ORDER BY a.code)
        FROM public.finance_accounts a WHERE a.society_id=_society_id), '[]'::jsonb),
    'vouchers', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'voucher_no', coalesce(e.journal_no, upper(left(e.source_type,3)) || '-' || to_char(e.transaction_date,'YYYYMMDD') || '-' || left(e.id::text,8)),
        'date', e.transaction_date,
        'type', CASE WHEN e.source_type IN ('payment','income') THEN 'Receipt' WHEN e.source_type='expense' THEN 'Payment' ELSE 'Journal' END,
        'source', e.source_type, 'narration', e.description, 'reference', e.reference,
        'lines', (SELECT jsonb_agg(jsonb_build_object('ledger', a.name || ' (' || a.code || ')', 'debit', l.debit, 'credit', l.credit) ORDER BY l.line_number)
                  FROM public.finance_journal_lines l JOIN public.finance_accounts a ON a.id=l.account_id WHERE l.journal_entry_id=e.id)
      ) ORDER BY e.transaction_date, e.posted_at, e.id)
      FROM public.finance_journal_entries e WHERE e.society_id=_society_id AND e.status IN ('posted','reversed') AND e.transaction_date BETWEEN _from AND _to), '[]'::jsonb)
  ) INTO v_res;
  INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
  VALUES (v_uid, _society_id, 'finance.tally_export', 'finance_journal_entries', NULL,
          jsonb_build_object('from', _from, 'to', _to, 'vouchers', jsonb_array_length(v_res->'vouchers')));
  RETURN v_res;
END $$;

-- 9. Execution grants: authenticated only (each RPC re-checks finance permission server-side)
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'fin_create_account(uuid,text,text,text)', 'fin_list_accounts(uuid)',
    'fin_save_manual_journal(uuid,uuid,date,text,text,jsonb,uuid)', 'fin_transition_manual_journal(uuid,text,text,date,uuid)',
    'fin_list_manual_journals(uuid,text,integer,integer)', 'fin_trial_balance(uuid,date,date)',
    'fin_income_expenditure(uuid,date,date,date,date)', 'fin_balance_sheet(uuid,date,date)',
    'fin_year_status(uuid,date)', 'fin_close_year(uuid,date,text)', 'fin_reopen_year(uuid,date,text)',
    'fin_tally_export(uuid,date,date)', 'admin_set_society_tax_settings(uuid,boolean,text,boolean,text)',
    'admin_set_vendor_tax(uuid,text,text,text,numeric,text,numeric)',
    'admin_calculate_expense_tax(uuid,boolean,numeric,text,text,numeric)', 'fin_tax_report(uuid,date,date)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['_fin_write_manual_lines(uuid,uuid,jsonb)', '_fin_ie_section(uuid,date,date)', '_fin_bs_section(uuid,date)',
    '_fin_manual_balanced(uuid)', '_fin_period_open(uuid,date)', '_finance_block_closed_period()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END $$;
