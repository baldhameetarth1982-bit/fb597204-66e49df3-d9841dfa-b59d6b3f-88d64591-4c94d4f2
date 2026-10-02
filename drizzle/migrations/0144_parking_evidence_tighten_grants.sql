REVOKE ALL ON public.parking_violation_evidence FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.parking_violation_evidence FROM authenticated;