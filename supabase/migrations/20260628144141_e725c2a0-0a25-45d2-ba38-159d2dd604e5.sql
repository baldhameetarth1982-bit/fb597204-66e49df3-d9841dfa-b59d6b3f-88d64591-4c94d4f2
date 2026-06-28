
-- 1. Fix custom_field_values self-write self-join bug + verify society membership
DROP POLICY IF EXISTS cfv_self_write ON public.custom_field_values;
CREATE POLICY cfv_self_write ON public.custom_field_values
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND society_id = public.get_user_society_id(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.custom_fields cf
      WHERE cf.id = custom_field_values.field_id
        AND cf.society_id = custom_field_values.society_id
        AND cf.visibility = 'resident_editable'
    )
  );

-- 2. Tighten profiles admin SELECT policies to authenticated role only
DROP POLICY IF EXISTS "block admins view profiles in their block" ON public.profiles;
DROP POLICY IF EXISTS "society admins view profiles in their society" ON public.profiles;
CREATE POLICY "block admins view profiles in their block" ON public.profiles
  FOR SELECT TO authenticated
  USING (id IN (
    SELECT fr.user_id FROM public.flat_residents fr
    JOIN public.flats f ON f.id = fr.flat_id
    WHERE f.block_id IN (SELECT public.get_admin_block_ids(auth.uid()))
  ));
CREATE POLICY "society admins view profiles in their society" ON public.profiles
  FOR SELECT TO authenticated
  USING (society_id IN (SELECT public.get_admin_society_ids(auth.uid())));

-- 3. Restrict unit_billing_overrides resident SELECT to their own flat only
DROP POLICY IF EXISTS "residents view unit overrides in their society" ON public.unit_billing_overrides;
CREATE POLICY "residents view own unit override" ON public.unit_billing_overrides
  FOR SELECT TO authenticated
  USING (
    flat_id IN (
      SELECT fr.flat_id FROM public.flat_residents fr WHERE fr.user_id = auth.uid()
    )
  );

-- 4. Posts bucket: add society-scoped SELECT policy (bucket now private)
DROP POLICY IF EXISTS "posts society members read" ON storage.objects;
CREATE POLICY "posts society members read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'posts'
    AND EXISTS (
      SELECT 1
      FROM public.profiles me, public.profiles owner
      WHERE me.id = auth.uid()
        AND owner.id::text = (storage.foldername(name))[1]
        AND me.society_id IS NOT NULL
        AND me.society_id = owner.society_id
    )
  );

-- 5. Revoke EXECUTE on internal SECURITY DEFINER helpers from anon + authenticated
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_block_admin(uuid, uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_society_admin_for(uuid, uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_society_id(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_society_ids(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_block_ids(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.find_referrer_by_code(text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_active_society_plan(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_razorpay_live() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.society_has_access(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.authorize_membership(uuid, uuid) FROM anon, authenticated, PUBLIC;

-- Revoke anon EXECUTE on user-facing RPCs (still callable by authenticated)
REVOKE EXECUTE ON FUNCTION public.request_join_flat(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.respond_join_request(uuid, boolean, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_societies_by_name(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_society_flats_public(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_maintenance_period(uuid, date, numeric, date) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_flat_bill(uuid, uuid[], jsonb, date, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_bill(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.find_society_by_code(text) FROM anon, PUBLIC;
