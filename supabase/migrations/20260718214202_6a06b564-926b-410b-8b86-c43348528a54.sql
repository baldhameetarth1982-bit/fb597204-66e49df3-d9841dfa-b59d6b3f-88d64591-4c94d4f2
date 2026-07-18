-- Stage 3C v8: explicit-column payment detail + audience-shaped nested receipt.
-- Removes SELECT * / payments%ROWTYPE and shapes the receipt payload per audience.

CREATE OR REPLACE FUNCTION public.get_payment_detail(_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  -- Explicit variables replace the payments%ROWTYPE record.
  p_id                 uuid;
  p_bill_id            uuid;
  p_society_id         uuid;
  p_flat_id            uuid;
  p_amount             numeric;
  p_method             text;
  p_status             text;
  p_reference_no       text;
  p_notes              text;
  p_submitted_at       timestamptz;
  p_submitted_by       uuid;
  p_source             text;
  p_payment_date       date;
  p_verified_at        timestamptz;
  p_verified_by        uuid;
  p_verification_notes text;
  p_rejected_at        timestamptz;
  p_rejected_by        uuid;
  p_rejection_reason   text;
  p_reversed_at        timestamptz;
  p_reversed_by        uuid;
  p_reversal_reason    text;
  p_created_at         timestamptz;

  is_admin boolean := false;
  is_owner boolean := false;
  bill_num text;
  flat_lbl text;
  summary  jsonb;
  full_receipt jsonb;
  receipt_json jsonb;
  common_payment jsonb;
  audience text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  -- Explicit-column read; NO SELECT *, NO %ROWTYPE, NO to_jsonb(p), NO row_to_json(p).
  SELECT
    id, bill_id, society_id, flat_id, amount, method, status, reference_no, notes,
    submitted_at, submitted_by, source, payment_date,
    verified_at, verified_by, verification_notes,
    rejected_at, rejected_by, rejection_reason,
    reversed_at, reversed_by, reversal_reason,
    created_at
  INTO
    p_id, p_bill_id, p_society_id, p_flat_id, p_amount, p_method, p_status, p_reference_no, p_notes,
    p_submitted_at, p_submitted_by, p_source, p_payment_date,
    p_verified_at, p_verified_by, p_verification_notes,
    p_rejected_at, p_rejected_by, p_rejection_reason,
    p_reversed_at, p_reversed_by, p_reversal_reason,
    p_created_at
  FROM public.payments
  WHERE id = _payment_id;

  IF p_id IS NULL THEN
    RETURN NULL;
  END IF;

  is_admin :=
    public.has_role(uid, 'super_admin'::app_role)
    OR public.current_user_has_society_permission(p_society_id, 'billing.manage'::text, NULL::uuid);

  IF NOT is_admin THEN
    SELECT EXISTS (
      SELECT 1 FROM public.flat_residents fr
       JOIN public.bills b ON b.flat_id = fr.flat_id
       WHERE b.id = p_bill_id
         AND fr.user_id = uid
         AND fr.is_active = true
         AND fr.moved_out_at IS NULL
    ) INTO is_owner;
    IF NOT is_owner THEN
      RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  audience := CASE WHEN is_admin THEN 'admin' ELSE 'resident' END;

  SELECT b.bill_number, f.flat_number
    INTO bill_num, flat_lbl
    FROM public.bills b
    LEFT JOIN public.flats f ON f.id = b.flat_id
    WHERE b.id = p_bill_id;

  summary := public.get_bill_payment_summary(p_bill_id);
  full_receipt := public.get_payment_receipt_lifecycle(p_id);

  -- Common safe payment fields returned to every audience (explicit list).
  common_payment := jsonb_build_object(
    'id',               p_id,
    'bill_id',          p_bill_id,
    'society_id',       p_society_id,
    'flat_id',          p_flat_id,
    'amount',           p_amount,
    'method',           p_method,
    'status',           p_status,
    'reference_no',     p_reference_no,
    'submitted_at',     p_submitted_at,
    'source',           p_source,
    'payment_date',     p_payment_date,
    'verified_at',      p_verified_at,
    'rejected_at',      p_rejected_at,
    'rejection_reason', p_rejection_reason,
    'reversed_at',      p_reversed_at,
    'reversal_reason',  p_reversal_reason,
    'created_at',       p_created_at
  );

  IF is_admin THEN
    common_payment := common_payment || jsonb_build_object(
      'notes',              p_notes,
      'submitted_by',       p_submitted_by,
      'verified_by',        p_verified_by,
      'verification_notes', p_verification_notes,
      'rejected_by',        p_rejected_by,
      'reversed_by',        p_reversed_by
    );
  END IF;

  -- Audience-shaped receipt payload. Residents get only display-safe fields;
  -- internal actor UUIDs (verified_by / voided_by) and internal database IDs
  -- stay hidden regardless of the underlying lifecycle row.
  IF full_receipt IS NULL OR full_receipt = 'null'::jsonb THEN
    receipt_json := NULL;
  ELSIF is_admin THEN
    -- Admin: full lifecycle shape (unchanged).
    receipt_json := full_receipt;
  ELSE
    receipt_json := jsonb_build_object(
      'receipt_number',       full_receipt->>'receipt_number',
      'status',               full_receipt->>'status',
      'issued_at',            full_receipt->>'issued_at',
      'voided_at',            full_receipt->>'voided_at',
      'void_reason',          full_receipt->>'void_reason',
      'amount_snapshot',      full_receipt->'amount_snapshot',
      'method_snapshot',      full_receipt->>'method_snapshot',
      'reference_snapshot',   full_receipt->>'reference_snapshot',
      'bill_number_snapshot', full_receipt->>'bill_number_snapshot',
      'verified_at',          full_receipt->>'verified_at'
    );
  END IF;

  RETURN jsonb_build_object(
    'payment',     common_payment,
    'bill_number', bill_num,
    'flat_label',  flat_lbl,
    'summary',     summary,
    'receipt',     receipt_json,
    'audience',    audience
  );
END;
$function$;