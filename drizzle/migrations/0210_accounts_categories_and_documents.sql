
CREATE TABLE public.finance_expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 60),
  base_kind text NOT NULL DEFAULT 'other' CHECK (base_kind IN ('cleaning','security','electricity','repair','water','salary','other')),
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX finance_expense_categories_soc_name_uidx ON public.finance_expense_categories(society_id, lower(btrim(name)));
GRANT SELECT ON public.finance_expense_categories TO authenticated;
GRANT ALL ON public.finance_expense_categories TO service_role;
ALTER TABLE public.finance_expense_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance readers view expense categories" ON public.finance_expense_categories FOR SELECT TO authenticated USING (public._finance_reader_for(society_id));

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.finance_expense_categories(id) ON DELETE RESTRICT;

-- Bills (income) and vouchers (expense): one document per canonical entry.
CREATE TABLE public.finance_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('bill','voucher')),
  document_no text NOT NULL,
  income_record_id uuid REFERENCES public.society_income_records(id) ON DELETE RESTRICT,
  expense_id uuid REFERENCES public.expenses(id) ON DELETE RESTRICT,
  issued_by uuid,
  issued_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind='bill' AND income_record_id IS NOT NULL AND expense_id IS NULL) OR (kind='voucher' AND expense_id IS NOT NULL AND income_record_id IS NULL))
);
CREATE UNIQUE INDEX finance_documents_no_uidx ON public.finance_documents(society_id, document_no);
CREATE UNIQUE INDEX finance_documents_income_uidx ON public.finance_documents(income_record_id) WHERE income_record_id IS NOT NULL;
CREATE UNIQUE INDEX finance_documents_expense_uidx ON public.finance_documents(expense_id) WHERE expense_id IS NOT NULL;
GRANT SELECT ON public.finance_documents TO authenticated;
GRANT ALL ON public.finance_documents TO service_role;
ALTER TABLE public.finance_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance readers view documents" ON public.finance_documents FOR SELECT TO authenticated USING (public._finance_reader_for(society_id));
CREATE TRIGGER finance_documents_append_only BEFORE UPDATE OR DELETE ON public.finance_documents FOR EACH ROW EXECUTE FUNCTION public._append_only();

CREATE TABLE public.finance_document_sequences (
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  kind text NOT NULL,
  fy_start int NOT NULL,
  last_no int NOT NULL DEFAULT 0,
  PRIMARY KEY (society_id, kind, fy_start)
);
GRANT ALL ON public.finance_document_sequences TO service_role;
ALTER TABLE public.finance_document_sequences ENABLE ROW LEVEL SECURITY;

-- Maintenance timing: post / current / pre (society setting).
ALTER TABLE public.society_settings ADD COLUMN IF NOT EXISTS maintenance_timing text NOT NULL DEFAULT 'current' CHECK (maintenance_timing IN ('post','current','pre'));

