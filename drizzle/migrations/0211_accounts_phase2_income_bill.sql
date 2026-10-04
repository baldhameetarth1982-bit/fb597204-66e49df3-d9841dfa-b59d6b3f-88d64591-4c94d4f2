CREATE OR REPLACE FUNCTION public.create_income_with_bill(
  _society_id uuid, _category_id uuid, _amount numeric, _payment_method text,
  _payment_date timestamptz, _reference_number text, _description text, _creation_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_res jsonb; v_id uuid; v_doc jsonb;
BEGIN
  PERFORM public._finance_require_admin(_society_id);
  v_res := public.create_non_member_income_record(_society_id, _category_id, 'anonymous', NULL, NULL,
    _amount, _payment_method, _payment_date, _reference_number, _description, _creation_request_id);
  IF coalesce(v_res->>'status','') NOT IN ('created','existing') THEN
    RAISE EXCEPTION '%', coalesce(v_res->>'status','temporary_error') USING ERRCODE='22023';
  END IF;
  v_id := (v_res->>'id')::uuid;
  -- Same transaction: if the bill fails, the income entry rolls back too (no orphan either way).
  v_doc := public.issue_finance_bill(v_id);
  RETURN v_doc || jsonb_build_object('income_record_id', v_id, 'income_status', v_res->>'status');
END $$;
REVOKE ALL ON FUNCTION public.create_income_with_bill(uuid,uuid,numeric,text,timestamptz,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_income_with_bill(uuid,uuid,numeric,text,timestamptz,text,text,uuid) TO authenticated;

DROP POLICY IF EXISTS sic_finance_reader_select ON public.society_income_categories;
CREATE POLICY sic_finance_reader_select ON public.society_income_categories
  FOR SELECT TO authenticated USING (public._finance_reader_for(society_id));