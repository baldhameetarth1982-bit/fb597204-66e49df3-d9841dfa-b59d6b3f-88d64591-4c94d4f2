-- Finance completion: manual journals, statements, FY close, Tally-ready export, GST/TDS calculation.
-- All built on the canonical finance_accounts / finance_journal_entries / finance_journal_lines ledger.

-- 1. Journal lifecycle extensions (additive)
ALTER TABLE public.finance_journal_entries DROP CONSTRAINT finance_journal_entries_status_check;
ALTER TABLE public.finance_journal_entries ADD CONSTRAINT finance_journal_entries_status_check
  CHECK (status = ANY (ARRAY['draft','in_review','posted','reversed','cancelled']));
ALTER TABLE public.finance_journal_entries ADD COLUMN IF NOT EXISTS journal_no text;
ALTER TABLE public.finance_journal_entries ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE public.finance_journal_entries ADD CONSTRAINT finance_journal_no_len CHECK (journal_no IS NULL OR char_length(journal_no) <= 40);
ALTER TABLE public.finance_journal_entries ADD CONSTRAINT finance_journal_cancel_reason_len CHECK (cancel_reason IS NULL OR char_length(cancel_reason) BETWEEN 5 AND 500);
CREATE UNIQUE INDEX IF NOT EXISTS finance_journal_no_unique ON public.finance_journal_entries(society_id, journal_no) WHERE journal_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS finance_journal_manual_idx ON public.finance_journal_entries(society_id, status, transaction_date DESC) WHERE source_type = 'manual';

CREATE OR REPLACE FUNCTION public._finance_protect_posted()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'posted_history_immutable' USING ERRCODE='55000'; END IF;
  IF OLD.status IN ('posted','reversed','cancelled') THEN RAISE EXCEPTION 'posted_history_immutable' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._finance_protect_lines()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_entry uuid := COALESCE(NEW.journal_entry_id,OLD.journal_entry_id); v_status text;
BEGIN
  SELECT status INTO v_status FROM public.finance_journal_entries WHERE id=v_entry;
  IF v_status IN ('posted','reversed','cancelled') THEN RAISE EXCEPTION 'posted_history_immutable' USING ERRCODE='55000'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TABLE public.finance_journal_sequences (
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  fy_start date NOT NULL,
  last_no integer NOT NULL DEFAULT 0,
  PRIMARY KEY (society_id, fy_start)
);
GRANT ALL ON public.finance_journal_sequences TO service_role;
ALTER TABLE public.finance_journal_sequences ENABLE ROW LEVEL SECURITY;

-- 2. Financial years
CREATE OR REPLACE FUNCTION public.fin_fy_start(_d date) RETURNS date LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT make_date(CASE WHEN extract(month FROM _d) >= 4 THEN extract(year FROM _d)::int ELSE extract(year FROM _d)::int - 1 END, 4, 1)
$$;

CREATE TABLE public.finance_fiscal_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  fy_start date NOT NULL,
  fy_end date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_at timestamptz, closed_by uuid,
  close_snapshot jsonb,
  reopened_at timestamptz, reopened_by uuid, reopen_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (society_id, fy_start),
  CHECK (extract(month FROM fy_start) = 4 AND extract(day FROM fy_start) = 1 AND fy_end = (fy_start + interval '1 year' - interval '1 day')::date),
  CHECK (reopen_reason IS NULL OR char_length(reopen_reason) BETWEEN 10 AND 500)
);
GRANT SELECT ON public.finance_fiscal_years TO authenticated;
GRANT ALL ON public.finance_fiscal_years TO service_role;
ALTER TABLE public.finance_fiscal_years ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_fiscal_years_admin_read ON public.finance_fiscal_years FOR SELECT TO authenticated
  USING (public.resolve_financial_visibility(society_id) = 'admin' AND public._finance_plan_enabled(society_id));

-- Closed-period guard: applies to EVERY posting path (payments, income, expenses, manual journals).
CREATE OR REPLACE FUNCTION public._finance_block_closed_period()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status IN ('posted','reversed') AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    IF EXISTS (SELECT 1 FROM public.finance_fiscal_years f
               WHERE f.society_id = NEW.society_id AND f.status = 'closed'
                 AND NEW.transaction_date BETWEEN f.fy_start AND f.fy_end) THEN
      RAISE EXCEPTION 'period_closed' USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finance_journal_entries_closed_period BEFORE INSERT OR UPDATE OF status ON public.finance_journal_entries
  FOR EACH ROW EXECUTE FUNCTION public._finance_block_closed_period();

