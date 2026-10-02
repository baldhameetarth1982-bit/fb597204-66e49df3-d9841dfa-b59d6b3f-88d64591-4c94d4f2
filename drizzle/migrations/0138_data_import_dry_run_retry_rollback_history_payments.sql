
-- ===== Shared value parsers (Indian formats) =====
CREATE OR REPLACE FUNCTION public._import_parse_amount(_v text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE s text := regexp_replace(coalesce(_v,''), '[₹,\s]|^(rs\.?|inr)', '', 'gi');
BEGIN
  IF s !~ '^\d{1,8}(\.\d{1,2})?$' THEN RETURN NULL; END IF;
  RETURN s::numeric;
END $$;

CREATE OR REPLACE FUNCTION public._import_parse_date(_v text) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE s text := btrim(coalesce(_v,'')); d date;
BEGIN
  BEGIN
    IF s ~ '^\d{4}-\d{2}-\d{2}$' THEN d := to_date(s, 'YYYY-MM-DD');
      IF to_char(d,'YYYY-MM-DD') <> s THEN RETURN NULL; END IF;
    ELSIF s ~ '^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$' THEN
      s := regexp_replace(s, '[/.]', '-', 'g');
      d := to_date(s, 'DD-MM-YYYY');
      IF to_char(d,'FMDD-FMMM-YYYY') <> regexp_replace(regexp_replace(s,'^0',''),'-0','-') THEN RETURN NULL; END IF;
    ELSE RETURN NULL; END IF;
  EXCEPTION WHEN others THEN RETURN NULL; END;
  IF d > CURRENT_DATE OR d < DATE '2000-01-01' THEN RETURN NULL; END IF;
  RETURN d;
END $$;

CREATE OR REPLACE FUNCTION public._import_find_flat(_society_id uuid, _block text, _unit text, OUT n int, OUT flat_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT count(*)::int, min(f.id::text)::uuid
    FROM flats f LEFT JOIN blocks b ON b.id = f.block_id
   WHERE f.society_id=_society_id AND f.is_active AND lower(f.flat_number) = lower(btrim(_unit))
     AND (btrim(coalesce(_block,'')) = '' OR lower(coalesce(b.name,'')) = lower(btrim(_block)));
$$;
REVOKE ALL ON FUNCTION public._import_find_flat(uuid,text,text) FROM PUBLIC, anon, authenticated;

-- ===== Opening balances: dry-run capable import (old signature becomes a wrapper) =====
CREATE OR REPLACE FUNCTION public.import_opening_balances_v2(_society_id uuid, _request_id text, _source_ref text, _rows jsonb, _dry_run boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid(); v_row jsonb; v_i int := 0; f record;
  v_unit text; v_amt numeric; v_d date; v_ok int := 0; v_dup int := 0;
  v_rej jsonb := '[]'::jsonb; v_seen text[] := '{}';
BEGIN
  PERFORM public._billing_require_admin(_society_id);
  IF _request_id IS NULL OR length(_request_id) NOT BETWEEN 8 AND 80 THEN RAISE EXCEPTION 'invalid_request_id'; END IF;
  IF jsonb_typeof(_rows) <> 'array' OR jsonb_array_length(_rows) = 0 OR jsonb_array_length(_rows) > 5000 THEN RAISE EXCEPTION 'invalid_rows'; END IF;
  IF NOT coalesce(_dry_run,false) AND EXISTS (SELECT 1 FROM opening_balances WHERE society_id=_society_id AND request_id=_request_id) THEN
    RETURN jsonb_build_object('idempotent_replay', true, 'dry_run', false,
      'imported', (SELECT count(*) FROM opening_balances WHERE society_id=_society_id AND request_id=_request_id), 'rejected', '[]'::jsonb);
  END IF;
  PERFORM public._rate_hit(CASE WHEN _dry_run THEN 'opening_balance_dry_run' ELSE 'opening_balance_import' END, v_uid::text,
    CASE WHEN _dry_run THEN 60 ELSE 10 END, interval '1 hour');
  FOR v_row IN SELECT value FROM jsonb_array_elements(_rows) LOOP
    v_i := v_i + 1;
    v_unit := left(btrim(coalesce(v_row->>'unit','')), 40);
    IF v_unit = '' THEN v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'missing_unit'); CONTINUE; END IF;
    v_amt := public._import_parse_amount(v_row->>'amount');
    IF v_amt IS NULL OR v_amt <= 0 OR v_amt > 10000000 THEN v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'invalid_amount'); CONTINUE; END IF;
    v_d := public._import_parse_date(v_row->>'as_of');
    IF v_d IS NULL THEN v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'invalid_date'); CONTINUE; END IF;
    SELECT * INTO f FROM public._import_find_flat(_society_id, left(coalesce(v_row->>'block',''),80), v_unit);
    IF f.n = 0 THEN v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'unit_not_found'); CONTINUE; END IF;
    IF f.n > 1 THEN v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'ambiguous_unit'); CONTINUE; END IF;
    IF f.flat_id::text = ANY(v_seen) THEN v_dup := v_dup + 1; v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'duplicate_in_file'); CONTINUE; END IF;
    v_seen := v_seen || f.flat_id::text;
    IF EXISTS (SELECT 1 FROM opening_balances WHERE society_id=_society_id AND flat_id=f.flat_id AND status <> 'rejected') THEN
      v_dup := v_dup + 1; v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'already_imported'); CONTINUE; END IF;
    IF NOT coalesce(_dry_run,false) THEN
      INSERT INTO opening_balances (society_id, flat_id, amount, as_of, source_ref, request_id, created_by)
        VALUES (_society_id, f.flat_id, v_amt, v_d, left(nullif(btrim(coalesce(_source_ref,'')),''),120), _request_id, v_uid);
    END IF;
    v_ok := v_ok + 1;
  END LOOP;
  IF NOT coalesce(_dry_run,false) THEN
    INSERT INTO audit_log (actor_id, action, target_table, target_id, society_id, metadata)
      VALUES (v_uid, 'billing.opening_balances_imported', 'opening_balances', _request_id, _society_id,
        jsonb_build_object('total', v_i, 'imported', v_ok, 'rejected', jsonb_array_length(v_rej), 'duplicates', v_dup, 'source_ref', left(coalesce(_source_ref,''),120)));
  END IF;
  RETURN jsonb_build_object('idempotent_replay', false, 'dry_run', coalesce(_dry_run,false), 'total', v_i,
    'imported', v_ok, 'duplicates', v_dup, 'rejected', v_rej);
