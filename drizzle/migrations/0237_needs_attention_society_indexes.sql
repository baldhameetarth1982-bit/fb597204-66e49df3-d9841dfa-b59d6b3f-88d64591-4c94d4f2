CREATE INDEX IF NOT EXISTS security_incidents_society_status_idx ON public.security_incidents (society_id, status);
CREATE INDEX IF NOT EXISTS privacy_requests_society_status_idx ON public.privacy_requests (society_id, status);
CREATE INDEX IF NOT EXISTS bill_run_approvals_society_status_idx ON public.bill_run_approvals (society_id, status);