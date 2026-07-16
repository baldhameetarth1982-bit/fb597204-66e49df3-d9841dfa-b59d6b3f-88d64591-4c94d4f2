
-- Stage 1D — parity with PLAN_NORMALIZATION_SPEC.trialRequiresFutureExpiry.
-- Previous body allowed trial with NULL trial_ends_at (permanent trial).
-- Tighten: trial/trialing requires trial_ends_at IS NOT NULL AND > now().

CREATE OR REPLACE FUNCTION public.create_non_member_income_record(
  _society_id uuid,
  _category_id uuid,
  _payer_kind text,
  _resident_user_id uuid,
  _non_member_payer_id uuid,
  _amount numeric,
  _payment_method text,
  _payment_date timestamptz,
  _reference_number text,
  _description text,
  _creation_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _plan_id text;
  _plan_status text;
  _trial_ends_at timestamptz;
  _plan_ok boolean;
  _cat_active boolean;
  _cat_soc uuid;
  _payer_active boolean;
  _payer_soc uuid;
  _norm_ref text;
  _norm_desc text;
  _norm_date date;
  _norm_amount numeric(14,2);
  _canonical text;
  _hash text;
  _existing_id uuid;
  _existing_hash text;
  _new_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('status','not_authorized');
  END IF;
  IF _creation_request_id IS NULL THEN
    RETURN jsonb_build_object('status','invalid_input');
  END IF;
  IF _payer_kind NOT IN ('non_member','anonymous') THEN
    RETURN jsonb_build_object('status','not_authorized');
  END IF;
  IF _payment_method NOT IN ('cash','bank_transfer') THEN
    RETURN jsonb_build_object('status','invalid_input');
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RETURN jsonb_build_object('status','invalid_input');
  END IF;

  IF NOT (
    public.is_society_admin_for(_uid, _society_id)
    OR public.is_super_admin(_uid)
  ) THEN
    RETURN jsonb_build_object('status','not_authorized');
  END IF;

  -- Plan entitlement — parity with PLAN_NORMALIZATION_SPEC in
  -- src/lib/plan-features.ts. Stage 1D trial rule: NULL trial_ends_at → basic.
  SELECT plan_id, plan_status, trial_ends_at
    INTO _plan_id, _plan_status, _trial_ends_at
  FROM public.societies WHERE id = _society_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','not_authorized');
  END IF;

  IF lower(coalesce(_plan_status,'')) IN ('expired','cancelled','canceled','past_due','inactive') THEN
    _plan_ok := false;
  ELSIF lower(coalesce(_plan_status,'')) IN ('trial','trialing') THEN
    _plan_ok := (_trial_ends_at IS NOT NULL AND _trial_ends_at > now());
  ELSIF lower(coalesce(_plan_id,'')) IN ('pro','standard','growth','premium','business','enterprise') THEN
    _plan_ok := true;
  ELSE
    _plan_ok := false;
  END IF;

  IF NOT _plan_ok THEN
    RETURN jsonb_build_object('status','plan_required');
  END IF;

  SELECT is_active, society_id INTO _cat_active, _cat_soc
    FROM public.society_income_categories WHERE id = _category_id;
  IF NOT FOUND OR _cat_soc IS DISTINCT FROM _society_id THEN
    RETURN jsonb_build_object('status','not_authorized');
  END IF;
  IF NOT _cat_active THEN
    RETURN jsonb_build_object('status','category_inactive');
  END IF;

  IF _payer_kind = 'non_member' THEN
    IF _non_member_payer_id IS NULL THEN
      RETURN jsonb_build_object('status','invalid_input');
    END IF;
    SELECT is_active, society_id INTO _payer_active, _payer_soc
      FROM public.non_member_payers WHERE id = _non_member_payer_id;
    IF NOT FOUND OR _payer_soc IS DISTINCT FROM _society_id THEN
      RETURN jsonb_build_object('status','not_authorized');
    END IF;
    IF NOT _payer_active THEN
      RETURN jsonb_build_object('status','payer_inactive');
    END IF;
  END IF;

  _norm_amount := round(_amount::numeric, 2);
  _norm_date := coalesce(_payment_date::date, current_date);
  _norm_ref := lower(regexp_replace(coalesce(_reference_number,''), '\s+', ' ', 'g'));
  _norm_ref := btrim(_norm_ref);
  _norm_desc := lower(regexp_replace(coalesce(_description,''), '\s+', ' ', 'g'));
  _norm_desc := btrim(_norm_desc);

  _canonical := jsonb_build_object(
    'society_id', _society_id,
    'category_id', _category_id,
    'payer_kind', _payer_kind,
    'resident_user_id', null,
    'non_member_payer_id', _non_member_payer_id,
    'amount', to_char(_norm_amount, 'FM99999999999990.00'),
    'payment_method', _payment_method,
    'payment_date', to_char(_norm_date, 'YYYY-MM-DD'),
    'reference_number', _norm_ref,
    'description', _norm_desc
  )::text;
  _hash := encode(extensions.digest(_canonical, 'sha256'), 'hex');

  SELECT id, creation_payload_hash INTO _existing_id, _existing_hash
    FROM public.society_income_records
   WHERE society_id = _society_id
     AND created_by = _uid
     AND creation_request_id = _creation_request_id
   LIMIT 1;

  IF FOUND THEN
    IF _existing_hash IS DISTINCT FROM _hash THEN
      RETURN jsonb_build_object('status','idempotency_conflict');
    END IF;
    RETURN jsonb_build_object('status','existing','id',_existing_id,'idempotent',true);
  END IF;

  INSERT INTO public.society_income_records(
    society_id, category_id, payer_kind, resident_user_id, non_member_payer_id,
    amount, payment_method, payment_date, reference_number, description,
    verification_status, created_by, creation_request_id, creation_payload_hash
  ) VALUES (
    _society_id, _category_id, _payer_kind, null, _non_member_payer_id,
    _norm_amount, _payment_method, _norm_date, nullif(_norm_ref,''), nullif(_norm_desc,''),
    'pending', _uid, _creation_request_id, _hash
  )
  RETURNING id INTO _new_id;

  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (_uid, 'income_record.create', 'society_income_records', _new_id, _society_id,
          jsonb_build_object('creation_request_id', _creation_request_id));

  RETURN jsonb_build_object('status','created','id',_new_id,'idempotent',false);
END;
$fn$;
