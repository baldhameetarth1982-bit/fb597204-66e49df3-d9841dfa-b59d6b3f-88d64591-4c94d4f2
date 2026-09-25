CREATE OR REPLACE FUNCTION public.list_finance_workspace(_society_id uuid, _resource text, _limit integer DEFAULT 50, _offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_visibility text; v_rows jsonb;
BEGIN
  v_visibility:=public.resolve_financial_visibility(_society_id);
  IF v_visibility<>'admin' OR NOT public._finance_plan_enabled(_society_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF _limit NOT BETWEEN 1 AND 200 OR _offset NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  IF _resource='accounts' THEN SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_rows FROM (SELECT id,code,name,account_type,normal_balance,system_key,is_system,is_active FROM public.finance_accounts WHERE society_id=_society_id ORDER BY code LIMIT _limit OFFSET _offset)x;
  ELSIF _resource='vendors' THEN SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_rows FROM (SELECT id,name,category,phone,email,notes,is_active FROM public.finance_vendors WHERE society_id=_society_id ORDER BY is_active DESC,name LIMIT _limit OFFSET _offset)x;
  ELSIF _resource='expenses' THEN SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_rows FROM (SELECT e.id,e.vendor_id,v.name vendor_name,e.category,e.amount,e.note description,e.spent_on expense_date,e.payment_method,e.status,e.journal_entry_id,e.reversal_journal_entry_id,e.reversed_at,e.reversal_reason FROM public.expenses e LEFT JOIN public.finance_vendors v ON v.id=e.vendor_id WHERE e.society_id=_society_id ORDER BY e.spent_on DESC,e.created_at DESC LIMIT _limit OFFSET _offset)x;
  ELSIF _resource='journal' THEN SELECT COALESCE(jsonb_agg(jsonb_build_object('id',x.id,'transaction_date',x.transaction_date,'description',x.description,'reference',x.reference,'source_type',x.source_type,'status',x.status,'reversal_of',x.reversal_of,'debit',x.debit,'credit',x.credit) ORDER BY x.transaction_date DESC,x.created_at DESC),'[]'::jsonb) INTO v_rows FROM (SELECT j.id,j.transaction_date,j.created_at,j.description,j.reference,j.source_type,j.status,j.reversal_of,COALESCE(q.debit,0) debit,COALESCE(q.credit,0) credit FROM public.finance_journal_entries j LEFT JOIN LATERAL(SELECT sum(debit) debit,sum(credit) credit FROM public.finance_journal_lines WHERE journal_entry_id=j.id)q ON true WHERE j.society_id=_society_id ORDER BY j.transaction_date DESC,j.created_at DESC LIMIT _limit OFFSET _offset)x;
  ELSE RAISE EXCEPTION 'invalid_resource' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('visibility',v_visibility,'resource',_resource,'rows',v_rows,'limit',_limit,'offset',_offset);
END $function$;