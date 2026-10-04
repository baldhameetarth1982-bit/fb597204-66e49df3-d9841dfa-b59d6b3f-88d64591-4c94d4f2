-- 1) Notice edit history: keep every earlier version of a published notice.
CREATE TABLE IF NOT EXISTS public.notice_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id uuid NOT NULL REFERENCES public.notices(id) ON DELETE CASCADE,
  society_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  category text,
  audience text,
  block_id uuid,
  replaced_by uuid,
  replaced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notice_versions_notice_idx ON public.notice_versions(notice_id, replaced_at DESC);
GRANT SELECT ON public.notice_versions TO authenticated;
GRANT ALL ON public.notice_versions TO service_role;
ALTER TABLE public.notice_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Committee reads notice versions" ON public.notice_versions FOR SELECT TO authenticated
  USING (society_id = public._notice_admin_society());
CREATE TRIGGER notice_versions_append_only BEFORE UPDATE OR DELETE ON public.notice_versions
  FOR EACH ROW WHEN (pg_trigger_depth() < 2) EXECUTE FUNCTION public._append_only();

CREATE OR REPLACE FUNCTION public._notice_keep_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = 'published' AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body
       OR NEW.category IS DISTINCT FROM OLD.category OR NEW.audience IS DISTINCT FROM OLD.audience
       OR NEW.block_id IS DISTINCT FROM OLD.block_id) THEN
    INSERT INTO public.notice_versions(notice_id, society_id, title, body, category, audience, block_id, replaced_by)
    VALUES (OLD.id, OLD.society_id, OLD.title, OLD.body, OLD.category, OLD.audience, OLD.block_id, auth.uid());
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._notice_keep_version() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notice_keep_version ON public.notices;
CREATE TRIGGER trg_notice_keep_version BEFORE UPDATE ON public.notices
  FOR EACH ROW EXECUTE FUNCTION public._notice_keep_version();

-- 2) Procurement: order/invoice/payment references cannot be silently overwritten once recorded.
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
  IF OLD.order_ref IS NOT NULL AND NEW.order_ref IS DISTINCT FROM OLD.order_ref THEN RAISE EXCEPTION 'order_ref_locked' USING ERRCODE='22023'; END IF;
  IF OLD.invoice_ref IS NOT NULL AND (NEW.invoice_ref IS DISTINCT FROM OLD.invoice_ref OR NEW.invoice_amount IS DISTINCT FROM OLD.invoice_amount OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date) THEN
    RAISE EXCEPTION 'invoice_locked' USING ERRCODE='22023'; END IF;
  IF OLD.payment_ref IS NOT NULL AND NEW.payment_ref IS DISTINCT FROM OLD.payment_ref THEN RAISE EXCEPTION 'payment_ref_locked' USING ERRCODE='22023'; END IF;
  IF OLD.expense_id IS NOT NULL AND NEW.expense_id IS DISTINCT FROM OLD.expense_id THEN RAISE EXCEPTION 'expense_link_immutable' USING ERRCODE='22023'; END IF;
  IF OLD.status IN ('completed','rejected','cancelled') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'record_closed' USING ERRCODE='22023'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- 3) Invoice reading: one confirmed invoice per purchase request; confirming completes the request
--    through the same single expense link, so a request can never gain two expenses.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_extractions_one_confirmed_per_procurement
  ON public.invoice_extractions(procurement_request_id)
  WHERE status = 'confirmed' AND procurement_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.invoice_ai_confirm(_id uuid, _request_id uuid, _vendor_id uuid, _category text, _amount numeric, _expense_date date,
  _payment_method text, _description text, _invoice_number text, _procurement_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.invoice_extractions%ROWTYPE; v_uid uuid; v_res jsonb; v_inv text := nullif(btrim(coalesce(_invoice_number, '')), ''); v_corr jsonb := '{}'::jsonb; v_ex jsonb;
  pr public.procurement_requests;
BEGIN
  SELECT * INTO r FROM public.invoice_extractions WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='02000'; END IF;
  v_uid := public._finance_require_admin(r.society_id);
  IF r.status = 'confirmed' AND r.expense_id IS NOT NULL THEN
    RETURN jsonb_build_object('expense_id', r.expense_id, 'extraction_id', _id, 'duplicate', true);
  END IF;
  IF r.status NOT IN ('extracted','needs_review') THEN RAISE EXCEPTION 'invalid_state' USING ERRCODE='22023'; END IF;
  IF v_inv IS NOT NULL AND v_inv !~ '^[A-Za-z0-9/_.#-]{1,40}$' THEN RAISE EXCEPTION 'invalid_invoice_number' USING ERRCODE='22023'; END IF;
  IF _procurement_request_id IS NOT NULL THEN
    SELECT * INTO pr FROM public.procurement_requests p WHERE p.id = _procurement_request_id AND p.society_id = r.society_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='02000'; END IF;
    IF pr.expense_id IS NOT NULL OR pr.status IN ('completed','rejected','cancelled') THEN
      RAISE EXCEPTION 'procurement_already_closed' USING ERRCODE='22023'; END IF;
    IF pr.status NOT IN ('approved','ordered','invoice_received','payment_ref_recorded') THEN
      RAISE EXCEPTION 'procurement_not_approved' USING ERRCODE='22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.invoice_extractions x WHERE x.procurement_request_id = pr.id AND x.status = 'confirmed') THEN
      RAISE EXCEPTION 'procurement_already_invoiced' USING ERRCODE='23505'; END IF;
  END IF;
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
  -- Complete the purchase request through its single expense link when the workflow allows it.
  IF pr.id IS NOT NULL AND pr.status IN ('invoice_received','payment_ref_recorded') THEN
    UPDATE public.procurement_requests SET status = 'completed', expense_id = (v_res->>'expense_id')::uuid WHERE id = pr.id;
    PERFORM public._proc_log(pr, v_uid, pr.status, 'completed', 'linked from confirmed invoice', 'procurement.expense_linked');
  END IF;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (v_uid, 'invoice_ai.confirmed', 'invoice_extractions', _id::text, r.society_id,
    jsonb_build_object('expense_id', v_res->>'expense_id', 'corrected_fields', (SELECT coalesce(jsonb_agg(k), '[]'::jsonb) FROM jsonb_object_keys(v_corr) k), 'procurement_request_id', _procurement_request_id));
  RETURN v_res || jsonb_build_object('extraction_id', _id);
END $$;
REVOKE ALL ON FUNCTION public.invoice_ai_confirm(uuid, uuid, uuid, text, numeric, date, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_ai_confirm(uuid, uuid, uuid, text, numeric, date, text, text, text, uuid) TO authenticated;