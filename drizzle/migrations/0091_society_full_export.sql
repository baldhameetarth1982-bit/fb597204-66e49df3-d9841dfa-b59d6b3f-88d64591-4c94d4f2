CREATE OR REPLACE FUNCTION public.get_society_export_section(_society_id uuid, _section text, _offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_limit constant int := 1000;
  v_sql text;
  v_rows jsonb;
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
    WHEN 'payments' THEN 'SELECT id,bill_id,flat_id,user_id,amount,method,status,source,reference_no,payment_date,paid_at,submitted_at,verified_at,rejected_at,rejection_reason,reversed_at,reversal_reason,journal_entry_id,reversal_journal_entry_id,created_at FROM payments WHERE society_id=$1'
    WHEN 'receipts' THEN 'SELECT id,payment_id,receipt_number,status,issued_at,amount_snapshot,method_snapshot,reference_snapshot,bill_number_snapshot,voided_at,void_reason,created_at FROM payment_receipts WHERE society_id=$1'
    WHEN 'income' THEN 'SELECT id,category_id,payer_kind,resident_user_id,non_member_payer_id,amount,payment_method,payment_status,payment_date,reference_number,description,verification_status,reconciliation_status,verified_at,reversed_at,reversal_reason,rejected_at,journal_entry_id,reversal_journal_entry_id,created_at FROM society_income_records WHERE society_id=$1'
    WHEN 'non_member_payers' THEN 'SELECT id,payer_type,display_name,organization_name,phone,email,reference_code,is_active,created_at FROM non_member_payers WHERE society_id=$1'
    WHEN 'expenses' THEN 'SELECT id,category,amount,note,spent_on,vendor_id,payment_method,status,journal_entry_id,reversal_journal_entry_id,reversed_at,reversal_reason,created_at FROM expenses WHERE society_id=$1'
    WHEN 'journal' THEN 'SELECT id,transaction_date,description,reference,source_type,source_id,source_action,status,reversal_of,posted_at,created_at FROM finance_journal_entries WHERE society_id=$1'
    WHEN 'journal_lines' THEN 'SELECT id,journal_entry_id,account_id,line_number,description,debit,credit,created_at FROM finance_journal_lines WHERE society_id=$1'
    WHEN 'bank_lines' THEN 'SELECT id,import_id,line_no,txn_date,description,reference,direction,amount,is_duplicate,status,matched_kind,matched_id,matched_at,created_at FROM bank_statement_lines WHERE society_id=$1'
    WHEN 'no_dues' THEN 'SELECT id,request_id,flat_id,certificate_number,issued_at,valid_until,revoked_at,revoke_reason,created_at FROM no_dues_certificates WHERE society_id=$1'
    WHEN 'helpdesk' THEN 'SELECT id,ticket_no,user_id,subject,description,category,status,priority,assigned_to,resolution_note,resolved_at,closed_at,created_at FROM support_tickets WHERE society_id=$1'
    WHEN 'visitors' THEN 'SELECT id,flat_id,flat_number,visitor_name,phone,vehicle_number,purpose,category,status,pre_approved,expected_at,entry_at,exit_at,decided_at,created_at FROM visitors WHERE society_id=$1'
    WHEN 'notices' THEN 'SELECT id,title,body,category,audience,block_id,status,publish_at,published_at,created_at FROM notices WHERE society_id=$1'
    WHEN 'polls' THEN 'SELECT id,kind,title,description,status,closes_at,created_at FROM polls WHERE society_id=$1'
    WHEN 'poll_options' THEN 'SELECT o.id,o.poll_id,o.label,o.position FROM poll_options o JOIN polls p ON p.id=o.poll_id WHERE p.society_id=$1'
    WHEN 'survey_questions' THEN 'SELECT id,poll_id,position,prompt,qtype,options,required FROM survey_questions WHERE society_id=$1'
    WHEN 'audit' THEN 'SELECT id,actor_id,action,target_table,target_id,created_at FROM audit_log WHERE society_id=$1'
    ELSE NULL END;
  IF v_sql IS NULL THEN RAISE EXCEPTION 'invalid_section' USING ERRCODE='22023'; END IF;

  PERFORM public._rate_hit('society_export', v_uid::text, 400, interval '1 hour');

  IF _section = 'society' THEN
    INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (v_uid, 'society.full_export', 'societies', _society_id::text, _society_id, jsonb_build_object('started_at', now()));
  END IF;

  EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM (%s ORDER BY 1 LIMIT %s OFFSET %s) t', v_sql, v_limit, _offset)
    INTO v_rows USING _society_id;

  RETURN jsonb_build_object('section', _section, 'offset', _offset, 'page_size', v_limit, 'rows', v_rows,
                            'has_more', jsonb_array_length(v_rows) = v_limit);
END $fn$;

REVOKE ALL ON FUNCTION public.get_society_export_section(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_society_export_section(uuid, text, integer) TO authenticated, service_role;