CREATE OR REPLACE FUNCTION public._fin_period_open(_society_id uuid, _d date) RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.finance_fiscal_years f WHERE f.society_id=_society_id AND f.status='closed' AND _d BETWEEN f.fy_start AND f.fy_end)
$$;

-- 3. Chart of accounts: controlled custom accounts (funds, reserves, TDS/GST, deposits)
CREATE OR REPLACE FUNCTION public.fin_create_account(_society_id uuid, _code text, _name text, _account_type text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := public._finance_require_admin(_society_id); v_id uuid; v_code text := upper(btrim(coalesce(_code,'')));
BEGIN
  PERFORM public._rate_hit('fin_account', v_uid::text, 30, interval '1 hour');
  IF _account_type NOT IN ('asset','liability','income','expense','equity') THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  PERFORM public._finance_seed_accounts(_society_id, v_uid);
  INSERT INTO public.finance_accounts(society_id, code, name, account_type, normal_balance, is_system, created_by)
  VALUES (_society_id, v_code, btrim(_name), _account_type,
          CASE WHEN _account_type IN ('asset','expense') THEN 'debit' ELSE 'credit' END, false, v_uid)
  RETURNING id INTO v_id;
  INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
  VALUES (v_uid, _society_id, 'finance.account_create', 'finance_accounts', v_id, jsonb_build_object('code', v_code, 'type', _account_type));
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'account_code_exists' USING ERRCODE='22023';
         WHEN check_violation THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
END $$;

CREATE OR REPLACE FUNCTION public.fin_list_accounts(_society_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public._finance_require_admin(_society_id);
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'account_type',account_type,'is_system',is_system,'is_active',is_active) ORDER BY code)
                   FROM public.finance_accounts WHERE society_id=_society_id), '[]'::jsonb);
END $$;

