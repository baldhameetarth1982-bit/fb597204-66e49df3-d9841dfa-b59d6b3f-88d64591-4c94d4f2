CREATE OR REPLACE FUNCTION public._payments_require_nonblank_reason()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected'
     AND (NEW.rejection_reason IS NULL OR NEW.rejection_reason !~ '[^[:space:]]') THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  IF NEW.status = 'reversed' AND OLD.status IS DISTINCT FROM 'reversed'
     AND (NEW.reversal_reason IS NULL OR NEW.reversal_reason !~ '[^[:space:]]') THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public._payments_require_nonblank_reason() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_payments_require_nonblank_reason ON public.payments;
CREATE TRIGGER trg_payments_require_nonblank_reason
  BEFORE UPDATE OF status ON public.payments
  FOR EACH ROW
  WHEN (NEW.status IN ('rejected', 'reversed'))
  EXECUTE FUNCTION public._payments_require_nonblank_reason();