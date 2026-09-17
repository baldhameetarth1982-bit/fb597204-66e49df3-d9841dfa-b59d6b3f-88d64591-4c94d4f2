REVOKE ALL ON FUNCTION public._finance_payment_posting_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._finance_income_posting_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._finance_assert_posted_balance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._finance_prevent_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._finance_protect_lines() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._finance_protect_posted() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._finance_validate_line_scope() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._finance_payment_posting_trigger() TO service_role;
GRANT EXECUTE ON FUNCTION public._finance_income_posting_trigger() TO service_role;
GRANT EXECUTE ON FUNCTION public._finance_assert_posted_balance() TO service_role;
GRANT EXECUTE ON FUNCTION public._finance_prevent_delete() TO service_role;
GRANT EXECUTE ON FUNCTION public._finance_protect_lines() TO service_role;
GRANT EXECUTE ON FUNCTION public._finance_protect_posted() TO service_role;
GRANT EXECUTE ON FUNCTION public._finance_validate_line_scope() TO service_role;

DROP POLICY finance_accounts_admin_read ON public.finance_accounts;
CREATE POLICY finance_accounts_admin_read ON public.finance_accounts FOR SELECT TO authenticated
  USING (public.resolve_financial_visibility(society_id) = 'admin' AND public._finance_plan_enabled(society_id));
DROP POLICY finance_journal_entries_admin_read ON public.finance_journal_entries;
CREATE POLICY finance_journal_entries_admin_read ON public.finance_journal_entries FOR SELECT TO authenticated
  USING (public.resolve_financial_visibility(society_id) = 'admin' AND public._finance_plan_enabled(society_id));
DROP POLICY finance_journal_lines_admin_read ON public.finance_journal_lines;
CREATE POLICY finance_journal_lines_admin_read ON public.finance_journal_lines FOR SELECT TO authenticated
  USING (public.resolve_financial_visibility(society_id) = 'admin' AND public._finance_plan_enabled(society_id));
DROP POLICY finance_vendors_admin_read ON public.finance_vendors;
CREATE POLICY finance_vendors_admin_read ON public.finance_vendors FOR SELECT TO authenticated
  USING (public.resolve_financial_visibility(society_id) = 'admin' AND public._finance_plan_enabled(society_id));
DROP POLICY ledger_entries_admin_read_only ON public.ledger_entries;
CREATE POLICY ledger_entries_admin_read_only ON public.ledger_entries FOR SELECT TO authenticated
  USING (public.resolve_financial_visibility(society_id) = 'admin' AND public._finance_plan_enabled(society_id));