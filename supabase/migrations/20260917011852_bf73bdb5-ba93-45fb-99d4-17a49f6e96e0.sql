-- Stage 3D: canonical society accounting foundation.
-- Legacy ledger_entries are preserved read-only and excluded from canonical totals.

CREATE TABLE public.finance_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('asset','liability','income','expense','equity')),
  normal_balance text NOT NULL CHECK (normal_balance IN ('debit','credit')),
  system_key text,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_accounts_code_format CHECK (code ~ '^[A-Z0-9_-]{2,24}$'),
  CONSTRAINT finance_accounts_name_length CHECK (char_length(btrim(name)) BETWEEN 2 AND 100),
  CONSTRAINT finance_accounts_society_code_unique UNIQUE (society_id, code),
  CONSTRAINT finance_accounts_society_system_unique UNIQUE NULLS NOT DISTINCT (society_id, system_key)
);
GRANT SELECT ON public.finance_accounts TO authenticated;
GRANT ALL ON public.finance_accounts TO service_role;
ALTER TABLE public.finance_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_accounts_admin_read ON public.finance_accounts FOR SELECT TO authenticated
  USING (public.resolve_financial_visibility(society_id) = 'admin');

CREATE TABLE public.finance_journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  transaction_date date NOT NULL,
  description text NOT NULL,
  reference text,
  source_type text NOT NULL CHECK (source_type IN ('payment','income','expense','expense_reversal','payment_reversal','income_reversal','manual')),
  source_id uuid NOT NULL,
  source_action text NOT NULL DEFAULT 'post' CHECK (source_action IN ('post','reverse')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','reversed')),
  reversal_of uuid REFERENCES public.finance_journal_entries(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_journal_description_length CHECK (char_length(btrim(description)) BETWEEN 2 AND 500),
  CONSTRAINT finance_journal_reference_length CHECK (reference IS NULL OR char_length(reference) <= 120),
  CONSTRAINT finance_journal_source_unique UNIQUE (society_id, source_type, source_id),
  CONSTRAINT finance_journal_reversal_unique UNIQUE (reversal_of),
  CONSTRAINT finance_journal_reversal_shape CHECK (
    (source_action = 'post' AND reversal_of IS NULL) OR
    (source_action = 'reverse' AND reversal_of IS NOT NULL)
  )
);
GRANT SELECT ON public.finance_journal_entries TO authenticated;
GRANT ALL ON public.finance_journal_entries TO service_role;
ALTER TABLE public.finance_journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_journal_entries_admin_read ON public.finance_journal_entries FOR SELECT TO authenticated
  USING (public.resolve_financial_visibility(society_id) = 'admin');

CREATE TABLE public.finance_journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  journal_entry_id uuid NOT NULL REFERENCES public.finance_journal_entries(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES public.finance_accounts(id) ON DELETE RESTRICT,
  line_number smallint NOT NULL CHECK (line_number > 0),
  description text,
  debit numeric(16,2) NOT NULL DEFAULT 0,
  credit numeric(16,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_line_positive_exclusive CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
  ),
  CONSTRAINT finance_line_precision CHECK (debit = round(debit,2) AND credit = round(credit,2)),
  CONSTRAINT finance_line_number_unique UNIQUE (journal_entry_id, line_number)
);
GRANT SELECT ON public.finance_journal_lines TO authenticated;
GRANT ALL ON public.finance_journal_lines TO service_role;
ALTER TABLE public.finance_journal_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_journal_lines_admin_read ON public.finance_journal_lines FOR SELECT TO authenticated
  USING (public.resolve_financial_visibility(society_id) = 'admin');

CREATE TABLE public.finance_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  name text NOT NULL,
  category text,
  phone text,
  email text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  deactivated_at timestamptz,
  deactivated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_vendor_name_length CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  CONSTRAINT finance_vendor_category_length CHECK (category IS NULL OR char_length(category) <= 80),
  CONSTRAINT finance_vendor_phone_length CHECK (phone IS NULL OR char_length(phone) <= 24),
  CONSTRAINT finance_vendor_email_length CHECK (email IS NULL OR char_length(email) <= 254),
  CONSTRAINT finance_vendor_notes_length CHECK (notes IS NULL OR char_length(notes) <= 500)
);
GRANT SELECT ON public.finance_vendors TO authenticated;
GRANT ALL ON public.finance_vendors TO service_role;
ALTER TABLE public.finance_vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_vendors_admin_read ON public.finance_vendors FOR SELECT TO authenticated
  USING (public.resolve_financial_visibility(society_id) = 'admin');

