CREATE TABLE public.finance_backfill_requests (
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (society_id, request_id),
  CONSTRAINT finance_backfill_result_object CHECK (jsonb_typeof(result) = 'object')
);
GRANT ALL ON public.finance_backfill_requests TO service_role;
ALTER TABLE public.finance_backfill_requests ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._finance_protect_backfill_request()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'finance_backfill_request_immutable' USING ERRCODE = '55000';
END
$$;
REVOKE ALL ON FUNCTION public._finance_protect_backfill_request() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._finance_protect_backfill_request() TO service_role;
CREATE TRIGGER finance_backfill_requests_immutable
BEFORE UPDATE OR DELETE ON public.finance_backfill_requests
FOR EACH ROW EXECUTE FUNCTION public._finance_protect_backfill_request();

CREATE OR REPLACE FUNCTION public._finance_post_entry(
  _society_id uuid, _actor_id uuid, _transaction_date date, _description text,
  _reference text, _source_type text, _source_id uuid, _source_action text,
  _debit_system_key text, _credit_system_key text, _amount numeric,
  _reversal_of uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.finance_journal_entries%ROWTYPE;
  v_parent public.finance_journal_entries%ROWTYPE;
  v_entry uuid;
  v_debit uuid;
  v_credit uuid;
  v_sum_debit numeric;
  v_sum_credit numeric;
  v_lines int;
  v_source_society uuid;
  v_existing_debit_key text;
  v_existing_credit_key text;
  v_existing_amount numeric;
  v_expected_post_type text;
  v_description text := btrim(coalesce(_description, ''));
  v_reference text := nullif(btrim(coalesce(_reference, '')), '');
BEGIN
  IF _society_id IS NULL OR _actor_id IS NULL OR _source_id IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  IF _transaction_date IS NULL OR _transaction_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'invalid_date' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_description) NOT BETWEEN 2 AND 500 OR (v_reference IS NOT NULL AND char_length(v_reference) > 120) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  IF _amount IS NULL OR _amount <= 0 OR _amount > 100000000 OR _amount <> round(_amount, 2) THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;
  IF (_source_action = 'post' AND _source_type NOT IN ('payment', 'income', 'expense'))
     OR (_source_action = 'reverse' AND _source_type NOT IN ('payment_reversal', 'income_reversal', 'expense_reversal'))
     OR _source_action NOT IN ('post', 'reverse') THEN
    RAISE EXCEPTION 'invalid_source_action' USING ERRCODE = '22023';
  END IF;

  IF _source_type IN ('payment', 'payment_reversal') THEN
    SELECT society_id INTO v_source_society FROM public.payments WHERE id = _source_id;
  ELSIF _source_type IN ('income', 'income_reversal') THEN
    SELECT society_id INTO v_source_society FROM public.society_income_records WHERE id = _source_id;
  ELSIF _source_type IN ('expense', 'expense_reversal') THEN
    SELECT society_id INTO v_source_society FROM public.expenses WHERE id = _source_id;
  END IF;
  IF v_source_society IS NULL OR v_source_society <> _society_id THEN
    RAISE EXCEPTION 'cross_society_finance_reference' USING ERRCODE = '23514';
  END IF;

  PERFORM public._finance_seed_accounts(_society_id, _actor_id);
  SELECT id INTO v_debit FROM public.finance_accounts
    WHERE society_id = _society_id AND system_key = _debit_system_key AND is_active FOR SHARE;
  SELECT id INTO v_credit FROM public.finance_accounts
    WHERE society_id = _society_id AND system_key = _credit_system_key AND is_active FOR SHARE;
  IF v_debit IS NULL OR v_credit IS NULL OR v_debit = v_credit THEN
    RAISE EXCEPTION 'account_unavailable' USING ERRCODE = '22023';
  END IF;

  IF _source_action = 'reverse' THEN
    v_expected_post_type := CASE _source_type
      WHEN 'payment_reversal' THEN 'payment'
      WHEN 'income_reversal' THEN 'income'
      WHEN 'expense_reversal' THEN 'expense'
    END;
    SELECT * INTO v_parent FROM public.finance_journal_entries WHERE id = _reversal_of FOR SHARE;
    IF NOT FOUND
       OR v_parent.society_id <> _society_id
       OR v_parent.source_type <> v_expected_post_type
       OR v_parent.source_id <> _source_id
       OR v_parent.source_action <> 'post'
       OR v_parent.status <> 'posted'
       OR v_parent.reversal_of IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.finance_journal_entries r WHERE r.reversal_of = v_parent.id) THEN
      RAISE EXCEPTION 'invalid_reversal' USING ERRCODE = '22023';
    END IF;
  ELSIF _reversal_of IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_reversal' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM public.finance_journal_entries
  WHERE society_id = _society_id AND source_type = _source_type AND source_id = _source_id;
  IF FOUND THEN
    SELECT
      max(a.system_key) FILTER (WHERE l.debit > 0),
      max(a.system_key) FILTER (WHERE l.credit > 0),
      max(l.debit) FILTER (WHERE l.debit > 0)
    INTO v_existing_debit_key, v_existing_credit_key, v_existing_amount
    FROM public.finance_journal_lines l
    JOIN public.finance_accounts a ON a.id = l.account_id AND a.society_id = l.society_id
    WHERE l.journal_entry_id = v_existing.id;

    IF v_existing.transaction_date = _transaction_date
       AND v_existing.description = v_description
       AND v_existing.reference IS NOT DISTINCT FROM v_reference
       AND v_existing.source_action = _source_action
       AND v_existing.reversal_of IS NOT DISTINCT FROM _reversal_of
       AND v_existing_debit_key = _debit_system_key
       AND v_existing_credit_key = _credit_system_key
       AND v_existing_amount = _amount THEN
      RETURN v_existing.id;
    END IF;
    RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.finance_journal_entries(
    society_id, transaction_date, description, reference, source_type, source_id,
    source_action, status, reversal_of, created_by
  ) VALUES (
    _society_id, _transaction_date, v_description, v_reference, _source_type, _source_id,
    _source_action, 'draft', _reversal_of, _actor_id
  ) RETURNING id INTO v_entry;

  INSERT INTO public.finance_journal_lines(society_id, journal_entry_id, account_id, line_number, debit, credit)
  VALUES (_society_id, v_entry, v_debit, 1, _amount, 0),
         (_society_id, v_entry, v_credit, 2, 0, _amount);

  SELECT count(*), sum(debit), sum(credit)
  INTO v_lines, v_sum_debit, v_sum_credit
  FROM public.finance_journal_lines WHERE journal_entry_id = v_entry;
  IF v_lines <> 2 OR v_sum_debit <= 0 OR v_sum_debit <> v_sum_credit THEN
    RAISE EXCEPTION 'journal_unbalanced' USING ERRCODE = '23514';
  END IF;

  UPDATE public.finance_journal_entries
  SET status = CASE WHEN _source_action = 'reverse' THEN 'reversed' ELSE 'posted' END,
      posted_at = now()
  WHERE id = v_entry;

  INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
  VALUES (_actor_id, _society_id, 'finance.journal_' || _source_action,
          'finance_journal_entries', v_entry,
          jsonb_build_object('source_type', _source_type, 'source_id', _source_id,
                             'amount', _amount, 'reversal_of', _reversal_of));
  RETURN v_entry;
