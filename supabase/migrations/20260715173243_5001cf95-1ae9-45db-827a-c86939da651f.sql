
-- Turn 18B.2A: close direct-RPC plan bypass and record-existence enumeration.

-- 1) Internal plan entitlement helper. Uses the same authoritative columns
--    (societies.plan_id, societies.plan_status) that normalizePlan() reads on
--    the server. Not callable by PUBLIC/anon; used only by the transition RPC.
CREATE OR REPLACE FUNCTION public.is_non_member_income_enabled_internal(_society_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan text;
  v_status text;
BEGIN
  IF _society_id IS NULL THEN
    RETURN false;
  END IF;
  SELECT lower(btrim(coalesce(plan_id, ''))), lower(btrim(coalesce(plan_status, '')))
    INTO v_plan, v_status
    FROM public.societies
    WHERE id = _society_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Explicit inactive statuses collapse entitlement to Basic (denied).
  IF v_status IN ('expired','cancelled','canceled','past_due','inactive') THEN
    RETURN false;
  END IF;

  -- Active trial inherits Premium.
  IF v_status IN ('trial','trialing') THEN
    RETURN true;
  END IF;
  IF v_plan = 'trial' THEN
    RETURN true;
  END IF;

  -- Canonical Pro/Premium plan ids (mirrors normalizePlan()).
  IF v_plan IN ('pro','standard','growth','premium','business','enterprise') THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.is_non_member_income_enabled_internal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_non_member_income_enabled_internal(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_non_member_income_enabled_internal(uuid) TO authenticated;

COMMENT ON FUNCTION public.is_non_member_income_enabled_internal(uuid)
  IS 'Turn 18B.2A: internal Pro/Premium entitlement gate for non-member income transitions. Mirrors normalizePlan() on the server. Not for general use.';

-- 2) Hardened transition RPC.
--    - Returns generic {status: not_found} for missing rows, cross-society
--      rows, and non-admin callers (no existence enumeration).
--    - Enforces Pro/Premium at the database level.
--    - Removes unused v_new_recon variable.
CREATE OR REPLACE FUNCTION public.transition_income_record(
  _record_id uuid,
  _target_status text,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_rec public.society_income_records%ROWTYPE;
  v_from text;
  v_reason text;
  v_rows int;
  v_accessible boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status','not_authorized');
  END IF;

  IF _target_status NOT IN ('verified','rejected','reversed') THEN
    RETURN jsonb_build_object('status','invalid_transition');
  END IF;

  SELECT * INTO v_rec FROM public.society_income_records WHERE id = _record_id;
  IF FOUND THEN
    v_accessible := public.is_society_admin_for(v_uid, v_rec.society_id)
                 OR public.is_super_admin(v_uid);
  END IF;

  -- Non-enumerating: nonexistent, cross-society, and non-admin callers all
  -- receive the same shape. No society/status/amount/payer leaks pre-auth.
  IF NOT v_accessible THEN
    RETURN jsonb_build_object('status','not_found');
  END IF;

  -- Plan entitlement is now enforced inside the RPC (defense against direct
  -- Supabase client invocations that bypass the TypeScript wrapper).
  IF NOT public.is_non_member_income_enabled_internal(v_rec.society_id) THEN
    RETURN jsonb_build_object('status','plan_required');
  END IF;

  v_from := v_rec.verification_status;

  IF _target_status = 'verified' AND v_from <> 'pending' THEN
    RETURN jsonb_build_object(
      'status', CASE WHEN v_from IN ('verified','rejected','reversed')
                     THEN 'already_processed' ELSE 'invalid_transition' END,
      'currentStatus', v_from
    );
  ELSIF _target_status = 'rejected' AND v_from <> 'pending' THEN
    RETURN jsonb_build_object(
      'status', CASE WHEN v_from IN ('verified','rejected','reversed')
                     THEN 'already_processed' ELSE 'invalid_transition' END,
      'currentStatus', v_from
    );
  ELSIF _target_status = 'reversed' AND v_from <> 'verified' THEN
    RETURN jsonb_build_object(
      'status', CASE WHEN v_from IN ('rejected','reversed')
                     THEN 'already_processed' ELSE 'invalid_transition' END,
      'currentStatus', v_from
    );
  END IF;

  IF _target_status IN ('rejected','reversed') THEN
    v_reason := btrim(COALESCE(_reason,''));
    IF char_length(v_reason) < 5 OR char_length(v_reason) > 500 THEN
      RETURN jsonb_build_object('status','invalid_transition');
    END IF;
    IF v_reason ~ '<[^>]+>' THEN
      RETURN jsonb_build_object('status','invalid_transition');
    END IF;
  END IF;

  IF _target_status = 'verified' THEN
    UPDATE public.society_income_records
      SET verification_status = 'verified',
          verified_at = v_now,
          verified_by = v_uid
      WHERE id = _record_id AND verification_status = 'pending';
  ELSIF _target_status = 'rejected' THEN
    UPDATE public.society_income_records
      SET verification_status = 'rejected',
          rejected_at = v_now,
          rejected_by = v_uid,
          rejection_reason = v_reason
      WHERE id = _record_id AND verification_status = 'pending';
  ELSE
    UPDATE public.society_income_records
      SET verification_status = 'reversed',
          reversed_at = v_now,
          reversed_by = v_uid,
          reversal_reason = v_reason,
          reconciliation_status = 'reversed'
      WHERE id = _record_id AND verification_status = 'verified';
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    SELECT verification_status INTO v_from
      FROM public.society_income_records WHERE id = _record_id;
    RETURN jsonb_build_object('status','already_processed','currentStatus', v_from);
  END IF;

  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (
    v_uid,
    'income_record.' || _target_status,
    'society_income_records',
    _record_id,
    v_rec.society_id,
    jsonb_build_object(
      'from', v_rec.verification_status,
      'to', _target_status,
      'reason', v_reason,
      'amount', v_rec.amount,
      'category_id', v_rec.category_id
    )
  );

  RETURN jsonb_build_object(
    'status','success',
    'recordId', _record_id,
    'verificationStatus', _target_status,
    'changedAt', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transition_income_record(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_income_record(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.transition_income_record(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.transition_income_record(uuid, text, text)
  IS 'Turn 18B.2A: atomic verified/rejected/reversed transitions. Independently enforces admin membership and Pro/Premium plan entitlement at the DB layer; returns non-enumerating not_found for all inaccessible/missing records.';
