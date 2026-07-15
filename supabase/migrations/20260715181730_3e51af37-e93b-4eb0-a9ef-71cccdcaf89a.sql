-- Turn 18B.2B: entitlement helper privacy + exact plan parity + trial-expiry fix.
-- Additive migration; no data changes, no seeds, no backfills.

-- 1) Rewrite the internal entitlement helper to (a) mirror normalizePlan()
--    aliases exactly, and (b) require a non-expired trial_ends_at for trial
--    status. Reject plan_id='trial' unless plan_status is also trial/trialing.
CREATE OR REPLACE FUNCTION public.is_non_member_income_enabled_internal(_society_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan text;
  v_status text;
  v_trial_ends timestamptz;
BEGIN
  IF _society_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT lower(btrim(coalesce(plan_id, ''))),
         lower(btrim(coalesce(plan_status, ''))),
         trial_ends_at
    INTO v_plan, v_status, v_trial_ends
    FROM public.societies
    WHERE id = _society_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Explicit inactive statuses collapse to Basic (denied). Mirrors normalizePlan().
  IF v_status IN ('expired','cancelled','canceled','past_due','inactive') THEN
    RETURN false;
  END IF;

  -- Active trial: status must be trial/trialing AND (no expiry set OR expiry in future).
  -- normalizePlan() maps this to Premium; an expired trial must NOT retain access.
  IF v_status IN ('trial','trialing') THEN
    IF v_trial_ends IS NULL OR v_trial_ends > now() THEN
      RETURN true;
    END IF;
    RETURN false;
  END IF;

  -- plan_id='trial' independently is NOT sufficient without an active trial status.
  -- (Turn 18B.2A allowed this and could leak Premium to stale trial rows.)

  -- Canonical Pro/Premium alias set, matching normalizePlan() exactly.
  IF v_plan IN ('pro','standard','growth','premium','business','enterprise') THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- 2) Revoke ALL caller-facing execute on the helper. It is only reachable
--    through the transition RPC, which runs SECURITY DEFINER as the function
--    owner (postgres) and therefore retains execute privilege on the helper.
REVOKE ALL ON FUNCTION public.is_non_member_income_enabled_internal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_non_member_income_enabled_internal(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_non_member_income_enabled_internal(uuid) FROM authenticated;

COMMENT ON FUNCTION public.is_non_member_income_enabled_internal(uuid)
  IS 'Turn 18B.2B: internal Pro/Premium entitlement gate. Not callable by anon, authenticated, or PUBLIC — invoked only inside the transition RPC via SECURITY DEFINER owner. Mirrors normalizePlan() aliases and requires an active, non-expired trial for trial-status entitlement.';