EXCEPTION WHEN unique_violation THEN
  SELECT * INTO v_existing
  FROM public.finance_journal_entries
  WHERE society_id = _society_id AND source_type = _source_type AND source_id = _source_id;
  IF FOUND THEN
    SELECT
      max(a.system_key) FILTER (WHERE l.debit > 0),
      max(a.system_key) FILTER (WHERE l.credit > 0),
      max(l.debit) FILTER (WHERE l.debit > 0)
    INTO v_existing_debit_key, v_existing_credit_key, v_existing_amount
    FROM public.finance_journal_lines l
    JOIN public.finance_accounts a ON a.id = l.account_id AND a.society_id = l.society_id
    WHERE l.journal_entry_id = v_existing.id;
    IF v_existing.transaction_date = _transaction_date
       AND v_existing.description = v_description
       AND v_existing.reference IS NOT DISTINCT FROM v_reference
       AND v_existing.source_action = _source_action
       AND v_existing.reversal_of IS NOT DISTINCT FROM _reversal_of
       AND v_existing_debit_key = _debit_system_key
       AND v_existing_credit_key = _credit_system_key
       AND v_existing_amount = _amount THEN
      RETURN v_existing.id;
    END IF;
  END IF;
  RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '22023';
END
$$;
REVOKE ALL ON FUNCTION public._finance_post_entry(uuid,uuid,date,text,text,text,uuid,text,text,text,numeric,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._finance_post_entry(uuid,uuid,date,text,text,text,uuid,text,text,text,numeric,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._finance_income_posting_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_journal uuid;
  v_original uuid;
  v_income_account text;
BEGIN
  IF NEW.verification_status IN ('verified', 'reversed') AND OLD.verification_status IS DISTINCT FROM NEW.verification_status THEN
    v_income_account := CASE
      WHEN NEW.payment_method = 'cash' THEN 'cash'
      WHEN NEW.payment_method = 'bank_transfer' THEN 'bank'
      ELSE NULL
    END;
    IF v_income_account IS NULL THEN
      RAISE EXCEPTION 'unsupported_payment_method' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.verification_status = 'verified' AND OLD.verification_status IS DISTINCT FROM 'verified' THEN
    v_journal := public._finance_post_entry(
      NEW.society_id, COALESCE(NEW.verified_by, auth.uid()),
      COALESCE(NEW.payment_date::date, NEW.verified_at::date, CURRENT_DATE),
      'Society income', NEW.reference_number, 'income', NEW.id, 'post',
      v_income_account, 'other_income', NEW.amount, NULL
    );
    NEW.journal_entry_id := v_journal;
  ELSIF NEW.verification_status = 'reversed' AND OLD.verification_status = 'verified' THEN
    v_original := COALESCE(OLD.journal_entry_id, NEW.journal_entry_id);
    IF v_original IS NULL THEN
      RAISE EXCEPTION 'journal_missing' USING ERRCODE = '55000';
    END IF;
    v_journal := public._finance_post_entry(
      NEW.society_id, COALESCE(NEW.reversed_by, auth.uid()),
      COALESCE(NEW.reversed_at::date, CURRENT_DATE),
      'Reversal: society income', NEW.reference_number, 'income_reversal', NEW.id, 'reverse',
      'other_income', v_income_account, NEW.amount, v_original
    );
    NEW.reversal_journal_entry_id := v_journal;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public._finance_income_posting_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._finance_income_posting_trigger() TO service_role;

CREATE OR REPLACE FUNCTION public.create_finance_expense(
  _society_id uuid, _vendor_id uuid, _category text, _amount numeric,
  _expense_date date, _payment_method text, _description text, _request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_expense uuid;
  v_journal uuid;
  v_existing public.expenses%ROWTYPE;
  v_expense_key text;
  v_description text := nullif(btrim(coalesce(_description, '')), '');
BEGIN
  v_uid := public._finance_require_admin(_society_id);
  IF _request_id IS NULL THEN RAISE EXCEPTION 'invalid_request_id' USING ERRCODE = '22023'; END IF;
  IF _amount IS NULL OR _amount <= 0 OR _amount > 100000000 OR _amount <> round(_amount, 2) THEN RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023'; END IF;
  IF _expense_date IS NULL OR _expense_date > CURRENT_DATE THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE = '22023'; END IF;
  IF _payment_method NOT IN ('cash', 'bank_transfer') THEN RAISE EXCEPTION 'invalid_method' USING ERRCODE = '22023'; END IF;
  IF _category NOT IN ('cleaning','security','electricity','repair','water','salary','other') THEN RAISE EXCEPTION 'invalid_category' USING ERRCODE = '22023'; END IF;
  IF v_description IS NOT NULL AND char_length(v_description) > 500 THEN RAISE EXCEPTION 'invalid_description' USING ERRCODE = '22023'; END IF;
  IF _vendor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.finance_vendors WHERE id = _vendor_id AND society_id = _society_id AND is_active
  ) THEN RAISE EXCEPTION 'vendor_not_found' USING ERRCODE = '02000'; END IF;

  SELECT * INTO v_existing FROM public.expenses
  WHERE society_id = _society_id AND created_by = v_uid AND request_id = _request_id;
  IF FOUND THEN
    IF v_existing.amount = _amount
       AND v_existing.category = _category
       AND v_existing.payment_method = _payment_method
       AND v_existing.spent_on = _expense_date
       AND v_existing.vendor_id IS NOT DISTINCT FROM _vendor_id
       AND v_existing.note IS NOT DISTINCT FROM v_description
       AND v_existing.status = 'posted'
       AND v_existing.journal_entry_id IS NOT NULL THEN
      RETURN jsonb_build_object('status','existing','expense_id',v_existing.id,'journal_entry_id',v_existing.journal_entry_id);
    END IF;
    RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '22023';
  END IF;

  BEGIN
    INSERT INTO public.expenses(society_id,vendor_id,category,amount,note,spent_on,created_by,payment_method,status,request_id)
    VALUES(_society_id,_vendor_id,_category,_amount,v_description,_expense_date,v_uid,_payment_method,'pending',_request_id)
    RETURNING id INTO v_expense;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing FROM public.expenses
    WHERE society_id = _society_id AND created_by = v_uid AND request_id = _request_id;
    IF FOUND
       AND v_existing.amount = _amount
       AND v_existing.category = _category
       AND v_existing.payment_method = _payment_method
       AND v_existing.spent_on = _expense_date
       AND v_existing.vendor_id IS NOT DISTINCT FROM _vendor_id
       AND v_existing.note IS NOT DISTINCT FROM v_description
       AND v_existing.status = 'posted'
       AND v_existing.journal_entry_id IS NOT NULL THEN
      RETURN jsonb_build_object('status','existing','expense_id',v_existing.id,'journal_entry_id',v_existing.journal_entry_id);
    END IF;
    RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '22023';
  END;

  v_expense_key := CASE _category
    WHEN 'repair' THEN 'expense_repairs'
    WHEN 'electricity' THEN 'expense_utilities'
    WHEN 'water' THEN 'expense_utilities'
    WHEN 'security' THEN 'expense_security'
    WHEN 'cleaning' THEN 'expense_housekeeping'
    WHEN 'salary' THEN 'expense_salary'
    ELSE 'expense_other'
  END;
  v_journal := public._finance_post_entry(
    _society_id, v_uid, _expense_date, 'Expense: ' || _category, NULL,
    'expense', v_expense, 'post', v_expense_key,
    CASE WHEN _payment_method = 'cash' THEN 'cash' ELSE 'bank' END,
    _amount, NULL
  );
  UPDATE public.expenses SET status = 'posted', journal_entry_id = v_journal WHERE id = v_expense;
  INSERT INTO public.audit_log(actor_id,society_id,action,target_table,target_id,metadata)
  VALUES(v_uid,_society_id,'finance.expense_posted','expenses',v_expense,
         jsonb_build_object('journal_entry_id',v_journal,'amount',_amount,'method',_payment_method));
  RETURN jsonb_build_object('status','posted','expense_id',v_expense,'journal_entry_id',v_journal);
END
$$;
REVOKE ALL ON FUNCTION public.create_finance_expense(uuid,uuid,text,numeric,date,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_finance_expense(uuid,uuid,text,numeric,date,text,text,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_finance_overview(_society_id uuid,_from date,_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visibility text;
  v_result jsonb;
BEGIN
  IF _from IS NULL OR _to IS NULL OR _from > _to OR _to - _from > 730 THEN
    RAISE EXCEPTION 'invalid_period' USING ERRCODE = '22023';
  END IF;
  v_visibility := public.resolve_financial_visibility(_society_id);
  IF v_visibility <> 'admin' OR NOT public._finance_plan_enabled(_society_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'visibility', v_visibility, 'from', _from, 'to', _to,
    'income', COALESCE(sum(l.credit-l.debit) FILTER (WHERE a.account_type='income' AND j.transaction_date BETWEEN _from AND _to),0),
    'expense', COALESCE(sum(l.debit-l.credit) FILTER (WHERE a.account_type='expense' AND j.transaction_date BETWEEN _from AND _to),0),
    'cash_balance', COALESCE(sum(l.debit-l.credit) FILTER (WHERE a.system_key='cash' AND j.transaction_date <= _to),0),
    'bank_balance', COALESCE(sum(l.debit-l.credit) FILTER (WHERE a.system_key='bank' AND j.transaction_date <= _to),0),
    'net_movement', COALESCE(sum(l.credit-l.debit) FILTER (WHERE a.account_type='income' AND j.transaction_date BETWEEN _from AND _to),0)
                    - COALESCE(sum(l.debit-l.credit) FILTER (WHERE a.account_type='expense' AND j.transaction_date BETWEEN _from AND _to),0)
  ) INTO v_result
  FROM public.finance_journal_lines l
  JOIN public.finance_journal_entries j ON j.id=l.journal_entry_id AND j.society_id=l.society_id
  JOIN public.finance_accounts a ON a.id=l.account_id AND a.society_id=l.society_id
  WHERE j.society_id=_society_id AND j.status IN ('posted','reversed') AND j.transaction_date <= _to;
  RETURN v_result;
END
$$;
REVOKE ALL ON FUNCTION public.get_finance_overview(uuid,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_finance_overview(uuid,date,date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.execute_finance_backfill(_society_id uuid,_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_row record;
  v_payment_count int := 0;
  v_income_count int := 0;
  v_journal uuid;
  v_account text;
  v_result jsonb;
BEGIN
  v_uid := public._finance_require_admin(_society_id);
  IF _request_id IS NULL THEN RAISE EXCEPTION 'invalid_request_id' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_society_id::text || ':finance_backfill', 0));

  SELECT result INTO v_result FROM public.finance_backfill_requests
  WHERE society_id = _society_id AND request_id = _request_id;
  IF FOUND THEN RETURN v_result; END IF;

  FOR v_row IN
    SELECT * FROM public.payments
    WHERE society_id=_society_id AND status='verified' AND journal_entry_id IS NULL
      AND method IN ('cash','bank_transfer')
    ORDER BY created_at,id FOR UPDATE
  LOOP
    v_account := CASE WHEN v_row.method='cash' THEN 'cash' ELSE 'bank' END;
    v_journal := public._finance_post_entry(
      _society_id, COALESCE(v_row.verified_by,v_uid),
      COALESCE(v_row.payment_date,v_row.paid_at::date,v_row.verified_at::date,CURRENT_DATE),
      'Maintenance payment',v_row.reference_no,'payment',v_row.id,'post',
      v_account,'maintenance_income',v_row.amount,NULL
    );
    UPDATE public.payments SET journal_entry_id=v_journal WHERE id=v_row.id AND journal_entry_id IS NULL;
    v_payment_count := v_payment_count + 1;
  END LOOP;

  FOR v_row IN
    SELECT * FROM public.society_income_records
    WHERE society_id=_society_id AND verification_status='verified' AND journal_entry_id IS NULL
      AND payment_method IN ('cash','bank_transfer')
    ORDER BY created_at,id FOR UPDATE
  LOOP
    v_account := CASE WHEN v_row.payment_method='cash' THEN 'cash' ELSE 'bank' END;
    v_journal := public._finance_post_entry(
      _society_id,COALESCE(v_row.verified_by,v_uid),
      COALESCE(v_row.payment_date::date,v_row.verified_at::date,CURRENT_DATE),
      'Society income',v_row.reference_number,'income',v_row.id,'post',
      v_account,'other_income',v_row.amount,NULL
    );
    UPDATE public.society_income_records SET journal_entry_id=v_journal WHERE id=v_row.id AND journal_entry_id IS NULL;
    v_income_count := v_income_count + 1;
  END LOOP;

  v_result := jsonb_build_object('status','success','payments_posted',v_payment_count,'income_posted',v_income_count);
  INSERT INTO public.finance_backfill_requests(society_id,request_id,requested_by,result)
  VALUES(_society_id,_request_id,v_uid,v_result);
  INSERT INTO public.audit_log(actor_id,society_id,action,target_table,target_id,metadata)
  VALUES(v_uid,_society_id,'finance.backfill_executed','finance_backfill_requests',_request_id,v_result - 'status');
  RETURN v_result;
END
$$;
REVOKE ALL ON FUNCTION public.execute_finance_backfill(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_finance_backfill(uuid,uuid) TO authenticated, service_role;