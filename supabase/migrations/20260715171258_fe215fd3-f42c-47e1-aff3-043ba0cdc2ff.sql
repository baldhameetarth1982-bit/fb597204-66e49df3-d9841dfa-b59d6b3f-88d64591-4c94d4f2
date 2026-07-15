
-- Turn 18B.2: rejection audit fields + atomic transition RPC
ALTER TABLE public.society_income_records
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sir_rejection_len') THEN
    ALTER TABLE public.society_income_records
      ADD CONSTRAINT sir_rejection_len
      CHECK (rejection_reason IS NULL OR char_length(rejection_reason) <= 500);
  END IF;
END $$;

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
  v_new_recon text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status','not_authorized');
  END IF;

  IF _target_status NOT IN ('verified','rejected','reversed') THEN
    RETURN jsonb_build_object('status','invalid_transition');
  END IF;

  SELECT * INTO v_rec FROM public.society_income_records WHERE id = _record_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','not_found');
  END IF;

  IF NOT (public.is_society_admin_for(v_uid, v_rec.society_id)
          OR public.is_super_admin(v_uid)) THEN
    RETURN jsonb_build_object('status','not_authorized');
  END IF;

  v_from := v_rec.verification_status;

  -- Canonical state machine
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
    -- Reject HTML-like content
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
  ELSE -- reversed
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
    -- Someone else updated it concurrently — reload and report conflict
    SELECT verification_status INTO v_from
      FROM public.society_income_records WHERE id = _record_id;
    RETURN jsonb_build_object('status','already_processed','currentStatus', v_from);
  END IF;

  -- Atomic audit evidence in the same transaction
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
GRANT EXECUTE ON FUNCTION public.transition_income_record(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.transition_income_record(uuid, text, text)
  IS 'Turn 18B.2: atomic verified/rejected/reversed transitions with audit_log write. Society/actor derived server-side; expected-state guard prevents concurrent overwrites.';