END $$;

CREATE OR REPLACE FUNCTION public.import_opening_balances(_society_id uuid, _request_id text, _source_ref text, _rows jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.import_opening_balances_v2(_society_id, _request_id, _source_ref, _rows, false);
$$;

CREATE OR REPLACE FUNCTION public.rollback_opening_balance_batch(_society_id uuid, _request_id text, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_reason text := nullif(btrim(coalesce(_reason,'')),''); v_n int; v_conf int;
BEGIN
  PERFORM public._billing_require_admin(_society_id);
  IF v_reason IS NULL OR length(v_reason) < 5 OR length(v_reason) > 400 THEN RAISE EXCEPTION 'reason_required'; END IF;
  PERFORM 1 FROM opening_balances WHERE society_id=_society_id AND request_id=_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unavailable'; END IF;
  SELECT count(*) INTO v_conf FROM opening_balances WHERE society_id=_society_id AND request_id=_request_id AND status='confirmed';
  IF v_conf > 0 THEN RAISE EXCEPTION 'batch_has_confirmed_rows'; END IF;
  UPDATE opening_balances SET status='rejected', reviewed_by=auth.uid(), reviewed_at=now(),
      review_note=left('Import undone: '||v_reason, 500)
    WHERE society_id=_society_id AND request_id=_request_id AND status='imported_unverified';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO audit_log (actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (auth.uid(), 'billing.opening_balance_import_undone', 'opening_balances', _request_id, _society_id,
      jsonb_build_object('rejected', v_n, 'reason', v_reason));
  RETURN jsonb_build_object('status','ok','undone', v_n);
END $$;

-- ===== Historical (past) payments: record-only, never live money =====
CREATE TABLE public.historical_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_id uuid NOT NULL REFERENCES public.flats(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount > 0 AND amount <= 10000000),
  payment_date date NOT NULL,
  method text NOT NULL CHECK (method IN ('cash','bank_transfer','cheque','upi','online','other')),
  reference_no text CHECK (length(reference_no) <= 80),
  receipt_ref text CHECK (length(receipt_ref) <= 80),
  source_ref text CHECK (length(source_ref) <= 120),
  request_id text NOT NULL,
  row_number int NOT NULL,
  status text NOT NULL DEFAULT 'imported_unverified' CHECK (status IN ('imported_unverified','confirmed','rejected','reversed')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid, reviewed_at timestamptz, review_note text CHECK (length(review_note) <= 500),
  UNIQUE (society_id, request_id, row_number)
);
CREATE UNIQUE INDEX historical_payments_dedupe ON public.historical_payments
  (society_id, flat_id, payment_date, amount, upper(coalesce(reference_no,''))) WHERE status IN ('imported_unverified','confirmed');
CREATE INDEX historical_payments_society_created ON public.historical_payments (society_id, created_at DESC);
GRANT SELECT ON public.historical_payments TO authenticated;
GRANT ALL ON public.historical_payments TO service_role;
ALTER TABLE public.historical_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Billing admins read historical payments" ON public.historical_payments FOR SELECT TO authenticated
  USING (public.current_user_has_society_permission(society_id, 'billing.manage'::text, NULL::uuid));
CREATE POLICY "Current residents read confirmed history of their flat" ON public.historical_payments FOR SELECT TO authenticated
  USING (status = 'confirmed' AND EXISTS (SELECT 1 FROM public.flat_residents fr WHERE fr.flat_id = historical_payments.flat_id
    AND fr.user_id = auth.uid() AND fr.is_active AND fr.moved_out_at IS NULL));

CREATE OR REPLACE FUNCTION public._historical_payments_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'historical_payment_append_only'; END IF;
  IF NEW.amount <> OLD.amount OR NEW.flat_id <> OLD.flat_id OR NEW.society_id <> OLD.society_id OR NEW.payment_date <> OLD.payment_date
     OR NEW.method <> OLD.method OR NEW.reference_no IS DISTINCT FROM OLD.reference_no OR NEW.receipt_ref IS DISTINCT FROM OLD.receipt_ref
     OR NEW.request_id <> OLD.request_id OR NEW.row_number <> OLD.row_number OR NEW.created_by <> OLD.created_by
     OR NEW.created_at <> OLD.created_at OR NEW.source_ref IS DISTINCT FROM OLD.source_ref THEN
    RAISE EXCEPTION 'historical_payment_immutable';
  END IF;
  IF OLD.status = 'imported_unverified' AND NEW.status IN ('confirmed','rejected') THEN RETURN NEW; END IF;
  IF OLD.status = 'confirmed' AND NEW.status = 'reversed' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'historical_payment_immutable';
END $$;
CREATE TRIGGER historical_payments_guard BEFORE UPDATE OR DELETE ON public.historical_payments
  FOR EACH ROW EXECUTE FUNCTION public._historical_payments_guard();

CREATE OR REPLACE FUNCTION public.import_historical_payments(_society_id uuid, _request_id text, _source_ref text, _rows jsonb, _dry_run boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid(); v_row jsonb; v_i int := 0; f record; v_unit text; v_amt numeric; v_d date;
  v_method text; v_ref text; v_rcpt text; v_key text; v_ok int := 0; v_dup int := 0;
  v_rej jsonb := '[]'::jsonb; v_seen text[] := '{}';
BEGIN
  PERFORM public._billing_require_admin(_society_id);
  IF _request_id IS NULL OR length(_request_id) NOT BETWEEN 8 AND 80 THEN RAISE EXCEPTION 'invalid_request_id'; END IF;
  IF jsonb_typeof(_rows) <> 'array' OR jsonb_array_length(_rows) = 0 OR jsonb_array_length(_rows) > 5000 THEN RAISE EXCEPTION 'invalid_rows'; END IF;
  IF NOT coalesce(_dry_run,false) AND EXISTS (SELECT 1 FROM historical_payments WHERE society_id=_society_id AND request_id=_request_id) THEN
    RETURN jsonb_build_object('idempotent_replay', true, 'dry_run', false,
      'imported', (SELECT count(*) FROM historical_payments WHERE society_id=_society_id AND request_id=_request_id), 'rejected', '[]'::jsonb);
  END IF;
  PERFORM public._rate_hit(CASE WHEN _dry_run THEN 'historical_payment_dry_run' ELSE 'historical_payment_import' END, v_uid::text,
    CASE WHEN _dry_run THEN 60 ELSE 10 END, interval '1 hour');
  FOR v_row IN SELECT value FROM jsonb_array_elements(_rows) LOOP
    v_i := v_i + 1;
    v_unit := left(btrim(coalesce(v_row->>'unit','')), 40);
    IF v_unit = '' THEN v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'missing_unit'); CONTINUE; END IF;
    v_amt := public._import_parse_amount(v_row->>'amount');
    IF v_amt IS NULL OR v_amt <= 0 OR v_amt > 10000000 THEN v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'invalid_amount'); CONTINUE; END IF;
    v_d := public._import_parse_date(v_row->>'payment_date');
    IF v_d IS NULL THEN v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'invalid_date'); CONTINUE; END IF;
    v_method := lower(regexp_replace(btrim(coalesce(v_row->>'method','')), '[\s-]+', '_', 'g'));
    v_method := CASE WHEN v_method IN ('','cash') THEN 'cash'
      WHEN v_method IN ('bank','bank_transfer','neft','rtgs','imps','transfer') THEN 'bank_transfer'
      WHEN v_method IN ('cheque','check','chq') THEN 'cheque' WHEN v_method IN ('upi','gpay','phonepe','paytm') THEN 'upi'
      WHEN v_method IN ('online','card','netbanking') THEN 'online' WHEN v_method = 'other' THEN 'other' ELSE NULL END;
    IF v_method IS NULL THEN v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'invalid_method'); CONTINUE; END IF;
    v_ref := nullif(btrim(coalesce(v_row->>'reference_no','')), '');
    v_rcpt := nullif(btrim(coalesce(v_row->>'receipt_ref','')), '');
    IF length(v_ref) > 80 OR length(v_rcpt) > 80 THEN v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'value_too_long'); CONTINUE; END IF;
    IF v_ref ~ '^[=+\-@]' OR v_rcpt ~ '^[=+\-@]' THEN v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'unsafe_value'); CONTINUE; END IF;
    SELECT * INTO f FROM public._import_find_flat(_society_id, left(coalesce(v_row->>'block',''),80), v_unit);
    IF f.n = 0 THEN v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'unit_not_found'); CONTINUE; END IF;
    IF f.n > 1 THEN v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'ambiguous_unit'); CONTINUE; END IF;
    v_key := f.flat_id::text||'|'||v_d||'|'||v_amt||'|'||upper(coalesce(v_ref,''));
    IF v_key = ANY(v_seen) THEN v_dup := v_dup + 1; v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'duplicate_in_file'); CONTINUE; END IF;
    v_seen := v_seen || v_key;
    IF EXISTS (SELECT 1 FROM historical_payments WHERE society_id=_society_id AND flat_id=f.flat_id AND payment_date=v_d AND amount=v_amt
        AND upper(coalesce(reference_no,'')) = upper(coalesce(v_ref,'')) AND status IN ('imported_unverified','confirmed')) THEN
      v_dup := v_dup + 1; v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'already_imported'); CONTINUE; END IF;
    IF v_ref IS NOT NULL AND EXISTS (SELECT 1 FROM payments WHERE society_id=_society_id AND status IN ('pending','verified')
        AND upper(btrim(coalesce(reference_no,''))) = upper(v_ref)) THEN
      v_dup := v_dup + 1; v_rej := v_rej || jsonb_build_object('row', v_i, 'code', 'matches_live_payment'); CONTINUE; END IF;
    IF NOT coalesce(_dry_run,false) THEN
      INSERT INTO historical_payments (society_id, flat_id, amount, payment_date, method, reference_no, receipt_ref, source_ref, request_id, row_number, created_by)
        VALUES (_society_id, f.flat_id, v_amt, v_d, v_method, v_ref, v_rcpt, left(nullif(btrim(coalesce(_source_ref,'')),''),120), _request_id, v_i, v_uid);
    END IF;
    v_ok := v_ok + 1;
  END LOOP;
  IF NOT coalesce(_dry_run,false) THEN
    INSERT INTO audit_log (actor_id, action, target_table, target_id, society_id, metadata)
      VALUES (v_uid, 'billing.historical_payments_imported', 'historical_payments', _request_id, _society_id,
        jsonb_build_object('total', v_i, 'imported', v_ok, 'rejected', jsonb_array_length(v_rej), 'duplicates', v_dup, 'source_ref', left(coalesce(_source_ref,''),120)));
  END IF;
  RETURN jsonb_build_object('idempotent_replay', false, 'dry_run', coalesce(_dry_run,false), 'total', v_i,
    'imported', v_ok, 'duplicates', v_dup, 'rejected', v_rej);
