
DROP FUNCTION IF EXISTS public.flat_outstanding(uuid);
DROP FUNCTION IF EXISTS public.society_maintenance_summary(uuid);

CREATE FUNCTION public.flat_outstanding(_flat_id uuid)
RETURNS TABLE(pending numeric, overdue_count integer, next_due date)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_society uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT society_id INTO v_society FROM public.flats WHERE id = _flat_id;
  IF v_society IS NULL THEN RAISE EXCEPTION 'Flat not found'; END IF;

  IF NOT (
    public.is_super_admin(v_caller)
    OR public.is_society_admin_for(v_caller, v_society)
    OR EXISTS (
      SELECT 1 FROM public.flat_residents fr
      WHERE fr.flat_id = _flat_id AND fr.user_id = v_caller
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE WHEN b.status IN ('unpaid','overdue') THEN b.amount ELSE 0 END), 0)::numeric AS pending,
    COALESCE(SUM(CASE WHEN b.status = 'overdue' OR (b.status = 'unpaid' AND b.due_date < CURRENT_DATE) THEN 1 ELSE 0 END), 0)::int AS overdue_count,
    MIN(CASE WHEN b.status IN ('unpaid','overdue') THEN b.due_date END) AS next_due
  FROM public.bills b
  WHERE b.flat_id = _flat_id;
END;
$function$;

CREATE FUNCTION public.society_maintenance_summary(_society_id uuid)
RETURNS TABLE(
  total_houses bigint,
  paid_periods bigint,
  pending_periods bigint,
  advance_periods bigint,
  overdue_periods bigint,
  outstanding_amount numeric,
  advance_amount numeric,
  collection_percent numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (
    public.is_super_admin(v_caller)
    OR public.is_society_admin_for(v_caller, _society_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(*) FROM public.flats WHERE society_id = _society_id)::bigint,
    count(*) FILTER (WHERE mp.status = 'paid')::bigint,
    count(*) FILTER (WHERE mp.status = 'pending')::bigint,
    count(*) FILTER (WHERE mp.status = 'advance')::bigint,
    count(*) FILTER (WHERE mp.status = 'overdue' OR (mp.status = 'pending' AND mp.due_date IS NOT NULL AND mp.due_date < CURRENT_DATE))::bigint,
    COALESCE(SUM(CASE WHEN mp.status IN ('pending','overdue') THEN mp.amount_due ELSE 0 END), 0)::numeric,
    COALESCE(SUM(CASE WHEN mp.status = 'advance' THEN mp.amount_due ELSE 0 END), 0)::numeric,
    CASE
      WHEN count(*) = 0 THEN 0::numeric
      ELSE ROUND((count(*) FILTER (WHERE mp.status = 'paid')::numeric * 100.0) / count(*), 2)
    END
  FROM public.maintenance_periods mp
  WHERE mp.society_id = _society_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.flat_outstanding(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.society_maintenance_summary(uuid) TO authenticated;

-- Revoke anon EXECUTE on all public SECURITY DEFINER functions
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon, PUBLIC',
                   r.proname, r.args);
  END LOOP;
END $$;

-- Whitelist intentionally public helpers
GRANT EXECUTE ON FUNCTION public.find_society_by_code(text) TO anon;
GRANT EXECUTE ON FUNCTION public.search_societies_public(text) TO anon;
GRANT EXECUTE ON FUNCTION public.is_razorpay_live() TO anon;
GRANT EXECUTE ON FUNCTION public.get_applicable_plans(integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_pricing_settings() TO anon;

-- Fix storage policy: add WITH CHECK
DROP POLICY IF EXISTS uploads_authenticated_update ON storage.objects;
CREATE POLICY uploads_authenticated_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'uploads' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'uploads' AND owner = auth.uid());