-- 4. Manual journals
CREATE OR REPLACE FUNCTION public._fin_write_manual_lines(_society_id uuid, _entry uuid, _lines jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r jsonb; i int := 0; v_acc uuid; v_dr numeric; v_cr numeric; v_desc text;
BEGIN
  IF jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) < 2 OR jsonb_array_length(_lines) > 50 THEN
    RAISE EXCEPTION 'invalid_lines' USING ERRCODE='22023';
  END IF;
  DELETE FROM public.finance_journal_lines WHERE journal_entry_id=_entry;
  FOR r IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    i := i + 1;
    BEGIN
      v_acc := (r->>'account_id')::uuid;
      v_dr := coalesce(nullif(r->>'debit','')::numeric, 0);
      v_cr := coalesce(nullif(r->>'credit','')::numeric, 0);
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid_lines' USING ERRCODE='22023'; END;
    v_desc := nullif(btrim(coalesce(r->>'description','')), '');
    IF v_dr < 0 OR v_cr < 0 OR (v_dr > 0) = (v_cr > 0) OR v_dr > 100000000 OR v_cr > 100000000
       OR v_dr <> round(v_dr,2) OR v_cr <> round(v_cr,2) OR (v_desc IS NOT NULL AND char_length(v_desc) > 200) THEN
      RAISE EXCEPTION 'invalid_amount' USING ERRCODE='22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.finance_accounts WHERE id=v_acc AND society_id=_society_id AND is_active) THEN
      RAISE EXCEPTION 'account_unavailable' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.finance_journal_lines(society_id, journal_entry_id, account_id, line_number, description, debit, credit)
    VALUES (_society_id, _entry, v_acc, i, v_desc, v_dr, v_cr);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.fin_save_manual_journal(_society_id uuid, _journal_id uuid, _transaction_date date, _description text, _reference text, _lines jsonb, _request_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := public._finance_require_admin(_society_id); v_e public.finance_journal_entries%ROWTYPE; v_id uuid;
  v_desc text := btrim(coalesce(_description,'')); v_ref text := nullif(btrim(coalesce(_reference,'')),'');
BEGIN
  PERFORM public._rate_hit('fin_journal', v_uid::text, 120, interval '1 hour');
  IF _transaction_date IS NULL OR _transaction_date > CURRENT_DATE OR _transaction_date < DATE '2000-04-01' THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE='22023'; END IF;
  IF char_length(v_desc) NOT BETWEEN 2 AND 500 OR (v_ref IS NOT NULL AND char_length(v_ref) > 120) THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  IF NOT public._fin_period_open(_society_id, _transaction_date) THEN RAISE EXCEPTION 'period_closed' USING ERRCODE='55000'; END IF;
  IF _journal_id IS NULL THEN
    IF _request_id IS NULL THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
    SELECT * INTO v_e FROM public.finance_journal_entries WHERE society_id=_society_id AND source_type='manual' AND source_id=_request_id;
    IF FOUND THEN RETURN v_e.id; END IF; -- idempotent retry
    INSERT INTO public.finance_journal_entries(society_id, transaction_date, description, reference, source_type, source_id, source_action, status, created_by)
    VALUES (_society_id, _transaction_date, v_desc, v_ref, 'manual', _request_id, 'post', 'draft', v_uid) RETURNING id INTO v_id;
  ELSE
    SELECT * INTO v_e FROM public.finance_journal_entries WHERE id=_journal_id FOR UPDATE;
    IF NOT FOUND OR v_e.society_id <> _society_id OR v_e.source_type <> 'manual' THEN RAISE EXCEPTION 'not_found' USING ERRCODE='22023'; END IF;
    IF v_e.status NOT IN ('draft','in_review') THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='55000'; END IF;
    UPDATE public.finance_journal_entries SET transaction_date=_transaction_date, description=v_desc, reference=v_ref, status='draft' WHERE id=_journal_id;
    v_id := _journal_id;
  END IF;
  PERFORM public._fin_write_manual_lines(_society_id, v_id, _lines);
  INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
  VALUES (v_uid, _society_id, CASE WHEN _journal_id IS NULL THEN 'finance.manual_journal_draft' ELSE 'finance.manual_journal_edit' END, 'finance_journal_entries', v_id,
          jsonb_build_object('lines', jsonb_array_length(_lines)));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public._fin_manual_balanced(_entry uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT count(*) >= 2 AND coalesce(sum(debit),0) > 0 AND coalesce(sum(debit),0) = coalesce(sum(credit),0)
  FROM public.finance_journal_lines WHERE journal_entry_id=_entry
$$;

CREATE OR REPLACE FUNCTION public.fin_transition_manual_journal(_journal_id uuid, _action text, _reason text DEFAULT NULL, _reversal_date date DEFAULT NULL, _request_id uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_e public.finance_journal_entries%ROWTYPE; v_uid uuid; v_fy date; v_no int; v_jno text; v_rev uuid; v_date date;
  v_reason text := nullif(btrim(coalesce(_reason,'')),'');
BEGIN
  SELECT * INTO v_e FROM public.finance_journal_entries WHERE id=_journal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='22023'; END IF;
  v_uid := public._finance_require_admin(v_e.society_id);
  IF v_e.source_type <> 'manual' THEN RAISE EXCEPTION 'not_found' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('fin_journal', v_uid::text, 120, interval '1 hour');

  IF _action = 'submit' THEN
    IF v_e.status <> 'draft' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='55000'; END IF;
    IF NOT public._fin_manual_balanced(v_e.id) THEN RAISE EXCEPTION 'journal_unbalanced' USING ERRCODE='23514'; END IF;
    UPDATE public.finance_journal_entries SET status='in_review' WHERE id=v_e.id;
  ELSIF _action = 'post' THEN
    IF v_e.status NOT IN ('draft','in_review') THEN
      IF v_e.status = 'posted' THEN RETURN jsonb_build_object('status','posted','journal_id',v_e.id,'journal_no',v_e.journal_no); END IF;
      RAISE EXCEPTION 'invalid_transition' USING ERRCODE='55000';
    END IF;
    IF v_e.transaction_date > CURRENT_DATE THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE='22023'; END IF;
    IF NOT public._fin_manual_balanced(v_e.id) THEN RAISE EXCEPTION 'journal_unbalanced' USING ERRCODE='23514'; END IF;
    IF NOT public._fin_period_open(v_e.society_id, v_e.transaction_date) THEN RAISE EXCEPTION 'period_closed' USING ERRCODE='55000'; END IF;
    v_fy := public.fin_fy_start(v_e.transaction_date);
    INSERT INTO public.finance_journal_sequences(society_id, fy_start, last_no) VALUES (v_e.society_id, v_fy, 1)
      ON CONFLICT (society_id, fy_start) DO UPDATE SET last_no = public.finance_journal_sequences.last_no + 1
      RETURNING last_no INTO v_no;
    v_jno := 'MJ/' || extract(year FROM v_fy)::int || '-' || lpad(((extract(year FROM v_fy)::int + 1) % 100)::text, 2, '0') || '/' || lpad(v_no::text, 4, '0');
    UPDATE public.finance_journal_entries SET status='posted', posted_at=now(), journal_no=v_jno WHERE id=v_e.id;
  ELSIF _action = 'cancel' THEN
    IF v_e.status NOT IN ('draft','in_review') THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='55000'; END IF;
    IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
    UPDATE public.finance_journal_entries SET status='cancelled', cancel_reason=v_reason WHERE id=v_e.id;
  ELSIF _action = 'reverse' THEN
    IF v_e.status <> 'posted' OR v_e.source_action <> 'post' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='55000'; END IF;
    IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
    SELECT id INTO v_rev FROM public.finance_journal_entries WHERE reversal_of=v_e.id;
    IF v_rev IS NOT NULL THEN RETURN jsonb_build_object('status','reversed','journal_id',v_rev); END IF;
    v_date := coalesce(_reversal_date, CURRENT_DATE);
    IF v_date > CURRENT_DATE OR v_date < v_e.transaction_date THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE='22023'; END IF;
    IF NOT public._fin_period_open(v_e.society_id, v_date) THEN RAISE EXCEPTION 'period_closed' USING ERRCODE='55000'; END IF;
    INSERT INTO public.finance_journal_entries(society_id, transaction_date, description, reference, source_type, source_id, source_action, status, reversal_of, created_by)
    VALUES (v_e.society_id, v_date, left('Reversal of ' || coalesce(v_e.journal_no, 'journal') || ': ' || v_reason, 500), v_e.journal_no, 'manual',
            coalesce(_request_id, gen_random_uuid()), 'reverse', 'draft', v_e.id, v_uid) RETURNING id INTO v_rev;
    INSERT INTO public.finance_journal_lines(society_id, journal_entry_id, account_id, line_number, description, debit, credit)
      SELECT society_id, v_rev, account_id, line_number, description, credit, debit FROM public.finance_journal_lines WHERE journal_entry_id=v_e.id;
    UPDATE public.finance_journal_entries SET status='reversed', posted_at=now() WHERE id=v_rev;
  ELSE
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
  VALUES (v_uid, v_e.society_id, 'finance.manual_journal_' || _action, 'finance_journal_entries', v_e.id,
          jsonb_strip_nulls(jsonb_build_object('journal_no', coalesce(v_jno, v_e.journal_no), 'reason', v_reason, 'reversal_id', v_rev)));
  RETURN jsonb_strip_nulls(jsonb_build_object('status', CASE _action WHEN 'submit' THEN 'in_review' WHEN 'post' THEN 'posted' WHEN 'cancel' THEN 'cancelled' ELSE 'reversed' END,
                            'journal_id', coalesce(v_rev, v_e.id), 'journal_no', v_jno));
END $$;

CREATE OR REPLACE FUNCTION public.fin_list_manual_journals(_society_id uuid, _status text, _limit int, _offset int)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public._finance_require_admin(_society_id);
  IF _limit IS NULL OR _limit < 1 OR _limit > 100 OR _offset < 0 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY (x->>'transaction_date') DESC, (x->>'created_at') DESC) FROM (
      SELECT jsonb_build_object(
        'id', e.id, 'journal_no', e.journal_no, 'transaction_date', e.transaction_date, 'description', e.description,
        'reference', e.reference, 'status', e.status, 'source_action', e.source_action, 'reversal_of', e.reversal_of,
        'reversed_by_id', (SELECT r.id FROM public.finance_journal_entries r WHERE r.reversal_of=e.id),
        'cancel_reason', e.cancel_reason, 'created_at', e.created_at, 'posted_at', e.posted_at,
        'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('account_id', l.account_id, 'code', a.code, 'name', a.name, 'debit', l.debit, 'credit', l.credit, 'description', l.description) ORDER BY l.line_number)
                           FROM public.finance_journal_lines l JOIN public.finance_accounts a ON a.id=l.account_id WHERE l.journal_entry_id=e.id), '[]'::jsonb)
      ) AS x
      FROM public.finance_journal_entries e
      WHERE e.society_id=_society_id AND e.source_type='manual' AND (_status IS NULL OR _status='all' OR e.status=_status)
      ORDER BY e.transaction_date DESC, e.created_at DESC LIMIT _limit OFFSET _offset
    ) s), '[]'::jsonb);
