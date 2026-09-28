
CREATE TABLE public.bank_statement_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 120),
  file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  row_count int NOT NULL CHECK (row_count BETWEEN 1 AND 2000),
  duplicate_count int NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (society_id, file_sha256)
);
GRANT SELECT ON public.bank_statement_imports TO authenticated;
GRANT ALL ON public.bank_statement_imports TO service_role;
ALTER TABLE public.bank_statement_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY bsi_admin_read ON public.bank_statement_imports FOR SELECT TO authenticated
  USING ((public.current_user_has_society_permission(society_id,'billing.manage'::text,NULL::uuid)
          OR public.has_role(auth.uid(),'super_admin'::public.app_role))
         AND public._finance_plan_enabled(society_id));

CREATE TABLE public.bank_statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES public.bank_statement_imports(id) ON DELETE CASCADE,
  line_no int NOT NULL,
  txn_date date NOT NULL,
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 300),
  reference text CHECK (reference IS NULL OR char_length(reference) BETWEEN 1 AND 100),
  direction text NOT NULL CHECK (direction IN ('credit','debit')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0 AND amount <= 100000000),
  fingerprint text NOT NULL,
  is_duplicate boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'unmatched'
    CHECK (status IN ('unmatched','suggested','conflict','already_reconciled','matched','ignored')),
  suggested_kind text CHECK (suggested_kind IN ('payment','income')),
  suggested_id uuid,
  match_strength text CHECK (match_strength IN ('strong','possible')),
  candidate_count int NOT NULL DEFAULT 0,
  matched_kind text CHECK (matched_kind IN ('payment','income')),
  matched_id uuid,
  matched_by uuid,
  matched_at timestamptz,
  note text CHECK (note IS NULL OR char_length(note) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_id, line_no),
  CONSTRAINT bsl_match_consistent CHECK (
    (status = 'matched') = (matched_kind IS NOT NULL AND matched_id IS NOT NULL))
);
CREATE UNIQUE INDEX bsl_one_line_per_record ON public.bank_statement_lines (matched_kind, matched_id) WHERE status = 'matched';
CREATE INDEX bsl_society_status ON public.bank_statement_lines (society_id, status, txn_date);
CREATE INDEX bsl_society_fp ON public.bank_statement_lines (society_id, fingerprint);
GRANT SELECT ON public.bank_statement_lines TO authenticated;
GRANT ALL ON public.bank_statement_lines TO service_role;
ALTER TABLE public.bank_statement_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY bsl_admin_read ON public.bank_statement_lines FOR SELECT TO authenticated
  USING ((public.current_user_has_society_permission(society_id,'billing.manage'::text,NULL::uuid)
          OR public.has_role(auth.uid(),'super_admin'::public.app_role))
         AND public._finance_plan_enabled(society_id));

