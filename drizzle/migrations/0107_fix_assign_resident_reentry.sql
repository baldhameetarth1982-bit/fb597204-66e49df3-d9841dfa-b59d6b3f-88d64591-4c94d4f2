CREATE OR REPLACE FUNCTION public.admin_assign_resident_to_flat(_flat_id uuid, _user_id uuid, _relationship text DEFAULT 'owner'::text, _is_primary boolean DEFAULT false, _lease_starts_on date DEFAULT NULL::date, _lease_ends_on date DEFAULT NULL::date)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_caller uuid:=auth.uid(); v_society uuid; v_user_society uuid; v_id uuid; v_prev uuid;
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
  PERFORM pg_advisory_xact_lock(hashtext('flat_resident:'||_flat_id::text||':'||_user_id::text));
  IF EXISTS (SELECT 1 FROM public.flat_residents WHERE flat_id=_flat_id AND user_id=_user_id AND is_active) THEN
    RAISE EXCEPTION 'duplicate_active_assignment' USING ERRCODE='23505';
  END IF;
  SELECT id INTO v_prev FROM public.flat_residents WHERE flat_id=_flat_id AND user_id=_user_id ORDER BY coalesce(moved_out_at,moved_in_at) DESC NULLS LAST LIMIT 1;
  INSERT INTO public.flat_residents(flat_id,user_id,relationship,is_primary,is_active,moved_in_at,lease_starts_on,lease_ends_on,access_expires_at)
  VALUES(_flat_id,_user_id,_relationship,coalesce(_is_primary,false) OR NOT EXISTS(SELECT 1 FROM public.flat_residents WHERE flat_id=_flat_id AND is_active),true,
    coalesce(_lease_starts_on,current_date),_lease_starts_on,_lease_ends_on,CASE WHEN _lease_ends_on IS NULL THEN NULL ELSE (_lease_ends_on+1)::timestamp AT TIME ZONE 'Asia/Kolkata' END)
  RETURNING id INTO v_id;
  INSERT INTO public.audit_log(actor_id,society_id,target_table,target_id,action,metadata)
  VALUES(v_caller,v_society,'flat_residents',v_id,CASE WHEN v_prev IS NULL THEN 'assign' ELSE 'resident.returned' END,
    jsonb_build_object('user_id',_user_id,'flat_id',_flat_id,'relationship',_relationship,'lease_ends_on',_lease_ends_on,'previous_record',v_prev));
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_assign_resident_to_flat(uuid, uuid, text, boolean, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_resident_to_flat(uuid, uuid, text, boolean, date, date) TO authenticated;