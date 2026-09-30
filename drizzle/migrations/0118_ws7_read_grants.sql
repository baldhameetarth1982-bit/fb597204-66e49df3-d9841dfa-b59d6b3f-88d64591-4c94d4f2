GRANT SELECT ON public.bill_adjustments TO authenticated;
GRANT SELECT ON public.opening_balances TO authenticated;
GRANT SELECT ON public.bill_run_approvals TO authenticated;
GRANT ALL ON public.bill_adjustments, public.opening_balances, public.bill_run_approvals TO service_role;