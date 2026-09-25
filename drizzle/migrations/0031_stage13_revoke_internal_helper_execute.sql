-- Stage 13 (#94): internal SECURITY DEFINER helpers must not be callable directly by clients.
-- _billing_audit let any signed-in user forge audit_log rows for any society.
REVOKE EXECUTE ON FUNCTION public._billing_audit(uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._billing_require_admin(uuid) FROM PUBLIC, anon, authenticated;
-- Trigger functions are invoked by the trigger system only.
REVOKE EXECUTE ON FUNCTION public._audit_flat_residents() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._audit_maintenance_periods() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._helpdesk_notify_owner() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.award_points_on_bill_paid() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_support_ticket_user_immutability() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_withdrawal_user_immutability() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.flats_enforce_structure_mode() FROM PUBLIC, anon, authenticated;
-- Signed-out visitors have no reason to evaluate notice visibility.
REVOKE EXECUTE ON FUNCTION public._notice_visible(public.notices) FROM PUBLIC, anon;
-- Server-only internal tables: RLS already locks them; drop unneeded client grants too.
REVOKE ALL ON public.finance_backfill_requests FROM anon, authenticated;
REVOKE ALL ON public.payment_receipt_month_sequences FROM anon, authenticated;