CREATE OR REPLACE FUNCTION public.ensure_default_account_categories(_society_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid; v_i int := 0; v_e int := 0;
BEGIN
  v_uid := public._finance_require_admin(_society_id);
  INSERT INTO public.society_income_categories(society_id,key,display_name,is_system,is_active,created_by)
  SELECT _society_id, k, d, true, true, v_uid FROM (VALUES ('maintenance','Maintenance'),('amenities','Amenities'),('advertisement','Advertisement'),('penalty_fees','Penalty Fees'),('bank_interest','Bank Interest')) AS t(k,d)
  WHERE NOT EXISTS (SELECT 1 FROM public.society_income_categories c WHERE c.society_id=_society_id AND (lower(c.key)=t.k OR lower(c.display_name)=lower(t.d)));
  GET DIAGNOSTICS v_i = ROW_COUNT;
  INSERT INTO public.finance_expense_categories(society_id,name,base_kind,is_default,created_by)
  SELECT _society_id, n, b, true, v_uid FROM (VALUES ('Water Bill','water'),('Electricity','electricity'),('Watchman','security'),('Cleaner','cleaning')) AS t(n,b)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_e = ROW_COUNT;
  IF v_i + v_e > 0 THEN
    INSERT INTO public.audit_log(actor_id,society_id,action,target_table,metadata)
    VALUES (v_uid,_society_id,'finance.default_categories_seeded','finance_expense_categories',jsonb_build_object('income',v_i,'expense',v_e));
  END IF;
  RETURN jsonb_build_object('income_added',v_i,'expense_added',v_e);
END $$;

CREATE OR REPLACE FUNCTION public.upsert_finance_expense_category(_society_id uuid, _category_id uuid, _name text, _base_kind text, _is_active boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid; v_id uuid; v_old public.finance_expense_categories%ROWTYPE; v_name text := btrim(coalesce(_name,''));
BEGIN
  v_uid := public._finance_require_admin(_society_id);
  IF char_length(v_name) NOT BETWEEN 2 AND 60 THEN RAISE EXCEPTION 'invalid_name' USING ERRCODE='22023'; END IF;
  IF coalesce(_base_kind,'other') NOT IN ('cleaning','security','electricity','repair','water','salary','other') THEN RAISE EXCEPTION 'invalid_category' USING ERRCODE='22023'; END IF;
  BEGIN
    IF _category_id IS NULL THEN
      INSERT INTO public.finance_expense_categories(society_id,name,base_kind,created_by) VALUES (_society_id,v_name,coalesce(_base_kind,'other'),v_uid) RETURNING id INTO v_id;
      INSERT INTO public.audit_log(actor_id,society_id,action,target_table,target_id,metadata) VALUES (v_uid,_society_id,'finance.expense_category_created','finance_expense_categories',v_id,jsonb_build_object('name',v_name));
    ELSE
      SELECT * INTO v_old FROM public.finance_expense_categories WHERE id=_category_id AND society_id=_society_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'category_not_found' USING ERRCODE='02000'; END IF;
      UPDATE public.finance_expense_categories SET name=v_name, base_kind=coalesce(_base_kind,base_kind), is_active=coalesce(_is_active,is_active), updated_at=now() WHERE id=_category_id RETURNING id INTO v_id;
      INSERT INTO public.audit_log(actor_id,society_id,action,target_table,target_id,metadata) VALUES (v_uid,_society_id,'finance.expense_category_updated','finance_expense_categories',v_id,
        jsonb_build_object('old',jsonb_build_object('name',v_old.name,'base_kind',v_old.base_kind,'is_active',v_old.is_active),'new',jsonb_build_object('name',v_name,'base_kind',coalesce(_base_kind,v_old.base_kind),'is_active',coalesce(_is_active,v_old.is_active))));
    END IF;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'category_exists' USING ERRCODE='23505';
  END;
  RETURN v_id;
END $$;

-- Category-aware expense creation. Reuses the canonical posting RPC, then links the category.
CREATE OR REPLACE FUNCTION public.create_finance_expense_categorized(_society_id uuid, _category_id uuid, _vendor_id uuid, _amount numeric, _expense_date date, _payment_method text, _description text, _request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_cat public.finance_expense_categories%ROWTYPE; v_res jsonb; v_exp uuid; v_cur uuid;
BEGIN
  PERFORM public._finance_require_admin(_society_id);
  SELECT * INTO v_cat FROM public.finance_expense_categories WHERE id=_category_id AND society_id=_society_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'category_not_found' USING ERRCODE='02000'; END IF;
  v_res := public.create_finance_expense(_society_id,_vendor_id,v_cat.base_kind,_amount,_expense_date,_payment_method,_description,_request_id);
  v_exp := (v_res->>'expense_id')::uuid;
  SELECT category_id INTO v_cur FROM public.expenses WHERE id=v_exp;
  IF v_cur IS NULL THEN UPDATE public.expenses SET category_id=v_cat.id WHERE id=v_exp;
  ELSIF v_cur <> v_cat.id THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023'; END IF;
  RETURN v_res || jsonb_build_object('category_id',v_cat.id);
END $$;

CREATE OR REPLACE FUNCTION public._allocate_finance_document_no(_society_id uuid, _kind text, _d date)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_fy int := CASE WHEN extract(month FROM _d) >= 4 THEN extract(year FROM _d)::int ELSE extract(year FROM _d)::int - 1 END; v_n int;
BEGIN
  INSERT INTO public.finance_document_sequences(society_id,kind,fy_start,last_no) VALUES (_society_id,_kind,v_fy,1)
  ON CONFLICT (society_id,kind,fy_start) DO UPDATE SET last_no = finance_document_sequences.last_no + 1
  RETURNING last_no INTO v_n;
  RETURN CASE _kind WHEN 'bill' THEN 'BL' ELSE 'VCH' END || '/' || v_fy || '-' || lpad(((v_fy+1)%100)::text,2,'0') || '/' || lpad(v_n::text,4,'0');
END $$;

-- Flow A: issue a voucher for an existing posted expense (idempotent).
CREATE OR REPLACE FUNCTION public.issue_finance_voucher(_expense_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_e public.expenses%ROWTYPE; v_uid uuid; v_doc public.finance_documents%ROWTYPE;
BEGIN
  SELECT * INTO v_e FROM public.expenses WHERE id=_expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'expense_not_found' USING ERRCODE='02000'; END IF;
  v_uid := public._finance_require_admin(v_e.society_id);
  SELECT * INTO v_doc FROM public.finance_documents WHERE expense_id=_expense_id;
  IF FOUND THEN RETURN jsonb_build_object('status','existing','document_id',v_doc.id,'document_no',v_doc.document_no); END IF;
  IF v_e.status <> 'posted' THEN RAISE EXCEPTION 'expense_not_posted' USING ERRCODE='22023'; END IF;
  INSERT INTO public.finance_documents(society_id,kind,document_no,expense_id,issued_by)
  VALUES (v_e.society_id,'voucher',public._allocate_finance_document_no(v_e.society_id,'voucher',v_e.spent_on),_expense_id,v_uid) RETURNING * INTO v_doc;
  INSERT INTO public.audit_log(actor_id,society_id,action,target_table,target_id,metadata) VALUES (v_uid,v_e.society_id,'finance.voucher_issued','finance_documents',v_doc.id,jsonb_build_object('expense_id',_expense_id,'document_no',v_doc.document_no,'amount',v_e.amount));
  RETURN jsonb_build_object('status','issued','document_id',v_doc.id,'document_no',v_doc.document_no);
END $$;

-- Flow B: voucher creates its expense (same transaction, idempotent via request id).
CREATE OR REPLACE FUNCTION public.create_expense_with_voucher(_society_id uuid, _category_id uuid, _vendor_id uuid, _amount numeric, _expense_date date, _payment_method text, _description text, _request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_res jsonb;
BEGIN
  v_res := public.create_finance_expense_categorized(_society_id,_category_id,_vendor_id,_amount,_expense_date,_payment_method,_description,_request_id);
  RETURN v_res || public.issue_finance_voucher((v_res->>'expense_id')::uuid);
END $$;

-- Flow A for income: bill for a verified income record (income is the canonical entry).
CREATE OR REPLACE FUNCTION public.issue_finance_bill(_income_record_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_r public.society_income_records%ROWTYPE; v_uid uuid; v_doc public.finance_documents%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM public.society_income_records WHERE id=_income_record_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'income_not_found' USING ERRCODE='02000'; END IF;
  v_uid := public._finance_require_admin(v_r.society_id);
  SELECT * INTO v_doc FROM public.finance_documents WHERE income_record_id=_income_record_id;
  IF FOUND THEN RETURN jsonb_build_object('status','existing','document_id',v_doc.id,'document_no',v_doc.document_no); END IF;
  IF v_r.reversed_at IS NOT NULL OR v_r.rejected_at IS NOT NULL THEN RAISE EXCEPTION 'income_not_billable' USING ERRCODE='22023'; END IF;
  INSERT INTO public.finance_documents(society_id,kind,document_no,income_record_id,issued_by)
  VALUES (v_r.society_id,'bill',public._allocate_finance_document_no(v_r.society_id,'bill',coalesce(v_r.payment_date,v_r.created_at)::date),_income_record_id,v_uid) RETURNING * INTO v_doc;
  INSERT INTO public.audit_log(actor_id,society_id,action,target_table,target_id,metadata) VALUES (v_uid,v_r.society_id,'finance.bill_issued','finance_documents',v_doc.id,jsonb_build_object('income_record_id',_income_record_id,'document_no',v_doc.document_no,'amount',v_r.amount));
  RETURN jsonb_build_object('status','issued','document_id',v_doc.id,'document_no',v_doc.document_no);
END $$;

CREATE OR REPLACE FUNCTION public.set_maintenance_timing(_society_id uuid, _timing text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid; v_old text;
BEGIN
  v_uid := public._finance_require_admin(_society_id);
  IF _timing NOT IN ('post','current','pre') THEN RAISE EXCEPTION 'invalid_timing' USING ERRCODE='22023'; END IF;
  SELECT maintenance_timing INTO v_old FROM public.society_settings WHERE society_id=_society_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'settings_not_found' USING ERRCODE='02000'; END IF;
  UPDATE public.society_settings SET maintenance_timing=_timing WHERE society_id=_society_id;
  INSERT INTO public.audit_log(actor_id,society_id,action,target_table,metadata) VALUES (v_uid,_society_id,'finance.maintenance_timing_changed','society_settings',jsonb_build_object('old',v_old,'new',_timing));
END $$;

REVOKE ALL ON FUNCTION public.ensure_default_account_categories(uuid), public.upsert_finance_expense_category(uuid,uuid,text,text,boolean), public.create_finance_expense_categorized(uuid,uuid,uuid,numeric,date,text,text,uuid), public._allocate_finance_document_no(uuid,text,date), public.issue_finance_voucher(uuid), public.create_expense_with_voucher(uuid,uuid,uuid,numeric,date,text,text,uuid), public.issue_finance_bill(uuid), public.set_maintenance_timing(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_default_account_categories(uuid), public.upsert_finance_expense_category(uuid,uuid,text,text,boolean), public.create_finance_expense_categorized(uuid,uuid,uuid,numeric,date,text,text,uuid), public.issue_finance_voucher(uuid), public.create_expense_with_voucher(uuid,uuid,uuid,numeric,date,text,text,uuid), public.issue_finance_bill(uuid), public.set_maintenance_timing(uuid,text) TO authenticated;