END $$;

-- 5. Statements (canonical posted ledger only: status posted/reversed)
CREATE OR REPLACE FUNCTION public.fin_trial_balance(_society_id uuid, _from date, _to date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_fy date; v_rows jsonb; v_prior numeric;
BEGIN
  PERFORM public._finance_require_admin(_society_id);
  IF _from IS NULL OR _to IS NULL OR _from > _to OR _to - _from > 3660 THEN RAISE EXCEPTION 'invalid_period' USING ERRCODE='22023'; END IF;
  v_fy := public.fin_fy_start(_from);
  WITH mv AS (
    SELECT l.account_id,
      coalesce(sum(l.debit - l.credit) FILTER (WHERE e.transaction_date < _from), 0) AS before_net,
      coalesce(sum(l.debit - l.credit) FILTER (WHERE e.transaction_date >= v_fy AND e.transaction_date < _from), 0) AS fy_before_net,
      coalesce(sum(l.debit) FILTER (WHERE e.transaction_date BETWEEN _from AND _to), 0) AS pd,
      coalesce(sum(l.credit) FILTER (WHERE e.transaction_date BETWEEN _from AND _to), 0) AS pc
    FROM public.finance_journal_lines l JOIN public.finance_journal_entries e ON e.id=l.journal_entry_id
    WHERE l.society_id=_society_id AND e.society_id=_society_id AND e.status IN ('posted','reversed') AND e.transaction_date <= _to
    GROUP BY l.account_id
  ), r AS (
    SELECT a.code, a.name, a.account_type,
      CASE WHEN a.account_type IN ('income','expense') THEN coalesce(mv.fy_before_net,0) ELSE coalesce(mv.before_net,0) END AS opening,
      coalesce(mv.pd,0) AS pd, coalesce(mv.pc,0) AS pc
    FROM public.finance_accounts a LEFT JOIN mv ON mv.account_id=a.id
    WHERE a.society_id=_society_id AND (mv.account_id IS NOT NULL OR a.is_active)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('code',code,'name',name,'account_type',account_type,
      'opening_debit', greatest(opening,0), 'opening_credit', greatest(-opening,0),
      'period_debit', pd, 'period_credit', pc,
      'closing_debit', greatest(opening+pd-pc,0), 'closing_credit', greatest(-(opening+pd-pc),0)) ORDER BY code), '[]'::jsonb)
  INTO v_rows FROM r;
  -- prior-year income/expense rolled into accumulated surplus so the trial balance stays balanced
  SELECT coalesce(sum(l.credit - l.debit),0) INTO v_prior
  FROM public.finance_journal_lines l JOIN public.finance_journal_entries e ON e.id=l.journal_entry_id JOIN public.finance_accounts a ON a.id=l.account_id
  WHERE l.society_id=_society_id AND e.status IN ('posted','reversed') AND e.transaction_date < v_fy AND a.account_type IN ('income','expense');
  IF v_prior <> 0 THEN
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('code','SURPLUS','name','Accumulated surplus / (deficit) — prior years','account_type','equity',
      'opening_debit', greatest(-v_prior,0), 'opening_credit', greatest(v_prior,0), 'period_debit',0,'period_credit',0,
      'closing_debit', greatest(-v_prior,0), 'closing_credit', greatest(v_prior,0)));
  END IF;
  RETURN jsonb_build_object('from',_from,'to',_to,'fy_start',v_fy,'rows',v_rows,
    'totals', (SELECT jsonb_build_object(
      'opening_debit', coalesce(sum((x->>'opening_debit')::numeric),0), 'opening_credit', coalesce(sum((x->>'opening_credit')::numeric),0),
      'period_debit', coalesce(sum((x->>'period_debit')::numeric),0), 'period_credit', coalesce(sum((x->>'period_credit')::numeric),0),
      'closing_debit', coalesce(sum((x->>'closing_debit')::numeric),0), 'closing_credit', coalesce(sum((x->>'closing_credit')::numeric),0))
      FROM jsonb_array_elements(v_rows) x));
