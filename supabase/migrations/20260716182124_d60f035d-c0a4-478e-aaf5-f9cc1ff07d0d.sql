
-- Stage 1D — re-consolidated authoritative creator with tightened trial rule.
-- Trial requires trial_ends_at IS NOT NULL AND > now(). All other invariants
-- (11-arg signature, cash/bank-transfer only, resident denied, canonical hash
-- derived server-side, no caller-controlled canonical/hash) are preserved.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Idempotent DROP of the historical 12-arg signature so invariant tests can
-- assert both versions are stripped in the same migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'create_non_member_income_record'
      AND pg_get_function_identity_arguments(p.oid) =
        '_society_id uuid, _category_id uuid, _payer_kind text, _resident_user_id uuid, _non_member_payer_id uuid, _amount numeric, _payment_method text, _payment_date timestamp with time zone, _reference_number text, _description text, _creation_request_id uuid, _canonical_payload text'
  ) THEN
    REVOKE ALL ON FUNCTION public.create_non_member_income_record(
      uuid, uuid, text, uuid, uuid, numeric, text, timestamptz, text, text, uuid, text
    ) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.create_non_member_income_record(
      uuid, uuid, text, uuid, uuid, numeric, text, timestamptz, text, text, uuid, text
    ) FROM anon;
    REVOKE ALL ON FUNCTION public.create_non_member_income_record(
      uuid, uuid, text, uuid, uuid, numeric, text, timestamptz, text, text, uuid, text
    ) FROM authenticated;
    DROP FUNCTION public.create_non_member_income_record(
      uuid, uuid, text, uuid, uuid, numeric, text, timestamptz, text, text, uuid, text
    );
  END IF;
