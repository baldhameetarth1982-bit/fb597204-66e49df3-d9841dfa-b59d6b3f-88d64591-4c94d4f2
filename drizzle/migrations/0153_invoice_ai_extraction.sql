CREATE TABLE public.invoice_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL,
  file_path text NOT NULL UNIQUE CHECK (file_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$'),
  file_mime text NOT NULL CHECK (file_mime IN ('application/pdf','image/jpeg','image/png','image/webp')),
  file_size integer NOT NULL CHECK (file_size > 0 AND file_size <= 5242880),
  original_name text NOT NULL CHECK (char_length(original_name) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','extracted','needs_review','failed','confirmed','rejected')),
  extracted jsonb,
  notes text[] NOT NULL DEFAULT '{}',
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[a-z_]{2,40}$'),
  invoice_number text CHECK (invoice_number IS NULL OR invoice_number ~ '^[A-Za-z0-9/_.#-]{1,40}$'),
  vendor_gstin text CHECK (vendor_gstin IS NULL OR vendor_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  procurement_request_id uuid REFERENCES public.procurement_requests(id),
  expense_id uuid REFERENCES public.expenses(id),
  corrections jsonb,
  decided_by uuid,
  decided_at timestamptz,
  reject_reason text CHECK (reject_reason IS NULL OR char_length(reject_reason) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoice_extractions_society_idx ON public.invoice_extractions(society_id, created_at DESC);
CREATE UNIQUE INDEX invoice_extractions_confirmed_unique ON public.invoice_extractions(society_id, lower(invoice_number), coalesce(vendor_gstin, ''))
  WHERE status = 'confirmed' AND invoice_number IS NOT NULL;

GRANT SELECT ON public.invoice_extractions TO authenticated;
GRANT ALL ON public.invoice_extractions TO service_role;
ALTER TABLE public.invoice_extractions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance admins read invoice extractions" ON public.invoice_extractions FOR SELECT TO authenticated
  USING (public.current_user_has_society_permission(society_id, 'billing.manage'::text, NULL::uuid) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.invoice_ai_register(_society_id uuid, _mime text, _size integer, _name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_id uuid := gen_random_uuid(); v_ext text; v_path text; r record;
BEGIN
  v_uid := public._finance_require_admin(_society_id);
  v_ext := CASE _mime WHEN 'application/pdf' THEN 'pdf' WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp' END;
  IF v_ext IS NULL OR _size IS NULL OR _size <= 0 OR _size > 5242880 THEN RAISE EXCEPTION 'invalid_file' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM public.touch_rate_limit('invoice_ai_user', v_uid::text, 20, 3600);
  IF NOT r.allowed THEN RAISE EXCEPTION 'rate_limited' USING ERRCODE='54000'; END IF;
  SELECT * INTO r FROM public.touch_rate_limit('invoice_ai_society', _society_id::text, 100, 86400);
  IF NOT r.allowed THEN RAISE EXCEPTION 'rate_limited' USING ERRCODE='54000'; END IF;
  v_path := _society_id::text || '/' || v_id::text || '.' || v_ext;
  INSERT INTO public.invoice_extractions(id, society_id, uploaded_by, file_path, file_mime, file_size, original_name)
  VALUES (v_id, _society_id, v_uid, v_path, _mime, _size, left(coalesce(nullif(btrim(regexp_replace(_name, '[<>:"|?*\x00-\x1f]', '', 'g')), ''), 'invoice'), 120));
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (v_uid, 'invoice_ai.uploaded', 'invoice_extractions', v_id::text, _society_id, jsonb_build_object('mime', _mime, 'size', _size));
  RETURN jsonb_build_object('id', v_id, 'path', v_path);
END $$;

CREATE OR REPLACE FUNCTION public.invoice_ai_record_result(_id uuid, _status text, _extracted jsonb, _notes text[], _error text, _invoice_number text, _vendor_gstin text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.invoice_extractions%ROWTYPE;
BEGIN
  IF _status NOT IN ('extracted','needs_review','failed') THEN RAISE EXCEPTION 'invalid_state'; END IF;
  SELECT * INTO r FROM public.invoice_extractions WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'processing' THEN RAISE EXCEPTION 'invalid_state'; END IF;
  UPDATE public.invoice_extractions SET status = _status,
    extracted = CASE WHEN _status = 'failed' THEN NULL ELSE _extracted END,
    notes = coalesce((SELECT array_agg(left(n, 240)) FROM unnest(_notes[1:12]) n), '{}'),
    error_code = _error, invoice_number = _invoice_number, vendor_gstin = _vendor_gstin, updated_at = now()
  WHERE id = _id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (r.uploaded_by, 'invoice_ai.' || _status, 'invoice_extractions', _id::text, r.society_id, jsonb_build_object('error', _error));
END $$;

CREATE OR REPLACE FUNCTION public.invoice_ai_confirm(_id uuid, _request_id uuid, _vendor_id uuid, _category text, _amount numeric, _expense_date date,
  _payment_method text, _description text, _invoice_number text, _procurement_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.invoice_extractions%ROWTYPE; v_uid uuid; v_res jsonb; v_inv text := nullif(btrim(coalesce(_invoice_number, '')), ''); v_corr jsonb := '{}'::jsonb; v_ex jsonb;
BEGIN
  SELECT * INTO r FROM public.invoice_extractions WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='02000'; END IF;
  v_uid := public._finance_require_admin(r.society_id);
  IF r.status NOT IN ('extracted','needs_review') THEN RAISE EXCEPTION 'invalid_state' USING ERRCODE='22023'; END IF;
  IF v_inv IS NOT NULL AND v_inv !~ '^[A-Za-z0-9/_.#-]{1,40}$' THEN RAISE EXCEPTION 'invalid_invoice_number' USING ERRCODE='22023'; END IF;
  IF _procurement_request_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.procurement_requests p WHERE p.id = _procurement_request_id AND p.society_id = r.society_id) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE='02000'; END IF;
  IF v_inv IS NOT NULL AND EXISTS (SELECT 1 FROM public.invoice_extractions x WHERE x.society_id = r.society_id AND x.status = 'confirmed'
       AND lower(x.invoice_number) = lower(v_inv) AND coalesce(x.vendor_gstin, '') = coalesce(r.vendor_gstin, '')) THEN
    RAISE EXCEPTION 'duplicate_invoice' USING ERRCODE='23505'; END IF;
  v_res := public.create_finance_expense(r.society_id, _vendor_id, _category, _amount, _expense_date, _payment_method, _description, _request_id);
  v_ex := coalesce(r.extracted, '{}'::jsonb);
  IF (v_ex->>'total') IS DISTINCT FROM _amount::text AND (v_ex->>'total') IS NOT NULL AND (v_ex->>'total')::numeric <> _amount THEN v_corr := v_corr || jsonb_build_object('amount', jsonb_build_object('from', v_ex->>'total', 'to', _amount)); END IF;
  IF (v_ex->>'invoice_date') IS DISTINCT FROM _expense_date::text THEN v_corr := v_corr || jsonb_build_object('date', jsonb_build_object('from', v_ex->>'invoice_date', 'to', _expense_date)); END IF;
  IF (v_ex->>'invoice_number') IS DISTINCT FROM v_inv THEN v_corr := v_corr || jsonb_build_object('invoice_number', jsonb_build_object('from', v_ex->>'invoice_number', 'to', v_inv)); END IF;
  IF (v_ex->>'category_hint') IS DISTINCT FROM _category THEN v_corr := v_corr || jsonb_build_object('category', jsonb_build_object('from', v_ex->>'category_hint', 'to', _category)); END IF;
  UPDATE public.invoice_extractions SET status = 'confirmed', invoice_number = v_inv, expense_id = (v_res->>'expense_id')::uuid,
    procurement_request_id = _procurement_request_id, corrections = v_corr, decided_by = v_uid, decided_at = now(), updated_at = now()
  WHERE id = _id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (v_uid, 'invoice_ai.confirmed', 'invoice_extractions', _id::text, r.society_id,
    jsonb_build_object('expense_id', v_res->>'expense_id', 'corrected_fields', (SELECT coalesce(jsonb_agg(k), '[]'::jsonb) FROM jsonb_object_keys(v_corr) k), 'procurement_request_id', _procurement_request_id));
  RETURN v_res || jsonb_build_object('extraction_id', _id);
END $$;

CREATE OR REPLACE FUNCTION public.invoice_ai_reject(_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.invoice_extractions%ROWTYPE; v_uid uuid; v_reason text := btrim(coalesce(_reason, ''));
BEGIN
  SELECT * INTO r FROM public.invoice_extractions WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='02000'; END IF;
  v_uid := public._finance_require_admin(r.society_id);
  IF r.status NOT IN ('processing','extracted','needs_review','failed') THEN RAISE EXCEPTION 'invalid_state' USING ERRCODE='22023'; END IF;
  IF char_length(v_reason) < 3 OR char_length(v_reason) > 300 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  UPDATE public.invoice_extractions SET status = 'rejected', reject_reason = v_reason, decided_by = v_uid, decided_at = now(), updated_at = now() WHERE id = _id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (v_uid, 'invoice_ai.rejected', 'invoice_extractions', _id::text, r.society_id, '{}'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.invoice_ai_register(uuid, text, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invoice_ai_record_result(uuid, text, jsonb, text[], text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invoice_ai_confirm(uuid, uuid, uuid, text, numeric, date, text, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invoice_ai_reject(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_ai_register(uuid, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_ai_confirm(uuid, uuid, uuid, text, numeric, date, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_ai_reject(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_ai_record_result(uuid, text, jsonb, text[], text, text, text) TO service_role;