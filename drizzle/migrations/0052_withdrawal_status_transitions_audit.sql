CREATE OR REPLACE FUNCTION public._withdrawal_guard_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status <> 'pending' OR NEW.status NOT IN ('paid','rejected') THEN
      RAISE EXCEPTION 'invalid_withdrawal_transition' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_super_admin(auth.uid()) THEN
      RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.audit_log(actor_id, action, target_table, target_id, metadata)
    VALUES (auth.uid(), 'withdrawal.' || NEW.status, 'withdrawals', NEW.id::text,
            jsonb_build_object('amount', NEW.amount, 'user_id', NEW.user_id));
  ELSIF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'withdrawal_finalized' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS withdrawal_guard_transition ON public.withdrawals;
CREATE TRIGGER withdrawal_guard_transition BEFORE UPDATE ON public.withdrawals
FOR EACH ROW EXECUTE FUNCTION public._withdrawal_guard_transition();