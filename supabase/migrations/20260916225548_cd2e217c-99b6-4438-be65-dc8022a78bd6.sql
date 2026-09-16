-- Audit-log contract consistency repair.
-- Historical migrations are intentionally preserved. This migration replaces only
-- the currently installed function definitions whose audit writes used noncanonical
-- entity_type/entity_id/meta columns. Authorization and state transitions are unchanged.

CREATE OR REPLACE FUNCTION public.configure_society_structure_mode(_society_id uuid, _mode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_current text;
  v_total int;
  v_with_block int;
  v_no_block int;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF NOT (public.is_society_admin_for(v_caller, _society_id) OR public.is_super_admin(v_caller)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _mode NOT IN ('structured','serial') THEN
    RAISE EXCEPTION 'invalid_mode';
  END IF;

  SELECT structure_mode INTO v_current FROM public.societies WHERE id = _society_id FOR UPDATE;

  SELECT count(*),
         count(*) FILTER (WHERE block_id IS NOT NULL),
         count(*) FILTER (WHERE block_id IS NULL)
    INTO v_total, v_with_block, v_no_block
  FROM public.flats WHERE society_id = _society_id;

  IF v_current IS NOT NULL AND v_current <> _mode THEN
    IF v_total > 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'conversion_blocked_units_exist');
    END IF;
  END IF;

  IF v_current IS NULL AND v_total > 0 THEN
    IF v_with_block > 0 AND v_no_block > 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'review_required_mixed_units');
    END IF;
    IF _mode = 'structured' AND v_no_block > 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'review_required_units_without_block');
    END IF;
    IF _mode = 'serial' AND v_with_block > 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'review_required_units_have_block');
    END IF;
  END IF;

  UPDATE public.societies SET structure_mode = _mode, updated_at = now() WHERE id = _society_id;

  INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
  VALUES (v_caller, _society_id, 'configure_structure_mode', 'society', _society_id,
          jsonb_build_object('from', v_current, 'to', _mode));

  RETURN jsonb_build_object('ok', true, 'structure_mode', _mode);
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_resident_to_unit(
  _society_id uuid,
  _user_id uuid,
  _flat_id uuid,
  _relationship text,
  _is_primary boolean DEFAULT false,
  _moved_in_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flat_society uuid;
  v_flat_active boolean;
  v_new_id uuid;
BEGIN
  IF NOT public.is_society_admin_for(_society_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF _relationship NOT IN ('owner','co-owner','tenant','resident','family') THEN
    RAISE EXCEPTION 'invalid_relationship';
  END IF;

  SELECT society_id, coalesce(is_active,true) INTO v_flat_society, v_flat_active
    FROM public.flats WHERE id = _flat_id;
  IF v_flat_society IS NULL OR v_flat_society <> _society_id THEN
    RAISE EXCEPTION 'unit_not_in_society';
  END IF;
  IF NOT v_flat_active THEN
    RAISE EXCEPTION 'unit_inactive';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND society_id = _society_id) THEN
    RAISE EXCEPTION 'resident_not_in_society';
  END IF;

  IF EXISTS (SELECT 1 FROM public.flat_residents
             WHERE flat_id = _flat_id AND user_id = _user_id
               AND relationship = _relationship AND is_active) THEN
    RAISE EXCEPTION 'duplicate_active_assignment';
  END IF;

  IF _is_primary THEN
    UPDATE public.flat_residents SET is_primary = false
      WHERE user_id = _user_id AND is_primary = true;
  END IF;

  INSERT INTO public.flat_residents(flat_id, user_id, relationship, is_primary, is_active, moved_in_at)
    VALUES (_flat_id, _user_id, _relationship, coalesce(_is_primary,false), true, coalesce(_moved_in_at, now()))
    RETURNING id INTO v_new_id;

  INSERT INTO public.audit_log(actor_id, society_id, target_table, target_id, action, metadata)
    VALUES (auth.uid(), _society_id, 'flat_residents', v_new_id, 'assign',
            jsonb_build_object('user_id',_user_id,'flat_id',_flat_id,'relationship',_relationship));
  RETURN v_new_id;
END; $$;

CREATE OR REPLACE FUNCTION public.end_resident_unit_relationship(
  _society_id uuid,
  _flat_resident_id uuid,
  _moved_out_at timestamptz DEFAULT now(),
  _reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flat_id uuid;
  v_moved_in timestamptz;
BEGIN
  IF NOT public.is_society_admin_for(_society_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  SELECT fr.flat_id, fr.moved_in_at INTO v_flat_id, v_moved_in
    FROM public.flat_residents fr
    JOIN public.flats f ON f.id = fr.flat_id
   WHERE fr.id = _flat_resident_id AND f.society_id = _society_id;

  IF v_flat_id IS NULL THEN RAISE EXCEPTION 'relationship_not_found'; END IF;
  IF v_moved_in IS NOT NULL AND _moved_out_at < v_moved_in THEN
    RAISE EXCEPTION 'moved_out_before_moved_in';
  END IF;

  UPDATE public.flat_residents
     SET is_active = false,
         moved_out_at = coalesce(_moved_out_at, now()),
         ended_reason = _reason
   WHERE id = _flat_resident_id AND is_active;

  INSERT INTO public.audit_log(actor_id, society_id, target_table, target_id, action, metadata)
    VALUES (auth.uid(), _society_id, 'flat_residents', _flat_resident_id, 'move_out',
            jsonb_build_object('reason',_reason));
END; $$;

CREATE OR REPLACE FUNCTION public.admin_upsert_family_member(
  _society_id uuid,
  _resident_user_id uuid,
  _id uuid DEFAULT NULL,
  _full_name text DEFAULT NULL,
  _relation text DEFAULT NULL,
  _phone text DEFAULT NULL,
  _age int DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; BEGIN
  IF NOT public.is_society_admin_for(_society_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _resident_user_id AND society_id = _society_id) THEN
    RAISE EXCEPTION 'resident_not_in_society';
  END IF;
  IF _relation NOT IN ('spouse','child','parent','sibling','helper','other') THEN
    RAISE EXCEPTION 'invalid_relation';
  END IF;

  IF _id IS NULL THEN
    INSERT INTO public.family_members(user_id, full_name, relation, phone, age)
      VALUES (_resident_user_id, _full_name, _relation, _phone, _age)
      RETURNING id INTO v_id;
    INSERT INTO public.audit_log(actor_id, society_id, target_table, target_id, action, metadata)
      VALUES (auth.uid(), _society_id, 'family_members', v_id, 'create', jsonb_build_object('resident',_resident_user_id));
  ELSE
    UPDATE public.family_members
       SET full_name = _full_name, relation = _relation, phone = _phone, age = _age, updated_at = now()
     WHERE id = _id AND user_id = _resident_user_id
     RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'family_member_not_found'; END IF;
    INSERT INTO public.audit_log(actor_id, society_id, target_table, target_id, action, metadata)
      VALUES (auth.uid(), _society_id, 'family_members', v_id, 'update', '{}'::jsonb);
  END IF;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_delete_family_member(_society_id uuid, _id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_prev boolean; BEGIN
  IF NOT public.is_society_admin_for(_society_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  SELECT fm.user_id, fm.is_active INTO v_uid, v_prev
    FROM public.family_members fm
    JOIN public.profiles p ON p.id = fm.user_id AND p.society_id = _society_id
   WHERE fm.id = _id;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'family_member_not_found'; END IF;
  UPDATE public.family_members
     SET is_active = false, deactivated_at = now(), deactivated_by = auth.uid(), updated_at = now()
   WHERE id = _id AND is_active = true;
  INSERT INTO public.audit_log(actor_id, society_id, target_table, target_id, action, metadata)
    VALUES (auth.uid(), _society_id, 'family_members', _id, 'deactivate',
            jsonb_build_object('resident', v_uid, 'previous_state', v_prev));
END; $$;

CREATE OR REPLACE FUNCTION public.admin_upsert_vehicle(
  _society_id uuid,
  _id uuid DEFAULT NULL,
  _resident_user_id uuid DEFAULT NULL,
  _flat_id uuid DEFAULT NULL,
  _plate_number text DEFAULT NULL,
  _type text DEFAULT NULL,
  _make_model text DEFAULT NULL,
  _color text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_norm text; v_prev_active boolean; BEGIN
  IF NOT public.is_society_admin_for(_society_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  v_norm := upper(regexp_replace(coalesce(_plate_number,''), '\s+', '', 'g'));
  IF length(v_norm) < 3 THEN RAISE EXCEPTION 'invalid_plate'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _resident_user_id AND society_id = _society_id) THEN
    RAISE EXCEPTION 'resident_not_in_society';
  END IF;
  IF _flat_id IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM public.flats WHERE id = _flat_id AND society_id = _society_id
  ) THEN
    RAISE EXCEPTION 'unit_not_in_society';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(_society_id::text || '|' || v_norm, 0)
  );

  IF _id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.vehicles
       WHERE society_id = _society_id AND is_active = true
         AND upper(regexp_replace(plate_number, '\s+', '', 'g')) = v_norm
    ) THEN
      RAISE EXCEPTION 'duplicate_active_plate';
    END IF;
    INSERT INTO public.vehicles(society_id, user_id, flat_id, plate_number, type, make_model, color, is_active)
      VALUES (_society_id, _resident_user_id, _flat_id, v_norm,
              coalesce(nullif(_type,''),'car'), _make_model, _color, true)
      RETURNING id INTO v_id;
    INSERT INTO public.audit_log(actor_id, society_id, target_table, target_id, action, metadata)
      VALUES (auth.uid(), _society_id, 'vehicles', v_id, 'create', jsonb_build_object('plate', v_norm));
  ELSE
    SELECT is_active INTO v_prev_active FROM public.vehicles
     WHERE id = _id AND society_id = _society_id;
    IF v_prev_active IS NULL THEN RAISE EXCEPTION 'vehicle_not_found'; END IF;
    IF EXISTS (
      SELECT 1 FROM public.vehicles
       WHERE society_id = _society_id AND is_active = true AND id <> _id
         AND upper(regexp_replace(plate_number, '\s+', '', 'g')) = v_norm
    ) THEN
      RAISE EXCEPTION 'duplicate_active_plate';
    END IF;
    UPDATE public.vehicles
       SET user_id = _resident_user_id, flat_id = _flat_id, plate_number = v_norm,
           type = coalesce(nullif(_type,''), type),
           make_model = _make_model, color = _color, updated_at = now()
     WHERE id = _id AND society_id = _society_id
     RETURNING id INTO v_id;
    INSERT INTO public.audit_log(actor_id, society_id, target_table, target_id, action, metadata)
      VALUES (auth.uid(), _society_id, 'vehicles', v_id, 'update', jsonb_build_object('plate', v_norm));
  END IF;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'duplicate_active_plate';
END; $$;

CREATE OR REPLACE FUNCTION public.admin_delete_vehicle(_society_id uuid, _id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prev boolean; BEGIN
  IF NOT public.is_society_admin_for(_society_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  SELECT is_active INTO v_prev FROM public.vehicles WHERE id = _id AND society_id = _society_id;
  IF v_prev IS NULL THEN RAISE EXCEPTION 'vehicle_not_found'; END IF;
  UPDATE public.vehicles
     SET is_active = false, deactivated_at = now(), deactivated_by = auth.uid(), updated_at = now()
   WHERE id = _id AND society_id = _society_id AND is_active = true;
  INSERT INTO public.audit_log(actor_id, society_id, target_table, target_id, action, metadata)
    VALUES (auth.uid(), _society_id, 'vehicles', _id, 'deactivate',
            jsonb_build_object('previous_state', v_prev));
END; $$;

CREATE OR REPLACE FUNCTION public.submit_offline_payment(
  _bill_id uuid,
  _method text,
  _amount numeric,
  _payment_date date,
  _reference_no text,
  _notes text,
  _idempotency_key text,
  _actor_role text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  uid uuid := auth.uid();
  b record;
  pid uuid;
  is_resident boolean;
  is_admin boolean;
  verified_sum numeric;
  pending_sum numeric;
  total numeric;
  available numeric;
  ref_norm text;
  dup_id uuid;
  existing record;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF _method NOT IN ('cash','bank_transfer') THEN
    RAISE EXCEPTION 'invalid_method' USING ERRCODE = '22023'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023'; END IF;
  IF _idempotency_key IS NULL OR length(trim(_idempotency_key)) < 6 THEN
    RAISE EXCEPTION 'invalid_idempotency_key' USING ERRCODE = '22023'; END IF;

  SELECT id, society_id, flat_id, status, cancelled_at, total_payable, amount
    INTO b FROM public.bills WHERE id = _bill_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bill_not_found' USING ERRCODE = '02000'; END IF;
  IF b.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'bill_cancelled' USING ERRCODE = '22023'; END IF;

  SELECT EXISTS(SELECT 1 FROM public.flat_residents WHERE flat_id = b.flat_id AND user_id = uid)
    INTO is_resident;
  is_admin := public.current_user_has_society_permission(b.society_id, 'billing.manage'::text, NULL::uuid)
              OR public.has_role(uid, 'super_admin'::app_role);

  IF _actor_role = 'resident' THEN
    IF NOT is_resident THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
    IF _method <> 'bank_transfer' THEN
      RAISE EXCEPTION 'resident_cash_not_allowed' USING ERRCODE = '42501';
    END IF;
  ELSIF _actor_role = 'admin' THEN
    IF NOT is_admin THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  ELSE
    RAISE EXCEPTION 'invalid_actor_role' USING ERRCODE = '22023';
  END IF;

  IF _method = 'bank_transfer' AND (_reference_no IS NULL OR length(trim(_reference_no)) = 0) THEN
    RAISE EXCEPTION 'reference_required' USING ERRCODE = '22023';
  END IF;

  SELECT id, bill_id, amount, method, COALESCE(reference_no, '') AS reference_no
    INTO existing
    FROM public.payments
    WHERE idempotency_key = _idempotency_key AND submitted_by = uid;
  IF FOUND THEN
    IF existing.bill_id = _bill_id
       AND existing.amount = _amount
       AND existing.method = _method
       AND existing.reference_no = COALESCE(_reference_no, '')
    THEN
      RETURN existing.id;
    ELSE
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF _method = 'bank_transfer' THEN
    ref_norm := upper(trim(_reference_no));
    SELECT id INTO dup_id FROM public.payments
      WHERE society_id = b.society_id
        AND method = 'bank_transfer'
        AND status IN ('pending', 'verified')
        AND upper(trim(COALESCE(reference_no,''))) = ref_norm
      LIMIT 1;
    IF dup_id IS NOT NULL THEN
      RAISE EXCEPTION 'duplicate_reference' USING ERRCODE = '23505';
    END IF;
  END IF;

  total := COALESCE(b.total_payable, b.amount, 0);
  SELECT
    COALESCE(SUM(CASE WHEN status='verified' THEN amount ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN status='pending'  THEN amount ELSE 0 END),0)
    INTO verified_sum, pending_sum
    FROM public.payments WHERE bill_id = _bill_id;
  available := total - verified_sum - pending_sum;
  IF _amount > available + 0.0001 THEN
    RAISE EXCEPTION 'amount_exceeds_outstanding' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payments(
    bill_id, society_id, flat_id, user_id, amount, method, status,
    reference_no, paid_at, notes,
    submitted_at, submitted_by, source, payment_date, idempotency_key)
  VALUES (b.id, b.society_id, b.flat_id, uid, _amount, _method, 'pending',
    _reference_no, COALESCE(_payment_date::timestamptz, now()), _notes,
    now(), uid,
    CASE WHEN _actor_role = 'admin' THEN 'admin_entry' ELSE 'resident_submission' END,
    _payment_date, _idempotency_key)
  RETURNING id INTO pid;

  INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
    VALUES (uid, b.society_id, 'payment.submitted', 'payment', pid,
            jsonb_build_object('method',_method,'amount',_amount,'bill_id',b.id,
                               'source', CASE WHEN _actor_role='admin' THEN 'admin_entry' ELSE 'resident_submission' END));
  RETURN pid;
END; $function$;

CREATE OR REPLACE FUNCTION public.verify_offline_payment(_payment_id uuid, _notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  p record;
  b record;
  verified_sum numeric;
  total numeric;
  remaining numeric;
  rn text;
  rid uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;

  SELECT * INTO p FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_not_found' USING ERRCODE='02000'; END IF;
  IF NOT (public.current_user_has_society_permission(p.society_id,'billing.manage'::text, NULL::uuid)
          OR public.has_role(uid,'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF p.status <> 'pending' THEN
    RAISE EXCEPTION 'payment_not_pending' USING ERRCODE='22023';
  END IF;
  IF p.submitted_by = uid THEN
    RAISE EXCEPTION 'self_verification_not_allowed' USING ERRCODE='42501';
  END IF;

  IF p.bill_id IS NULL THEN
    RAISE EXCEPTION 'bill_not_found' USING ERRCODE='02000';
  END IF;
  SELECT id, cancelled_at, total_payable, amount
    INTO b FROM public.bills WHERE id = p.bill_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bill_not_found' USING ERRCODE='02000'; END IF;
  IF b.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'bill_cancelled' USING ERRCODE='22023';
  END IF;

  total := COALESCE(b.total_payable, b.amount, 0);
  SELECT COALESCE(SUM(amount),0) INTO verified_sum
    FROM public.payments WHERE bill_id = p.bill_id AND status = 'verified';
  remaining := total - verified_sum;
  IF p.amount > remaining + 0.0001 THEN
    RAISE EXCEPTION 'amount_exceeds_outstanding' USING ERRCODE='22023';
  END IF;

  UPDATE public.payments
    SET status='verified', verified_by=uid, verified_at=now(),
        verification_notes=_notes, updated_at=now()
    WHERE id = _payment_id;

  rn := public._allocate_receipt_number_monthly(p.society_id, now());
  INSERT INTO public.payment_receipts(
    payment_id, society_id, receipt_number, issued_by, status,
    amount_snapshot, method_snapshot, reference_snapshot,
    verified_by, verified_at)
  VALUES (_payment_id, p.society_id, rn, uid, 'valid',
          p.amount, p.method, p.reference_no, uid, now())
  RETURNING id INTO rid;

  PERFORM public._sync_bill_payment_state(p.bill_id);

  INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
    VALUES (uid, p.society_id, 'payment.verified', 'payment', _payment_id,
            jsonb_build_object('receipt_number', rn, 'receipt_id', rid));
  RETURN jsonb_build_object('payment_id', _payment_id, 'receipt_number', rn, 'receipt_id', rid);
END; $$;

CREATE OR REPLACE FUNCTION public.reject_offline_payment(_payment_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); p record;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF _reason IS NULL OR length(trim(_reason))=0 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  SELECT * INTO p FROM public.payments WHERE id=_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_not_found' USING ERRCODE='02000'; END IF;
  IF NOT (public.current_user_has_society_permission(p.society_id,'billing.manage'::text, NULL::uuid)
          OR public.has_role(uid,'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF p.status <> 'pending' THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
  UPDATE public.payments SET status='rejected', rejected_by=uid, rejected_at=now(),
    rejection_reason=_reason, updated_at=now() WHERE id=_payment_id;
  INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
    VALUES (uid, p.society_id, 'payment.rejected', 'payment', _payment_id,
            jsonb_build_object('reason',_reason));
END; $$;

CREATE OR REPLACE FUNCTION public.reverse_offline_payment(_payment_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  p record;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF _reason IS NULL OR length(trim(_reason)) = 0 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE='22023';
  END IF;

  SELECT * INTO p FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_not_found' USING ERRCODE='02000'; END IF;
  IF NOT (public.current_user_has_society_permission(p.society_id,'billing.manage'::text, NULL::uuid)
          OR public.has_role(uid,'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF p.status <> 'verified' THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023';
  END IF;

  IF p.bill_id IS NOT NULL THEN
    PERFORM 1 FROM public.bills WHERE id = p.bill_id FOR UPDATE;
  END IF;

  UPDATE public.payments
    SET status='reversed', reversed_by=uid, reversed_at=now(),
        reversal_reason=_reason, updated_at=now()
    WHERE id = _payment_id;

  UPDATE public.payment_receipts
    SET status='void', voided_at=now(), voided_by=uid, void_reason=_reason
    WHERE payment_id = _payment_id AND status = 'valid';

  IF p.bill_id IS NOT NULL THEN PERFORM public._sync_bill_payment_state(p.bill_id); END IF;

  INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
    VALUES (uid, p.society_id, 'payment.reversed', 'payment', _payment_id,
            jsonb_build_object('reason',_reason));
  INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
    VALUES (uid, p.society_id, 'receipt.voided', 'payment', _payment_id,
            jsonb_build_object('reason',_reason));
END; $$;

DO $audit_contract_check$
DECLARE
  offender record;
BEGIN
  FOR offender IN
    SELECT n.nspname AS schema_name, p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS identity_arguments
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND pg_get_functiondef(p.oid) ~* 'insert[[:space:]]+into[[:space:]]+(public[.])?audit_log[[:space:]]*[(][^)]*(entity_type|entity_id|meta)([[:space:],)]|$)'
  LOOP
    RAISE EXCEPTION 'noncanonical audit_log writer remains: %.%(%)',
      offender.schema_name, offender.function_name, offender.identity_arguments;
  END LOOP;
END;
$audit_contract_check$;