
CREATE OR REPLACE FUNCTION public._bank_lock_line_society(_line_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_soc uuid;
BEGIN
  SELECT society_id INTO v_soc FROM public.bank_statement_lines WHERE id=_line_id;
  IF v_soc IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('bank_recon:'||v_soc, 0)); END IF;
END $$;
REVOKE ALL ON FUNCTION public._bank_lock_line_society(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bank_lock_line_society(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_bank_line_match(_line_id uuid, _kind text, _record_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid; v_line record; v_c record; v_prev text;
BEGIN
  PERFORM public._bank_lock_line_society(_line_id);
  SELECT * INTO v_line FROM public.bank_statement_lines WHERE id=_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  v_uid := public._finance_require_admin(v_line.society_id);
  IF v_line.status = 'matched' THEN RETURN jsonb_build_object('status','already_processed'); END IF;
  IF v_line.direction <> 'credit' OR v_line.status = 'ignored' OR _kind NOT IN ('payment','income') THEN
    RETURN jsonb_build_object('status','invalid_transition'); END IF;
  IF _kind='payment' THEN PERFORM 1 FROM public.payments WHERE id=_record_id FOR UPDATE;
  ELSE PERFORM 1 FROM public.society_income_records WHERE id=_record_id FOR UPDATE; END IF;
  SELECT * INTO v_c FROM public._bank_line_candidates(_line_id, 7) WHERE kind=_kind AND record_id=_record_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_eligible'); END IF;
  IF v_c.already_reconciled THEN RETURN jsonb_build_object('status','already_reconciled'); END IF;
  IF _kind='income' THEN
    SELECT reconciliation_status INTO v_prev FROM public.society_income_records WHERE id=_record_id;
    IF v_prev NOT IN ('unreconciled','needs_review','partially_matched') THEN
      RETURN jsonb_build_object('status','already_reconciled'); END IF;
    UPDATE public.society_income_records SET reconciliation_status='matched', reconciled_at=now(), reconciled_by=v_uid,
      reconciliation_reference='bank_line:'||_line_id, reconciliation_reason=NULL, updated_at=now() WHERE id=_record_id;
  END IF;
  BEGIN
    UPDATE public.bank_statement_lines SET status='matched', matched_kind=_kind, matched_id=_record_id,
      matched_by=v_uid, matched_at=now(), suggested_kind=NULL, suggested_id=NULL, match_strength=NULL, updated_at=now()
      WHERE id=_line_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_reconciled' USING ERRCODE='23505';
  END;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (v_uid,'bank_statement.reconcile','bank_statement_lines',_line_id,v_line.society_id,
      jsonb_build_object('kind',_kind,'record_id',_record_id,'amount',v_line.amount,'txn_date',v_line.txn_date,'from',v_line.status));
  PERFORM public._bank_refresh_suggestions(v_line.society_id);
  RETURN jsonb_build_object('status','success');
END $$;

CREATE OR REPLACE FUNCTION public.unmatch_bank_line(_line_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid; v_line record;
BEGIN
  PERFORM public._bank_lock_line_society(_line_id);
  SELECT * INTO v_line FROM public.bank_statement_lines WHERE id=_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  v_uid := public._finance_require_admin(v_line.society_id);
  IF char_length(btrim(COALESCE(_reason,''))) NOT BETWEEN 5 AND 300 THEN RETURN jsonb_build_object('status','invalid_input'); END IF;
  IF v_line.status NOT IN ('matched','ignored') THEN RETURN jsonb_build_object('status','already_processed'); END IF;
  IF v_line.matched_kind='income' THEN
    UPDATE public.society_income_records SET reconciliation_status='unreconciled', reconciled_at=NULL, reconciled_by=NULL,
      reconciliation_reference=NULL, reconciliation_reason=btrim(_reason), updated_at=now()
      WHERE id=v_line.matched_id AND reconciliation_status='matched' AND reconciliation_reference='bank_line:'||_line_id;
  END IF;
  UPDATE public.bank_statement_lines SET status='unmatched', matched_kind=NULL, matched_id=NULL, matched_by=NULL, matched_at=NULL,
    note=left(btrim(_reason),300), updated_at=now() WHERE id=_line_id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (v_uid,'bank_statement.unmatch','bank_statement_lines',_line_id,v_line.society_id,
      jsonb_build_object('from',v_line.status,'kind',v_line.matched_kind,'record_id',v_line.matched_id,'reason',btrim(_reason)));
  PERFORM public._bank_refresh_suggestions(v_line.society_id);
  RETURN jsonb_build_object('status','success');
END $$;

CREATE OR REPLACE FUNCTION public.ignore_bank_line(_line_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid; v_line record;
BEGIN
  PERFORM public._bank_lock_line_society(_line_id);
  SELECT * INTO v_line FROM public.bank_statement_lines WHERE id=_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  v_uid := public._finance_require_admin(v_line.society_id);
  IF char_length(btrim(COALESCE(_reason,''))) NOT BETWEEN 5 AND 300 THEN RETURN jsonb_build_object('status','invalid_input'); END IF;
  IF v_line.status IN ('matched','ignored') THEN RETURN jsonb_build_object('status','already_processed'); END IF;
  UPDATE public.bank_statement_lines SET status='ignored', suggested_kind=NULL, suggested_id=NULL, match_strength=NULL,
    note=left(btrim(_reason),300), updated_at=now() WHERE id=_line_id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (v_uid,'bank_statement.ignore','bank_statement_lines',_line_id,v_line.society_id,
      jsonb_build_object('from',v_line.status,'reason',btrim(_reason)));
  RETURN jsonb_build_object('status','success');
END $$;

CREATE OR REPLACE FUNCTION public.refresh_bank_statement_suggestions(_society_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public._finance_require_admin(_society_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('bank_recon:'||_society_id, 0));
  RETURN jsonb_build_object('status','ok','suggested',public._bank_refresh_suggestions(_society_id));
END $$;

CREATE OR REPLACE FUNCTION public.import_bank_statement(_society_id uuid, _file_name text, _file_sha256 text, _rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid; v_import uuid; v_row jsonb; v_i int := 0; v_fp text; v_dup boolean; v_dups int := 0;
  v_date date; v_desc text; v_ref text; v_dir text; v_amt numeric; v_sugg int;
BEGIN
  v_uid := public._finance_require_admin(_society_id);
  IF jsonb_typeof(_rows) <> 'array' OR jsonb_array_length(_rows) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  IF _file_sha256 !~ '^[0-9a-f]{64}$' OR char_length(btrim(COALESCE(_file_name,''))) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bank_recon:'||_society_id, 0));
  IF EXISTS (SELECT 1 FROM public.bank_statement_imports WHERE society_id=_society_id AND file_sha256=_file_sha256) THEN
    RETURN jsonb_build_object('status','already_imported'); END IF;
  INSERT INTO public.bank_statement_imports(society_id,file_name,file_sha256,row_count,created_by)
    VALUES (_society_id, btrim(_file_name), _file_sha256, jsonb_array_length(_rows), v_uid) RETURNING id INTO v_import;
  FOR v_row IN SELECT * FROM jsonb_array_elements(_rows) LOOP
    v_i := v_i + 1;
    v_date := (v_row->>'date')::date;
    v_desc := btrim(v_row->>'description');
    v_ref := NULLIF(btrim(COALESCE(v_row->>'reference','')),'');
    v_dir := v_row->>'direction';
    v_amt := round((v_row->>'amount')::numeric, 2);
    IF v_date IS NULL OR v_date > current_date + 1 OR v_date < date '2000-01-01' OR v_dir IS NULL OR v_dir NOT IN ('credit','debit')
       OR v_amt IS NULL OR v_amt <= 0 OR v_desc IS NULL OR v_desc = '' THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
    v_fp := md5(v_date::text||'|'||v_dir||'|'||v_amt::text||'|'||lower(COALESCE(v_ref,''))||'|'||lower(v_desc));
    v_dup := EXISTS (SELECT 1 FROM public.bank_statement_lines WHERE society_id=_society_id AND fingerprint=v_fp);
    IF v_dup THEN v_dups := v_dups + 1; END IF;
    INSERT INTO public.bank_statement_lines(society_id,import_id,line_no,txn_date,description,reference,direction,amount,fingerprint,is_duplicate)
      VALUES (_society_id, v_import, v_i, v_date, left(v_desc,300), left(v_ref,100), v_dir, v_amt, v_fp, v_dup);
  END LOOP;
  UPDATE public.bank_statement_imports SET duplicate_count=v_dups WHERE id=v_import;
  v_sugg := public._bank_refresh_suggestions(_society_id);
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (v_uid,'bank_statement.import','bank_statement_imports',v_import,_society_id,
            jsonb_build_object('rows',v_i,'possible_duplicates',v_dups,'file_name',btrim(_file_name)));
  RETURN jsonb_build_object('status','imported','import_id',v_import,'rows',v_i,'possible_duplicates',v_dups,'suggested',v_sugg);
END $$;
