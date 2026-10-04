CREATE OR REPLACE FUNCTION public._payment_status_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE amt text; who uuid; lnk text;
BEGIN
  -- Online (Razorpay) payments are notified by finalize_maintenance_online_payment.
  IF NEW.razorpay_payment_id IS NOT NULL OR NEW.razorpay_order_id IS NOT NULL THEN RETURN NEW; END IF;
  amt := '₹' || to_char(NEW.amount, 'FM99,99,99,990.00');
  who := COALESCE(NEW.user_id, NEW.submitted_by);
  lnk := CASE WHEN NEW.bill_id IS NOT NULL THEN '/app/bills/' || NEW.bill_id ELSE '/app/bills' END;

  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    PERFORM public._notify_society_admins_once(NEW.society_id, 'payment', 'Payment to verify',
      amt || ' ' || replace(coalesce(NEW.method,'payment'),'_',' ') || ' payment is waiting for verification.',
      '/society/verifications', 'payment:' || NEW.id || ':submitted', 'normal');
    RETURN NEW;
  END IF;

  IF who IS NULL OR (TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status) THEN RETURN NEW; END IF;
  IF NEW.status = 'verified' THEN
    PERFORM public._notify_user_once(who, NEW.society_id, 'payment', 'Payment verified',
      'Your ' || amt || ' payment was verified. Your receipt is ready.', lnk, 'payment:' || NEW.id || ':verified', 'normal');
  ELSIF NEW.status = 'rejected' THEN
    PERFORM public._notify_user_once(who, NEW.society_id, 'payment', 'Payment not accepted',
      'Your ' || amt || ' payment was not accepted: ' || left(coalesce(NEW.rejection_reason,'see details'), 160), lnk,
      'payment:' || NEW.id || ':rejected', 'high');
  ELSIF NEW.status = 'reversed' THEN
    PERFORM public._notify_user_once(who, NEW.society_id, 'payment', 'Payment reversed',
      'Your ' || amt || ' payment was reversed: ' || left(coalesce(NEW.reversal_reason,'see details'), 160), lnk,
      'payment:' || NEW.id || ':reversed', 'high');
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A notification failure must never block a financial transition.
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._payment_status_notify() FROM PUBLIC, anon, authenticated;