END $$;

CREATE OR REPLACE FUNCTION public._fin_ie_section(_society_id uuid, _from date, _to date)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH b AS (
    SELECT a.code, a.name, a.account_type,
      CASE WHEN a.account_type='income' THEN sum(l.credit - l.debit) ELSE sum(l.debit - l.credit) END AS amount
    FROM public.finance_journal_lines l JOIN public.finance_journal_entries e ON e.id=l.journal_entry_id JOIN public.finance_accounts a ON a.id=l.account_id
    WHERE l.society_id=_society_id AND e.status IN ('posted','reversed') AND e.transaction_date BETWEEN _from AND _to AND a.account_type IN ('income','expense')
    GROUP BY a.code, a.name, a.account_type
  )
  SELECT jsonb_build_object('from',_from,'to',_to,
    'income', coalesce((SELECT jsonb_agg(jsonb_build_object('code',code,'name',name,'amount',amount) ORDER BY code) FROM b WHERE account_type='income'),'[]'::jsonb),
    'expenditure', coalesce((SELECT jsonb_agg(jsonb_build_object('code',code,'name',name,'amount',amount) ORDER BY code) FROM b WHERE account_type='expense'),'[]'::jsonb),
    'total_income', coalesce((SELECT sum(amount) FROM b WHERE account_type='income'),0),
    'total_expenditure', coalesce((SELECT sum(amount) FROM b WHERE account_type='expense'),0),
    'surplus', coalesce((SELECT sum(CASE WHEN account_type='income' THEN amount ELSE -amount END) FROM b),0))