END $$;

CREATE OR REPLACE FUNCTION public.review_historical_payment(_id uuid, _confirm boolean, _note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; v_note text := nullif(btrim(coalesce(_note,'')),'');
BEGIN
  SELECT * INTO r FROM historical_payments WHERE id=_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unavailable' USING ERRCODE='P0002'; END IF;
  PERFORM public._billing_require_admin(r.society_id);
  PERFORM public._rate_hit('historical_payment_review', auth.uid()::text, 300, interval '1 hour');
  IF r.status <> 'imported_unverified' THEN RAISE EXCEPTION 'already_reviewed'; END IF;
  IF _confirm IS NULL OR (v_note IS NOT NULL AND length(v_note) > 500) THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF NOT _confirm AND v_note IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;
  UPDATE historical_payments SET status = CASE WHEN _confirm THEN 'confirmed' ELSE 'rejected' END,
    reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_note WHERE id=_id;
  INSERT INTO audit_log (actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (auth.uid(), CASE WHEN _confirm THEN 'billing.historical_payment_confirmed' ELSE 'billing.historical_payment_rejected' END,
      'historical_payments', _id::text, r.society_id, jsonb_build_object('amount', r.amount, 'note', v_note));
  RETURN jsonb_build_object('status', CASE WHEN _confirm THEN 'confirmed' ELSE 'rejected' END);
END $$;

CREATE OR REPLACE FUNCTION public.rollback_historical_payment_batch(_society_id uuid, _request_id text, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_reason text := nullif(btrim(coalesce(_reason,'')),''); v_rej int; v_rev int;
BEGIN
  PERFORM public._billing_require_admin(_society_id);
  IF v_reason IS NULL OR length(v_reason) < 5 OR length(v_reason) > 400 THEN RAISE EXCEPTION 'reason_required'; END IF;
  PERFORM 1 FROM historical_payments WHERE society_id=_society_id AND request_id=_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unavailable'; END IF;
  UPDATE historical_payments SET status='rejected', reviewed_by=auth.uid(), reviewed_at=now(), review_note=left('Import undone: '||v_reason,500)
    WHERE society_id=_society_id AND request_id=_request_id AND status='imported_unverified';
  GET DIAGNOSTICS v_rej = ROW_COUNT;
  UPDATE historical_payments SET status='reversed', review_note=left('Import undone: '||v_reason,500)
    WHERE society_id=_society_id AND request_id=_request_id AND status='confirmed';
  GET DIAGNOSTICS v_rev = ROW_COUNT;
  INSERT INTO audit_log (actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (auth.uid(), 'billing.historical_payment_import_undone', 'historical_payments', _request_id, _society_id,
      jsonb_build_object('rejected', v_rej, 'reversed', v_rev, 'reason', v_reason));
  RETURN jsonb_build_object('status','ok','undone', v_rej + v_rev);
END $$;

-- ===== Finance-import batch history (opening balances + past payments) =====
CREATE OR REPLACE FUNCTION public.list_finance_import_batches(_society_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public._billing_require_admin(_society_id);
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x->>'created_at' DESC) FROM (
    SELECT jsonb_build_object('kind','opening_balance','request_id',request_id,'source_ref',max(source_ref),'created_at',min(created_at),
      'rows',count(*),'unverified',count(*) FILTER (WHERE status='imported_unverified'),'confirmed',count(*) FILTER (WHERE status='confirmed'),
      'rejected',count(*) FILTER (WHERE status='rejected'),'reversed',0,'total',sum(amount) FILTER (WHERE status<>'rejected'),
      'undone', bool_or(review_note LIKE 'Import undone:%')) x
      FROM opening_balances WHERE society_id=_society_id GROUP BY request_id
    UNION ALL
    SELECT jsonb_build_object('kind','past_payment','request_id',request_id,'source_ref',max(source_ref),'created_at',min(created_at),
      'rows',count(*),'unverified',count(*) FILTER (WHERE status='imported_unverified'),'confirmed',count(*) FILTER (WHERE status='confirmed'),
      'rejected',count(*) FILTER (WHERE status='rejected'),'reversed',count(*) FILTER (WHERE status='reversed'),
      'total',sum(amount) FILTER (WHERE status IN ('imported_unverified','confirmed')),
      'undone', bool_or(review_note LIKE 'Import undone:%'))
      FROM historical_payments WHERE society_id=_society_id GROUP BY request_id
  ) t LIMIT 200), '[]'::jsonb);
END $$;

-- ===== Migration jobs: retry lineage + safe rollback =====
ALTER TABLE public.migration_jobs
  ADD COLUMN retry_of_job_id uuid REFERENCES public.migration_jobs(id) ON DELETE SET NULL,
  ADD COLUMN rolled_back_at timestamptz,
  ADD COLUMN rolled_back_by uuid,
  ADD COLUMN rollback_reason text,
  ADD COLUMN rollback_summary jsonb;

CREATE OR REPLACE FUNCTION public.migration_set_retry_of(_job_id uuid, _retry_of uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j record; p record;
BEGIN
  SELECT * INTO j FROM migration_jobs WHERE id=_job_id FOR UPDATE;
  SELECT * INTO p FROM migration_jobs WHERE id=_retry_of;
  IF j.id IS NULL OR p.id IS NULL OR j.society_id <> p.society_id OR _job_id = _retry_of
     OR NOT public.user_can_admin_migrations(auth.uid(), j.society_id) OR j.status NOT IN ('uploaded','mapping') THEN
    RETURN jsonb_build_object('status','unavailable'); END IF;
  UPDATE migration_jobs SET retry_of_job_id=_retry_of, updated_at=now() WHERE id=_job_id;
  RETURN jsonb_build_object('status','ok');
END $$;

CREATE OR REPLACE FUNCTION public.migration_rollback_job(_job_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  j record; v_ts timestamptz; v_reason text := nullif(btrim(coalesce(_reason,'')),'');
  v_blocks uuid[]; v_flats uuid[]; v_res uuid[]; v_fam uuid[]; v_veh uuid[]; v_blockers text[] := '{}'; v_fr int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  SELECT * INTO j FROM migration_jobs WHERE id=_job_id FOR UPDATE;
  IF NOT FOUND OR NOT public.user_can_admin_migrations(auth.uid(), j.society_id) THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF v_reason IS NULL OR length(v_reason) < 5 OR length(v_reason) > 400 THEN RETURN jsonb_build_object('status','reason_required'); END IF;
  IF j.rolled_back_at IS NOT NULL THEN RETURN jsonb_build_object('status','already_rolled_back'); END IF;
  IF j.status <> 'completed' THEN RETURN jsonb_build_object('status','job_not_ready'); END IF;
  PERFORM public._rate_hit('migration_rollback', auth.uid()::text, 10, interval '1 hour');
  -- Records created by this job carry the commit transaction's timestamp.
  SELECT created_at INTO v_ts FROM migration_commit_requests WHERE job_id=_job_id AND status='completed' ORDER BY created_at LIMIT 1;
  IF v_ts IS NULL THEN RETURN jsonb_build_object('status','job_not_ready'); END IF;

  SELECT coalesce(array_agg(b.id),'{}') INTO v_blocks FROM migration_entity_links l JOIN blocks b ON b.id=l.canonical_entity_id
    WHERE l.job_id=_job_id AND l.entity_type='structure' AND b.society_id=j.society_id AND b.created_at=v_ts;
  SELECT coalesce(array_agg(f.id),'{}') INTO v_flats FROM migration_entity_links l JOIN flats f ON f.id=l.canonical_entity_id
    WHERE l.job_id=_job_id AND l.entity_type='unit' AND f.society_id=j.society_id AND f.created_at=v_ts;
  SELECT coalesce(array_agg(o.id),'{}') INTO v_res FROM migration_entity_links l JOIN offline_residents o ON o.id=l.canonical_entity_id
    WHERE l.job_id=_job_id AND l.entity_type='resident' AND o.society_id=j.society_id AND o.created_at=v_ts;
  SELECT coalesce(array_agg(m.id),'{}') INTO v_fam FROM migration_entity_links l JOIN family_members m ON m.id=l.canonical_entity_id
    WHERE l.job_id=_job_id AND l.entity_type='family' AND m.created_at=v_ts;
  SELECT coalesce(array_agg(v.id),'{}') INTO v_veh FROM migration_entity_links l JOIN vehicles v ON v.id=l.canonical_entity_id
    WHERE l.job_id=_job_id AND l.entity_type='vehicle' AND v.society_id=j.society_id AND v.created_at=v_ts;

  -- Refuse if anything created later depends on the imported records.
  IF EXISTS (SELECT 1 FROM bills WHERE flat_id = ANY(v_flats)) THEN v_blockers := v_blockers || 'bills'; END IF;
  IF EXISTS (SELECT 1 FROM payments WHERE flat_id = ANY(v_flats)) THEN v_blockers := v_blockers || 'payments'; END IF;
  IF EXISTS (SELECT 1 FROM opening_balances WHERE flat_id = ANY(v_flats)) THEN v_blockers := v_blockers || 'opening_balances'; END IF;
  IF EXISTS (SELECT 1 FROM historical_payments WHERE flat_id = ANY(v_flats)) THEN v_blockers := v_blockers || 'past_payments'; END IF;
  IF EXISTS (SELECT 1 FROM maintenance_periods WHERE flat_id = ANY(v_flats)) THEN v_blockers := v_blockers || 'maintenance'; END IF;
  IF EXISTS (SELECT 1 FROM no_dues_requests WHERE flat_id = ANY(v_flats)) OR EXISTS (SELECT 1 FROM no_dues_certificates WHERE flat_id = ANY(v_flats)) THEN v_blockers := v_blockers || 'no_dues'; END IF;
  IF EXISTS (SELECT 1 FROM amenity_bookings WHERE flat_id = ANY(v_flats)) THEN v_blockers := v_blockers || 'amenity_bookings'; END IF;
  IF EXISTS (SELECT 1 FROM join_requests WHERE flat_id = ANY(v_flats)) THEN v_blockers := v_blockers || 'join_requests'; END IF;
  IF EXISTS (SELECT 1 FROM visitor_recurring_passes WHERE flat_id = ANY(v_flats)) THEN v_blockers := v_blockers || 'visitor_passes'; END IF;
  IF EXISTS (SELECT 1 FROM unit_billing_overrides WHERE flat_id = ANY(v_flats)) THEN v_blockers := v_blockers || 'billing_overrides'; END IF;
  IF EXISTS (SELECT 1 FROM parking_slots WHERE flat_id = ANY(v_flats) OR vehicle_id = ANY(v_veh)) THEN v_blockers := v_blockers || 'parking'; END IF;
  IF EXISTS (SELECT 1 FROM sos_alerts WHERE flat_id = ANY(v_flats)) THEN v_blockers := v_blockers || 'sos_alerts'; END IF;
  IF EXISTS (SELECT 1 FROM flat_residents WHERE flat_id = ANY(v_flats)) THEN v_blockers := v_blockers || 'app_residents'; END IF;
  IF EXISTS (SELECT 1 FROM offline_residents WHERE flat_id = ANY(v_flats) AND NOT (id = ANY(v_res))) THEN v_blockers := v_blockers || 'other_residents'; END IF;
  IF EXISTS (SELECT 1 FROM family_members WHERE (flat_id = ANY(v_flats) OR offline_resident_id = ANY(v_res)) AND NOT (id = ANY(v_fam))) THEN v_blockers := v_blockers || 'other_family'; END IF;
  IF EXISTS (SELECT 1 FROM vehicles WHERE (flat_id = ANY(v_flats) OR offline_resident_id = ANY(v_res)) AND NOT (id = ANY(v_veh))) THEN v_blockers := v_blockers || 'other_vehicles'; END IF;
  IF EXISTS (SELECT 1 FROM flats WHERE block_id = ANY(v_blocks) AND NOT (id = ANY(v_flats))) THEN v_blockers := v_blockers || 'other_units'; END IF;
  IF EXISTS (SELECT 1 FROM user_roles WHERE block_id = ANY(v_blocks)) OR EXISTS (SELECT 1 FROM user_role_block_scopes WHERE block_id = ANY(v_blocks))
     OR EXISTS (SELECT 1 FROM notices WHERE block_id = ANY(v_blocks)) THEN v_blockers := v_blockers || 'structure_in_use'; END IF;
  IF array_length(v_blockers,1) > 0 THEN
    INSERT INTO audit_log (actor_id, action, target_table, target_id, society_id, metadata)
      VALUES (auth.uid(), 'migration.rollback_refused', 'migration_jobs', _job_id::text, j.society_id, jsonb_build_object('blockers', v_blockers));
    RETURN jsonb_build_object('status','blocked_by_dependents','blockers', to_jsonb(v_blockers));
  END IF;

  DELETE FROM vehicles WHERE id = ANY(v_veh);
  DELETE FROM family_members WHERE id = ANY(v_fam);
  DELETE FROM offline_residents WHERE id = ANY(v_res);
  DELETE FROM flats WHERE id = ANY(v_flats);
  DELETE FROM blocks WHERE id = ANY(v_blocks);
  -- Links for removed records go, so a corrected re-import creates them again; links to pre-existing records stay.
  DELETE FROM migration_entity_links WHERE job_id=_job_id
    AND canonical_entity_id = ANY(v_blocks || v_flats || v_res || v_fam || v_veh);
  UPDATE migration_jobs SET rolled_back_at=now(), rolled_back_by=auth.uid(), rollback_reason=v_reason, updated_at=now(),
    rollback_summary=jsonb_build_object('structures',cardinality(v_blocks),'units',cardinality(v_flats),'residents',cardinality(v_res),
      'family',cardinality(v_fam),'vehicles',cardinality(v_veh))
    WHERE id=_job_id;
  INSERT INTO audit_log (actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (auth.uid(), 'migration.rolled_back', 'migration_jobs', _job_id::text, j.society_id,
      jsonb_build_object('reason', v_reason, 'structures', v_blocks, 'units', v_flats, 'residents', v_res, 'family', v_fam, 'vehicles', v_veh));
  RETURN jsonb_build_object('status','ok','structures',cardinality(v_blocks),'units',cardinality(v_flats),'residents',cardinality(v_res),
    'family',cardinality(v_fam),'vehicles',cardinality(v_veh));
END $$;

REVOKE ALL ON FUNCTION public.import_opening_balances_v2(uuid,text,text,jsonb,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rollback_opening_balance_batch(uuid,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.import_historical_payments(uuid,text,text,jsonb,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_historical_payment(uuid,boolean,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rollback_historical_payment_batch(uuid,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_finance_import_batches(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.migration_set_retry_of(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.migration_rollback_job(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_opening_balances_v2(uuid,text,text,jsonb,boolean), public.rollback_opening_balance_batch(uuid,text,text),
  public.import_historical_payments(uuid,text,text,jsonb,boolean), public.review_historical_payment(uuid,boolean,text),
  public.rollback_historical_payment_batch(uuid,text,text), public.list_finance_import_batches(uuid),
  public.migration_set_retry_of(uuid,uuid), public.migration_rollback_job(uuid,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._import_parse_amount(text), public._import_parse_date(text) FROM anon;
