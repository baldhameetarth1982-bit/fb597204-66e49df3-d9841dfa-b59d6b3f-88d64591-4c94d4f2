
-- ============ WITHDRAWALS ============
DROP POLICY IF EXISTS "users manage own withdrawals" ON public.withdrawals;

CREATE POLICY "users read own withdrawals" ON public.withdrawals
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "users create own withdrawals" ON public.withdrawals
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'pending');

CREATE POLICY "users update own withdrawals" ON public.withdrawals
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'pending')
  WITH CHECK (user_id = auth.uid() AND status = 'pending');

CREATE POLICY "users delete own pending withdrawals" ON public.withdrawals
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND status = 'pending');

CREATE OR REPLACE FUNCTION public.enforce_withdrawal_user_immutability()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF has_role(auth.uid(), 'super_admin'::app_role) THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.method IS DISTINCT FROM OLD.method
     OR NEW.upi_id IS DISTINCT FROM OLD.upi_id
     OR NEW.bank_account IS DISTINCT FROM OLD.bank_account
     OR NEW.bank_ifsc IS DISTINCT FROM OLD.bank_ifsc
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Residents cannot modify withdrawal status, amount, or payout destination';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_withdrawals_user_immutable ON public.withdrawals;
CREATE TRIGGER trg_withdrawals_user_immutable
  BEFORE UPDATE ON public.withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.enforce_withdrawal_user_immutability();

-- ============ SUPPORT TICKETS ============
DROP POLICY IF EXISTS "users manage own tickets" ON public.support_tickets;

CREATE POLICY "users read own tickets" ON public.support_tickets
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "users create own tickets" ON public.support_tickets
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'open');

CREATE POLICY "users update own tickets" ON public.support_tickets
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users delete own tickets" ON public.support_tickets
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND status = 'open');

CREATE OR REPLACE FUNCTION public.enforce_support_ticket_user_immutability()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF has_role(auth.uid(), 'super_admin'::app_role)
     OR (OLD.society_id IS NOT NULL
         AND OLD.society_id IN (SELECT get_admin_society_ids(auth.uid()))) THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.priority IS DISTINCT FROM OLD.priority
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.society_id IS DISTINCT FROM OLD.society_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Residents cannot modify support ticket status, priority, or category';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_tickets_user_immutable ON public.support_tickets;
CREATE TRIGGER trg_support_tickets_user_immutable
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_support_ticket_user_immutability();