$$;

CREATE OR REPLACE FUNCTION public.fin_income_expenditure(_society_id uuid, _from date, _to date, _cmp_from date DEFAULT NULL, _cmp_to date DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public._finance_require_admin(_society_id);
  IF _from IS NULL OR _to IS NULL OR _from > _to OR (_cmp_from IS NULL) <> (_cmp_to IS NULL) OR _cmp_from > _cmp_to THEN RAISE EXCEPTION 'invalid_period' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('current', public._fin_ie_section(_society_id,_from,_to),
    'comparative', CASE WHEN _cmp_from IS NULL THEN NULL ELSE public._fin_ie_section(_society_id,_cmp_from,_cmp_to) END);
END $$;

CREATE OR REPLACE FUNCTION public._fin_bs_section(_society_id uuid, _as_of date)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH b AS (
    SELECT a.code, a.name, a.account_type, sum(l.debit - l.credit) AS net
    FROM public.finance_journal_lines l JOIN public.finance_journal_entries e ON e.id=l.journal_entry_id JOIN public.finance_accounts a ON a.id=l.account_id
    WHERE l.society_id=_society_id AND e.status IN ('posted','reversed') AND e.transaction_date <= _as_of
    GROUP BY a.code, a.name, a.account_type
  ), s AS (
    SELECT
      coalesce((SELECT -sum(net) FROM b WHERE account_type IN ('income','expense')),0) AS total_surplus,
      coalesce((SELECT -sum(l.debit - l.credit) FROM public.finance_journal_lines l JOIN public.finance_journal_entries e ON e.id=l.journal_entry_id JOIN public.finance_accounts a ON a.id=l.account_id
                WHERE l.society_id=_society_id AND e.status IN ('posted','reversed') AND e.transaction_date >= public.fin_fy_start(_as_of) AND e.transaction_date <= _as_of AND a.account_type IN ('income','expense')),0) AS current_surplus
  )
  SELECT jsonb_build_object('as_of',_as_of,
    'assets', coalesce((SELECT jsonb_agg(jsonb_build_object('code',code,'name',name,'amount',net) ORDER BY code) FROM b WHERE account_type='asset' AND net<>0),'[]'::jsonb),
    'liabilities', coalesce((SELECT jsonb_agg(jsonb_build_object('code',code,'name',name,'amount',-net) ORDER BY code) FROM b WHERE account_type='liability' AND net<>0),'[]'::jsonb),
    'funds', coalesce((SELECT jsonb_agg(jsonb_build_object('code',code,'name',name,'amount',-net) ORDER BY code) FROM b WHERE account_type='equity' AND net<>0),'[]'::jsonb),
    'prior_surplus', (SELECT total_surplus - current_surplus FROM s),
    'current_surplus', (SELECT current_surplus FROM s),
    'total_assets', coalesce((SELECT sum(net) FROM b WHERE account_type='asset'),0),
    'total_liabilities', coalesce((SELECT -sum(net) FROM b WHERE account_type='liability'),0),
    'total_funds', coalesce((SELECT -sum(net) FROM b WHERE account_type='equity'),0) + (SELECT total_surplus FROM s))
$$;

CREATE OR REPLACE FUNCTION public.fin_balance_sheet(_society_id uuid, _as_of date, _cmp_as_of date DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public._finance_require_admin(_society_id);
  IF _as_of IS NULL OR (_cmp_as_of IS NOT NULL AND _cmp_as_of >= _as_of) THEN RAISE EXCEPTION 'invalid_period' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('current', public._fin_bs_section(_society_id,_as_of),
    'comparative', CASE WHEN _cmp_as_of IS NULL THEN NULL ELSE public._fin_bs_section(_society_id,_cmp_as_of) END);
END $$;

-- 6. Financial-year close
CREATE OR REPLACE FUNCTION public.fin_year_status(_society_id uuid, _fy_start date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_end date; v_fy public.finance_fiscal_years%ROWTYPE; v_tb jsonb;
BEGIN
  PERFORM public._finance_require_admin(_society_id);
  IF _fy_start IS NULL OR _fy_start <> public.fin_fy_start(_fy_start) THEN RAISE EXCEPTION 'invalid_period' USING ERRCODE='22023'; END IF;
  v_end := (_fy_start + interval '1 year' - interval '1 day')::date;
  SELECT * INTO v_fy FROM public.finance_fiscal_years WHERE society_id=_society_id AND fy_start=_fy_start;
  v_tb := public.fin_trial_balance(_society_id, _fy_start, least(v_end, greatest(CURRENT_DATE, _fy_start)));
  RETURN jsonb_build_object(
    'fy_start', _fy_start, 'fy_end', v_end, 'status', coalesce(v_fy.status,'open'),
    'closed_at', v_fy.closed_at, 'reopened_at', v_fy.reopened_at, 'reopen_reason', v_fy.reopen_reason, 'snapshot', v_fy.close_snapshot,
    'year_ended', v_end < CURRENT_DATE,
    'blockers', jsonb_build_object(
      'manual_drafts', (SELECT count(*) FROM public.finance_journal_entries WHERE society_id=_society_id AND source_type='manual' AND status IN ('draft','in_review') AND transaction_date BETWEEN _fy_start AND v_end),
      'payments_unposted', (SELECT count(*) FROM public.payments WHERE society_id=_society_id AND status='verified' AND journal_entry_id IS NULL AND method IN ('cash','bank_transfer') AND coalesce(paid_at::date, created_at::date) BETWEEN _fy_start AND v_end),
      'income_unposted', (SELECT count(*) FROM public.society_income_records WHERE society_id=_society_id AND verification_status='verified' AND journal_entry_id IS NULL AND payment_method IN ('cash','bank_transfer') AND created_at::date BETWEEN _fy_start AND v_end),
      'expenses_unposted', (SELECT count(*) FROM public.expenses WHERE society_id=_society_id AND status IN ('draft','pending') AND spent_on BETWEEN _fy_start AND v_end),
      'trial_balance_unbalanced', ((v_tb->'totals'->>'closing_debit')::numeric <> (v_tb->'totals'->>'closing_credit')::numeric)),
    'warnings', jsonb_build_object(
      'bank_lines_unreconciled', (SELECT count(*) FROM public.bank_statement_lines WHERE society_id=_society_id AND status IN ('unmatched','suggested','conflict') AND txn_date BETWEEN _fy_start AND v_end),
      'tax_needs_configuration', (SELECT count(*) FROM public.expense_tax_calculations t JOIN public.expenses x ON x.id=t.expense_id WHERE t.society_id=_society_id AND t.status='needs_configuration' AND x.spent_on BETWEEN _fy_start AND v_end)),
    'totals', v_tb->'totals');
END $$;
