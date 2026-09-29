CREATE OR REPLACE FUNCTION public._protect_profile_society_selection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.society_id IS DISTINCT FROM OLD.society_id AND auth.uid() IS NOT NULL THEN
    IF auth.uid() <> OLD.id OR NEW.society_id IS NULL OR NOT public.authorize_membership(auth.uid(),NEW.society_id) THEN
      RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
    END IF;
    INSERT INTO public.audit_log(actor_id,society_id,target_table,target_id,action,metadata)
    VALUES(auth.uid(),NEW.society_id,'profiles',NEW.id,'session.society_switched',jsonb_build_object('from_society_id',OLD.society_id,'to_society_id',NEW.society_id));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_profile_society_selection ON public.profiles;
CREATE TRIGGER trg_protect_profile_society_selection BEFORE UPDATE OF society_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public._protect_profile_society_selection();

CREATE OR REPLACE FUNCTION public.switch_active_society(_society_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_uid uuid:=auth.uid(); v_from uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  IF NOT public.authorize_membership(v_uid,_society_id) OR NOT public.society_has_access(_society_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF NOT public._rate_hit('society_switch',v_uid::text,30,interval '1 hour') THEN RAISE EXCEPTION 'rate_limited'; END IF;
  SELECT society_id INTO v_from FROM public.profiles WHERE id=v_uid FOR UPDATE;
  IF v_from IS NOT DISTINCT FROM _society_id THEN RETURN; END IF;
  UPDATE public.profiles SET society_id=_society_id,updated_at=now() WHERE id=v_uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_assign_resident_to_flat(
  _flat_id uuid,_user_id uuid,_relationship text DEFAULT 'owner',_is_primary boolean DEFAULT false,
  _lease_starts_on date DEFAULT NULL,_lease_ends_on date DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_caller uuid:=auth.uid(); v_society uuid; v_user_society uuid; v_id uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  IF _relationship NOT IN ('owner','tenant','family') THEN RAISE EXCEPTION 'invalid_relationship' USING ERRCODE='22023'; END IF;
  IF _relationship<>'tenant' AND (_lease_starts_on IS NOT NULL OR _lease_ends_on IS NOT NULL) THEN RAISE EXCEPTION 'lease_only_for_tenant' USING ERRCODE='22023'; END IF;
  IF _lease_starts_on IS NOT NULL AND _lease_ends_on IS NOT NULL AND _lease_ends_on<_lease_starts_on THEN RAISE EXCEPTION 'invalid_lease_dates' USING ERRCODE='22023'; END IF;
  SELECT society_id INTO v_society FROM public.flats WHERE id=_flat_id;
  IF v_society IS NULL THEN RAISE EXCEPTION 'flat_not_found' USING ERRCODE='22023'; END IF;
  IF NOT (public.current_user_has_society_permission(v_society,'residents.manage',NULL) OR public.is_super_admin(v_caller)) THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  SELECT society_id INTO v_user_society FROM public.profiles WHERE id=_user_id;
  IF v_user_society IS NULL OR v_user_society<>v_society THEN RAISE EXCEPTION 'resident_not_in_society' USING ERRCODE='22023'; END IF;
  INSERT INTO public.flat_residents(flat_id,user_id,relationship,is_primary,is_active,moved_in_at,lease_starts_on,lease_ends_on,access_expires_at)
  VALUES(_flat_id,_user_id,_relationship,coalesce(_is_primary,false) OR NOT EXISTS(SELECT 1 FROM public.flat_residents WHERE flat_id=_flat_id AND is_active),true,
    coalesce(_lease_starts_on,current_date),_lease_starts_on,_lease_ends_on,CASE WHEN _lease_ends_on IS NULL THEN NULL ELSE (_lease_ends_on+1)::timestamp AT TIME ZONE 'Asia/Kolkata' END)
  ON CONFLICT(flat_id,user_id) DO UPDATE SET relationship=EXCLUDED.relationship,is_primary=public.flat_residents.is_primary OR EXCLUDED.is_primary,
    is_active=true,moved_out_at=NULL,ended_reason=NULL,termination_kind=NULL,lease_starts_on=EXCLUDED.lease_starts_on,
    lease_ends_on=EXCLUDED.lease_ends_on,access_expires_at=EXCLUDED.access_expires_at
  RETURNING id INTO v_id;
  INSERT INTO public.audit_log(actor_id,society_id,target_table,target_id,action,metadata)
  VALUES(v_caller,v_society,'flat_residents',v_id,'assign',jsonb_build_object('user_id',_user_id,'flat_id',_flat_id,'relationship',_relationship,'lease_ends_on',_lease_ends_on));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_resident_private_detail(_society_id uuid,_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_profile jsonb; v_relations jsonb; v_family jsonb; v_vehicles jsonb;
BEGIN
  IF NOT public.current_user_has_society_permission(_society_id,'residents.private_detail',NULL) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT to_jsonb(p) INTO v_profile FROM (SELECT id,full_name,email,phone,avatar_url,property_number,ugvcl_number,share_certificate_number,move_in_date,aadhaar_verified,is_offline,society_id FROM public.profiles WHERE id=_user_id AND society_id=_society_id) p;
  IF v_profile IS NULL THEN RETURN NULL; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.is_active DESC,r.moved_in_at DESC NULLS LAST),'[]'::jsonb) INTO v_relations FROM (
    SELECT fr.id,fr.flat_id,f.flat_number,b.name AS block_name,fr.relationship,fr.is_active,fr.is_primary,fr.moved_in_at,fr.moved_out_at,fr.ended_reason,fr.created_at,
      fr.lease_starts_on,fr.lease_ends_on,fr.notice_given_on,fr.termination_kind,fr.access_expires_at
    FROM public.flat_residents fr JOIN public.flats f ON f.id=fr.flat_id AND f.society_id=_society_id LEFT JOIN public.blocks b ON b.id=f.block_id WHERE fr.user_id=_user_id) r;
  SELECT coalesce(jsonb_agg(to_jsonb(fm) ORDER BY fm.created_at),'[]'::jsonb) INTO v_family FROM (SELECT id,full_name,relation,phone,age,created_at FROM public.family_members WHERE user_id=_user_id) fm;
  SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.created_at DESC),'[]'::jsonb) INTO v_vehicles FROM (SELECT id,plate_number,type,make_model,color,flat_id,created_at FROM public.vehicles WHERE user_id=_user_id AND society_id=_society_id) v;
  RETURN jsonb_build_object('profile',v_profile,'relationships',v_relations,'family',v_family,'vehicles',v_vehicles);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_current_auth_context()
