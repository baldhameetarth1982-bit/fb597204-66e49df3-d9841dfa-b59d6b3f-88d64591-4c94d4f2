CREATE OR REPLACE FUNCTION public._finance_income_posting_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_journal uuid;
  v_original uuid;
  v_income_account text;
BEGIN
  IF NOT public._finance_plan_enabled(NEW.society_id) THEN
    RETURN NEW;
  END IF;
  IF NEW.verification_status IN ('verified', 'reversed') AND OLD.verification_status IS DISTINCT FROM NEW.verification_status THEN
    v_income_account := CASE
      WHEN NEW.payment_method = 'cash' THEN 'cash'
      WHEN NEW.payment_method = 'bank_transfer' THEN 'bank'
      ELSE NULL
    END;
    IF v_income_account IS NULL THEN
      RAISE EXCEPTION 'unsupported_payment_method' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NEW.verification_status = 'verified' AND OLD.verification_status IS DISTINCT FROM 'verified' THEN
    v_journal := public._finance_post_entry(
      NEW.society_id, COALESCE(NEW.verified_by, auth.uid()),
      COALESCE(NEW.payment_date::date, NEW.verified_at::date, CURRENT_DATE),
      'Society income', NEW.reference_number, 'income', NEW.id, 'post',
      v_income_account, 'other_income', NEW.amount, NULL
    );
    NEW.journal_entry_id := v_journal;
  ELSIF NEW.verification_status = 'reversed' AND OLD.verification_status = 'verified' THEN
    v_original := COALESCE(OLD.journal_entry_id, NEW.journal_entry_id);
    IF v_original IS NULL THEN
      RAISE EXCEPTION 'journal_missing' USING ERRCODE = '55000';
    END IF;
    v_journal := public._finance_post_entry(
      NEW.society_id, COALESCE(NEW.reversed_by, auth.uid()),
      COALESCE(NEW.reversed_at::date, CURRENT_DATE),
      'Reversal: society income', NEW.reference_number, 'income_reversal', NEW.id, 'reverse',
      'other_income', v_income_account, NEW.amount, v_original
    );
    NEW.reversal_journal_entry_id := v_journal;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public._finance_income_posting_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._finance_income_posting_trigger() TO service_role;

CREATE OR REPLACE FUNCTION public._finance_payment_posting_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_journal uuid;
  v_original uuid;
  v_cash_account text;
BEGIN
  IF NOT public._finance_plan_enabled(NEW.society_id) THEN
    RETURN NEW;
  END IF;
  IF NEW.status IN ('verified', 'reversed') AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_cash_account := CASE
      WHEN NEW.method = 'cash' THEN 'cash'
      WHEN NEW.method = 'bank_transfer' THEN 'bank'
      ELSE NULL
    END;
    IF v_cash_account IS NULL THEN
      RAISE EXCEPTION 'unsupported_payment_method' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NEW.status = 'verified' AND OLD.status IS DISTINCT FROM 'verified' THEN
    v_journal := public._finance_post_entry(
      NEW.society_id, COALESCE(NEW.verified_by, auth.uid()),
      COALESCE(NEW.payment_date, NEW.paid_at::date, NEW.verified_at::date, CURRENT_DATE),
      'Maintenance payment', NEW.reference_no, 'payment', NEW.id, 'post',
      v_cash_account, 'maintenance_income', NEW.amount, NULL
    );
    NEW.journal_entry_id := v_journal;
  ELSIF NEW.status = 'reversed' AND OLD.status = 'verified' THEN
    v_original := COALESCE(OLD.journal_entry_id, NEW.journal_entry_id);
    IF v_original IS NULL THEN
      RAISE EXCEPTION 'journal_missing' USING ERRCODE = '55000';
    END IF;
    v_journal := public._finance_post_entry(
      NEW.society_id, COALESCE(NEW.reversed_by, auth.uid()),
      COALESCE(NEW.reversed_at::date, CURRENT_DATE),
      'Reversal: maintenance payment', NEW.reference_no, 'payment_reversal', NEW.id, 'reverse',
      'maintenance_income', v_cash_account, NEW.amount, v_original
    );
    NEW.reversal_journal_entry_id := v_journal;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public._finance_payment_posting_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._finance_payment_posting_trigger() TO service_role;