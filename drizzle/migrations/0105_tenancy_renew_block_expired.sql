CREATE OR REPLACE FUNCTION public.admin_renew_tenancy(_flat_resident_id uuid,_new_lease_ends_on date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_s uuid; v public.flat_residents%ROWTYPE;
BEGIN
  v_s := public._tenancy_row_society(_flat_resident_id);
  IF v_s IS NULL OR NOT public.current_user_has_society_permission(v_s,'residents.manage',NULL) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  PERFORM public._rate_hit('tenancy_change',auth.uid()::text,60,interval '10 minutes');
  SELECT * INTO v FROM public.flat_residents WHERE id=_flat_resident_id FOR UPDATE;
  IF v.relationship<>'tenant' THEN RAISE EXCEPTION 'not_tenant' USING ERRCODE='22023'; END IF;
  IF NOT v.is_active OR v.moved_out_at IS NOT NULL OR v.archived_at IS NOT NULL
     OR (v.access_expires_at IS NOT NULL AND v.access_expires_at <= now()) THEN
    RAISE EXCEPTION 'tenancy_ended' USING ERRCODE='22023'; END IF;
  IF v.termination_kind IN ('move_out','early_termination') THEN RAISE EXCEPTION 'move_out_scheduled' USING ERRCODE='22023'; END IF;
  IF _new_lease_ends_on IS NULL OR _new_lease_ends_on <= current_date OR (v.lease_ends_on IS NOT NULL AND _new_lease_ends_on <= v.lease_ends_on)
     OR _new_lease_ends_on > current_date + 3650 THEN RAISE EXCEPTION 'invalid_lease_dates' USING ERRCODE='22023'; END IF;
  UPDATE public.flat_residents SET lease_ends_on=_new_lease_ends_on,notice_given_on=NULL,renewed_at=now(),renewal_count=renewal_count+1,
    access_expires_at=(_new_lease_ends_on+1)::timestamp AT TIME ZONE 'Asia/Kolkata' WHERE id=_flat_resident_id;
  INSERT INTO public.audit_log(actor_id,society_id,target_table,target_id,action,metadata)
  VALUES(auth.uid(),v_s,'flat_residents',_flat_resident_id,'tenancy.renewed',jsonb_build_object('from',v.lease_ends_on,'to',_new_lease_ends_on));
END; $$;