CREATE INDEX finance_accounts_society_active_idx ON public.finance_accounts(society_id, is_active, account_type);
CREATE INDEX finance_journal_society_date_idx ON public.finance_journal_entries(society_id, transaction_date DESC, id DESC) WHERE status IN ('posted','reversed');
CREATE INDEX finance_lines_entry_idx ON public.finance_journal_lines(journal_entry_id, line_number);
CREATE INDEX finance_lines_account_idx ON public.finance_journal_lines(society_id, account_id, journal_entry_id);
CREATE INDEX finance_vendors_society_active_idx ON public.finance_vendors(society_id, is_active, name);

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.finance_vendors(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS journal_entry_id uuid REFERENCES public.finance_journal_entries(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reversal_journal_entry_id uuid REFERENCES public.finance_journal_entries(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid,
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS request_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='expenses_stage3d_status_check') THEN
    ALTER TABLE public.expenses ADD CONSTRAINT expenses_stage3d_status_check CHECK (status IN ('draft','pending','posted','reversed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='expenses_stage3d_method_check') THEN
    ALTER TABLE public.expenses ADD CONSTRAINT expenses_stage3d_method_check CHECK (payment_method IS NULL OR payment_method IN ('cash','bank_transfer'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='expenses_stage3d_reversal_reason_check') THEN
    ALTER TABLE public.expenses ADD CONSTRAINT expenses_stage3d_reversal_reason_check CHECK (reversal_reason IS NULL OR char_length(reversal_reason) BETWEEN 5 AND 500);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS expenses_stage3d_request_unique ON public.expenses(society_id, created_by, request_id) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS expenses_stage3d_journal_unique ON public.expenses(journal_entry_id) WHERE journal_entry_id IS NOT NULL;

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS journal_entry_id uuid REFERENCES public.finance_journal_entries(id) ON DELETE RESTRICT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS reversal_journal_entry_id uuid REFERENCES public.finance_journal_entries(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS payments_stage3d_journal_unique ON public.payments(journal_entry_id) WHERE journal_entry_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_stage3d_reversal_journal_unique ON public.payments(reversal_journal_entry_id) WHERE reversal_journal_entry_id IS NOT NULL;

ALTER TABLE public.society_income_records ADD COLUMN IF NOT EXISTS journal_entry_id uuid REFERENCES public.finance_journal_entries(id) ON DELETE RESTRICT;
ALTER TABLE public.society_income_records ADD COLUMN IF NOT EXISTS reversal_journal_entry_id uuid REFERENCES public.finance_journal_entries(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS income_stage3d_journal_unique ON public.society_income_records(journal_entry_id) WHERE journal_entry_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS income_stage3d_reversal_journal_unique ON public.society_income_records(reversal_journal_entry_id) WHERE reversal_journal_entry_id IS NOT NULL;

REVOKE INSERT, UPDATE, DELETE ON public.finance_accounts, public.finance_journal_entries, public.finance_journal_lines, public.finance_vendors FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.expenses FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.ledger_entries FROM authenticated;
DROP POLICY IF EXISTS "Society admins view expenses" ON public.expenses;
DROP POLICY IF EXISTS "Society admins insert expenses" ON public.expenses;
DROP POLICY IF EXISTS "Society admins update expenses" ON public.expenses;
DROP POLICY IF EXISTS "Society admins delete expenses" ON public.expenses;
DROP POLICY IF EXISTS "society admins manage ledger" ON public.ledger_entries;
DROP POLICY IF EXISTS "society members view ledger" ON public.ledger_entries;
DROP POLICY IF EXISTS "super admin ledger" ON public.ledger_entries;
CREATE POLICY ledger_entries_admin_read_only ON public.ledger_entries FOR SELECT TO authenticated
  USING (public.resolve_financial_visibility(society_id) = 'admin');

CREATE OR REPLACE FUNCTION public._finance_plan_enabled(_society_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.societies s
    WHERE s.id=_society_id
      AND CASE
        WHEN lower(coalesce(s.plan_status,'')) IN ('expired','cancelled','canceled','past_due','inactive') THEN false
        WHEN lower(coalesce(s.plan_status,'')) IN ('trial','trialing') THEN s.trial_ends_at IS NOT NULL AND s.trial_ends_at > now()
        ELSE lower(coalesce(s.plan_id,'')) IN ('pro','premium') AND lower(coalesce(s.plan_status,'')) = 'active'
      END
  )
$$;
REVOKE ALL ON FUNCTION public._finance_plan_enabled(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._finance_plan_enabled(uuid) TO authenticated, service_role;

CREATE POLICY expenses_stage3d_admin_read ON public.expenses FOR SELECT TO authenticated
  USING (public.resolve_financial_visibility(society_id) = 'admin' AND public._finance_plan_enabled(society_id));

CREATE OR REPLACE FUNCTION public._finance_require_admin(_society_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF NOT (public.current_user_has_society_permission(_society_id,'billing.manage'::text,NULL::uuid)
          OR public.has_role(v_uid,'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF NOT public._finance_plan_enabled(_society_id) THEN RAISE EXCEPTION 'plan_required' USING ERRCODE='42501'; END IF;
  RETURN v_uid;
END $$;
REVOKE ALL ON FUNCTION public._finance_require_admin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._finance_require_admin(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._finance_seed_accounts(_society_id uuid, _actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
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
END $$;
REVOKE ALL ON FUNCTION public._finance_seed_accounts(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._finance_seed_accounts(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.seed_finance_accounts(_society_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid; v_count int;
BEGIN
  v_uid := public._finance_require_admin(_society_id);
  PERFORM public._finance_seed_accounts(_society_id,v_uid);
  SELECT count(*) INTO v_count FROM public.finance_accounts WHERE society_id=_society_id;
  INSERT INTO public.audit_log(actor_id,society_id,action,target_table,target_id,metadata)
  VALUES(v_uid,_society_id,'finance.accounts_seeded','finance_accounts',_society_id,jsonb_build_object('account_count',v_count));
  RETURN jsonb_build_object('status','success','account_count',v_count);
END $$;
REVOKE ALL ON FUNCTION public.seed_finance_accounts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_finance_accounts(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._finance_protect_posted()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'posted_history_immutable' USING ERRCODE='55000'; END IF;
  IF OLD.status IN ('posted','reversed') THEN RAISE EXCEPTION 'posted_history_immutable' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finance_journal_entries_immutable BEFORE UPDATE OR DELETE ON public.finance_journal_entries FOR EACH ROW EXECUTE FUNCTION public._finance_protect_posted();

CREATE OR REPLACE FUNCTION public._finance_protect_lines()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_entry uuid := COALESCE(NEW.journal_entry_id,OLD.journal_entry_id); v_status text;
BEGIN
  SELECT status INTO v_status FROM public.finance_journal_entries WHERE id=v_entry;
  IF v_status IN ('posted','reversed') THEN RAISE EXCEPTION 'posted_history_immutable' USING ERRCODE='55000'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finance_journal_lines_immutable BEFORE UPDATE OR DELETE ON public.finance_journal_lines FOR EACH ROW EXECUTE FUNCTION public._finance_protect_lines();

CREATE OR REPLACE FUNCTION public._finance_validate_line_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_entry_society uuid; v_account_society uuid;
BEGIN
  SELECT society_id INTO v_entry_society FROM public.finance_journal_entries WHERE id=NEW.journal_entry_id;
  SELECT society_id INTO v_account_society FROM public.finance_accounts WHERE id=NEW.account_id;
  IF v_entry_society IS NULL OR v_account_society IS NULL OR NEW.society_id<>v_entry_society OR NEW.society_id<>v_account_society THEN
    RAISE EXCEPTION 'cross_society_finance_reference' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finance_journal_lines_scope BEFORE INSERT OR UPDATE ON public.finance_journal_lines FOR EACH ROW EXECUTE FUNCTION public._finance_validate_line_scope();

CREATE OR REPLACE FUNCTION public._finance_assert_posted_balance()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_lines int; v_debit numeric; v_credit numeric;
BEGIN
  IF NEW.status IN ('posted','reversed') AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT count(*),COALESCE(sum(debit),0),COALESCE(sum(credit),0) INTO v_lines,v_debit,v_credit
    FROM public.finance_journal_lines WHERE journal_entry_id=NEW.id;
    IF v_lines<2 OR v_debit<=0 OR v_debit<>v_credit THEN RAISE EXCEPTION 'journal_unbalanced' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finance_journal_entries_balance BEFORE UPDATE OF status ON public.finance_journal_entries FOR EACH ROW EXECUTE FUNCTION public._finance_assert_posted_balance();

CREATE OR REPLACE FUNCTION public._finance_prevent_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'financial_history_delete_forbidden' USING ERRCODE='55000'; END $$;
CREATE TRIGGER finance_expenses_no_delete BEFORE DELETE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public._finance_prevent_delete();
CREATE TRIGGER finance_vendors_no_delete BEFORE DELETE ON public.finance_vendors FOR EACH ROW EXECUTE FUNCTION public._finance_prevent_delete();

CREATE OR REPLACE FUNCTION public._finance_post_entry(
  _society_id uuid, _actor_id uuid, _transaction_date date, _description text,
  _reference text, _source_type text, _source_id uuid, _source_action text,
  _debit_system_key text, _credit_system_key text, _amount numeric,
  _reversal_of uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_existing uuid; v_entry uuid; v_debit uuid; v_credit uuid; v_sum_debit numeric; v_sum_credit numeric; v_lines int;
BEGIN
  IF _society_id IS NULL OR _actor_id IS NULL OR _source_id IS NULL THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  IF _transaction_date IS NULL OR _transaction_date > CURRENT_DATE THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE='22023'; END IF;
  IF _amount IS NULL OR _amount <= 0 OR _amount > 100000000 OR _amount <> round(_amount,2) THEN RAISE EXCEPTION 'invalid_amount' USING ERRCODE='22023'; END IF;
  IF _source_action NOT IN ('post','reverse') THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  SELECT id INTO v_existing FROM public.finance_journal_entries WHERE society_id=_society_id AND source_type=_source_type AND source_id=_source_id;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  PERFORM public._finance_seed_accounts(_society_id,_actor_id);
  SELECT id INTO v_debit FROM public.finance_accounts WHERE society_id=_society_id AND system_key=_debit_system_key AND is_active FOR SHARE;
  SELECT id INTO v_credit FROM public.finance_accounts WHERE society_id=_society_id AND system_key=_credit_system_key AND is_active FOR SHARE;
  IF v_debit IS NULL OR v_credit IS NULL OR v_debit=v_credit THEN RAISE EXCEPTION 'account_unavailable' USING ERRCODE='22023'; END IF;
  IF _source_action='reverse' THEN
    IF _reversal_of IS NULL OR NOT EXISTS(SELECT 1 FROM public.finance_journal_entries WHERE id=_reversal_of AND society_id=_society_id AND status='posted') THEN
      RAISE EXCEPTION 'invalid_reversal' USING ERRCODE='22023';
    END IF;
  ELSIF _reversal_of IS NOT NULL THEN RAISE EXCEPTION 'invalid_reversal' USING ERRCODE='22023'; END IF;
  INSERT INTO public.finance_journal_entries(society_id,transaction_date,description,reference,source_type,source_id,source_action,status,reversal_of,created_by)
  VALUES(_society_id,_transaction_date,btrim(_description),nullif(btrim(coalesce(_reference,'')),''),_source_type,_source_id,_source_action,'draft',_reversal_of,_actor_id)
  RETURNING id INTO v_entry;
  INSERT INTO public.finance_journal_lines(society_id,journal_entry_id,account_id,line_number,debit,credit)
  VALUES (_society_id,v_entry,v_debit,1,_amount,0),(_society_id,v_entry,v_credit,2,0,_amount);
  SELECT count(*),sum(debit),sum(credit) INTO v_lines,v_sum_debit,v_sum_credit FROM public.finance_journal_lines WHERE journal_entry_id=v_entry;
  IF v_lines < 2 OR v_sum_debit <> v_sum_credit THEN RAISE EXCEPTION 'journal_unbalanced' USING ERRCODE='23514'; END IF;
  UPDATE public.finance_journal_entries SET status=CASE WHEN _source_action='reverse' THEN 'reversed' ELSE 'posted' END,posted_at=now() WHERE id=v_entry;
  INSERT INTO public.audit_log(actor_id,society_id,action,target_table,target_id,metadata)
  VALUES(_actor_id,_society_id,'finance.journal_'||_source_action,'finance_journal_entries',v_entry,jsonb_build_object('source_type',_source_type,'source_id',_source_id,'amount',_amount,'reversal_of',_reversal_of));
  RETURN v_entry;
EXCEPTION WHEN unique_violation THEN
  SELECT id INTO v_existing FROM public.finance_journal_entries WHERE society_id=_society_id AND source_type=_source_type AND source_id=_source_id;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  RAISE;
END $$;
REVOKE ALL ON FUNCTION public._finance_post_entry(uuid,uuid,date,text,text,text,uuid,text,text,text,numeric,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._finance_post_entry(uuid,uuid,date,text,text,text,uuid,text,text,text,numeric,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._finance_payment_posting_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_journal uuid; v_original uuid;
BEGIN
  IF NEW.status='verified' AND OLD.status IS DISTINCT FROM 'verified' THEN
    v_journal := public._finance_post_entry(NEW.society_id,COALESCE(NEW.verified_by,auth.uid()),COALESCE(NEW.payment_date,NEW.paid_at::date,CURRENT_DATE),'Maintenance payment',NEW.reference_no,'payment',NEW.id,'post',CASE WHEN NEW.method='cash' THEN 'cash' WHEN NEW.method='bank_transfer' THEN 'bank' ELSE 'unsupported' END,'maintenance_income',NEW.amount,NULL);
    NEW.journal_entry_id := v_journal;
  ELSIF NEW.status='reversed' AND OLD.status='verified' THEN
    v_original := COALESCE(OLD.journal_entry_id,NEW.journal_entry_id);
    IF v_original IS NULL THEN RAISE EXCEPTION 'journal_missing' USING ERRCODE='55000'; END IF;
    v_journal := public._finance_post_entry(NEW.society_id,COALESCE(NEW.reversed_by,auth.uid()),COALESCE(NEW.reversed_at::date,CURRENT_DATE),'Reversal: maintenance payment',NEW.reference_no,'payment_reversal',NEW.id,'reverse','maintenance_income',CASE WHEN NEW.method='cash' THEN 'cash' WHEN NEW.method='bank_transfer' THEN 'bank' ELSE 'unsupported' END,NEW.amount,v_original);
    NEW.reversal_journal_entry_id := v_journal;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_finance_posting BEFORE UPDATE OF status ON public.payments FOR EACH ROW EXECUTE FUNCTION public._finance_payment_posting_trigger();

CREATE OR REPLACE FUNCTION public._finance_income_posting_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_journal uuid; v_original uuid;
BEGIN
  IF NEW.verification_status='verified' AND OLD.verification_status IS DISTINCT FROM 'verified' THEN
    v_journal := public._finance_post_entry(NEW.society_id,COALESCE(NEW.verified_by,auth.uid()),COALESCE(NEW.payment_date::date,CURRENT_DATE),'Society income',NEW.reference_number,'income',NEW.id,'post',CASE WHEN NEW.payment_method='cash' THEN 'cash' WHEN NEW.payment_method='bank_transfer' THEN 'bank' ELSE 'offline_clearing' END,'other_income',NEW.amount,NULL);
    NEW.journal_entry_id := v_journal;
  ELSIF NEW.verification_status='reversed' AND OLD.verification_status='verified' THEN
    v_original := COALESCE(OLD.journal_entry_id,NEW.journal_entry_id);
    IF v_original IS NULL THEN RAISE EXCEPTION 'journal_missing' USING ERRCODE='55000'; END IF;
    v_journal := public._finance_post_entry(NEW.society_id,COALESCE(NEW.reversed_by,auth.uid()),COALESCE(NEW.reversed_at::date,CURRENT_DATE),'Reversal: society income',NEW.reference_number,'income_reversal',NEW.id,'reverse','other_income',CASE WHEN NEW.payment_method='cash' THEN 'cash' WHEN NEW.payment_method='bank_transfer' THEN 'bank' ELSE 'offline_clearing' END,NEW.amount,v_original);
    NEW.reversal_journal_entry_id := v_journal;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER income_finance_posting BEFORE UPDATE OF verification_status ON public.society_income_records FOR EACH ROW EXECUTE FUNCTION public._finance_income_posting_trigger();

CREATE OR REPLACE FUNCTION public.upsert_finance_vendor(_society_id uuid,_vendor_id uuid,_name text,_category text,_phone text,_email text,_notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid; v_id uuid;
BEGIN
  v_uid:=public._finance_require_admin(_society_id);
  IF char_length(btrim(coalesce(_name,''))) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'invalid_vendor' USING ERRCODE='22023'; END IF;
  IF _vendor_id IS NULL THEN
    INSERT INTO public.finance_vendors(society_id,name,category,phone,email,notes,created_by) VALUES(_society_id,btrim(_name),nullif(btrim(coalesce(_category,'')),''),nullif(btrim(coalesce(_phone,'')),''),nullif(btrim(coalesce(_email,'')),''),nullif(btrim(coalesce(_notes,'')),''),v_uid) RETURNING id INTO v_id;
  ELSE
    UPDATE public.finance_vendors SET name=btrim(_name),category=nullif(btrim(coalesce(_category,'')),''),phone=nullif(btrim(coalesce(_phone,'')),''),email=nullif(btrim(coalesce(_email,'')),''),notes=nullif(btrim(coalesce(_notes,'')),''),updated_at=now() WHERE id=_vendor_id AND society_id=_society_id AND is_active RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'vendor_not_found' USING ERRCODE='02000'; END IF;
  END IF;
  INSERT INTO public.audit_log(actor_id,society_id,action,target_table,target_id,metadata) VALUES(v_uid,_society_id,CASE WHEN _vendor_id IS NULL THEN 'finance.vendor_created' ELSE 'finance.vendor_updated' END,'finance_vendors',v_id,jsonb_build_object('category',_category));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.upsert_finance_vendor(uuid,uuid,text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_finance_vendor(uuid,uuid,text,text,text,text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.deactivate_finance_vendor(_vendor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid; v_society uuid;
BEGIN
  SELECT society_id INTO v_society FROM public.finance_vendors WHERE id=_vendor_id FOR UPDATE;
  IF v_society IS NULL THEN RAISE EXCEPTION 'vendor_not_found' USING ERRCODE='02000'; END IF;
  v_uid:=public._finance_require_admin(v_society);
  UPDATE public.finance_vendors SET is_active=false,deactivated_at=now(),deactivated_by=v_uid,updated_at=now() WHERE id=_vendor_id AND is_active;
  INSERT INTO public.audit_log(actor_id,society_id,action,target_table,target_id,metadata) VALUES(v_uid,v_society,'finance.vendor_deactivated','finance_vendors',_vendor_id,'{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.deactivate_finance_vendor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deactivate_finance_vendor(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_finance_expense(_society_id uuid,_vendor_id uuid,_category text,_amount numeric,_expense_date date,_payment_method text,_description text,_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid; v_expense uuid; v_journal uuid; v_existing record; v_expense_key text;
BEGIN
  v_uid:=public._finance_require_admin(_society_id);
  IF _request_id IS NULL THEN RAISE EXCEPTION 'invalid_request_id' USING ERRCODE='22023'; END IF;
  SELECT id,amount,category,payment_method,spent_on,journal_entry_id INTO v_existing FROM public.expenses WHERE society_id=_society_id AND created_by=v_uid AND request_id=_request_id;
  IF FOUND THEN
    IF v_existing.amount=_amount AND v_existing.category=_category AND v_existing.payment_method=_payment_method AND v_existing.spent_on=_expense_date THEN
      RETURN jsonb_build_object('status','existing','expense_id',v_existing.id,'journal_entry_id',v_existing.journal_entry_id);
    END IF;
    RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023';
  END IF;
  IF _amount IS NULL OR _amount<=0 OR _amount>100000000 OR _amount<>round(_amount,2) THEN RAISE EXCEPTION 'invalid_amount' USING ERRCODE='22023'; END IF;
  IF _expense_date IS NULL OR _expense_date>CURRENT_DATE THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE='22023'; END IF;
  IF _payment_method NOT IN ('cash','bank_transfer') THEN RAISE EXCEPTION 'invalid_method' USING ERRCODE='22023'; END IF;
  IF _category NOT IN ('cleaning','security','electricity','repair','water','salary','other') THEN RAISE EXCEPTION 'invalid_category' USING ERRCODE='22023'; END IF;
  IF _vendor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.finance_vendors WHERE id=_vendor_id AND society_id=_society_id AND is_active) THEN RAISE EXCEPTION 'vendor_not_found' USING ERRCODE='02000'; END IF;
  INSERT INTO public.expenses(society_id,vendor_id,category,amount,note,spent_on,created_by,payment_method,status,request_id)
  VALUES(_society_id,_vendor_id,_category,_amount,nullif(btrim(coalesce(_description,'')),''),_expense_date,v_uid,_payment_method,'pending',_request_id) RETURNING id INTO v_expense;
  v_expense_key:=CASE _category WHEN 'repair' THEN 'expense_repairs' WHEN 'electricity' THEN 'expense_utilities' WHEN 'water' THEN 'expense_utilities' WHEN 'security' THEN 'expense_security' WHEN 'cleaning' THEN 'expense_housekeeping' WHEN 'salary' THEN 'expense_salary' ELSE 'expense_other' END;
  v_journal:=public._finance_post_entry(_society_id,v_uid,_expense_date,'Expense: '||_category,NULL,'expense',v_expense,'post',v_expense_key,CASE WHEN _payment_method='cash' THEN 'cash' ELSE 'bank' END,_amount,NULL);
  UPDATE public.expenses SET status='posted',journal_entry_id=v_journal WHERE id=v_expense;
  INSERT INTO public.audit_log(actor_id,society_id,action,target_table,target_id,metadata) VALUES(v_uid,_society_id,'finance.expense_posted','expenses',v_expense,jsonb_build_object('journal_entry_id',v_journal,'amount',_amount,'method',_payment_method));
  RETURN jsonb_build_object('status','posted','expense_id',v_expense,'journal_entry_id',v_journal);
END $$;
REVOKE ALL ON FUNCTION public.create_finance_expense(uuid,uuid,text,numeric,date,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_finance_expense(uuid,uuid,text,numeric,date,text,text,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reverse_finance_expense(_expense_id uuid,_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid; v_exp public.expenses%ROWTYPE; v_journal uuid; v_expense_key text;
BEGIN
  SELECT * INTO v_exp FROM public.expenses WHERE id=_expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'expense_not_found' USING ERRCODE='02000'; END IF;
  v_uid:=public._finance_require_admin(v_exp.society_id);
  IF v_exp.status<>'posted' OR v_exp.journal_entry_id IS NULL THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF char_length(btrim(coalesce(_reason,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  v_expense_key:=CASE v_exp.category WHEN 'repair' THEN 'expense_repairs' WHEN 'electricity' THEN 'expense_utilities' WHEN 'water' THEN 'expense_utilities' WHEN 'security' THEN 'expense_security' WHEN 'cleaning' THEN 'expense_housekeeping' WHEN 'salary' THEN 'expense_salary' ELSE 'expense_other' END;
  v_journal:=public._finance_post_entry(v_exp.society_id,v_uid,CURRENT_DATE,'Reversal: expense '||v_exp.category,NULL,'expense_reversal',v_exp.id,'reverse',CASE WHEN v_exp.payment_method='cash' THEN 'cash' ELSE 'bank' END,v_expense_key,v_exp.amount,v_exp.journal_entry_id);
  UPDATE public.expenses SET status='reversed',reversal_journal_entry_id=v_journal,reversed_at=now(),reversed_by=v_uid,reversal_reason=btrim(_reason),updated_at=now() WHERE id=_expense_id;
  INSERT INTO public.audit_log(actor_id,society_id,action,target_table,target_id,metadata) VALUES(v_uid,v_exp.society_id,'finance.expense_reversed','expenses',_expense_id,jsonb_build_object('journal_entry_id',v_journal,'reason',btrim(_reason)));
  RETURN jsonb_build_object('status','reversed','expense_id',_expense_id,'journal_entry_id',v_journal);
END $$;
REVOKE ALL ON FUNCTION public.reverse_finance_expense(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_finance_expense(uuid,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_finance_overview(_society_id uuid,_from date,_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid; v_visibility text; v_result jsonb;
BEGIN
  IF _from IS NULL OR _to IS NULL OR _from>_to OR _to-_from>730 THEN RAISE EXCEPTION 'invalid_period' USING ERRCODE='22023'; END IF;
  v_visibility:=public.resolve_financial_visibility(_society_id);
  IF v_visibility='none' OR NOT public._finance_plan_enabled(_society_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF v_visibility<>'admin' THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object(
    'visibility',v_visibility,'from',_from,'to',_to,
    'income',COALESCE(sum(l.credit-l.debit) FILTER (WHERE a.account_type='income'),0),
    'expense',COALESCE(sum(l.debit-l.credit) FILTER (WHERE a.account_type='expense'),0),
    'cash_balance',COALESCE(sum(l.debit-l.credit) FILTER (WHERE a.system_key='cash'),0),
    'bank_balance',COALESCE(sum(l.debit-l.credit) FILTER (WHERE a.system_key='bank'),0),
    'net_movement',COALESCE(sum(l.credit-l.debit) FILTER (WHERE a.account_type='income'),0)-COALESCE(sum(l.debit-l.credit) FILTER (WHERE a.account_type='expense'),0)
  ) INTO v_result
  FROM public.finance_journal_lines l JOIN public.finance_journal_entries j ON j.id=l.journal_entry_id JOIN public.finance_accounts a ON a.id=l.account_id
  WHERE j.society_id=_society_id AND j.status IN ('posted','reversed') AND j.transaction_date BETWEEN _from AND _to;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.get_finance_overview(uuid,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_finance_overview(uuid,date,date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_finance_book(_society_id uuid,_book text,_from date,_to date,_limit int DEFAULT 50,_offset int DEFAULT 0)
RETURNS TABLE(entry_id uuid,transaction_date date,reference text,description text,source_type text,debit numeric,credit numeric,running_balance numeric,status text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_visibility text; v_key text;
BEGIN
  v_visibility:=public.resolve_financial_visibility(_society_id);
  IF v_visibility<>'admin' OR NOT public._finance_plan_enabled(_society_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF _book NOT IN ('cash','bank') THEN RAISE EXCEPTION 'invalid_book' USING ERRCODE='22023'; END IF;
  IF _from IS NULL OR _to IS NULL OR _from>_to OR _limit NOT BETWEEN 1 AND 200 OR _offset NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  v_key:=_book;
  RETURN QUERY
  SELECT j.id,j.transaction_date,j.reference,j.description,j.source_type,l.debit,l.credit,
    sum(l.debit-l.credit) OVER (ORDER BY j.transaction_date,j.created_at,j.id,l.line_number),j.status
  FROM public.finance_journal_lines l JOIN public.finance_journal_entries j ON j.id=l.journal_entry_id JOIN public.finance_accounts a ON a.id=l.account_id
  WHERE j.society_id=_society_id AND a.system_key=v_key AND j.status IN ('posted','reversed') AND j.transaction_date BETWEEN _from AND _to
  ORDER BY j.transaction_date DESC,j.created_at DESC,j.id DESC LIMIT _limit OFFSET _offset;
END $$;
REVOKE ALL ON FUNCTION public.list_finance_book(uuid,text,date,date,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_finance_book(uuid,text,date,date,int,int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_receivables_ageing(_society_id uuid,_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE(bucket text,amount numeric,bill_count bigint) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_visibility text;
BEGIN
  v_visibility:=public.resolve_financial_visibility(_society_id);
  IF v_visibility<>'admin' OR NOT public._finance_plan_enabled(_society_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  RETURN QUERY WITH balances AS (
    SELECT b.id,b.due_date,GREATEST(0,COALESCE(b.total_payable,b.amount,0)-COALESCE(sum(p.amount) FILTER(WHERE p.status='verified'),0)) outstanding
    FROM public.bills b LEFT JOIN public.payments p ON p.bill_id=b.id
    WHERE b.society_id=_society_id AND b.cancelled_at IS NULL AND b.due_date<=_as_of
    GROUP BY b.id,b.due_date,b.total_payable,b.amount
  ), bucketed AS (
    SELECT CASE WHEN _as_of-due_date<=0 THEN 'current' WHEN _as_of-due_date<=30 THEN '1_30' WHEN _as_of-due_date<=60 THEN '31_60' WHEN _as_of-due_date<=90 THEN '61_90' ELSE '90_plus' END bucket,outstanding FROM balances WHERE outstanding>0
  ) SELECT b.bucket,sum(b.outstanding),count(*) FROM bucketed b GROUP BY b.bucket;
END $$;
REVOKE ALL ON FUNCTION public.get_receivables_ageing(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_receivables_ageing(uuid,date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_finance_workspace(_society_id uuid,_resource text,_limit int DEFAULT 50,_offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_visibility text; v_rows jsonb;
BEGIN
  v_visibility:=public.resolve_financial_visibility(_society_id);
  IF v_visibility<>'admin' OR NOT public._finance_plan_enabled(_society_id) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF _limit NOT BETWEEN 1 AND 200 OR _offset NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  IF _resource='accounts' THEN SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_rows FROM (SELECT id,code,name,account_type,normal_balance,system_key,is_system,is_active FROM public.finance_accounts WHERE society_id=_society_id ORDER BY code LIMIT _limit OFFSET _offset)x;
  ELSIF _resource='vendors' THEN SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_rows FROM (SELECT id,name,category,phone,email,notes,is_active FROM public.finance_vendors WHERE society_id=_society_id ORDER BY is_active DESC,name LIMIT _limit OFFSET _offset)x;
  ELSIF _resource='expenses' THEN SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_rows FROM (SELECT e.id,e.vendor_id,v.name vendor_name,e.category,e.amount,e.note description,e.spent_on expense_date,e.payment_method,e.status,e.journal_entry_id,e.reversal_journal_entry_id,e.reversed_at,e.reversal_reason FROM public.expenses e LEFT JOIN public.finance_vendors v ON v.id=e.vendor_id WHERE e.society_id=_society_id ORDER BY e.spent_on DESC,e.created_at DESC LIMIT _limit OFFSET _offset)x;
  ELSIF _resource='journal' THEN SELECT COALESCE(jsonb_agg(jsonb_build_object('id',j.id,'transaction_date',j.transaction_date,'description',j.description,'reference',j.reference,'source_type',j.source_type,'status',j.status,'reversal_of',j.reversal_of,'debit',q.debit,'credit',q.credit)),'[]'::jsonb) INTO v_rows FROM public.finance_journal_entries j JOIN LATERAL(SELECT sum(debit) debit,sum(credit) credit FROM public.finance_journal_lines WHERE journal_entry_id=j.id)q ON true WHERE j.society_id=_society_id ORDER BY j.transaction_date DESC,j.created_at DESC LIMIT _limit OFFSET _offset;
  ELSE RAISE EXCEPTION 'invalid_resource' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('visibility',v_visibility,'resource',_resource,'rows',v_rows,'limit',_limit,'offset',_offset);
END $$;
REVOKE ALL ON FUNCTION public.list_finance_workspace(uuid,text,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_finance_workspace(uuid,text,int,int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.preview_finance_backfill(_society_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public._finance_require_admin(_society_id);
  RETURN jsonb_build_object(
    'verified_payments_unposted',(SELECT count(*) FROM public.payments WHERE society_id=_society_id AND status='verified' AND journal_entry_id IS NULL AND method IN ('cash','bank_transfer')),
    'verified_income_unposted',(SELECT count(*) FROM public.society_income_records WHERE society_id=_society_id AND verification_status='verified' AND journal_entry_id IS NULL AND payment_method IN ('cash','bank_transfer')),
    'legacy_ledger_unconverted',(SELECT count(*) FROM public.ledger_entries WHERE society_id=_society_id)
  );
END $$;
REVOKE ALL ON FUNCTION public.preview_finance_backfill(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_finance_backfill(uuid) TO authenticated, service_role;

COMMENT ON TABLE public.finance_journal_entries IS 'Stage 3D canonical double-entry journal. Posted history is immutable and reversed only by compensating entries.';
COMMENT ON TABLE public.ledger_entries IS 'Legacy single-sided ledger preserved read-only; excluded from canonical financial reports.';