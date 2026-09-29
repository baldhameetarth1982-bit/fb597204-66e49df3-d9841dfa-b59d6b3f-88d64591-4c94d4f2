-- Workstream 5: procurement workflow + budgets. Evidence/reference only; financial truth stays in expenses/ledger.
CREATE TABLE public.procurement_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  request_no bigint GENERATED ALWAYS AS IDENTITY,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 120),
  description text CHECK (description IS NULL OR char_length(description) <= 2000),
  category text NOT NULL CHECK (category IN ('cleaning','security','electricity','repair','water','salary','other')),
  fy_start integer NOT NULL CHECK (fy_start BETWEEN 2000 AND 2100),
  needed_by date,
  estimated_amount numeric(12,2) CHECK (estimated_amount IS NULL OR estimated_amount > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','quotation_pending','awaiting_approval','approved','rejected','ordered','invoice_received','payment_ref_recorded','completed','cancelled')),
  requested_by uuid NOT NULL,
  selected_quotation_id uuid,
  vendor_id uuid REFERENCES public.finance_vendors(id) ON DELETE RESTRICT,
  approved_amount numeric(12,2) CHECK (approved_amount IS NULL OR approved_amount > 0),
  decided_by uuid, decided_at timestamptz, decision_note text CHECK (decision_note IS NULL OR char_length(decision_note) <= 500),
  order_ref text CHECK (order_ref IS NULL OR char_length(order_ref) BETWEEN 1 AND 80), ordered_at timestamptz,
  invoice_ref text CHECK (invoice_ref IS NULL OR char_length(invoice_ref) BETWEEN 1 AND 80),
  invoice_amount numeric(12,2) CHECK (invoice_amount IS NULL OR invoice_amount > 0), invoice_date date,
  payment_ref text CHECK (payment_ref IS NULL OR char_length(payment_ref) BETWEEN 1 AND 80),
  expense_id uuid REFERENCES public.expenses(id) ON DELETE RESTRICT,
  cancel_reason text CHECK (cancel_reason IS NULL OR char_length(cancel_reason) BETWEEN 5 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX procurement_requests_expense_unique ON public.procurement_requests(expense_id) WHERE expense_id IS NOT NULL;
CREATE INDEX procurement_requests_society_idx ON public.procurement_requests(society_id, status, created_at DESC);

CREATE TABLE public.procurement_quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES public.procurement_requests(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.finance_vendors(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  quote_ref text CHECK (quote_ref IS NULL OR char_length(quote_ref) <= 80),
  valid_until date,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 500),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, vendor_id)
);
CREATE INDEX procurement_quotations_req_idx ON public.procurement_quotations(request_id);

CREATE TABLE public.procurement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES public.procurement_requests(id) ON DELETE CASCADE,
  actor_id uuid, from_status text, to_status text NOT NULL, note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX procurement_events_req_idx ON public.procurement_events(request_id, created_at);

CREATE TABLE public.society_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  fy_start integer NOT NULL CHECK (fy_start BETWEEN 2000 AND 2100),
  category text NOT NULL CHECK (category IN ('cleaning','security','electricity','repair','water','salary','other')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 500),
  created_by uuid NOT NULL, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (society_id, fy_start, category)
);
CREATE TABLE public.society_budget_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  budget_id uuid NOT NULL REFERENCES public.society_budgets(id) ON DELETE CASCADE,
  old_amount numeric(12,2), new_amount numeric(12,2) NOT NULL,
  reason text, actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX society_budget_revisions_idx ON public.society_budget_revisions(budget_id, created_at);

