-- Allow returning to the same flat: history rows kept, only one active row per person+flat.
CREATE UNIQUE INDEX IF NOT EXISTS ux_flat_residents_one_active_per_person
  ON public.flat_residents (flat_id, user_id) WHERE is_active;
ALTER TABLE public.flat_residents DROP CONSTRAINT IF EXISTS flat_residents_flat_id_user_id_key;

-- Retire the legacy 4-arg overload (relied on the old unique key).
REVOKE ALL ON FUNCTION public.admin_assign_resident_to_flat(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;

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
  INSERT INTO public.flat_residents(flat_id,user_id,relationship,is_primary,is_active,moved_in_at,lease_starts_on,lease_ends_on,access_expires_at,renewed_from)
  VALUES(_flat_id,_user_id,_relationship,coalesce(_is_primary,false) OR NOT EXISTS(SELECT 1 FROM public.flat_residents WHERE flat_id=_flat_id AND is_active),true,
    coalesce(_lease_starts_on,current_date),_lease_starts_on,_lease_ends_on,CASE WHEN _lease_ends_on IS NULL THEN NULL ELSE (_lease_ends_on+1)::timestamp AT TIME ZONE 'Asia/Kolkata' END,NULL)
  RETURNING id INTO v_id;
  INSERT INTO public.audit_log(actor_id,society_id,target_table,target_id,action,metadata)
  VALUES(v_caller,v_society,'flat_residents',v_id,CASE WHEN v_prev IS NULL THEN 'assign' ELSE 'resident.returned' END,
    jsonb_build_object('user_id',_user_id,'flat_id',_flat_id,'relationship',_relationship,'lease_ends_on',_lease_ends_on,'previous_record',v_prev));
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_assign_resident_to_flat(uuid, uuid, text, boolean, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_resident_to_flat(uuid, uuid, text, boolean, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_resident_to_unit(_society_id uuid, _user_id uuid, _flat_id uuid, _relationship text, _is_primary boolean DEFAULT false, _moved_in_at timestamp with time zone DEFAULT now())
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_flat_society uuid; v_flat_active boolean; v_new_id uuid;
BEGIN
  IF NOT public.current_user_has_society_permission(_society_id,'residents.manage',NULL) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _relationship NOT IN ('owner','co-owner','tenant','resident','family') THEN RAISE EXCEPTION 'invalid_relationship'; END IF;
  SELECT f.society_id, coalesce(f.is_active,true) INTO v_flat_society, v_flat_active FROM public.flats f WHERE f.id=_flat_id;
  IF v_flat_society IS NULL OR v_flat_society <> _society_id THEN RAISE EXCEPTION 'unit_not_in_society'; END IF;
  IF NOT v_flat_active THEN RAISE EXCEPTION 'unit_inactive'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=_user_id AND p.society_id=_society_id) THEN
    RAISE EXCEPTION 'resident_not_in_society';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('flat_resident:'||_flat_id::text||':'||_user_id::text));
  IF EXISTS (SELECT 1 FROM public.flat_residents fr WHERE fr.flat_id=_flat_id AND fr.user_id=_user_id AND fr.is_active) THEN
    RAISE EXCEPTION 'duplicate_active_assignment';
  END IF;
  IF _is_primary THEN
    UPDATE public.flat_residents fr SET is_primary=false
      FROM public.flats f
     WHERE f.id=fr.flat_id AND f.society_id=_society_id AND fr.user_id=_user_id AND fr.is_primary;
  END IF;
  INSERT INTO public.flat_residents(flat_id,user_id,relationship,is_primary,is_active,moved_in_at)
    VALUES (_flat_id,_user_id,_relationship,coalesce(_is_primary,false),true,coalesce(_moved_in_at,now()))
    RETURNING id INTO v_new_id;
  INSERT INTO public.audit_log(actor_id,society_id,target_table,target_id,action,metadata)
    VALUES (auth.uid(),_society_id,'flat_residents',v_new_id,'assign',
            jsonb_build_object('user_id',_user_id,'flat_id',_flat_id,'relationship',_relationship));
  RETURN v_new_id;
END; $function$;
REVOKE ALL ON FUNCTION public.assign_resident_to_unit(uuid, uuid, uuid, text, boolean, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_resident_to_unit(uuid, uuid, uuid, text, boolean, timestamptz) TO authenticated;

-- Legacy "End relationship": administrative correction only. Never a move-out; never bypasses dues.
CREATE OR REPLACE FUNCTION public.end_resident_unit_relationship(_society_id uuid, _flat_resident_id uuid, _moved_out_at timestamp with time zone DEFAULT now(), _reason text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v public.flat_residents%ROWTYPE;
  v_row_society uuid;
  v_reason text := nullif(btrim(coalesce(_reason,'')),'');
  v_nd jsonb;
BEGIN
  v_row_society := public._tenancy_row_society(_flat_resident_id);
  IF v_row_society IS NULL OR v_row_society <> _society_id
     OR NOT public.current_user_has_society_permission(v_row_society,'residents.manage',NULL) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 10 THEN RAISE EXCEPTION 'correction_reason_required' USING ERRCODE='22023'; END IF;
  IF length(v_reason) > 300 THEN RAISE EXCEPTION 'reason_too_long' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('tenancy_change',auth.uid()::text,60,interval '10 minutes');
  SELECT * INTO v FROM public.flat_residents WHERE id=_flat_resident_id FOR UPDATE;
  IF NOT v.is_active THEN RAISE EXCEPTION 'already_moved_out' USING ERRCODE='22023'; END IF;
  IF v.moved_in_at IS NOT NULL AND coalesce(_moved_out_at,now())::date < v.moved_in_at THEN
    RAISE EXCEPTION 'moved_out_before_moved_in';
  END IF;
  v_nd := public.compute_no_dues_eligibility_internal(v_row_society, v.flat_id);
  IF NOT coalesce((v_nd->>'eligible')::boolean,false) THEN
    RAISE EXCEPTION 'correction_blocked_dues' USING ERRCODE='22023';
  END IF;

  UPDATE public.flat_residents
     SET is_active = false,
         moved_out_at = coalesce(_moved_out_at, now())::date,
         access_expires_at = least(coalesce(access_expires_at, now()), now()),
         termination_kind = 'admin_correction',
         ended_reason = v_reason
   WHERE id = _flat_resident_id AND is_active;
  PERFORM public._deactivate_resident_role_if_homeless(v.user_id, v_row_society);

  INSERT INTO public.audit_log(actor_id, society_id, target_table, target_id, action, metadata)
    VALUES (auth.uid(), v_row_society, 'flat_residents', _flat_resident_id, 'resident.admin_correction',
            jsonb_build_object('reason', v_reason, 'user_id', v.user_id, 'flat_id', v.flat_id, 'relationship', v.relationship));
END; $function$;
REVOKE ALL ON FUNCTION public.end_resident_unit_relationship(uuid, uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_resident_unit_relationship(uuid, uuid, timestamptz, text) TO authenticated;