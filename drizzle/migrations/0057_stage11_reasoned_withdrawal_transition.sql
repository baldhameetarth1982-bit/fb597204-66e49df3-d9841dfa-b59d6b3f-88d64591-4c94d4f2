CREATE OR REPLACE FUNCTION public._withdrawal_guard_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  transition_reason text := btrim(coalesce(current_setting('app.withdrawal_reason', true), ''));
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status <> 'pending' OR NEW.status NOT IN ('paid','rejected') THEN
      RAISE EXCEPTION 'invalid_withdrawal_transition' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_super_admin(auth.uid()) THEN
      RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
    END IF;
    IF char_length(transition_reason) < 5 THEN
      RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.audit_log(actor_id, action, target_table, target_id, metadata)
    VALUES (
      auth.uid(),
      'withdrawal.' || NEW.status,
      'withdrawals',
      NEW.id::text,
      jsonb_build_object('amount', NEW.amount, 'user_id', NEW.user_id, 'reason', left(transition_reason, 300))
    );
  ELSIF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'withdrawal_finalized' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.admin_transition_withdrawal(_withdrawal_id uuid, _status text, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF _status NOT IN ('paid', 'rejected') THEN
    RAISE EXCEPTION 'invalid_withdrawal_transition' USING ERRCODE = '22023';
  END IF;
  IF char_length(btrim(coalesce(_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.withdrawal_reason', left(btrim(_reason), 300), true);
  UPDATE public.withdrawals
  SET status = _status
  WHERE id = _withdrawal_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'withdrawal_not_pending' USING ERRCODE = 'P0002';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public._withdrawal_guard_transition() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_transition_withdrawal(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_transition_withdrawal(uuid, text, text) TO authenticated;
COMMENT ON FUNCTION public.admin_transition_withdrawal(uuid, text, text) IS 'Super-admin-only final payout transition with mandatory audited reason.';