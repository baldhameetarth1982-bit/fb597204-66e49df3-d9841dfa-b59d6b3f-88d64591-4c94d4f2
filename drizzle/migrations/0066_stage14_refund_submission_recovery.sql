CREATE OR REPLACE FUNCTION public.record_saas_subscription_refund_submission(
  _refund_record_id uuid,
  _provider_refund_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF _provider_refund_id !~ '^rfnd_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'invalid_provider_reference' USING ERRCODE = '22023';
  END IF;
  UPDATE public.saas_subscription_refunds
     SET provider_refund_id = COALESCE(provider_refund_id, _provider_refund_id),
         status = 'submitted', failure_code = NULL
   WHERE id = _refund_record_id
     AND status IN ('requested','submitted')
     AND (provider_refund_id IS NULL OR provider_refund_id = _provider_refund_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_submission_conflict' USING ERRCODE = '23505';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.record_saas_subscription_refund_submission(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_saas_subscription_refund_submission(uuid,text) TO service_role;