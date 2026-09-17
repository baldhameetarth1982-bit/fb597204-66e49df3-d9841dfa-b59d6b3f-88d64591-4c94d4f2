CREATE OR REPLACE FUNCTION public.is_society_admin_for(_user_id uuid, _society_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND society_id = _society_id
      AND role = 'society_admin'::public.app_role
      AND COALESCE(is_active, true)
  );
$$;
REVOKE ALL ON FUNCTION public.is_society_admin_for(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_society_admin_for(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._finance_seed_accounts(_society_id uuid, _actor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conflict boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.finance_accounts a
    JOIN (VALUES
      ('1000','cash'), ('1010','bank'), ('1100','maintenance_receivable'),
      ('1190','other_receivable'), ('2000','vendor_payable'), ('2090','other_payable'),
      ('3000','society_fund'), ('4000','maintenance_income'), ('4090','other_income'),
      ('4095','interest_income'), ('5000','expense_repairs'), ('5010','expense_utilities'),
      ('5020','expense_security'), ('5030','expense_housekeeping'), ('5040','expense_salary'),
      ('5050','expense_admin'), ('5090','expense_other'), ('1090','offline_clearing')
    ) expected(code, system_key)
      ON a.code = expected.code OR a.system_key = expected.system_key
    WHERE a.society_id = _society_id
      AND (a.code <> expected.code OR a.system_key IS DISTINCT FROM expected.system_key OR NOT a.is_system)
  ) INTO v_conflict;
  IF v_conflict THEN
    RAISE EXCEPTION 'account_seed_conflict' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.finance_accounts(society_id,code,name,account_type,normal_balance,system_key,is_system,created_by)
  SELECT _society_id, v.code, v.name, v.account_type, v.normal_balance, v.system_key, true, _actor_id
  FROM (VALUES
    ('1000','Cash','asset','debit','cash'),
    ('1010','Bank','asset','debit','bank'),
    ('1100','Maintenance Receivable','asset','debit','maintenance_receivable'),
    ('1190','Other Receivables','asset','debit','other_receivable'),
    ('2000','Vendor Payable','liability','credit','vendor_payable'),
    ('2090','Other Payables','liability','credit','other_payable'),
    ('3000','Society Fund','equity','credit','society_fund'),
    ('4000','Maintenance Income','income','credit','maintenance_income'),
    ('4090','Other Society Income','income','credit','other_income'),
    ('4095','Interest / Bank Income','income','credit','interest_income'),
    ('5000','Repairs & Maintenance','expense','debit','expense_repairs'),
    ('5010','Utilities','expense','debit','expense_utilities'),
    ('5020','Security','expense','debit','expense_security'),
    ('5030','Housekeeping','expense','debit','expense_housekeeping'),
    ('5040','Staff / Salaries','expense','debit','expense_salary'),
    ('5050','Administrative Expense','expense','debit','expense_admin'),
    ('5090','Other Expense','expense','debit','expense_other'),
    ('1090','Offline Clearing','asset','debit','offline_clearing')
  ) AS v(code,name,account_type,normal_balance,system_key)
  ON CONFLICT (society_id,code) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public._finance_seed_accounts(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._finance_seed_accounts(uuid,uuid) TO service_role;

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
  v_entry uuid;
  v_debit uuid;
  v_credit uuid;
  v_sum_debit numeric;
  v_sum_credit numeric;
  v_lines int;
  v_source_society uuid;
BEGIN
  IF _society_id IS NULL OR _actor_id IS NULL OR _source_id IS NULL THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  IF _transaction_date IS NULL OR _transaction_date > CURRENT_DATE THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE='22023'; END IF;
  IF char_length(btrim(coalesce(_description,''))) NOT BETWEEN 2 AND 500 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  IF _amount IS NULL OR _amount <= 0 OR _amount > 100000000 OR _amount <> round(_amount,2) THEN RAISE EXCEPTION 'invalid_amount' USING ERRCODE='22023'; END IF;
  IF _source_action NOT IN ('post','reverse') THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;

  IF _source_type = 'payment' OR _source_type = 'payment_reversal' THEN
    SELECT society_id INTO v_source_society FROM public.payments WHERE id = _source_id;
  ELSIF _source_type = 'income' OR _source_type = 'income_reversal' THEN
    SELECT society_id INTO v_source_society FROM public.society_income_records WHERE id = _source_id;
  ELSIF _source_type = 'expense' OR _source_type = 'expense_reversal' THEN
    SELECT society_id INTO v_source_society FROM public.expenses WHERE id = _source_id;
  ELSE
    RAISE EXCEPTION 'invalid_source' USING ERRCODE='22023';
  END IF;
  IF v_source_society IS NULL OR v_source_society <> _society_id THEN
    RAISE EXCEPTION 'cross_society_finance_reference' USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_existing
  FROM public.finance_journal_entries
  WHERE society_id=_society_id AND source_type=_source_type AND source_id=_source_id;
  IF FOUND THEN
    IF v_existing.transaction_date = _transaction_date
       AND v_existing.source_action = _source_action
       AND v_existing.reversal_of IS NOT DISTINCT FROM _reversal_of THEN
      RETURN v_existing.id;
    END IF;
    RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023';
  END IF;

  PERFORM public._finance_seed_accounts(_society_id,_actor_id);
  SELECT id INTO v_debit FROM public.finance_accounts WHERE society_id=_society_id AND system_key=_debit_system_key AND is_active FOR SHARE;
  SELECT id INTO v_credit FROM public.finance_accounts WHERE society_id=_society_id AND system_key=_credit_system_key AND is_active FOR SHARE;
  IF v_debit IS NULL OR v_credit IS NULL OR v_debit=v_credit THEN RAISE EXCEPTION 'account_unavailable' USING ERRCODE='22023'; END IF;
  IF _source_action='reverse' THEN
    IF _reversal_of IS NULL OR NOT EXISTS(
      SELECT 1 FROM public.finance_journal_entries
      WHERE id=_reversal_of AND society_id=_society_id AND status='posted' AND reversal_of IS NULL
    ) THEN RAISE EXCEPTION 'invalid_reversal' USING ERRCODE='22023'; END IF;
  ELSIF _reversal_of IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_reversal' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.finance_journal_entries(society_id,transaction_date,description,reference,source_type,source_id,source_action,status,reversal_of,created_by)
  VALUES(_society_id,_transaction_date,btrim(_description),nullif(btrim(coalesce(_reference,'')),''),_source_type,_source_id,_source_action,'draft',_reversal_of,_actor_id)
  RETURNING id INTO v_entry;
  INSERT INTO public.finance_journal_lines(society_id,journal_entry_id,account_id,line_number,debit,credit)
  VALUES (_society_id,v_entry,v_debit,1,_amount,0),(_society_id,v_entry,v_credit,2,0,_amount);
  SELECT count(*),sum(debit),sum(credit) INTO v_lines,v_sum_debit,v_sum_credit FROM public.finance_journal_lines WHERE journal_entry_id=v_entry;
  IF v_lines < 2 OR v_sum_debit <> v_sum_credit THEN RAISE EXCEPTION 'journal_unbalanced' USING ERRCODE='23514'; END IF;
  UPDATE public.finance_journal_entries SET status=CASE WHEN _source_action='reverse' THEN 'reversed' ELSE 'posted' END,posted_at=now() WHERE id=v_entry;
  INSERT INTO public.audit_log(actor_id,society_id,action,target_table,target_id,metadata)
  VALUES(_actor_id,_society_id,'finance.journal_'||_source_action,'finance_journal_entries',v_entry,jsonb_build_object('source_type',_source_type,'source_id',_source_id,'amount',_amount,'reversal_of',_reversal_of));
  RETURN v_entry;
EXCEPTION WHEN unique_violation THEN
  SELECT * INTO v_existing FROM public.finance_journal_entries WHERE society_id=_society_id AND source_type=_source_type AND source_id=_source_id;
  IF FOUND AND v_existing.transaction_date = _transaction_date AND v_existing.source_action = _source_action AND v_existing.reversal_of IS NOT DISTINCT FROM _reversal_of THEN
    RETURN v_existing.id;
  END IF;
  RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023';
END;
$$;
REVOKE ALL ON FUNCTION public._finance_post_entry(uuid,uuid,date,text,text,text,uuid,text,text,text,numeric,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._finance_post_entry(uuid,uuid,date,text,text,text,uuid,text,text,text,numeric,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.create_finance_expense(_society_id uuid,_vendor_id uuid,_category text,_amount numeric,_expense_date date,_payment_method text,_description text,_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid; v_expense uuid; v_journal uuid; v_existing record; v_expense_key text;
BEGIN
  v_uid:=public._finance_require_admin(_society_id);
  IF _request_id IS NULL THEN RAISE EXCEPTION 'invalid_request_id' USING ERRCODE='22023'; END IF;
  SELECT id,amount,category,payment_method,spent_on,journal_entry_id INTO v_existing FROM public.expenses WHERE society_id=_society_id AND created_by=v_uid AND request_id=_request_id;
  IF FOUND THEN
    IF v_existing.amount=_amount AND v_existing.category=_category AND v_existing.payment_method=_payment_method AND v_existing.spent_on=_expense_date THEN
      RETURN jsonb_build_object('status','existing','expense_id',v_existing.id,'journal_entry_id',v_existing.journal_entry_id);
    END IF;
    RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023';
  END IF;
  IF _amount IS NULL OR _amount<=0 OR _amount>100000000 OR _amount<>round(_amount,2) THEN RAISE EXCEPTION 'invalid_amount' USING ERRCODE='22023'; END IF;
  IF _expense_date IS NULL OR _expense_date>CURRENT_DATE THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE='22023'; END IF;
  IF _payment_method NOT IN ('cash','bank_transfer') THEN RAISE EXCEPTION 'invalid_method' USING ERRCODE='22023'; END IF;
  IF _category NOT IN ('cleaning','security','electricity','repair','water','salary','other') THEN RAISE EXCEPTION 'invalid_category' USING ERRCODE='22023'; END IF;
  IF _vendor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.finance_vendors WHERE id=_vendor_id AND society_id=_society_id AND is_active) THEN RAISE EXCEPTION 'vendor_not_found' USING ERRCODE='02000'; END IF;
  BEGIN
    INSERT INTO public.expenses(society_id,vendor_id,category,amount,note,spent_on,created_by,payment_method,status,request_id)
    VALUES(_society_id,_vendor_id,_category,_amount,nullif(btrim(coalesce(_description,'')),''),_expense_date,v_uid,_payment_method,'pending',_request_id) RETURNING id INTO v_expense;
  EXCEPTION WHEN unique_violation THEN
    SELECT id,amount,category,payment_method,spent_on,journal_entry_id INTO v_existing FROM public.expenses WHERE society_id=_society_id AND created_by=v_uid AND request_id=_request_id;
    IF FOUND AND v_existing.amount=_amount AND v_existing.category=_category AND v_existing.payment_method=_payment_method AND v_existing.spent_on=_expense_date THEN
      RETURN jsonb_build_object('status','existing','expense_id',v_existing.id,'journal_entry_id',v_existing.journal_entry_id);
    END IF;
    RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023';
  END;
  v_expense_key:=CASE _category WHEN 'repair' THEN 'expense_repairs' WHEN 'electricity' THEN 'expense_utilities' WHEN 'water' THEN 'expense_utilities' WHEN 'security' THEN 'expense_security' WHEN 'cleaning' THEN 'expense_housekeeping' WHEN 'salary' THEN 'expense_salary' ELSE 'expense_other' END;
  v_journal:=public._finance_post_entry(_society_id,v_uid,_expense_date,'Expense: '||_category,NULL,'expense',v_expense,'post',v_expense_key,CASE WHEN _payment_method='cash' THEN 'cash' ELSE 'bank' END,_amount,NULL);
  UPDATE public.expenses SET status='posted',journal_entry_id=v_journal WHERE id=v_expense;
  INSERT INTO public.audit_log(actor_id,society_id,action,target_table,target_id,metadata) VALUES(v_uid,_society_id,'finance.expense_posted','expenses',v_expense,jsonb_build_object('journal_entry_id',v_journal,'amount',_amount,'method',_payment_method));
  RETURN jsonb_build_object('status','posted','expense_id',v_expense,'journal_entry_id',v_journal);
END $$;
REVOKE ALL ON FUNCTION public.create_finance_expense(uuid,uuid,text,numeric,date,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_finance_expense(uuid,uuid,text,numeric,date,text,text,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reverse_finance_expense(_expense_id uuid,_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid; v_exp public.expenses%ROWTYPE; v_journal uuid; v_expense_key text;
BEGIN
  SELECT * INTO v_exp FROM public.expenses WHERE id=_expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'expense_not_found' USING ERRCODE='02000'; END IF;
  v_uid:=public._finance_require_admin(v_exp.society_id);
  IF v_exp.status='reversed' AND v_exp.reversal_journal_entry_id IS NOT NULL THEN
    RETURN jsonb_build_object('status','reversed','expense_id',v_exp.id,'journal_entry_id',v_exp.reversal_journal_entry_id);
  END IF;
  IF v_exp.status<>'posted' OR v_exp.journal_entry_id IS NULL THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF char_length(btrim(coalesce(_reason,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  v_expense_key:=CASE v_exp.category WHEN 'repair' THEN 'expense_repairs' WHEN 'electricity' THEN 'expense_utilities' WHEN 'water' THEN 'expense_utilities' WHEN 'security' THEN 'expense_security' WHEN 'cleaning' THEN 'expense_housekeeping' WHEN 'salary' THEN 'expense_salary' ELSE 'expense_other' END;
  v_journal:=public._finance_post_entry(v_exp.society_id,v_uid,CURRENT_DATE,'Reversal: expense '||v_exp.category,NULL,'expense_reversal',v_exp.id,'reverse',CASE WHEN v_exp.payment_method='cash' THEN 'cash' ELSE 'bank' END,v_expense_key,v_exp.amount,v_exp.journal_entry_id);
  UPDATE public.expenses SET status='reversed',reversal_journal_entry_id=v_journal,reversed_at=now(),reversed_by=v_uid,reversal_reason=btrim(_reason),updated_at=now() WHERE id=_expense_id;
  INSERT INTO public.audit_log(actor_id,society_id,action,target_table,target_id,metadata) VALUES(v_uid,v_exp.society_id,'finance.expense_reversed','expenses',_expense_id,jsonb_build_object('journal_entry_id',v_journal,'reason',btrim(_reason)));
  RETURN jsonb_build_object('status','reversed','expense_id',_expense_id,'journal_entry_id',v_journal);
END $$;
REVOKE ALL ON FUNCTION public.reverse_finance_expense(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_finance_expense(uuid,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_finance_book(_society_id uuid,_book text,_from date,_to date,_limit int DEFAULT 50,_offset int DEFAULT 0)
RETURNS TABLE(entry_id uuid,transaction_date date,reference text,description text,source_type text,debit numeric,credit numeric,running_balance numeric,status text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_visibility text; v_key text;
BEGIN
  v_visibility:=public.resolve_financial_visibility(_society_id);
  IF v_visibility<>'admin' OR NOT public._finance_plan_enabled(_society_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF _book NOT IN ('cash','bank') THEN RAISE EXCEPTION 'invalid_book' USING ERRCODE='22023'; END IF;
  IF _from IS NULL OR _to IS NULL OR _from>_to OR _to-_from>730 OR _limit NOT BETWEEN 1 AND 200 OR _offset NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  v_key:=_book;
  RETURN QUERY
  WITH movements AS (
    SELECT j.id,j.transaction_date,j.created_at,j.reference,j.description,j.source_type,l.debit,l.credit,j.status,
      sum(l.debit-l.credit) OVER (ORDER BY j.transaction_date,j.created_at,j.id,l.line_number ROWS UNBOUNDED PRECEDING) AS balance
    FROM public.finance_journal_lines l
    JOIN public.finance_journal_entries j ON j.id=l.journal_entry_id AND j.society_id=l.society_id
    JOIN public.finance_accounts a ON a.id=l.account_id AND a.society_id=l.society_id
    WHERE j.society_id=_society_id AND a.system_key=v_key AND j.status IN ('posted','reversed') AND j.transaction_date<=_to
  )
  SELECT m.id,m.transaction_date,m.reference,m.description,m.source_type,m.debit,m.credit,m.balance,m.status
  FROM movements m
  WHERE m.transaction_date>=_from
  ORDER BY m.transaction_date DESC,m.created_at DESC,m.id DESC LIMIT _limit OFFSET _offset;
END $$;
REVOKE ALL ON FUNCTION public.list_finance_book(uuid,text,date,date,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_finance_book(uuid,text,date,date,int,int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_receivables_ageing(_society_id uuid,_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE(bucket text,amount numeric,bill_count bigint) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_visibility text;
BEGIN
  v_visibility:=public.resolve_financial_visibility(_society_id);
  IF v_visibility<>'admin' OR NOT public._finance_plan_enabled(_society_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF _as_of IS NULL OR _as_of>CURRENT_DATE THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE='22023'; END IF;
  RETURN QUERY WITH balances AS (
    SELECT b.id,b.due_date,GREATEST(0,COALESCE(b.total_payable,b.amount,0)-COALESCE(sum(p.amount) FILTER(WHERE p.status='verified' AND p.verified_at::date<=_as_of),0)) outstanding
    FROM public.bills b LEFT JOIN public.payments p ON p.bill_id=b.id
    WHERE b.society_id=_society_id AND b.cancelled_at IS NULL AND b.status='finalized'
    GROUP BY b.id,b.due_date,b.total_payable,b.amount
  ), bucketed AS (
    SELECT CASE WHEN due_date>=_as_of THEN 'current' WHEN _as_of-due_date<=30 THEN '1_30' WHEN _as_of-due_date<=60 THEN '31_60' WHEN _as_of-due_date<=90 THEN '61_90' ELSE '90_plus' END bucket,outstanding FROM balances WHERE outstanding>0
  ) SELECT b.bucket,sum(b.outstanding),count(*) FROM bucketed b GROUP BY b.bucket;
END $$;
REVOKE ALL ON FUNCTION public.get_receivables_ageing(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_receivables_ageing(uuid,date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.execute_finance_backfill(_society_id uuid,_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_uid uuid;
  v_row record;
  v_payment_count int := 0;
  v_income_count int := 0;
  v_journal uuid;
  v_account text;
BEGIN
  v_uid:=public._finance_require_admin(_society_id);
  IF _request_id IS NULL THEN RAISE EXCEPTION 'invalid_request_id' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_society_id::text || ':finance_backfill', 0));

  FOR v_row IN SELECT * FROM public.payments WHERE society_id=_society_id AND status='verified' AND journal_entry_id IS NULL AND method IN ('cash','bank_transfer') ORDER BY created_at,id FOR UPDATE LOOP
    v_account:=CASE WHEN v_row.method='cash' THEN 'cash' ELSE 'bank' END;
    v_journal:=public._finance_post_entry(_society_id,COALESCE(v_row.verified_by,v_uid),COALESCE(v_row.payment_date,v_row.paid_at::date,CURRENT_DATE),'Maintenance payment',v_row.reference_no,'payment',v_row.id,'post',v_account,'maintenance_income',v_row.amount,NULL);
    UPDATE public.payments SET journal_entry_id=v_journal WHERE id=v_row.id AND journal_entry_id IS NULL;
    v_payment_count:=v_payment_count+1;
  END LOOP;

  FOR v_row IN SELECT * FROM public.society_income_records WHERE society_id=_society_id AND verification_status='verified' AND journal_entry_id IS NULL AND payment_method IN ('cash','bank_transfer') ORDER BY created_at,id FOR UPDATE LOOP
    v_account:=CASE WHEN v_row.payment_method='cash' THEN 'cash' ELSE 'bank' END;
    v_journal:=public._finance_post_entry(_society_id,COALESCE(v_row.verified_by,v_uid),COALESCE(v_row.payment_date::date,CURRENT_DATE),'Society income',v_row.reference_number,'income',v_row.id,'post',v_account,'other_income',v_row.amount,NULL);
    UPDATE public.society_income_records SET journal_entry_id=v_journal WHERE id=v_row.id AND journal_entry_id IS NULL;
    v_income_count:=v_income_count+1;
  END LOOP;

  INSERT INTO public.audit_log(actor_id,society_id,action,target_table,target_id,metadata)
  VALUES(v_uid,_society_id,'finance.backfill_executed','finance_journal_entries',_request_id,jsonb_build_object('payments_posted',v_payment_count,'income_posted',v_income_count));
  RETURN jsonb_build_object('status','success','payments_posted',v_payment_count,'income_posted',v_income_count);
END $$;
REVOKE ALL ON FUNCTION public.execute_finance_backfill(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_finance_backfill(uuid,uuid) TO authenticated, service_role;