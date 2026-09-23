
CREATE TABLE public.smart_qr_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  token text NOT NULL UNIQUE CHECK (token ~ '^[A-Za-z0-9_-]{40,64}$'),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 80),
  purpose text CHECK (purpose IS NULL OR char_length(purpose) <= 300),
  category_id uuid NOT NULL REFERENCES public.society_income_categories(id) ON DELETE RESTRICT,
  fixed_amount numeric(14,2) CHECK (fixed_amount IS NULL OR (fixed_amount > 0 AND fixed_amount <= 10000000)),
  payee_name text NOT NULL CHECK (char_length(btrim(payee_name)) BETWEEN 2 AND 100),
  bank_name text CHECK (bank_name IS NULL OR char_length(bank_name) <= 100),
  account_number text NOT NULL CHECK (account_number ~ '^[0-9]{6,20}$'),
  ifsc text NOT NULL CHECK (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  instructions text CHECK (instructions IS NULL OR char_length(instructions) <= 500),
  accepts_cash boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX smart_qr_codes_society_idx ON public.smart_qr_codes(society_id, created_at DESC);

CREATE TABLE public.smart_qr_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_id uuid NOT NULL REFERENCES public.smart_qr_codes(id) ON DELETE RESTRICT,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE RESTRICT,
  payer_name text NOT NULL CHECK (char_length(btrim(payer_name)) BETWEEN 2 AND 100),
  payer_phone text CHECK (payer_phone IS NULL OR payer_phone ~ '^[0-9]{10}$'),
  amount numeric(14,2) NOT NULL CHECK (amount > 0 AND amount <= 10000000),
  payment_method text NOT NULL CHECK (payment_method IN ('bank_transfer','cash')),
  reference_number text CHECK (reference_number IS NULL OR char_length(reference_number) BETWEEN 4 AND 64),
  paid_on date NOT NULL,
  note text CHECK (note IS NULL OR char_length(note) <= 300),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','recorded','rejected')),
  income_record_id uuid REFERENCES public.society_income_records(id) ON DELETE RESTRICT,
  review_reason text CHECK (review_reason IS NULL OR char_length(review_reason) <= 300),
  reviewed_by uuid,
  reviewed_at timestamptz,
  idempotency_key uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX smart_qr_submissions_ref_uniq ON public.smart_qr_submissions(qr_id, upper(reference_number)) WHERE reference_number IS NOT NULL AND status <> 'rejected';
CREATE INDEX smart_qr_submissions_qr_idx ON public.smart_qr_submissions(qr_id, created_at DESC);
CREATE INDEX smart_qr_submissions_society_status_idx ON public.smart_qr_submissions(society_id, status, created_at DESC);

GRANT SELECT ON public.smart_qr_codes TO authenticated;
GRANT SELECT ON public.smart_qr_submissions TO authenticated;
GRANT ALL ON public.smart_qr_codes TO service_role;
GRANT ALL ON public.smart_qr_submissions TO service_role;

ALTER TABLE public.smart_qr_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_qr_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Society admins read their QR codes" ON public.smart_qr_codes
  FOR SELECT TO authenticated
  USING (public.is_society_admin_for(auth.uid(), society_id) OR public.is_super_admin(auth.uid()));
CREATE POLICY "Society admins read their QR submissions" ON public.smart_qr_submissions
  FOR SELECT TO authenticated
  USING (public.is_society_admin_for(auth.uid(), society_id) OR public.is_super_admin(auth.uid()));

-- ---------- Admin: create ----------
CREATE OR REPLACE FUNCTION public.smart_qr_create(
  _title text, _purpose text, _category_id uuid, _fixed_amount numeric,
  _payee_name text, _bank_name text, _account_number text, _ifsc text,
  _instructions text, _accepts_cash boolean, _expires_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE _uid uuid := auth.uid(); _soc uuid; _cat_active boolean; _id uuid; _token text;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('status','not_authorized'); END IF;
  SELECT society_id, is_active INTO _soc, _cat_active FROM public.society_income_categories WHERE id = _category_id;
  IF NOT FOUND OR NOT public.is_society_admin_for(_uid, _soc) THEN
    RETURN jsonb_build_object('status','not_authorized');
  END IF;
  IF NOT public.is_non_member_income_enabled_internal(_soc) THEN RETURN jsonb_build_object('status','plan_required'); END IF;
  IF NOT _cat_active THEN RETURN jsonb_build_object('status','category_inactive'); END IF;
  IF _expires_at IS NOT NULL AND _expires_at <= now() THEN RETURN jsonb_build_object('status','invalid_input'); END IF;
  _token := translate(rtrim(encode(gen_random_bytes(32),'base64'),'='),'+/','-_');
  BEGIN
    INSERT INTO public.smart_qr_codes(society_id, token, title, purpose, category_id, fixed_amount, payee_name, bank_name,
      account_number, ifsc, instructions, accepts_cash, expires_at, created_by)
    VALUES (_soc, _token, btrim(_title), nullif(btrim(coalesce(_purpose,'')),''), _category_id, _fixed_amount, btrim(_payee_name),
      nullif(btrim(coalesce(_bank_name,'')),''), btrim(_account_number), upper(btrim(_ifsc)),
      nullif(btrim(coalesce(_instructions,'')),''), coalesce(_accepts_cash,false), _expires_at, _uid)
    RETURNING id INTO _id;
  EXCEPTION WHEN check_violation OR not_null_violation THEN
    RETURN jsonb_build_object('status','invalid_input');
  END;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (_uid, 'smart_qr.created', 'smart_qr_codes', _id::text, _soc, jsonb_build_object('title', btrim(_title)));
  RETURN jsonb_build_object('status','created','id',_id);
END $$;

-- ---------- Admin: activate / deactivate ----------
CREATE OR REPLACE FUNCTION public.smart_qr_set_active(_qr_id uuid, _active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _uid uuid := auth.uid(); _soc uuid;
BEGIN
  SELECT society_id INTO _soc FROM public.smart_qr_codes WHERE id = _qr_id;
  IF _uid IS NULL OR NOT FOUND OR NOT public.is_society_admin_for(_uid, _soc) THEN
    RETURN jsonb_build_object('status','not_found');
  END IF;
  IF _active AND NOT public.is_non_member_income_enabled_internal(_soc) THEN RETURN jsonb_build_object('status','plan_required'); END IF;
  UPDATE public.smart_qr_codes SET is_active = _active, updated_at = now() WHERE id = _qr_id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (_uid, CASE WHEN _active THEN 'smart_qr.activated' ELSE 'smart_qr.deactivated' END, 'smart_qr_codes', _qr_id::text, _soc, '{}'::jsonb);
  RETURN jsonb_build_object('status','success');
END $$;

-- ---------- Public: view by token ----------
CREATE OR REPLACE FUNCTION public.smart_qr_public_view(_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record;
BEGIN
  IF _token IS NULL OR _token !~ '^[A-Za-z0-9_-]{40,64}$' THEN RETURN jsonb_build_object('status','not_found'); END IF;
  SELECT q.*, s.name AS society_name INTO r FROM public.smart_qr_codes q JOIN public.societies s ON s.id = q.society_id WHERE q.token = _token;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
  IF NOT r.is_active OR (r.expires_at IS NOT NULL AND r.expires_at <= now())
     OR NOT public.is_non_member_income_enabled_internal(r.society_id) THEN
    RETURN jsonb_build_object('status','inactive','society_name', r.society_name, 'title', r.title);
  END IF;
  RETURN jsonb_build_object('status','ok','society_name', r.society_name, 'title', r.title, 'purpose', r.purpose,
    'fixed_amount', r.fixed_amount, 'payee_name', r.payee_name, 'bank_name', r.bank_name,
    'account_number', r.account_number, 'ifsc', r.ifsc, 'instructions', r.instructions,
    'accepts_cash', r.accepts_cash, 'expires_at', r.expires_at);
END $$;

-- ---------- Public: submit a payment claim (pending until admin records it) ----------
CREATE OR REPLACE FUNCTION public.smart_qr_public_submit(
  _token text, _payer_name text, _payer_phone text, _amount numeric, _payment_method text,
  _reference_number text, _paid_on date, _note text, _idempotency_key uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; _rl record; _existing record; _id uuid; _ref text; _today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF _idempotency_key IS NULL OR _token IS NULL OR _token !~ '^[A-Za-z0-9_-]{40,64}$' THEN RETURN jsonb_build_object('status','not_found'); END IF;
  SELECT * INTO r FROM public.smart_qr_codes WHERE token = _token;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;

  SELECT * INTO _existing FROM public.smart_qr_submissions WHERE idempotency_key = _idempotency_key;
  IF FOUND THEN
    IF _existing.qr_id <> r.id THEN RETURN jsonb_build_object('status','invalid_input'); END IF;
    RETURN jsonb_build_object('status','submitted','duplicate',true);
  END IF;

  IF NOT r.is_active OR (r.expires_at IS NOT NULL AND r.expires_at <= now())
     OR NOT public.is_non_member_income_enabled_internal(r.society_id) THEN
    RETURN jsonb_build_object('status','inactive');
  END IF;

  SELECT * INTO _rl FROM public.touch_rate_limit('smart_qr_submit', r.id::text, 60, 3600);
  IF NOT _rl.allowed THEN RETURN jsonb_build_object('status','rate_limited'); END IF;

  IF _payment_method NOT IN ('bank_transfer','cash') OR (_payment_method = 'cash' AND NOT r.accepts_cash) THEN
    RETURN jsonb_build_object('status','invalid_input');
  END IF;
  IF _amount IS NULL OR _amount <= 0 OR _amount > 10000000 OR _amount <> round(_amount,2)
     OR (r.fixed_amount IS NOT NULL AND _amount <> r.fixed_amount) THEN
    RETURN jsonb_build_object('status','invalid_input');
  END IF;
  IF _paid_on IS NULL OR _paid_on > _today OR _paid_on < _today - 90 THEN RETURN jsonb_build_object('status','invalid_input'); END IF;
  _ref := nullif(upper(regexp_replace(coalesce(_reference_number,''), '\s', '', 'g')), '');
  IF _payment_method = 'bank_transfer' AND (_ref IS NULL OR _ref !~ '^[A-Z0-9/-]{4,64}$') THEN
    RETURN jsonb_build_object('status','invalid_input');
  END IF;

  BEGIN
    INSERT INTO public.smart_qr_submissions(qr_id, society_id, payer_name, payer_phone, amount, payment_method,
      reference_number, paid_on, note, idempotency_key)
    VALUES (r.id, r.society_id, btrim(_payer_name), nullif(regexp_replace(coalesce(_payer_phone,''),'\D','','g'),''),
      round(_amount,2), _payment_method, _ref, _paid_on, nullif(btrim(coalesce(_note,'')),''), _idempotency_key)
    RETURNING id INTO _id;
  EXCEPTION
    WHEN unique_violation THEN
      IF EXISTS (SELECT 1 FROM public.smart_qr_submissions WHERE idempotency_key = _idempotency_key) THEN
        RETURN jsonb_build_object('status','submitted','duplicate',true);
      END IF;
      RETURN jsonb_build_object('status','duplicate_reference');
    WHEN check_violation OR not_null_violation THEN
      RETURN jsonb_build_object('status','invalid_input');
  END;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (NULL, 'smart_qr.submission_received', 'smart_qr_submissions', _id::text, r.society_id,
    jsonb_build_object('qr_id', r.id, 'amount', round(_amount,2), 'method', _payment_method));
  RETURN jsonb_build_object('status','submitted','duplicate',false);
END $$;

-- ---------- Admin: record submission into canonical income (pending verification) or reject ----------
CREATE OR REPLACE FUNCTION public.smart_qr_review_submission(_submission_id uuid, _action text, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE _uid uuid := auth.uid(); s record; q record; _res jsonb; _income uuid; _desc text;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
  SELECT * INTO s FROM public.smart_qr_submissions WHERE id = _submission_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_society_admin_for(_uid, s.society_id) THEN RETURN jsonb_build_object('status','not_found'); END IF;
  IF NOT public.is_non_member_income_enabled_internal(s.society_id) THEN RETURN jsonb_build_object('status','plan_required'); END IF;
  IF s.status <> 'submitted' THEN RETURN jsonb_build_object('status','already_processed','current', s.status); END IF;

  IF _action = 'reject' THEN
    IF _reason IS NULL OR char_length(btrim(_reason)) < 3 OR char_length(_reason) > 300 THEN
      RETURN jsonb_build_object('status','reason_required');
    END IF;
    UPDATE public.smart_qr_submissions SET status='rejected', review_reason=btrim(_reason), reviewed_by=_uid, reviewed_at=now()
      WHERE id = s.id;
    INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (_uid, 'smart_qr.submission_rejected', 'smart_qr_submissions', s.id::text, s.society_id, jsonb_build_object('reason', btrim(_reason)));
    RETURN jsonb_build_object('status','rejected');
  ELSIF _action = 'record' THEN
    SELECT * INTO q FROM public.smart_qr_codes WHERE id = s.qr_id;
    _desc := left('Smart QR: ' || q.title || ' — ' || s.payer_name || coalesce(' (' || s.payer_phone || ')','') || coalesce(' · ' || s.note,''), 500);
    _res := public.create_non_member_income_record(s.society_id, q.category_id, 'anonymous', NULL, NULL, s.amount,
      s.payment_method, s.paid_on::timestamptz, s.reference_number, _desc, s.id);
    IF _res->>'status' NOT IN ('created','existing') THEN
      RETURN jsonb_build_object('status', coalesce(_res->>'status','temporary_error'));
    END IF;
    _income := (_res->>'id')::uuid;
    UPDATE public.smart_qr_submissions SET status='recorded', income_record_id=_income, reviewed_by=_uid, reviewed_at=now()
      WHERE id = s.id;
    INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (_uid, 'smart_qr.submission_recorded', 'smart_qr_submissions', s.id::text, s.society_id, jsonb_build_object('income_record_id', _income));
    RETURN jsonb_build_object('status','recorded','income_record_id',_income);
  END IF;
  RETURN jsonb_build_object('status','invalid_input');
END $$;

REVOKE ALL ON FUNCTION public.smart_qr_create(text,text,uuid,numeric,text,text,text,text,text,boolean,timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.smart_qr_set_active(uuid,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.smart_qr_review_submission(uuid,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.smart_qr_public_view(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.smart_qr_public_submit(text,text,text,numeric,text,text,date,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.smart_qr_create(text,text,uuid,numeric,text,text,text,text,text,boolean,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.smart_qr_set_active(uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.smart_qr_review_submission(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.smart_qr_public_view(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.smart_qr_public_submit(text,text,text,numeric,text,text,date,text,uuid) TO anon, authenticated, service_role;
