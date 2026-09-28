CREATE OR REPLACE FUNCTION public.get_auditor_pack(_society_id uuid, _from date, _to date, _format text DEFAULT 'view')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid;
  v_cap constant int := 1000;
  v_opening jsonb;
  v_period jsonb;
  v_result jsonb;
BEGIN
  IF _format NOT IN ('view','csv','pdf') THEN RAISE EXCEPTION 'invalid_format' USING ERRCODE='22023'; END IF;
  IF _from IS NULL OR _to IS NULL OR _from > _to OR _to - _from > 730 OR _to > CURRENT_DATE + 1 THEN
    RAISE EXCEPTION 'invalid_period' USING ERRCODE='22023';
  END IF;
  -- auth + billing.manage (or super admin) + Growth/Pro/trial entitlement
  v_uid := public._finance_require_admin(_society_id);
  PERFORM public._rate_hit('auditor_pack', v_uid::text, 20, interval '1 hour');

  -- Canonical totals: reuse the same function the Reports page uses
  v_period  := public.get_finance_overview(_society_id, _from, _to);
  v_opening := public.get_finance_overview(_society_id, _from - 1, _from - 1);

  SELECT jsonb_build_object(
    'society', (SELECT jsonb_build_object('name', s.name,
                  'registration_no', coalesce(s.registration_number, s.registration_no),
                  'city', s.city, 'state', s.state)
                FROM public.societies s WHERE s.id = _society_id),
    'period', jsonb_build_object('from', _from, 'to', _to),
    'generated_at', now(),
    'format', _format,
    'row_cap', v_cap,
    'position', jsonb_build_object(
      'opening_cash', (v_opening->>'cash_balance')::numeric,
      'opening_bank', (v_opening->>'bank_balance')::numeric,
      'closing_cash', (v_period->>'cash_balance')::numeric,
      'closing_bank', (v_period->>'bank_balance')::numeric,
      'income', (v_period->>'income')::numeric,
      'expense', (v_period->>'expense')::numeric,
      'net_movement', (v_period->>'net_movement')::numeric),
    'ageing', (SELECT coalesce(jsonb_agg(jsonb_build_object('bucket', a.bucket, 'amount', a.amount, 'bill_count', a.bill_count)), '[]'::jsonb)
               FROM public.get_receivables_ageing(_society_id, _to) a),
    'journal', (SELECT jsonb_build_object('total', count(*), 'rows', coalesce(jsonb_agg(r) FILTER (WHERE r.rn <= v_cap), '[]'::jsonb)) FROM (
        SELECT row_number() OVER (ORDER BY j.transaction_date, j.created_at) rn,
          j.id, j.transaction_date, j.description, j.reference, j.source_type, j.source_action, j.status, j.reversal_of,
          (SELECT coalesce(sum(l.debit),0) FROM public.finance_journal_lines l WHERE l.journal_entry_id=j.id AND l.society_id=j.society_id) AS amount
        FROM public.finance_journal_entries j
        WHERE j.society_id=_society_id AND j.status IN ('posted','reversed') AND j.transaction_date BETWEEN _from AND _to) r),
    'bills', (SELECT jsonb_build_object('total', count(*), 'rows', coalesce(jsonb_agg(r) FILTER (WHERE r.rn <= v_cap), '[]'::jsonb)) FROM (
        SELECT row_number() OVER (ORDER BY coalesce(b.bill_date, b.period_start), b.bill_number) rn,
          b.id, b.bill_number, f.flat_number, b.period_label, coalesce(b.bill_date, b.period_start) AS bill_date, b.due_date,
          coalesce(b.total_payable, b.amount) AS total, b.status, coalesce(b.adjustments,0) AS adjustments,
          coalesce(b.penalties,0) AS penalties, b.cancelled_at, b.cancel_reason
        FROM public.bills b LEFT JOIN public.flats f ON f.id=b.flat_id AND f.society_id=b.society_id
        WHERE b.society_id=_society_id AND coalesce(b.bill_date, b.period_start) BETWEEN _from AND _to) r),
    'payments', (SELECT jsonb_build_object('total', count(*), 'rows', coalesce(jsonb_agg(r) FILTER (WHERE r.rn <= v_cap), '[]'::jsonb)) FROM (
        SELECT row_number() OVER (ORDER BY coalesce(p.payment_date, p.paid_at::date, p.created_at::date), p.created_at) rn,
          p.id, coalesce(p.payment_date, p.paid_at::date, p.created_at::date) AS payment_date, b.bill_number, f.flat_number,
          p.amount, p.method, p.reference_no, p.status, p.verified_at, p.reversed_at, p.reversal_reason,
          p.journal_entry_id, p.reversal_journal_entry_id,
          (SELECT pr.receipt_number FROM public.payment_receipts pr WHERE pr.payment_id=p.id AND pr.society_id=p.society_id ORDER BY pr.issued_at DESC LIMIT 1) AS receipt_number,
          (SELECT pr.status FROM public.payment_receipts pr WHERE pr.payment_id=p.id AND pr.society_id=p.society_id ORDER BY pr.issued_at DESC LIMIT 1) AS receipt_status
        FROM public.payments p
        LEFT JOIN public.bills b ON b.id=p.bill_id AND b.society_id=p.society_id
        LEFT JOIN public.flats f ON f.id=p.flat_id AND f.society_id=p.society_id
        WHERE p.society_id=_society_id AND coalesce(p.payment_date, p.paid_at::date, p.created_at::date) BETWEEN _from AND _to) r),
    'income', (SELECT jsonb_build_object('total', count(*), 'rows', coalesce(jsonb_agg(r) FILTER (WHERE r.rn <= v_cap), '[]'::jsonb)) FROM (
        SELECT row_number() OVER (ORDER BY i.payment_date, i.created_at) rn,
          i.id, i.payment_date::date AS payment_date, c.name AS category, i.payer_kind, i.amount, i.payment_method,
          i.reference_number, i.payment_status, i.verification_status, i.reconciliation_status,
          i.reversed_at, i.reversal_reason, i.journal_entry_id, i.reversal_journal_entry_id
        FROM public.society_income_records i
        LEFT JOIN public.society_income_categories c ON c.id=i.category_id AND c.society_id=i.society_id
        WHERE i.society_id=_society_id AND i.payment_date::date BETWEEN _from AND _to) r),
    'expenses', (SELECT jsonb_build_object('total', count(*), 'rows', coalesce(jsonb_agg(r) FILTER (WHERE r.rn <= v_cap), '[]'::jsonb)) FROM (
        SELECT row_number() OVER (ORDER BY e.spent_on, e.created_at) rn,
          e.id, e.spent_on, e.category, v.name AS vendor, e.amount, e.payment_method, e.status,
          e.reversed_at, e.reversal_reason, e.journal_entry_id, e.reversal_journal_entry_id
        FROM public.expenses e
        LEFT JOIN public.finance_vendors v ON v.id=e.vendor_id AND v.society_id=e.society_id
        WHERE e.society_id=_society_id AND e.spent_on BETWEEN _from AND _to) r),
    'bank', (SELECT jsonb_build_object('total', count(*), 'rows', coalesce(jsonb_agg(r) FILTER (WHERE r.rn <= v_cap), '[]'::jsonb)) FROM (
        SELECT row_number() OVER (ORDER BY bl.txn_date, bl.line_no) rn,
          bl.id, bl.import_id, bl.line_no, bl.txn_date, bl.direction, bl.amount, bl.reference, bl.status,
          bl.is_duplicate, bl.matched_kind, bl.matched_id, bl.matched_at
        FROM public.bank_statement_lines bl
        WHERE bl.society_id=_society_id AND bl.txn_date BETWEEN _from AND _to) r),
    'no_dues', (SELECT jsonb_build_object('total', count(*), 'rows', coalesce(jsonb_agg(r) FILTER (WHERE r.rn <= v_cap), '[]'::jsonb)) FROM (
        SELECT row_number() OVER (ORDER BY c.issued_at) rn,
          c.id, c.certificate_number, f.flat_number, c.issued_at, c.valid_until, c.revoked_at, c.revoke_reason
        FROM public.no_dues_certificates c LEFT JOIN public.flats f ON f.id=c.flat_id AND f.society_id=c.society_id
        WHERE c.society_id=_society_id AND c.issued_at::date BETWEEN _from AND _to) r),
    'activity', (SELECT jsonb_build_object('total', count(*), 'rows', coalesce(jsonb_agg(r) FILTER (WHERE r.rn <= v_cap), '[]'::jsonb)) FROM (
        SELECT row_number() OVER (ORDER BY al.created_at) rn, al.id, al.created_at, al.action, al.target_table, al.target_id
        FROM public.audit_log al
        WHERE al.society_id=_society_id AND al.created_at::date BETWEEN _from AND _to
          AND (al.action LIKE 'finance.%' OR al.action LIKE 'income_record.%' OR al.action LIKE 'bank_statement.%'
               OR al.action LIKE 'payment%' OR al.action LIKE 'bill%' OR al.action LIKE 'expense%'
               OR al.action LIKE 'receipt%' OR al.action LIKE 'no_dues%' OR al.action LIKE 'auditor_pack.%'
               OR al.target_table IN ('payments','bills','payment_receipts','expenses','no_dues_certificates'))) r)
  ) INTO v_result;

  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (v_uid, 'auditor_pack.generated', 'societies', _society_id::text, _society_id,
          jsonb_build_object('from', _from, 'to', _to, 'format', _format, 'outcome', 'success'));
  RETURN v_result;