END $$;

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
SET search_path = pg_catalog, extensions, pg_temp
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _plan_id text;
  _plan_status text;
  _trial_ends_at timestamptz;
  _plan_ok boolean := false;
  _cat_active boolean;
  _cat_soc uuid;
  _payer_active boolean;
  _payer_soc uuid;
  _amount_norm numeric(14,2);
  _ref_norm text;
  _desc_norm text;
  _date_norm date;
  _today date := (now() AT TIME ZONE 'UTC')::date;
  _canonical jsonb;
  _canonical_text text;
  _hash text;
  _existing_id uuid;
  _existing_hash text;
  _new_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('status','not_authorized');
  END IF;

  IF _society_id IS NULL
     OR _category_id IS NULL
     OR _creation_request_id IS NULL
     OR _payer_kind IS NULL
     OR _payment_method IS NULL
     OR _amount IS NULL THEN
    RETURN jsonb_build_object('status','invalid_input');
  END IF;

  IF _payer_kind NOT IN ('non_member','anonymous') THEN
    RETURN jsonb_build_object('status','invalid_input');
  END IF;

  IF _payment_method NOT IN ('cash','bank_transfer') THEN
    RETURN jsonb_build_object('status','invalid_input');
  END IF;

  IF _amount <= 0 OR _amount > 100000000 THEN
    RETURN jsonb_build_object('status','invalid_input');
  END IF;
  IF _amount <> round(_amount, 2) THEN
    RETURN jsonb_build_object('status','invalid_input');
  END IF;
  _amount_norm := round(_amount, 2);

  IF _payer_kind = 'non_member' THEN
    IF _non_member_payer_id IS NULL OR _resident_user_id IS NOT NULL THEN
      RETURN jsonb_build_object('status','invalid_input');
    END IF;
  ELSE
    IF _non_member_payer_id IS NOT NULL OR _resident_user_id IS NOT NULL THEN
      RETURN jsonb_build_object('status','invalid_input');
    END IF;
  END IF;

  IF _payment_date IS NULL THEN
    _date_norm := _today;
  ELSE
    _date_norm := (_payment_date AT TIME ZONE 'UTC')::date;
    IF _date_norm > _today THEN
      RETURN jsonb_build_object('status','invalid_input');
    END IF;
  END IF;

  _ref_norm := nullif(btrim(coalesce(_reference_number, '')), '');
  _desc_norm := nullif(btrim(coalesce(_description, '')), '');
  IF _ref_norm IS NOT NULL AND char_length(_ref_norm) > 128 THEN
    RETURN jsonb_build_object('status','invalid_input');
  END IF;
  IF _desc_norm IS NOT NULL AND char_length(_desc_norm) > 500 THEN
    RETURN jsonb_build_object('status','invalid_input');
  END IF;

  IF NOT (
    public.is_society_admin_for(_uid, _society_id)
    OR public.is_super_admin(_uid)
  ) THEN
    RETURN jsonb_build_object('status','not_authorized');
  END IF;

  -- Plan entitlement — parity with PLAN_NORMALIZATION_SPEC in
  -- src/lib/plan-features.ts. Stage 1D trial rule: trial/trialing REQUIRES
  -- a non-null trial_ends_at strictly in the future.
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
    SELECT is_active, society_id INTO _payer_active, _payer_soc
      FROM public.non_member_payers WHERE id = _non_member_payer_id;
    IF NOT FOUND OR _payer_soc IS DISTINCT FROM _society_id THEN
      RETURN jsonb_build_object('status','not_authorized');
    END IF;
    IF NOT _payer_active THEN
      RETURN jsonb_build_object('status','payer_inactive');
    END IF;
  END IF;

  _canonical := jsonb_build_object(
    'society_id',          _society_id,
    'created_by',          _uid,
    'category_id',         _category_id,
    'payer_kind',          _payer_kind,
    'resident_user_id',    NULL,
    'non_member_payer_id', _non_member_payer_id,
    'amount',              to_char(_amount_norm, 'FM999999999990.00'),
    'payment_method',      _payment_method,
    'payment_date',        to_char(_date_norm, 'YYYY-MM-DD'),
    'reference_number',    _ref_norm,
    'description',         _desc_norm,
    'source',              'manual'
  );
  _canonical_text := _canonical::text;

  _hash := encode(extensions.digest(_canonical_text, 'sha256'), 'hex');
  IF _hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('status','temporary_error');
  END IF;

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

  INSERT INTO public.society_income_records (
    society_id, category_id, payer_kind, resident_user_id, non_member_payer_id,
    amount, payment_method, payment_status, payment_date, reference_number, description,
    verification_status, reconciliation_status, source, created_by,
    creation_request_id, creation_payload_hash
  ) VALUES (
    _society_id, _category_id, _payer_kind, NULL, _non_member_payer_id,
    _amount_norm, _payment_method, 'received', _date_norm::timestamptz,
    _ref_norm, _desc_norm,
    'pending', 'unreconciled', 'manual', _uid,
    _creation_request_id, _hash
  ) RETURNING id INTO _new_id;

  INSERT INTO public.audit_log (
    actor_id, action, target_table, target_id, society_id, metadata
  ) VALUES (
    _uid, 'income_record.created', 'society_income_records', _new_id, _society_id,
    jsonb_build_object(
      'amount', _amount_norm,
      'method', _payment_method,
      'payer_kind', _payer_kind,
      'creation_request_id', _creation_request_id
    )
  );

  RETURN jsonb_build_object('status','created','id',_new_id,'idempotent',false);

EXCEPTION
  WHEN unique_violation THEN
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
    RETURN jsonb_build_object('status','temporary_error');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('status','temporary_error');
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_non_member_income_record(
  uuid, uuid, text, uuid, uuid, numeric, text, timestamptz, text, text, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_non_member_income_record(
  uuid, uuid, text, uuid, uuid, numeric, text, timestamptz, text, text, uuid
) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_non_member_income_record(
  uuid, uuid, text, uuid, uuid, numeric, text, timestamptz, text, text, uuid
) TO authenticated;

COMMENT ON FUNCTION public.create_non_member_income_record(
  uuid, uuid, text, uuid, uuid, numeric, text, timestamptz, text, text, uuid
) IS
  'Stage 1D — authoritative transactional creator with tightened trial rule (trial requires non-null future trial_ends_at). All other invariants preserved.';
