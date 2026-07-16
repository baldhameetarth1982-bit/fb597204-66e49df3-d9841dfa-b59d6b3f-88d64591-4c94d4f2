-- Stage 1D correctness slice — transactional RPC for non-member income creation.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'society_income_records_hash_format_chk'
      AND conrelid = 'public.society_income_records'::regclass
  ) THEN
    EXECUTE $c$
      ALTER TABLE public.society_income_records
        ADD CONSTRAINT society_income_records_hash_format_chk
        CHECK (
          creation_payload_hash IS NULL
          OR creation_payload_hash ~ '^[0-9a-f]{64}$'
        ) NOT VALID
    $c$;
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
  _creation_request_id uuid,
  _canonical_payload text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
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
  _hash text;
  _existing_id uuid;
  _existing_hash text;
  _new_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('status','not_authorized');
  END IF;

  IF _society_id IS NULL OR _category_id IS NULL OR _canonical_payload IS NULL THEN
    RETURN jsonb_build_object('status','invalid_input');
  END IF;
  IF _payer_kind NOT IN ('resident','non_member','anonymous') THEN
    RETURN jsonb_build_object('status','invalid_input');
  END IF;
  IF _payment_method NOT IN ('cash','bank_transfer','other_offline') THEN
    RETURN jsonb_build_object('status','invalid_input');
  END IF;
  IF _amount IS NULL OR _amount <= 0 OR _amount > 1e11 THEN
    RETURN jsonb_build_object('status','invalid_input');
  END IF;

  IF NOT (
    public.is_society_admin_for(_uid, _society_id)
    OR public.is_super_admin(_uid)
  ) THEN
    RETURN jsonb_build_object('status','not_authorized');
  END IF;

  SELECT plan_id, plan_status, trial_ends_at
    INTO _plan_id, _plan_status, _trial_ends_at
  FROM public.societies WHERE id = _society_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','not_authorized');
  END IF;

  IF lower(coalesce(_plan_status,'')) IN ('expired','cancelled','canceled','past_due','inactive') THEN
    _plan_ok := false;
  ELSIF lower(coalesce(_plan_status,'')) IN ('trial','trialing') THEN
    _plan_ok := (_trial_ends_at IS NULL OR _trial_ends_at > now());
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

  IF _payer_kind = 'resident' THEN
    IF _resident_user_id IS NULL OR _non_member_payer_id IS NOT NULL THEN
      RETURN jsonb_build_object('status','invalid_input');
    END IF;
  ELSIF _payer_kind = 'non_member' THEN
    IF _non_member_payer_id IS NULL OR _resident_user_id IS NOT NULL THEN
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
  ELSE
    IF _resident_user_id IS NOT NULL OR _non_member_payer_id IS NOT NULL THEN
      RETURN jsonb_build_object('status','invalid_input');
    END IF;
  END IF;

  _hash := encode(extensions.digest(_canonical_payload, 'sha256'), 'hex');
  IF _hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('status','temporary_error');
  END IF;

  IF _creation_request_id IS NOT NULL THEN
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
      RETURN jsonb_build_object(
        'status','existing','id',_existing_id,'idempotent',true
      );
    END IF;
  END IF;

  INSERT INTO public.society_income_records (
    society_id, category_id, payer_kind, resident_user_id, non_member_payer_id,
    amount, payment_method, payment_status, payment_date, reference_number, description,
    verification_status, reconciliation_status, source, created_by,
    creation_request_id, creation_payload_hash
  ) VALUES (
    _society_id, _category_id, _payer_kind, _resident_user_id, _non_member_payer_id,
    _amount, _payment_method, 'received', coalesce(_payment_date, now()),
    _reference_number, _description,
    'pending', 'unreconciled', 'manual', _uid,
    _creation_request_id, _hash
  ) RETURNING id INTO _new_id;

  INSERT INTO public.audit_log (
    actor_id, action, target_table, target_id, society_id, metadata
  ) VALUES (
    _uid, 'income_record.created', 'society_income_records', _new_id, _society_id,
    jsonb_build_object(
      'amount', _amount,
      'method', _payment_method,
      'payer_kind', _payer_kind,
      'creation_request_id', _creation_request_id
    )
  );

  RETURN jsonb_build_object(
    'status','created','id',_new_id,'idempotent',false
  );

EXCEPTION
  WHEN unique_violation THEN
    IF _creation_request_id IS NOT NULL THEN
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
        RETURN jsonb_build_object(
          'status','existing','id',_existing_id,'idempotent',true
        );
      END IF;
    END IF;
    RETURN jsonb_build_object('status','temporary_error');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('status','temporary_error');
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_non_member_income_record(
  uuid, uuid, text, uuid, uuid, numeric, text, timestamptz, text, text, uuid, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_non_member_income_record(
  uuid, uuid, text, uuid, uuid, numeric, text, timestamptz, text, text, uuid, text
) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_non_member_income_record(
  uuid, uuid, text, uuid, uuid, numeric, text, timestamptz, text, text, uuid, text
) TO authenticated;

COMMENT ON FUNCTION public.create_non_member_income_record(
  uuid, uuid, text, uuid, uuid, numeric, text, timestamptz, text, text, uuid, text
) IS
  'Stage 1D — transactional creator for non-member income records. Enforces society-admin membership, Pro/Premium plan, category/payer scoping, and SHA-256 canonical-payload idempotency. Record + audit commit atomically. Returns a strict discriminated jsonb result; never raises raw DB errors to callers.';