GRANT SELECT ON public.procurement_requests, public.procurement_quotations, public.procurement_events, public.society_budgets, public.society_budget_revisions TO authenticated;
GRANT ALL ON public.procurement_requests, public.procurement_quotations, public.procurement_events, public.society_budgets, public.society_budget_revisions TO service_role;
ALTER TABLE public.procurement_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.society_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.society_budget_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY proc_req_finance_read ON public.procurement_requests FOR SELECT TO authenticated USING (public.resolve_financial_visibility(society_id) = 'admin' AND public._finance_plan_enabled(society_id));
CREATE POLICY proc_quote_finance_read ON public.procurement_quotations FOR SELECT TO authenticated USING (public.resolve_financial_visibility(society_id) = 'admin' AND public._finance_plan_enabled(society_id));
CREATE POLICY proc_event_finance_read ON public.procurement_events FOR SELECT TO authenticated USING (public.resolve_financial_visibility(society_id) = 'admin' AND public._finance_plan_enabled(society_id));
CREATE POLICY budget_finance_read ON public.society_budgets FOR SELECT TO authenticated USING (public.resolve_financial_visibility(society_id) = 'admin' AND public._finance_plan_enabled(society_id));
CREATE POLICY budget_rev_finance_read ON public.society_budget_revisions FOR SELECT TO authenticated USING (public.resolve_financial_visibility(society_id) = 'admin' AND public._finance_plan_enabled(society_id));

