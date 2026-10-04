-- Legacy overload without a reason must not grant plans silently.
CREATE OR REPLACE FUNCTION public.admin_grant_society_plan(_society_id uuid, _plan_id text, _months integer DEFAULT 1, _extend boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.admin_grant_society_plan(uuid, text, integer, boolean) FROM PUBLIC, anon;