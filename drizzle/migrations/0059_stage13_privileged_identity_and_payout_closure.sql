REVOKE EXECUTE ON FUNCTION public.get_admin_society_ids(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_admin_block_ids(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_society_id(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_grant_society_plan(uuid,text,integer,boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_society_payout_setup_internal(
  _actor_id uuid,
  _society_id uuid,
  _razorpay_account_id text,
  _payout_status text,
  _bank_last4 text,
  _holder_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF _actor_id IS NULL OR _society_id IS NULL
     OR NOT (public.is_society_admin_for(_actor_id, _society_id) OR public.is_super_admin(_actor_id)) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF _payout_status NOT IN ('pending','active','rejected')
     OR _bank_last4 !~ '^[0-9]{4}$'
     OR _holder_name IS NULL OR char_length(btrim(_holder_name)) NOT BETWEEN 2 AND 120
     OR (_razorpay_account_id IS NOT NULL AND char_length(_razorpay_account_id) > 120) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  SELECT razorpay_account_id, payout_status, payout_bank_last4, payout_holder_name
  INTO v_old
  FROM public.societies
  WHERE id = _society_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = '02000'; END IF;

  UPDATE public.societies
  SET razorpay_account_id = _razorpay_account_id,
      payout_status = _payout_status,
      payout_bank_last4 = _bank_last4,
      payout_holder_name = btrim(_holder_name),
      updated_at = now()
  WHERE id = _society_id;

  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (_actor_id, 'payout.setup_updated', 'societies', _society_id::text, _society_id,
    jsonb_build_object(
      'from_status', v_old.payout_status,
      'to_status', _payout_status,
      'from_bank_last4', v_old.payout_bank_last4,
      'to_bank_last4', _bank_last4,
      'provider_account_changed', v_old.razorpay_account_id IS DISTINCT FROM _razorpay_account_id,
      'holder_changed', v_old.payout_holder_name IS DISTINCT FROM btrim(_holder_name)
    ));
  RETURN jsonb_build_object('status','success');
END;
$$;
REVOKE ALL ON FUNCTION public.update_society_payout_setup_internal(uuid,uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_society_payout_setup_internal(uuid,uuid,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_society_payout_status_internal(
  _actor_id uuid,
  _society_id uuid,
  _payout_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF _actor_id IS NULL OR _society_id IS NULL
     OR NOT (public.is_society_admin_for(_actor_id, _society_id) OR public.is_super_admin(_actor_id)) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF _payout_status NOT IN ('pending','active','rejected') THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  SELECT payout_status INTO v_old
  FROM public.societies
  WHERE id = _society_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = '02000'; END IF;

  IF v_old IS DISTINCT FROM _payout_status THEN
    UPDATE public.societies SET payout_status = _payout_status, updated_at = now() WHERE id = _society_id;
    INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (_actor_id, 'payout.status_refreshed', 'societies', _society_id::text, _society_id,
      jsonb_build_object('from_status', v_old, 'to_status', _payout_status));
  END IF;
  RETURN jsonb_build_object('status','success');
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_society_payout_status_internal(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_society_payout_status_internal(uuid,uuid,text) TO service_role;