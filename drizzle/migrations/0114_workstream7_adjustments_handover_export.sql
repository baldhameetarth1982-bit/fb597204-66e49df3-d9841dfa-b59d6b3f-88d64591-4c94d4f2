
CREATE TABLE public.bill_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id),
  bill_id uuid NOT NULL REFERENCES public.bills(id),
  amount numeric(14,2) NOT NULL CHECK (amount <> 0 AND amount BETWEEN -100000000 AND 100000000),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 500),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 8 AND 80),
  counter_of uuid REFERENCES public.bill_adjustments(id),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (society_id, request_id)
);
CREATE INDEX bill_adjustments_bill_idx ON public.bill_adjustments(bill_id);
GRANT SELECT ON public.bill_adjustments TO authenticated;
GRANT ALL ON public.bill_adjustments TO service_role;
ALTER TABLE public.bill_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Billing admins read adjustments" ON public.bill_adjustments FOR SELECT TO authenticated
  USING (public.current_user_has_society_permission(society_id, 'billing.manage'::text, NULL::uuid));
CREATE TRIGGER bill_adjustments_append_only BEFORE UPDATE OR DELETE ON public.bill_adjustments
  FOR EACH ROW EXECUTE FUNCTION public._append_only();

CREATE OR REPLACE FUNCTION public.admin_add_bill_adjustment(_society_id uuid, _bill_id uuid, _amount numeric, _reason text, _request_id text, _counter_of uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid(); v_bill public.bills%ROWTYPE; v_existing public.bill_adjustments%ROWTYPE;
  v_paid numeric; v_adj numeric; v_outstanding numeric; v_id uuid; v_parent public.bill_adjustments%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  PERFORM public._billing_require_admin(_society_id);
  IF _amount IS NULL OR _amount = 0 OR abs(_amount) > 100000000 OR _amount <> round(_amount, 2) THEN RAISE EXCEPTION 'invalid_amount' USING ERRCODE='22023'; END IF;
  IF _reason IS NULL OR char_length(btrim(_reason)) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'invalid_reason' USING ERRCODE='22023'; END IF;
  IF _request_id IS NULL OR char_length(_request_id) NOT BETWEEN 8 AND 80 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_existing FROM public.bill_adjustments WHERE society_id=_society_id AND request_id=_request_id;
  IF FOUND THEN
    IF v_existing.bill_id=_bill_id AND v_existing.amount=_amount THEN RETURN jsonb_build_object('id',v_existing.id,'replayed',true); END IF;
    RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_bill FROM public.bills WHERE id=_bill_id AND society_id=_society_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unavailable' USING ERRCODE='P0002'; END IF;
  IF v_bill.cancelled_at IS NOT NULL OR v_bill.status IN ('cancelled','draft') THEN RAISE EXCEPTION 'bill_not_adjustable' USING ERRCODE='22023'; END IF;

  IF _counter_of IS NOT NULL THEN
    SELECT * INTO v_parent FROM public.bill_adjustments WHERE id=_counter_of AND bill_id=_bill_id AND society_id=_society_id;
    IF NOT FOUND OR v_parent.counter_of IS NOT NULL OR _amount <> -v_parent.amount
       OR EXISTS (SELECT 1 FROM public.bill_adjustments WHERE counter_of=_counter_of) THEN
      RAISE EXCEPTION 'invalid_counter' USING ERRCODE='22023';
    END IF;
  END IF;

  PERFORM public._rate_hit('bill_adjustment', v_uid::text, 60, interval '1 hour');

  SELECT COALESCE(sum(amount),0) INTO v_paid FROM public.payments WHERE bill_id=_bill_id AND society_id=_society_id AND status='verified';
  SELECT COALESCE(sum(amount),0) INTO v_adj FROM public.bill_adjustments WHERE bill_id=_bill_id;
  v_outstanding := COALESCE(v_bill.total_payable, v_bill.amount, 0) + v_adj + _amount - v_paid;
  IF v_outstanding < 0 THEN RAISE EXCEPTION 'adjustment_exceeds_outstanding' USING ERRCODE='22023'; END IF;

  INSERT INTO public.bill_adjustments(society_id,bill_id,amount,reason,request_id,counter_of,created_by)
  VALUES (_society_id,_bill_id,_amount,btrim(_reason),_request_id,_counter_of,v_uid) RETURNING id INTO v_id;

  INSERT INTO public.audit_log(actor_id,society_id,action,target_table,target_id,metadata)
  VALUES (v_uid,_society_id,'billing.adjustment_added','bills',_bill_id::text,
    jsonb_build_object('adjustment_id',v_id,'amount',_amount,'counter_of',_counter_of,'outstanding_after',v_outstanding));
  RETURN jsonb_build_object('id',v_id,'replayed',false,'outstanding_after',v_outstanding);
END $$;
REVOKE ALL ON FUNCTION public.admin_add_bill_adjustment(uuid,uuid,numeric,text,text,uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_bill_adjustment(uuid,uuid,numeric,text,text,uuid) TO authenticated;

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
    SELECT b.id, b.due_date,
      GREATEST(0, COALESCE(b.total_payable, b.amount, 0)
        + COALESCE((SELECT sum(a.amount) FROM public.bill_adjustments a WHERE a.bill_id=b.id AND a.created_at::date <= _as_of),0)
        - COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.bill_id=b.id AND p.society_id=b.society_id AND p.status='verified' AND p.verified_at::date <= _as_of),0)
      ) AS outstanding
    FROM public.bills b
    WHERE b.society_id = _society_id AND b.cancelled_at IS NULL AND b.status NOT IN ('cancelled','draft')
      AND COALESCE(b.finalized_at::date, b.created_at::date) <= _as_of
  ), bucketed AS (
    SELECT CASE WHEN due_date >= _as_of THEN 'current' WHEN _as_of - due_date <= 30 THEN '1_30'
      WHEN _as_of - due_date <= 60 THEN '31_60' WHEN _as_of - due_date <= 90 THEN '61_90' ELSE '90_plus' END AS bucket, outstanding
    FROM balances WHERE outstanding > 0
  )
  SELECT bb.bucket, sum(bb.outstanding), count(*) FROM bucketed bb GROUP BY bb.bucket;