CREATE OR REPLACE FUNCTION public._bank_line_candidates(_line_id uuid, _days int)
RETURNS TABLE(kind text, record_id uuid, record_date date, amount numeric, reference text, label text,
              already_reconciled boolean, score int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH l AS (SELECT * FROM public.bank_statement_lines WHERE id=_line_id AND direction='credit'),
  c AS (
    SELECT 'payment'::text kind, p.id, COALESCE(p.payment_date, p.paid_at::date) d, p.amount, p.reference_no ref,
           ('Maintenance payment' || COALESCE(' · ' || f.flat_number, ''))::text label, false manual_recon
    FROM l JOIN public.payments p ON p.society_id=l.society_id AND p.method='bank_transfer' AND p.status='verified'
         AND p.amount=l.amount AND COALESCE(p.payment_date, p.paid_at::date) BETWEEN l.txn_date-_days AND l.txn_date+_days
    LEFT JOIN public.flats f ON f.id=p.flat_id
    UNION ALL
    SELECT 'income', r.id, r.payment_date::date, r.amount, r.reference_number,
           ('Other income' || COALESCE(' · ' || left(r.description,60), ''))::text,
           (r.reconciliation_status='matched' AND COALESCE(r.reconciliation_reference,'') NOT LIKE 'bank_line:%')
    FROM l JOIN public.society_income_records r ON r.society_id=l.society_id AND r.payment_method='bank_transfer'
         AND r.verification_status='verified' AND r.reversed_at IS NULL
         AND r.amount=l.amount AND r.payment_date::date BETWEEN l.txn_date-_days AND l.txn_date+_days
  )
  SELECT c.kind, c.id, c.d, c.amount, c.ref, c.label,
         (c.manual_recon OR EXISTS (SELECT 1 FROM public.bank_statement_lines m
                 WHERE m.status='matched' AND m.matched_kind=c.kind AND m.matched_id=c.id)) already,
         CASE WHEN c.ref IS NOT NULL AND char_length(btrim(c.ref))>=4 AND (
                lower(btrim(c.ref)) = lower(COALESCE(l.reference,''))
                OR position(lower(btrim(c.ref)) IN lower(l.description || ' ' || COALESCE(l.reference,'')))>0)
              THEN 100 ELSE 60 - 5*abs(c.d - l.txn_date) END
  FROM c CROSS JOIN l
$$;
REVOKE ALL ON FUNCTION public._bank_line_candidates(uuid,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bank_line_candidates(uuid,int) TO service_role;

CREATE OR REPLACE FUNCTION public._bank_refresh_suggestions(_society_id uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_line record; v_top int; v_n int; v_avail int; v_best record; v_count int := 0;
BEGIN
  FOR v_line IN SELECT id FROM public.bank_statement_lines
     WHERE society_id=_society_id AND direction='credit' AND status IN ('unmatched','suggested','conflict','already_reconciled')
     FOR UPDATE LOOP
    SELECT count(*) FILTER (WHERE NOT already_reconciled), count(*) INTO v_avail, v_n FROM public._bank_line_candidates(v_line.id, 3);
    IF v_avail = 0 THEN
      UPDATE public.bank_statement_lines SET status = CASE WHEN v_n>0 THEN 'already_reconciled' ELSE 'unmatched' END,
        suggested_kind=NULL, suggested_id=NULL, match_strength=NULL, candidate_count=v_n, updated_at=now() WHERE id=v_line.id;
      CONTINUE;
    END IF;
    SELECT max(score) INTO v_top FROM public._bank_line_candidates(v_line.id, 3) WHERE NOT already_reconciled;
    SELECT * INTO v_best FROM public._bank_line_candidates(v_line.id, 3) WHERE NOT already_reconciled AND score=v_top LIMIT 1;
    SELECT count(*) INTO v_n FROM public._bank_line_candidates(v_line.id, 3) WHERE NOT already_reconciled AND score=v_top;
    IF v_n > 1 THEN
      UPDATE public.bank_statement_lines SET status='conflict', suggested_kind=NULL, suggested_id=NULL, match_strength=NULL,
        candidate_count=v_avail, updated_at=now() WHERE id=v_line.id;
    ELSE
      UPDATE public.bank_statement_lines SET status='suggested', suggested_kind=v_best.kind, suggested_id=v_best.record_id,
        match_strength=CASE WHEN v_top>=100 THEN 'strong' ELSE 'possible' END, candidate_count=v_avail, updated_at=now()
        WHERE id=v_line.id;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public._bank_refresh_suggestions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bank_refresh_suggestions(uuid) TO service_role;

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
  PERFORM pg_advisory_xact_lock(hashtextextended('bank_import:'||_society_id, 0));
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
REVOKE ALL ON FUNCTION public.import_bank_statement(uuid,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_bank_statement(uuid,text,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.refresh_bank_statement_suggestions(_society_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public._finance_require_admin(_society_id);
  RETURN jsonb_build_object('status','ok','suggested',public._bank_refresh_suggestions(_society_id));
END $$;
REVOKE ALL ON FUNCTION public.refresh_bank_statement_suggestions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_bank_statement_suggestions(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_bank_line_candidates(_line_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_soc uuid;
BEGIN
  SELECT society_id INTO v_soc FROM public.bank_statement_lines WHERE id=_line_id;
  IF v_soc IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  PERFORM public._finance_require_admin(v_soc);
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',kind,'record_id',record_id,'record_date',record_date,
     'amount',amount,'reference',reference,'label',label,'already_reconciled',already_reconciled,'score',score) ORDER BY score DESC)
     FROM public._bank_line_candidates(_line_id, 7)), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.list_bank_line_candidates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_bank_line_candidates(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_bank_line_match(_line_id uuid, _kind text, _record_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid; v_line record; v_c record; v_prev text;
BEGIN
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
REVOKE ALL ON FUNCTION public.confirm_bank_line_match(uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_bank_line_match(uuid,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.unmatch_bank_line(_line_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid; v_line record;
BEGIN
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
REVOKE ALL ON FUNCTION public.unmatch_bank_line(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unmatch_bank_line(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.ignore_bank_line(_line_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid; v_line record;
BEGIN
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
REVOKE ALL ON FUNCTION public.ignore_bank_line(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ignore_bank_line(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_bank_statement_lines(_society_id uuid, _status text DEFAULT NULL, _limit int DEFAULT 50, _offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_rows jsonb; v_summary jsonb;
BEGIN
  PERFORM public._finance_require_admin(_society_id);
  IF _limit NOT BETWEEN 1 AND 200 OR _offset < 0 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  SELECT jsonb_object_agg(status, jsonb_build_object('count',n,'amount',amt)) INTO v_summary FROM (
    SELECT status, count(*) n, sum(amount) amt FROM public.bank_statement_lines WHERE society_id=_society_id GROUP BY status) s;
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'txn_date') DESC, (x->>'line_no')::int), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object('id',l.id,'line_no',l.line_no,'txn_date',l.txn_date,'description',l.description,'reference',l.reference,
      'direction',l.direction,'amount',l.amount,'status',l.status,'is_duplicate',l.is_duplicate,'match_strength',l.match_strength,
      'candidate_count',l.candidate_count,'note',l.note,
      'record_kind',COALESCE(l.matched_kind,l.suggested_kind),
      'record_id',COALESCE(l.matched_id,l.suggested_id),
      'record_label', CASE COALESCE(l.matched_kind,l.suggested_kind)
          WHEN 'payment' THEN (SELECT 'Maintenance payment' || COALESCE(' · ' || f.flat_number,'') || COALESCE(' · ref ' || p.reference_no,'')
                               FROM public.payments p LEFT JOIN public.flats f ON f.id=p.flat_id WHERE p.id=COALESCE(l.matched_id,l.suggested_id))
          WHEN 'income' THEN (SELECT 'Other income' || COALESCE(' · ' || left(r.description,60),'') || COALESCE(' · ref ' || r.reference_number,'')
                              FROM public.society_income_records r WHERE r.id=COALESCE(l.matched_id,l.suggested_id)) END,
      'record_reversed', CASE l.matched_kind
          WHEN 'payment' THEN EXISTS (SELECT 1 FROM public.payments p WHERE p.id=l.matched_id AND p.status<>'verified')
          WHEN 'income' THEN EXISTS (SELECT 1 FROM public.society_income_records r WHERE r.id=l.matched_id AND (r.verification_status<>'verified' OR r.reversed_at IS NOT NULL))
          ELSE false END) x
    FROM public.bank_statement_lines l
    WHERE l.society_id=_society_id AND (_status IS NULL OR l.status=_status)
    ORDER BY l.txn_date DESC, l.line_no LIMIT _limit OFFSET _offset) q;
  RETURN jsonb_build_object('rows',v_rows,'summary',COALESCE(v_summary,'{}'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.list_bank_statement_lines(uuid,text,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_bank_statement_lines(uuid,text,int,int) TO authenticated;
