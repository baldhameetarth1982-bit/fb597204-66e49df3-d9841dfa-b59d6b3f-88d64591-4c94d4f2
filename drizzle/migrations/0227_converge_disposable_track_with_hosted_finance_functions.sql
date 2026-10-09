-- Forward-only convergence: the disposable track excluded supabase mirror files whose
-- function bodies (idempotent expense reversal, finance book, account seeding, unit update)
-- were never carried into drizzle. Bodies are byte-identical to the hosted definitions,
-- so applying this to the hosted database is a no-op. Grants match hosted ACLs.
CREATE OR REPLACE FUNCTION public._finance_seed_accounts(_society_id uuid, _actor_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$

;

CREATE OR REPLACE FUNCTION public.list_finance_book(_society_id uuid, _book text, _from date, _to date, _limit integer DEFAULT 50, _offset integer DEFAULT 0)
 RETURNS TABLE(entry_id uuid, transaction_date date, reference text, description text, source_type text, debit numeric, credit numeric, running_balance numeric, status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$

;

CREATE OR REPLACE FUNCTION public.reverse_finance_expense(_expense_id uuid, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$

;

CREATE OR REPLACE FUNCTION public.update_society_unit(_unit_id uuid, _flat_number text DEFAULT NULL::text, _floor integer DEFAULT NULL::integer, _unit_type text DEFAULT NULL::text, _display_order integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_soc uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT society_id INTO v_soc FROM public.flats WHERE id = _unit_id;
  IF v_soc IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF NOT (public.is_society_admin_for(v_caller, v_soc) OR public.is_super_admin(v_caller)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  UPDATE public.flats SET
    flat_number = coalesce(nullif(btrim(_flat_number),''), flat_number),
    floor = coalesce(_floor, floor),
    unit_type = coalesce(nullif(_unit_type,''), unit_type),
    display_order = coalesce(_display_order, display_order),
    updated_at = now()
  WHERE id = _unit_id;

  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_label');
END;
$function$

;

REVOKE ALL ON FUNCTION public._finance_seed_accounts(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._finance_seed_accounts(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.list_finance_book(uuid,text,date,date,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_finance_book(uuid,text,date,date,integer,integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.reverse_finance_expense(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_finance_expense(uuid,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_society_unit(uuid,text,integer,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_society_unit(uuid,text,integer,text,integer) TO authenticated, service_role;