END;
$function$;

ALTER TABLE public.society_settings
  ADD COLUMN handover_status text NOT NULL DEFAULT 'not_started'
    CHECK (handover_status IN ('not_started','in_progress','ready','handed_over')),
  ADD COLUMN handover_note text CHECK (handover_note IS NULL OR char_length(handover_note) <= 1000),
  ADD COLUMN handover_updated_at timestamptz,
  ADD COLUMN handover_updated_by uuid;

CREATE OR REPLACE FUNCTION public.get_handover_summary(_society_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
    'opening_balance_set', s.opening_balance_date IS NOT NULL,
    'bills', (SELECT count(*) FROM bills WHERE society_id=_society_id AND cancelled_at IS NULL),
    'setup_completed', s.setup_completed_at IS NOT NULL
  ) INTO r FROM (SELECT 1) one LEFT JOIN society_settings s ON s.society_id=_society_id;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.get_handover_summary(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_handover_summary(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_handover_status(_society_id uuid, _status text, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_old text;
BEGIN
  IF v_uid IS NULL OR _society_id IS NULL OR NOT public.current_user_has_society_permission(_society_id,'society.settings',NULL::uuid) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF _status NOT IN ('not_started','in_progress','ready','handed_over') THEN RAISE EXCEPTION 'invalid_status' USING ERRCODE='22023'; END IF;
  IF _note IS NOT NULL AND char_length(_note) > 1000 THEN RAISE EXCEPTION 'invalid_note' USING ERRCODE='22023'; END IF;
  IF _status = 'handed_over' AND (_note IS NULL OR char_length(btrim(_note)) < 5) THEN RAISE EXCEPTION 'note_required' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('handover_status', v_uid::text, 30, interval '1 hour');
  INSERT INTO society_settings(society_id) VALUES (_society_id) ON CONFLICT (society_id) DO NOTHING;
  SELECT handover_status INTO v_old FROM society_settings WHERE society_id=_society_id FOR UPDATE;
  UPDATE society_settings SET handover_status=_status, handover_note=NULLIF(btrim(COALESCE(_note,'')),''),
    handover_updated_at=now(), handover_updated_by=v_uid WHERE society_id=_society_id;
  INSERT INTO audit_log(actor_id,society_id,action,target_table,target_id,metadata)
  VALUES (v_uid,_society_id,'society.handover_status','society_settings',_society_id::text,jsonb_build_object('from',v_old,'to',_status));
  RETURN jsonb_build_object('status',_status);
END $$;
REVOKE ALL ON FUNCTION public.admin_set_handover_status(uuid,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_handover_status(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_society_export_section(_society_id uuid, _section text, _offset integer DEFAULT 0)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_limit constant int := 1000; v_sql text; v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF _society_id IS NULL OR NOT public.current_user_has_society_permission(_society_id, 'society.settings', NULL::uuid) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF _offset IS NULL OR _offset < 0 OR _offset > 100000 OR _offset % v_limit <> 0 THEN
    RAISE EXCEPTION 'invalid_offset' USING ERRCODE='22023';
  END IF;
  v_sql := CASE _section
    WHEN 'society' THEN 'SELECT id,name,registration_no,registration_number,address,full_address,city,state,pincode,property_type,layout,structure_label,total_units,plan_id,plan_status,created_at FROM societies WHERE id=$1'
    WHEN 'blocks' THEN 'SELECT id,name,description,structure_kind,is_active,display_order,created_at FROM blocks WHERE society_id=$1'
    WHEN 'flats' THEN 'SELECT id,block_id,flat_number,floor,type,unit_type,area_sqft,status,is_active,display_order,created_at FROM flats WHERE society_id=$1'
    WHEN 'occupancy' THEN 'SELECT fr.id,fr.flat_id,fr.user_id,p.full_name,p.phone,p.email,fr.relationship,fr.is_primary,fr.is_active,fr.moved_in_at,fr.moved_out_at,fr.ended_reason FROM flat_residents fr JOIN flats f ON f.id=fr.flat_id LEFT JOIN profiles p ON p.id=fr.user_id WHERE f.society_id=$1'
    WHEN 'offline_residents' THEN 'SELECT id,flat_id,full_name,phone,email,notes,created_at FROM offline_residents WHERE society_id=$1'
    WHEN 'family' THEN 'SELECT id,flat_id,user_id,offline_resident_id,full_name,relation,phone,age,is_active,created_at FROM family_members WHERE society_id=$1'
    WHEN 'team' THEN 'SELECT ur.id,ur.user_id,p.full_name,ur.role,ur.block_id,ur.is_active,ur.created_at,ur.deactivated_at FROM user_roles ur LEFT JOIN profiles p ON p.id=ur.user_id WHERE ur.society_id=$1 AND ur.role<>''super_admin'''
    WHEN 'vehicles' THEN 'SELECT id,flat_id,user_id,offline_resident_id,plate_number,make_model,color,type,is_active,created_at FROM vehicles WHERE society_id=$1'
    WHEN 'parking' THEN 'SELECT id,label,slot_type,flat_id,vehicle_id,notes,is_active,created_at FROM parking_slots WHERE society_id=$1'
    WHEN 'bills' THEN 'SELECT id,bill_number,flat_id,period_label,period_start,period_end,bill_date,due_date,amount,current_charges,previous_balance,penalties,adjustments,tax_amount,total_payable,status,paid_at,cancelled_at,cancel_reason,replaced_by_bill_id,created_at FROM bills WHERE society_id=$1'
    WHEN 'bill_lines' THEN 'SELECT id,bill_id,kind,description,amount,created_at FROM bill_line_items WHERE society_id=$1'
    WHEN 'bill_adjustments' THEN 'SELECT id,bill_id,amount,reason,counter_of,created_by,created_at FROM bill_adjustments WHERE society_id=$1'
    WHEN 'payments' THEN 'SELECT id,bill_id,flat_id,user_id,amount,method,status,source,reference_no,payment_date,paid_at,submitted_at,verified_at,rejected_at,rejection_reason,reversed_at,reversal_reason,journal_entry_id,reversal_journal_entry_id,created_at FROM payments WHERE society_id=$1'
    WHEN 'receipts' THEN 'SELECT id,payment_id,receipt_number,status,issued_at,amount_snapshot,method_snapshot,reference_snapshot,bill_number_snapshot,voided_at,void_reason,created_at FROM payment_receipts WHERE society_id=$1'
    WHEN 'income' THEN 'SELECT id,category_id,payer_kind,resident_user_id,non_member_payer_id,amount,payment_method,payment_status,payment_date,reference_number,description,verification_status,reconciliation_status,verified_at,reversed_at,reversal_reason,rejected_at,journal_entry_id,reversal_journal_entry_id,created_at FROM society_income_records WHERE society_id=$1'
    WHEN 'non_member_payers' THEN 'SELECT id,payer_type,display_name,organization_name,phone,email,reference_code,is_active,created_at FROM non_member_payers WHERE society_id=$1'
    WHEN 'expenses' THEN 'SELECT id,category,amount,note,spent_on,vendor_id,payment_method,status,journal_entry_id,reversal_journal_entry_id,reversed_at,reversal_reason,created_at FROM expenses WHERE society_id=$1'
    WHEN 'journal' THEN 'SELECT id,transaction_date,description,reference,source_type,source_id,source_action,status,reversal_of,posted_at,created_at FROM finance_journal_entries WHERE society_id=$1'
    WHEN 'journal_lines' THEN 'SELECT id,journal_entry_id,account_id,line_number,description,debit,credit,created_at FROM finance_journal_lines WHERE society_id=$1'
    WHEN 'bank_lines' THEN 'SELECT id,import_id,line_no,txn_date,description,reference,direction,amount,is_duplicate,status,matched_kind,matched_id,matched_at,created_at FROM bank_statement_lines WHERE society_id=$1'
    WHEN 'no_dues' THEN 'SELECT id,request_id,flat_id,certificate_number,issued_at,valid_until,revoked_at,revoke_reason,created_at FROM no_dues_certificates WHERE society_id=$1'
    WHEN 'procurement' THEN 'SELECT id,request_no,title,category,fy_start,needed_by,estimated_amount,status,vendor_id,selected_quotation_id,approved_amount,decided_at,decision_note,order_ref,ordered_at,invoice_ref,invoice_amount,invoice_date,payment_ref,expense_id,cancel_reason,created_at FROM procurement_requests WHERE society_id=$1'
    WHEN 'procurement_quotes' THEN 'SELECT id,request_id,vendor_id,amount,quote_ref,valid_until,created_at FROM procurement_quotations WHERE society_id=$1'
    WHEN 'budgets' THEN 'SELECT id,fy_start,category,amount,notes,created_at,updated_at FROM society_budgets WHERE society_id=$1'
    WHEN 'budget_revisions' THEN 'SELECT id,budget_id,old_amount,new_amount,reason,actor_id,created_at FROM society_budget_revisions WHERE society_id=$1'
    WHEN 'meetings' THEN 'SELECT id,title,agenda,starts_at,ends_at,location,audience,status,minutes,cancel_reason,created_at FROM meetings WHERE society_id=$1'
    WHEN 'resolutions' THEN 'SELECT id,meeting_id,seq,text,outcome,poll_id,created_at FROM meeting_resolutions WHERE society_id=$1'
    WHEN 'documents' THEN 'SELECT id,kind,category,title,audience,file_name,mime_type,size_bytes,status,version,created_at,archived_at FROM society_knowledge_sources WHERE society_id=$1 AND kind<>''faq'''
    WHEN 'document_versions' THEN 'SELECT id,source_id,version,file_name,mime_type,size_bytes,superseded_at FROM society_document_versions WHERE society_id=$1'
    WHEN 'staff' THEN 'SELECT id,full_name,job_type,shift_start,shift_end,shift_days,is_active,created_at FROM society_staff WHERE society_id=$1'
    WHEN 'assets' THEN 'SELECT id,name,category,location,status,purchase_date,installed_on,warranty_until,amc_until,vendor_id,created_at FROM society_assets WHERE society_id=$1'
    WHEN 'inventory' THEN 'SELECT id,name,location,unit,quantity,reorder_level,is_active,created_at FROM inventory_items WHERE society_id=$1'
    WHEN 'migrations' THEN 'SELECT id,source_type,source_filename,status,structure_mode,total_rows,valid_rows,warning_rows,error_rows,committed_rows,failure_code,created_at,validated_at,committed_at,failed_at FROM migration_jobs WHERE society_id=$1'
    WHEN 'helpdesk' THEN 'SELECT id,ticket_no,user_id,subject,description,category,status,priority,assigned_to,resolution_note,resolved_at,closed_at,created_at FROM support_tickets WHERE society_id=$1'
    WHEN 'visitors' THEN 'SELECT id,flat_id,flat_number,visitor_name,phone,vehicle_number,purpose,category,status,pre_approved,expected_at,entry_at,exit_at,decided_at,created_at FROM visitors WHERE society_id=$1'
    WHEN 'notices' THEN 'SELECT id,title,body,category,audience,block_id,status,publish_at,published_at,created_at FROM notices WHERE society_id=$1'
    WHEN 'polls' THEN 'SELECT id,kind,title,description,status,closes_at,created_at FROM polls WHERE society_id=$1'
    WHEN 'poll_options' THEN 'SELECT o.id,o.poll_id,o.label,o.position FROM poll_options o JOIN polls p ON p.id=o.poll_id WHERE p.society_id=$1'
    WHEN 'survey_questions' THEN 'SELECT id,poll_id,position,prompt,qtype,options,required FROM survey_questions WHERE society_id=$1'
    WHEN 'audit' THEN 'SELECT id,actor_id,action,target_table,target_id,created_at FROM audit_log WHERE society_id=$1'
    ELSE NULL END;
  IF v_sql IS NULL THEN RAISE EXCEPTION 'invalid_section' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('society_export', v_uid::text, 600, interval '1 hour');
  IF _section = 'society' THEN
    INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (v_uid, 'society.full_export', 'societies', _society_id::text, _society_id, jsonb_build_object('started_at', now()));
  END IF;
  EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM (%s ORDER BY 1 LIMIT %s OFFSET %s) t', v_sql, v_limit, _offset)
    INTO v_rows USING _society_id;
  RETURN jsonb_build_object('section', _section, 'offset', _offset, 'page_size', v_limit, 'rows', v_rows,
                            'has_more', jsonb_array_length(v_rows) = v_limit);
END $function$;