RETURNS TABLE(profile jsonb,roles jsonb,primary_role text,society_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_user uuid:=auth.uid();v_society uuid;v_primary text;v_roles jsonb;v_profile jsonb;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
 SELECT CASE WHEN p.society_id IS NOT NULL AND public.authorize_membership(v_user,p.society_id) THEN p.society_id ELSE (
   SELECT ur.society_id FROM public.user_roles ur WHERE ur.user_id=v_user AND ur.is_active AND ur.society_id IS NOT NULL
   ORDER BY CASE ur.role WHEN 'society_admin'::public.app_role THEN 1 WHEN 'resident'::public.app_role THEN 2 WHEN 'block_admin'::public.app_role THEN 3 WHEN 'security'::public.app_role THEN 4 ELSE 9 END,ur.created_at LIMIT 1) END
 INTO v_society FROM public.profiles p WHERE p.id=v_user;
 SELECT coalesce(jsonb_agg(jsonb_build_object('role',ur.role,'society_id',ur.society_id,'block_id',ur.block_id) ORDER BY ur.created_at),'[]'::jsonb)
 INTO v_roles FROM public.user_roles ur WHERE ur.user_id=v_user AND ur.is_active AND (ur.role='super_admin' OR ur.society_id=v_society);
 SELECT CASE WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=v_user AND is_active AND role='super_admin') THEN 'super_admin'
   WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=v_user AND is_active AND role='society_admin' AND society_id=v_society) THEN 'society_admin'
   WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=v_user AND is_active AND role='resident' AND society_id=v_society) THEN 'resident'
   WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=v_user AND is_active AND role='block_admin' AND society_id=v_society) THEN 'block_admin'
   WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=v_user AND is_active AND role='security' AND society_id=v_society) THEN 'security' ELSE NULL END INTO v_primary;
 SELECT to_jsonb(p)||jsonb_build_object('society_id',v_society) INTO v_profile FROM public.profiles p WHERE p.id=v_user;
 RETURN QUERY SELECT v_profile,v_roles,v_primary,v_society;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_assign_resident_to_flat(uuid,uuid,text,boolean,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_resident_to_flat(uuid,uuid,text,boolean,date,date) TO authenticated,service_role;