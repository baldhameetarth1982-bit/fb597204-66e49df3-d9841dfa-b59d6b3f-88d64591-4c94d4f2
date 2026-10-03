CREATE TABLE public.petty_cash_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('top_up','spend','reversal')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0 AND amount <= 100000),
  purpose text NOT NULL CHECK (char_length(purpose) BETWEEN 3 AND 200),
  voucher_no text CHECK (voucher_no IS NULL OR char_length(voucher_no) <= 40),
  paid_to text CHECK (paid_to IS NULL OR char_length(paid_to) <= 80),
  reverses uuid REFERENCES public.petty_cash_entries(id),
  balance_after numeric(12,2) NOT NULL,
  request_id uuid NOT NULL,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (society_id, request_id)
);
CREATE UNIQUE INDEX petty_cash_one_reversal ON public.petty_cash_entries(reverses) WHERE reverses IS NOT NULL;
CREATE INDEX petty_cash_society ON public.petty_cash_entries(society_id, created_at DESC);
COMMENT ON TABLE public.petty_cash_entries IS 'Petty cash imprest register (reference record). Not part of the cash-basis journal; spends are booked to accounts via the normal expense flow.';
GRANT SELECT ON public.petty_cash_entries TO authenticated;
GRANT ALL ON public.petty_cash_entries TO service_role;
ALTER TABLE public.petty_cash_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance readers read petty cash" ON public.petty_cash_entries FOR SELECT TO authenticated
  USING (public._finance_reader_for(society_id));
CREATE TRIGGER petty_cash_append_only BEFORE UPDATE OR DELETE ON public.petty_cash_entries
  FOR EACH ROW EXECUTE FUNCTION public._append_only();

CREATE OR REPLACE FUNCTION public.admin_petty_cash_entry(_society_id uuid, _kind text, _amount numeric, _entry_date date, _purpose text, _voucher_no text, _paid_to text, _reverses uuid, _request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bal numeric; _new numeric; _orig public.petty_cash_entries; _id uuid; _existing public.petty_cash_entries;
BEGIN
  PERFORM public._finance_require_admin(_society_id);
  IF _request_id IS NULL THEN RAISE EXCEPTION 'Missing request id'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('petty_cash:' || _society_id::text));
  SELECT * INTO _existing FROM petty_cash_entries WHERE society_id=_society_id AND request_id=_request_id;
  IF FOUND THEN RETURN jsonb_build_object('id', _existing.id, 'balance', _existing.balance_after, 'duplicate', true); END IF;
  SELECT COALESCE((SELECT balance_after FROM petty_cash_entries WHERE society_id=_society_id ORDER BY created_at DESC, id DESC LIMIT 1),0) INTO _bal;
  IF _kind = 'reversal' THEN
    SELECT * INTO _orig FROM petty_cash_entries WHERE id=_reverses AND society_id=_society_id;
    IF NOT FOUND OR _orig.kind = 'reversal' THEN RAISE EXCEPTION 'Entry to reverse not found'; END IF;
    IF EXISTS (SELECT 1 FROM petty_cash_entries WHERE reverses=_reverses) THEN RAISE EXCEPTION 'Entry already reversed'; END IF;
    _amount := _orig.amount;
    _new := CASE WHEN _orig.kind='spend' THEN _bal + _amount ELSE _bal - _amount END;
    _purpose := 'Reversal: ' || COALESCE(NULLIF(trim(_purpose),''), 'correction');
  ELSIF _kind IN ('top_up','spend') THEN
    _reverses := NULL;
    IF _amount IS NULL OR _amount <= 0 OR round(_amount,2) <> _amount THEN RAISE EXCEPTION 'Enter a valid amount'; END IF;
    IF _entry_date IS NULL OR _entry_date > current_date THEN RAISE EXCEPTION 'Date cannot be in the future'; END IF;
    _new := CASE WHEN _kind='top_up' THEN _bal + _amount ELSE _bal - _amount END;
  ELSE RAISE EXCEPTION 'Invalid entry type'; END IF;
  IF _new < 0 THEN RAISE EXCEPTION 'Not enough petty cash (balance ₹%)', _bal; END IF;
  INSERT INTO petty_cash_entries(society_id, entry_date, kind, amount, purpose, voucher_no, paid_to, reverses, balance_after, request_id, recorded_by)
  VALUES (_society_id, COALESCE(_entry_date, current_date), _kind, _amount, left(trim(_purpose),200), NULLIF(trim(_voucher_no),''), NULLIF(trim(_paid_to),''), _reverses, _new, _request_id, auth.uid())
  RETURNING id INTO _id;
  INSERT INTO audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'petty_cash.' || _kind, 'petty_cash_entries', _id::text, _society_id, jsonb_build_object('amount', _amount, 'balance', _new, 'reverses', _reverses));
  RETURN jsonb_build_object('id', _id, 'balance', _new, 'duplicate', false);
END $$;
REVOKE ALL ON FUNCTION public.admin_petty_cash_entry(uuid,text,numeric,date,text,text,text,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_petty_cash_entry(uuid,text,numeric,date,text,text,text,uuid,uuid) TO authenticated;