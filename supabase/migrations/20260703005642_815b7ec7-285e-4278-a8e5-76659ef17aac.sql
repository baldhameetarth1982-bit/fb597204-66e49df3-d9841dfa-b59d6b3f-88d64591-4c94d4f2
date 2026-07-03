
-- 1. Revoke column-level SELECT on sensitive society fields from residents
REVOKE SELECT (business_pan, business_gstin, razorpay_account_id, payout_bank_last4, payout_holder_name)
  ON public.societies FROM authenticated;

-- Admin-only RPC to read the full business/payout profile
CREATE OR REPLACE FUNCTION public.get_society_business_profile(_society_id uuid)
RETURNS TABLE(
  id uuid,
  name text,
  legal_business_name text,
  business_address text,
  business_city text,
  business_state text,
  business_pincode text,
  business_gstin text,
  business_pan text,
  payout_status text,
  payout_bank_last4 text,
  payout_holder_name text,
  razorpay_account_id text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.name, s.legal_business_name, s.business_address, s.business_city,
         s.business_state, s.business_pincode, s.business_gstin, s.business_pan,
         s.payout_status, s.payout_bank_last4, s.payout_holder_name, s.razorpay_account_id
  FROM public.societies s
  WHERE s.id = _society_id
    AND (public.is_society_admin_for(auth.uid(), _society_id) OR public.is_super_admin(auth.uid()));
$$;

REVOKE EXECUTE ON FUNCTION public.get_society_business_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_society_business_profile(uuid) TO authenticated;

-- 2. Tighten user_roles society-admin policy
DROP POLICY IF EXISTS "society admins manage roles in their society" ON public.user_roles;

CREATE POLICY "society admins insert roles in their society"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
  society_id IS NOT NULL
  AND public.is_society_admin_for(auth.uid(), society_id)
  AND role = ANY (ARRAY['resident'::public.app_role, 'block_admin'::public.app_role, 'security'::public.app_role])
  AND user_id <> auth.uid()
);

CREATE POLICY "society admins update roles in their society"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (
  society_id IS NOT NULL
  AND public.is_society_admin_for(auth.uid(), society_id)
  AND role = ANY (ARRAY['resident'::public.app_role, 'block_admin'::public.app_role, 'security'::public.app_role])
  AND user_id <> auth.uid()
)
WITH CHECK (
  society_id IS NOT NULL
  AND public.is_society_admin_for(auth.uid(), society_id)
  AND role = ANY (ARRAY['resident'::public.app_role, 'block_admin'::public.app_role, 'security'::public.app_role])
  AND user_id <> auth.uid()
);

CREATE POLICY "society admins delete roles in their society"
ON public.user_roles
FOR DELETE
TO authenticated
USING (
  society_id IS NOT NULL
  AND public.is_society_admin_for(auth.uid(), society_id)
  AND role = ANY (ARRAY['resident'::public.app_role, 'block_admin'::public.app_role, 'security'::public.app_role])
  AND user_id <> auth.uid()
);
