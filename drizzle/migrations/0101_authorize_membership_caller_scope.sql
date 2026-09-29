CREATE OR REPLACE FUNCTION public._authorize_membership_internal(_user_id uuid, _society_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _user_id IS NOT NULL AND _society_id IS NOT NULL AND (
    public.is_super_admin(_user_id)
    OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=_user_id AND ur.society_id=_society_id AND ur.is_active AND (
          ur.role <> 'resident'::public.app_role
          OR EXISTS (SELECT 1 FROM public.flat_residents fr JOIN public.flats f ON f.id=fr.flat_id WHERE fr.user_id=_user_id AND f.society_id=_society_id AND fr.is_active AND fr.moved_out_at IS NULL AND (fr.access_expires_at IS NULL OR fr.access_expires_at > now()))
          OR NOT EXISTS (SELECT 1 FROM public.flat_residents fr JOIN public.flats f ON f.id=fr.flat_id WHERE fr.user_id=_user_id AND f.society_id=_society_id)))
    OR EXISTS (SELECT 1 FROM public.flat_residents fr JOIN public.flats f ON f.id=fr.flat_id WHERE fr.user_id=_user_id AND f.society_id=_society_id AND fr.is_active AND fr.moved_out_at IS NULL AND (fr.access_expires_at IS NULL OR fr.access_expires_at > now()))
  );
$$;
REVOKE ALL ON FUNCTION public._authorize_membership_internal(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._authorize_membership_internal(uuid,uuid) TO service_role;

-- Public entry point: a signed-in caller may only ask about themselves,
-- unless they are a super admin or an admin of that society.
CREATE OR REPLACE FUNCTION public.authorize_membership(_user_id uuid, _society_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL AND _user_id IS DISTINCT FROM auth.uid()
         AND NOT (public.is_super_admin(auth.uid()) OR public.is_society_admin_for(auth.uid(), _society_id))
      THEN false
    ELSE public._authorize_membership_internal(_user_id, _society_id)
  END;
$$;

-- Waitlist promotion checks another household on the canceller's behalf; use the internal check.
DO $$
DECLARE r record; d text;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname='cancel_amenity_booking' LOOP
    d := pg_get_functiondef(r.oid);
    IF position('public.authorize_membership(x.user_id' in d) > 0 THEN
      EXECUTE replace(d, 'public.authorize_membership(x.user_id', 'public._authorize_membership_internal(x.user_id');
    END IF;
  END LOOP;
END $$;