END $fn$;

-- Failure audit: only written for callers who are finance admins of that society (no cross-society noise).
CREATE OR REPLACE FUNCTION public.record_auditor_pack_failure(_society_id uuid, _from date, _to date, _format text, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  IF NOT (public.current_user_has_society_permission(_society_id,'billing.manage'::text,NULL::uuid)
          OR public.has_role(v_uid,'super_admin'::public.app_role)) THEN RETURN; END IF;
  IF _reason NOT IN ('invalid_period','plan_required','rate_limited','not_authorized','invalid_format','error') THEN _reason := 'error'; END IF;
  IF _format NOT IN ('view','csv','pdf') THEN _format := 'view'; END IF;
  PERFORM public._rate_hit('auditor_pack_fail', v_uid::text, 30, interval '1 hour');
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (v_uid, 'auditor_pack.failed', 'societies', _society_id::text, _society_id,
          jsonb_build_object('from', _from, 'to', _to, 'format', _format, 'outcome', 'failure', 'reason', _reason));
END $fn$;

REVOKE ALL ON FUNCTION public.get_auditor_pack(uuid,date,date,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_auditor_pack_failure(uuid,date,date,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_auditor_pack(uuid,date,date,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_auditor_pack_failure(uuid,date,date,text,text) TO authenticated, service_role;