-- Authoritative transitions
CREATE OR REPLACE FUNCTION public.procurement_transition_allowed(_from text, _to text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT (_from, _to) IN (
    ('draft','quotation_pending'),('draft','cancelled'),
    ('quotation_pending','awaiting_approval'),('quotation_pending','cancelled'),
    ('awaiting_approval','approved'),('awaiting_approval','rejected'),('awaiting_approval','cancelled'),
    ('approved','ordered'),('approved','cancelled'),
    ('ordered','invoice_received'),('ordered','cancelled'),
    ('invoice_received','payment_ref_recorded'),('invoice_received','completed'),
    ('payment_ref_recorded','completed'))
$$;

CREATE OR REPLACE FUNCTION public._procurement_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.society_id <> OLD.society_id OR NEW.requested_by <> OLD.requested_by THEN RAISE EXCEPTION 'immutable_field' USING ERRCODE='22023'; END IF;
  IF NEW.status <> OLD.status AND NOT public.procurement_transition_allowed(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023';
  END IF;
  IF OLD.status NOT IN ('draft','quotation_pending') AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.category IS DISTINCT FROM OLD.category OR NEW.fy_start IS DISTINCT FROM OLD.fy_start) THEN
    RAISE EXCEPTION 'locked_after_submission' USING ERRCODE='22023';
  END IF;
  IF OLD.status IN ('approved','ordered','invoice_received','payment_ref_recorded','completed','rejected','cancelled')
     AND (NEW.vendor_id IS DISTINCT FROM OLD.vendor_id OR NEW.approved_amount IS DISTINCT FROM OLD.approved_amount
          OR NEW.selected_quotation_id IS DISTINCT FROM OLD.selected_quotation_id OR NEW.decided_by IS DISTINCT FROM OLD.decided_by) THEN
    RAISE EXCEPTION 'locked_after_approval' USING ERRCODE='22023';
  END IF;
  IF OLD.expense_id IS NOT NULL AND NEW.expense_id IS DISTINCT FROM OLD.expense_id THEN RAISE EXCEPTION 'expense_link_immutable' USING ERRCODE='22023'; END IF;
  IF OLD.status IN ('completed','rejected','cancelled') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'record_closed' USING ERRCODE='22023'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_procurement_guard BEFORE UPDATE ON public.procurement_requests FOR EACH ROW EXECUTE FUNCTION public._procurement_guard();

CREATE OR REPLACE FUNCTION public._append_only() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN RAISE EXCEPTION 'append_only' USING ERRCODE='22023'; END $$;
CREATE TRIGGER trg_procurement_events_append_only BEFORE UPDATE OR DELETE ON public.procurement_events FOR EACH ROW EXECUTE FUNCTION public._append_only();
CREATE TRIGGER trg_budget_revisions_append_only BEFORE UPDATE OR DELETE ON public.society_budget_revisions FOR EACH ROW EXECUTE FUNCTION public._append_only();
CREATE TRIGGER trg_quotations_append_only BEFORE UPDATE ON public.procurement_quotations FOR EACH ROW EXECUTE FUNCTION public._append_only();

-- Helpers
CREATE OR REPLACE FUNCTION public._proc_money(_v numeric) RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
BEGIN
  IF _v IS NULL OR _v = 'NaN'::numeric OR _v <= 0 OR _v > 9999999999.99 OR _v <> round(_v, 2) THEN RAISE EXCEPTION 'invalid_amount' USING ERRCODE='22023'; END IF;
  RETURN _v;
END $$;

CREATE OR REPLACE FUNCTION public._proc_auth(_sid uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid;
BEGIN
  IF _sid IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  uid := public._finance_require_admin(_sid);
  PERFORM public._rate_hit('procurement_write', uid::text, 240, interval '1 hour');
  RETURN uid;
END $$;

CREATE OR REPLACE FUNCTION public._proc_log(_r public.procurement_requests, _uid uuid, _from text, _to text, _note text, _action text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.procurement_events(society_id, request_id, actor_id, from_status, to_status, note) VALUES (_r.society_id, _r.id, _uid, _from, _to, left(_note, 500));
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (_uid, _action, 'procurement_requests', _r.id::text, _r.society_id, jsonb_build_object('from', _from, 'to', _to));
END $$;

CREATE OR REPLACE FUNCTION public._proc_lock(_id uuid) RETURNS public.procurement_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.procurement_requests;
BEGIN
  SELECT * INTO r FROM public.procurement_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public._proc_clean(_t text, _max int) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT nullif(left(btrim(regexp_replace(coalesce(_t,''), '[\r\n\t]+', ' ', 'g')), _max), '') $$;

-- RPCs
CREATE OR REPLACE FUNCTION public.proc_create(_title text, _description text, _category text, _fy_start integer, _needed_by date, _estimated numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sid uuid := public.get_user_society_id(auth.uid()); uid uuid; r public.procurement_requests;
BEGIN
  uid := public._proc_auth(sid);
  INSERT INTO public.procurement_requests(society_id, title, description, category, fy_start, needed_by, estimated_amount, requested_by)
  VALUES (sid, public._proc_clean(_title,120), nullif(btrim(left(coalesce(_description,''),2000)),''), _category, _fy_start, _needed_by,
          CASE WHEN _estimated IS NULL THEN NULL ELSE public._proc_money(_estimated) END, uid) RETURNING * INTO r;
  PERFORM public._proc_log(r, uid, NULL, 'draft', NULL, 'procurement.created');
  RETURN r.id;
END $$;

CREATE OR REPLACE FUNCTION public.proc_add_quotation(_request uuid, _vendor uuid, _amount numeric, _quote_ref text, _valid_until date, _notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.procurement_requests := public._proc_lock(_request); uid uuid; qid uuid;
BEGIN
  uid := public._proc_auth(r.society_id);
  IF r.status NOT IN ('draft','quotation_pending') THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.finance_vendors WHERE id = _vendor AND society_id = r.society_id) THEN RAISE EXCEPTION 'invalid_vendor' USING ERRCODE='22023'; END IF;
  INSERT INTO public.procurement_quotations(society_id, request_id, vendor_id, amount, quote_ref, valid_until, notes, created_by)
  VALUES (r.society_id, r.id, _vendor, public._proc_money(_amount), public._proc_clean(_quote_ref,80), _valid_until, public._proc_clean(_notes,500), uid)
  ON CONFLICT (request_id, vendor_id) DO NOTHING RETURNING id INTO qid;
  IF qid IS NULL THEN RAISE EXCEPTION 'duplicate_quotation' USING ERRCODE='22023'; END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'procurement.quotation_added', 'procurement_requests', r.id::text, r.society_id, jsonb_build_object('quotation', qid, 'amount', _amount));
  RETURN qid;
END $$;

CREATE OR REPLACE FUNCTION public.proc_submit(_request uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.procurement_requests := public._proc_lock(_request); uid uuid;
BEGIN
  uid := public._proc_auth(r.society_id);
  IF r.status = 'quotation_pending' THEN RETURN; END IF;
  UPDATE public.procurement_requests SET status = 'quotation_pending' WHERE id = r.id;
  PERFORM public._proc_log(r, uid, r.status, 'quotation_pending', NULL, 'procurement.submitted');
END $$;

CREATE OR REPLACE FUNCTION public.proc_request_approval(_request uuid, _quotation uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.procurement_requests := public._proc_lock(_request); uid uuid; q public.procurement_quotations;
BEGIN
  uid := public._proc_auth(r.society_id);
  IF r.status = 'awaiting_approval' AND r.selected_quotation_id = _quotation THEN RETURN; END IF;
  SELECT * INTO q FROM public.procurement_quotations WHERE id = _quotation AND request_id = r.id AND society_id = r.society_id;
  IF q.id IS NULL THEN RAISE EXCEPTION 'invalid_quotation' USING ERRCODE='22023'; END IF;
  UPDATE public.procurement_requests SET status = 'awaiting_approval', selected_quotation_id = q.id, vendor_id = q.vendor_id, approved_amount = q.amount WHERE id = r.id;
  PERFORM public._proc_log(r, uid, r.status, 'awaiting_approval', NULL, 'procurement.approval_requested');
END $$;

CREATE OR REPLACE FUNCTION public.proc_decide(_request uuid, _approve boolean, _note text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.procurement_requests := public._proc_lock(_request); uid uuid; tgt text := CASE WHEN _approve THEN 'approved' ELSE 'rejected' END;
BEGIN
  uid := public._proc_auth(r.society_id);
  IF r.status = tgt AND r.decided_by = uid THEN RETURN; END IF;
  IF r.requested_by = uid THEN RAISE EXCEPTION 'self_approval_denied' USING ERRCODE='42501'; END IF;
  IF NOT _approve AND char_length(coalesce(btrim(_note),'')) < 5 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  UPDATE public.procurement_requests SET status = tgt, decided_by = uid, decided_at = now(), decision_note = public._proc_clean(_note,500) WHERE id = r.id;
  PERFORM public._proc_log(r, uid, r.status, tgt, _note, 'procurement.' || tgt);
END $$;

CREATE OR REPLACE FUNCTION public.proc_mark_ordered(_request uuid, _order_ref text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.procurement_requests := public._proc_lock(_request); uid uuid; ref text := public._proc_clean(_order_ref,80);
BEGIN
  uid := public._proc_auth(r.society_id);
  IF ref IS NULL THEN RAISE EXCEPTION 'reference_required' USING ERRCODE='22023'; END IF;
  IF r.status = 'ordered' AND r.order_ref = ref THEN RETURN; END IF;
  UPDATE public.procurement_requests SET status = 'ordered', order_ref = ref, ordered_at = now() WHERE id = r.id;
  PERFORM public._proc_log(r, uid, r.status, 'ordered', ref, 'procurement.ordered');
END $$;

CREATE OR REPLACE FUNCTION public.proc_record_invoice(_request uuid, _invoice_ref text, _amount numeric, _invoice_date date) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.procurement_requests := public._proc_lock(_request); uid uuid; ref text := public._proc_clean(_invoice_ref,80);
BEGIN
  uid := public._proc_auth(r.society_id);
  IF ref IS NULL THEN RAISE EXCEPTION 'reference_required' USING ERRCODE='22023'; END IF;
  IF _invoice_date IS NULL OR _invoice_date > current_date THEN RAISE EXCEPTION 'invalid_date' USING ERRCODE='22023'; END IF;
  IF r.status = 'invoice_received' AND r.invoice_ref = ref AND r.invoice_amount = _amount THEN RETURN; END IF;
  UPDATE public.procurement_requests SET status = 'invoice_received', invoice_ref = ref, invoice_amount = public._proc_money(_amount), invoice_date = _invoice_date WHERE id = r.id;
  PERFORM public._proc_log(r, uid, r.status, 'invoice_received', ref, 'procurement.invoice_recorded');
END $$;

CREATE OR REPLACE FUNCTION public.proc_record_payment_ref(_request uuid, _payment_ref text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.procurement_requests := public._proc_lock(_request); uid uuid; ref text := public._proc_clean(_payment_ref,80);
BEGIN
  uid := public._proc_auth(r.society_id);
  IF ref IS NULL THEN RAISE EXCEPTION 'reference_required' USING ERRCODE='22023'; END IF;
  IF r.status = 'payment_ref_recorded' AND r.payment_ref = ref THEN RETURN; END IF;
  UPDATE public.procurement_requests SET status = 'payment_ref_recorded', payment_ref = ref WHERE id = r.id;
  PERFORM public._proc_log(r, uid, r.status, 'payment_ref_recorded', 'informational reference only', 'procurement.payment_ref_recorded');
END $$;

CREATE OR REPLACE FUNCTION public.proc_link_expense(_request uuid, _expense uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.procurement_requests := public._proc_lock(_request); uid uuid;
BEGIN
  uid := public._proc_auth(r.society_id);
  IF r.status = 'completed' AND r.expense_id = _expense THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.expenses WHERE id = _expense AND society_id = r.society_id AND status = 'posted') THEN RAISE EXCEPTION 'invalid_expense' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.procurement_requests WHERE expense_id = _expense AND id <> r.id) THEN RAISE EXCEPTION 'expense_already_linked' USING ERRCODE='22023'; END IF;
  UPDATE public.procurement_requests SET status = 'completed', expense_id = _expense WHERE id = r.id;
  PERFORM public._proc_log(r, uid, r.status, 'completed', NULL, 'procurement.expense_linked');
END $$;

CREATE OR REPLACE FUNCTION public.proc_cancel(_request uuid, _reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.procurement_requests := public._proc_lock(_request); uid uuid;
BEGIN
  uid := public._proc_auth(r.society_id);
  IF r.status = 'cancelled' THEN RETURN; END IF;
  IF char_length(coalesce(btrim(_reason),'')) < 5 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  UPDATE public.procurement_requests SET status = 'cancelled', cancel_reason = public._proc_clean(_reason,500) WHERE id = r.id;
  PERFORM public._proc_log(r, uid, r.status, 'cancelled', _reason, 'procurement.cancelled');
END $$;

-- Budgets
CREATE OR REPLACE FUNCTION public.budget_set(_fy_start integer, _category text, _amount numeric, _notes text, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sid uuid := public.get_user_society_id(auth.uid()); uid uuid; b public.society_budgets; amt numeric;
BEGIN
  uid := public._proc_auth(sid);
  amt := public._proc_money(_amount);
  SELECT * INTO b FROM public.society_budgets WHERE society_id = sid AND fy_start = _fy_start AND category = _category FOR UPDATE;
  IF b.id IS NULL THEN
    INSERT INTO public.society_budgets(society_id, fy_start, category, amount, notes, created_by) VALUES (sid, _fy_start, _category, amt, public._proc_clean(_notes,500), uid) RETURNING * INTO b;
    INSERT INTO public.society_budget_revisions(society_id, budget_id, old_amount, new_amount, reason, actor_id) VALUES (sid, b.id, NULL, amt, 'Initial budget', uid);
  ELSIF b.amount = amt THEN
    UPDATE public.society_budgets SET notes = public._proc_clean(_notes,500), updated_by = uid, updated_at = now() WHERE id = b.id;
    RETURN b.id;
  ELSE
    IF char_length(coalesce(btrim(_reason),'')) < 5 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
    INSERT INTO public.society_budget_revisions(society_id, budget_id, old_amount, new_amount, reason, actor_id) VALUES (sid, b.id, b.amount, amt, public._proc_clean(_reason,500), uid);
    UPDATE public.society_budgets SET amount = amt, notes = public._proc_clean(_notes,500), updated_by = uid, updated_at = now() WHERE id = b.id;
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (uid, 'budget.set', 'society_budgets', b.id::text, sid, jsonb_build_object('fy', _fy_start, 'category', _category, 'old', CASE WHEN b.amount = amt THEN NULL ELSE b.amount END, 'new', amt));
  RETURN b.id;
END $$;

CREATE OR REPLACE FUNCTION public.get_budget_vs_actual(_fy_start integer)
RETURNS TABLE(category text, budget_id uuid, approved_amount numeric, original_amount numeric, revision_count integer, actual numeric, variance numeric, notes text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sid uuid := public.get_user_society_id(auth.uid());
BEGIN
  IF sid IS NULL OR public.resolve_financial_visibility(sid) <> 'admin' OR NOT public._finance_plan_enabled(sid) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  WITH cats AS (SELECT unnest(ARRAY['cleaning','security','electricity','repair','water','salary','other']) AS c),
  act AS (SELECT e.category AS c, sum(e.amount) AS s FROM public.expenses e
          WHERE e.society_id = sid AND e.status = 'posted' AND e.spent_on BETWEEN make_date(_fy_start,4,1) AND make_date(_fy_start+1,3,31) GROUP BY e.category)
  SELECT cats.c, b.id, b.amount,
    (SELECT r.new_amount FROM public.society_budget_revisions r WHERE r.budget_id = b.id ORDER BY r.created_at LIMIT 1),
    (SELECT count(*)::int - 1 FROM public.society_budget_revisions r WHERE r.budget_id = b.id),
    coalesce(act.s, 0)::numeric, (coalesce(b.amount,0) - coalesce(act.s,0))::numeric, b.notes
  FROM cats LEFT JOIN public.society_budgets b ON b.society_id = sid AND b.fy_start = _fy_start AND b.category = cats.c
  LEFT JOIN act ON act.c = cats.c ORDER BY cats.c;
END $$;

CREATE OR REPLACE FUNCTION public.get_procurement_report(_fy_start integer)
RETURNS TABLE(id uuid, request_no bigint, title text, category text, status text, vendor_name text, approved_amount numeric, invoice_ref text, invoice_amount numeric, payment_ref text, expense_id uuid, expense_amount numeric, expense_status text, decided_at timestamptz, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sid uuid := public.get_user_society_id(auth.uid());
BEGIN
  IF sid IS NULL OR public.resolve_financial_visibility(sid) <> 'admin' OR NOT public._finance_plan_enabled(sid) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  PERFORM public._rate_hit('procurement_report', auth.uid()::text, 60, interval '1 hour');
  RETURN QUERY SELECT p.id, p.request_no, p.title, p.category, p.status, v.name, p.approved_amount, p.invoice_ref, p.invoice_amount, p.payment_ref, p.expense_id, e.amount, e.status, p.decided_at, p.created_at
  FROM public.procurement_requests p LEFT JOIN public.finance_vendors v ON v.id = p.vendor_id LEFT JOIN public.expenses e ON e.id = p.expense_id
  WHERE p.society_id = sid AND p.fy_start = _fy_start ORDER BY p.created_at DESC LIMIT 1000;
END $$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['public._proc_auth(uuid)','public._proc_log(public.procurement_requests, uuid, text, text, text, text)','public._proc_lock(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.proc_create(text, text, text, integer, date, numeric)','public.proc_add_quotation(uuid, uuid, numeric, text, date, text)',
    'public.proc_submit(uuid)','public.proc_request_approval(uuid, uuid)','public.proc_decide(uuid, boolean, text)','public.proc_mark_ordered(uuid, text)',
    'public.proc_record_invoice(uuid, text, numeric, date)','public.proc_record_payment_ref(uuid, text)','public.proc_link_expense(uuid, uuid)','public.proc_cancel(uuid, text)',
    'public.budget_set(integer, text, numeric, text, text)','public.get_budget_vs_actual(integer)','public.get_procurement_report(integer)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;