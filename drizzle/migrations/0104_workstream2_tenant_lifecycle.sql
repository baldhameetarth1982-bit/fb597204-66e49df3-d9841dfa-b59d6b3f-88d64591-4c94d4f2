ALTER TABLE public.flat_residents
  ADD COLUMN IF NOT EXISTS invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS renewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS renewal_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS move_out_override_reason text;

ALTER TABLE public.society_settings
  ADD COLUMN IF NOT EXISTS tenancy_warning_days integer NOT NULL DEFAULT 30;
ALTER TABLE public.society_settings
  ADD CONSTRAINT society_settings_tenancy_warning_days_range CHECK (tenancy_warning_days BETWEEN 1 AND 180);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS elder_mode boolean NOT NULL DEFAULT false;

CREATE TABLE public.tenancy_reminders_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flat_resident_id uuid NOT NULL REFERENCES public.flat_residents(id) ON DELETE CASCADE,
  window_key text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flat_resident_id, window_key)
);
GRANT ALL ON public.tenancy_reminders_sent TO service_role;
ALTER TABLE public.tenancy_reminders_sent ENABLE ROW LEVEL SECURITY;

-- Derived lifecycle state (never stored, never client-supplied)
CREATE OR REPLACE FUNCTION public.tenancy_state(_is_active boolean,_moved_out_at date,_archived_at timestamptz,
  _termination_kind text,_access_expires_at timestamptz,_lease_ends_on date,_invited_at timestamptz,_moved_in_at date,_notice date,_warn integer)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN _archived_at IS NOT NULL THEN 'archived'
    WHEN NOT _is_active OR _moved_out_at IS NOT NULL THEN
      CASE _termination_kind WHEN 'lease_expired' THEN 'expired' WHEN 'early_termination' THEN 'terminated' ELSE 'moved_out' END
    WHEN _access_expires_at IS NOT NULL AND _access_expires_at <= now() THEN 'expired'
    WHEN _moved_in_at IS NOT NULL AND _moved_in_at > current_date THEN 'pending'
    WHEN _invited_at IS NOT NULL AND _moved_in_at IS NULL THEN 'invited'
    WHEN _notice IS NOT NULL THEN 'terminating'
    WHEN _lease_ends_on IS NOT NULL AND _lease_ends_on <= current_date + coalesce(_warn,30) THEN 'expiring'
    ELSE 'active' END
$$;

CREATE OR REPLACE FUNCTION public._tenancy_row_society(_flat_resident_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT f.society_id FROM public.flat_residents fr JOIN public.flats f ON f.id=fr.flat_id WHERE fr.id=_flat_resident_id
$$;
REVOKE ALL ON FUNCTION public._tenancy_row_society(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._deactivate_resident_role_if_homeless(_user uuid,_society uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  UPDATE public.user_roles ur SET is_active=false,deactivated_at=now(),updated_at=now()
  WHERE ur.user_id=_user AND ur.society_id=_society AND ur.role='resident'::public.app_role AND ur.is_active
    AND NOT EXISTS (SELECT 1 FROM public.flat_residents a JOIN public.flats af ON af.id=a.flat_id
      WHERE a.user_id=_user AND af.society_id=_society AND a.is_active AND a.moved_out_at IS NULL
        AND (a.access_expires_at IS NULL OR a.access_expires_at>now()));
$$;
REVOKE ALL ON FUNCTION public._deactivate_resident_role_if_homeless(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.list_tenancies(_society_id uuid,_filter text DEFAULT 'current')
RETURNS TABLE(flat_resident_id uuid,user_id uuid,flat_id uuid,flat_number text,resident_name text,relationship text,
  lease_starts_on date,lease_ends_on date,notice_given_on date,moved_in_at date,moved_out_at date,state text,days_remaining integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_warn integer;
BEGIN
  IF NOT public.current_user_has_society_permission(_society_id,'residents.manage',NULL) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF _filter NOT IN ('current','expiring','expired','all') THEN RAISE EXCEPTION 'invalid_filter' USING ERRCODE='22023'; END IF;
  SELECT coalesce(max(tenancy_warning_days),30) INTO v_warn FROM public.society_settings WHERE society_id=_society_id;
  RETURN QUERY SELECT * FROM (
    SELECT fr.id,fr.user_id,fr.flat_id,f.flat_number,p.full_name,fr.relationship,fr.lease_starts_on,fr.lease_ends_on,fr.notice_given_on,
      fr.moved_in_at,fr.moved_out_at,
      public.tenancy_state(fr.is_active,fr.moved_out_at,fr.archived_at,fr.termination_kind,fr.access_expires_at,fr.lease_ends_on,fr.invited_at,fr.moved_in_at,fr.notice_given_on,v_warn) st,
      CASE WHEN fr.lease_ends_on IS NULL THEN NULL ELSE (fr.lease_ends_on-current_date)::integer END
    FROM public.flat_residents fr JOIN public.flats f ON f.id=fr.flat_id LEFT JOIN public.profiles p ON p.id=fr.user_id
    WHERE f.society_id=_society_id AND fr.relationship='tenant') t
  WHERE CASE _filter WHEN 'current' THEN t.st IN ('active','expiring','terminating','pending','invited')
    WHEN 'expiring' THEN t.st IN ('expiring','terminating') WHEN 'expired' THEN t.st IN ('expired','terminated','moved_out') ELSE true END
  ORDER BY t.lease_ends_on NULLS LAST,t.flat_number LIMIT 500;
END; $$;

CREATE OR REPLACE FUNCTION public.get_flat_occupancy(_flat_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_society uuid; v_warn integer; v_rows jsonb; v_nd jsonb;
BEGIN
  SELECT society_id INTO v_society FROM public.flats WHERE id=_flat_id;
  IF v_society IS NULL OR NOT public.current_user_has_society_permission(v_society,'residents.manage',NULL) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  SELECT coalesce(max(tenancy_warning_days),30) INTO v_warn FROM public.society_settings WHERE society_id=v_society;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',fr.id,'user_id',fr.user_id,'name',p.full_name,'relationship',fr.relationship,
    'is_primary',fr.is_primary,'moved_in_at',fr.moved_in_at,'moved_out_at',fr.moved_out_at,'lease_starts_on',fr.lease_starts_on,
    'lease_ends_on',fr.lease_ends_on,'notice_given_on',fr.notice_given_on,'renewal_count',fr.renewal_count,'ended_reason',fr.ended_reason,
    'state',public.tenancy_state(fr.is_active,fr.moved_out_at,fr.archived_at,fr.termination_kind,fr.access_expires_at,fr.lease_ends_on,fr.invited_at,fr.moved_in_at,fr.notice_given_on,v_warn))
    ORDER BY fr.is_active DESC,fr.moved_in_at DESC NULLS LAST),'[]'::jsonb)
  INTO v_rows FROM public.flat_residents fr LEFT JOIN public.profiles p ON p.id=fr.user_id WHERE fr.flat_id=_flat_id;
  v_nd := public.compute_no_dues_eligibility_internal(v_society,_flat_id);
  RETURN jsonb_build_object('society_id',v_society,'warning_days',v_warn,'relationships',v_rows,
    'no_dues',jsonb_build_object('eligible',v_nd->'eligible','total_outstanding',v_nd->'total_outstanding','pending_payment_total',v_nd->'pending_payment_total'));
END; $$;

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
  IF NOT v.is_active OR v.moved_out_at IS NOT NULL OR v.archived_at IS NOT NULL THEN RAISE EXCEPTION 'tenancy_ended' USING ERRCODE='22023'; END IF;
  IF _new_lease_ends_on IS NULL OR _new_lease_ends_on <= current_date OR (v.lease_ends_on IS NOT NULL AND _new_lease_ends_on <= v.lease_ends_on)
     OR _new_lease_ends_on > current_date + 3650 THEN RAISE EXCEPTION 'invalid_lease_dates' USING ERRCODE='22023'; END IF;
  UPDATE public.flat_residents SET lease_ends_on=_new_lease_ends_on,notice_given_on=NULL,renewed_at=now(),renewal_count=renewal_count+1,
    access_expires_at=(_new_lease_ends_on+1)::timestamp AT TIME ZONE 'Asia/Kolkata' WHERE id=_flat_resident_id;
  INSERT INTO public.audit_log(actor_id,society_id,target_table,target_id,action,metadata)
  VALUES(auth.uid(),v_s,'flat_residents',_flat_resident_id,'tenancy.renewed',jsonb_build_object('from',v.lease_ends_on,'to',_new_lease_ends_on));
END; $$;

CREATE OR REPLACE FUNCTION public.admin_move_out_resident(_flat_resident_id uuid,_moved_out_on date,_reason text,_override_reason text DEFAULT NULL,_early_termination boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_s uuid; v public.flat_residents%ROWTYPE; v_nd jsonb; v_override text := nullif(btrim(coalesce(_override_reason,'')),'');
BEGIN
  v_s := public._tenancy_row_society(_flat_resident_id);
  IF v_s IS NULL OR NOT public.current_user_has_society_permission(v_s,'residents.manage',NULL) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  PERFORM public._rate_hit('tenancy_change',auth.uid()::text,60,interval '10 minutes');
  SELECT * INTO v FROM public.flat_residents WHERE id=_flat_resident_id FOR UPDATE;
  IF NOT v.is_active OR v.moved_out_at IS NOT NULL THEN RAISE EXCEPTION 'already_moved_out' USING ERRCODE='22023'; END IF;
  IF _moved_out_on IS NULL OR _moved_out_on > current_date + 365 OR (v.moved_in_at IS NOT NULL AND _moved_out_on < v.moved_in_at) THEN
    RAISE EXCEPTION 'invalid_move_out_date' USING ERRCODE='22023'; END IF;
  IF length(coalesce(_reason,'')) > 300 OR length(coalesce(v_override,'')) > 300 THEN RAISE EXCEPTION 'reason_too_long' USING ERRCODE='22023'; END IF;
  IF _early_termination AND v.relationship<>'tenant' THEN RAISE EXCEPTION 'not_tenant' USING ERRCODE='22023'; END IF;
  v_nd := public.compute_no_dues_eligibility_internal(v_s,v.flat_id);
  IF NOT coalesce((v_nd->>'eligible')::boolean,false) THEN
    IF v_override IS NULL OR length(v_override) < 10 THEN
      RETURN jsonb_build_object('ok',false,'blocked','dues_outstanding','total_outstanding',v_nd->'total_outstanding','pending_payment_total',v_nd->'pending_payment_total');
    END IF;
  END IF;
  IF _moved_out_on > current_date THEN
    -- scheduled: access ends at the date via the existing daily expiry job
    UPDATE public.flat_residents SET notice_given_on=current_date,
      lease_ends_on=CASE WHEN relationship='tenant' THEN _moved_out_on ELSE lease_ends_on END,
      access_expires_at=(_moved_out_on+1)::timestamp AT TIME ZONE 'Asia/Kolkata',
      termination_kind=CASE WHEN _early_termination THEN 'early_termination' ELSE 'move_out' END,
      ended_reason=nullif(btrim(coalesce(_reason,'')),''),move_out_override_reason=v_override WHERE id=_flat_resident_id;
  ELSE
    UPDATE public.flat_residents SET is_active=false,moved_out_at=_moved_out_on,access_expires_at=least(coalesce(access_expires_at,now()),now()),
      termination_kind=CASE WHEN _early_termination THEN 'early_termination' ELSE 'move_out' END,
      ended_reason=coalesce(nullif(btrim(coalesce(_reason,'')),''),'Moved out'),move_out_override_reason=v_override WHERE id=_flat_resident_id;
    PERFORM public._deactivate_resident_role_if_homeless(v.user_id,v_s);
  END IF;
  INSERT INTO public.audit_log(actor_id,society_id,target_table,target_id,action,metadata)
  VALUES(auth.uid(),v_s,'flat_residents',_flat_resident_id,CASE WHEN _early_termination THEN 'tenancy.terminated_early' ELSE 'resident.moved_out' END,
    jsonb_build_object('moved_out_on',_moved_out_on,'scheduled',_moved_out_on>current_date,'dues_override',v_override IS NOT NULL AND NOT coalesce((v_nd->>'eligible')::boolean,false),
      'total_outstanding',v_nd->'total_outstanding'));
  RETURN jsonb_build_object('ok',true,'scheduled',_moved_out_on>current_date);
END; $$;

-- tenancy_state treats scheduled end rows with notice as 'terminating'; expiry job handles them since it already checks access_expires_at for tenants.
CREATE OR REPLACE FUNCTION public.expire_stale_tenancies()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_count integer;
BEGIN
  IF current_user NOT IN ('postgres','service_role','supabase_admin') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  WITH expired AS (
    UPDATE public.flat_residents fr SET is_active=false,moved_out_at=coalesce(fr.moved_out_at,current_date),
      ended_reason=coalesce(fr.ended_reason,CASE WHEN fr.termination_kind IS NULL THEN 'Lease expired' ELSE 'Moved out' END),
      termination_kind=coalesce(fr.termination_kind,'lease_expired')
    WHERE fr.is_active AND fr.moved_out_at IS NULL AND fr.access_expires_at IS NOT NULL AND fr.access_expires_at <= now()
      AND (fr.relationship='tenant' OR fr.termination_kind IN ('move_out','early_termination'))
    RETURNING fr.id,fr.user_id,fr.flat_id
  ), deactivated_roles AS (
    UPDATE public.user_roles ur SET is_active=false,deactivated_at=now(),updated_at=now()
    WHERE ur.role='resident'::public.app_role AND ur.is_active
      AND EXISTS (SELECT 1 FROM expired e JOIN public.flats ef ON ef.id=e.flat_id WHERE e.user_id=ur.user_id AND ef.society_id=ur.society_id)
      AND NOT EXISTS (SELECT 1 FROM public.flat_residents a JOIN public.flats af ON af.id=a.flat_id
        WHERE a.user_id=ur.user_id AND af.society_id=ur.society_id AND a.is_active AND a.moved_out_at IS NULL
          AND (a.access_expires_at IS NULL OR a.access_expires_at>now())
          AND NOT EXISTS (SELECT 1 FROM expired e2 WHERE e2.id=a.id))
    RETURNING ur.id
  ), audited AS (
    INSERT INTO public.audit_log(actor_id,society_id,target_table,target_id,action,metadata)
    SELECT NULL,f.society_id,'flat_residents',e.id,'tenancy.expired',jsonb_build_object('user_id',e.user_id,'flat_id',e.flat_id)
    FROM expired e JOIN public.flats f ON f.id=e.flat_id RETURNING 1
  ) SELECT count(*) INTO v_count FROM audited;
  RETURN v_count;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_archive_tenancy(_flat_resident_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_s uuid; v public.flat_residents%ROWTYPE;
BEGIN
  v_s := public._tenancy_row_society(_flat_resident_id);
  IF v_s IS NULL OR NOT public.current_user_has_society_permission(v_s,'residents.manage',NULL) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  SELECT * INTO v FROM public.flat_residents WHERE id=_flat_resident_id FOR UPDATE;
  IF v.is_active OR v.moved_out_at IS NULL THEN RAISE EXCEPTION 'still_active' USING ERRCODE='22023'; END IF;
  IF v.archived_at IS NOT NULL THEN RETURN; END IF;
  UPDATE public.flat_residents SET archived_at=now() WHERE id=_flat_resident_id;
  INSERT INTO public.audit_log(actor_id,society_id,target_table,target_id,action,metadata)
  VALUES(auth.uid(),v_s,'flat_residents',_flat_resident_id,'tenancy.archived','{}'::jsonb);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_set_tenancy_warning_days(_society_id uuid,_days integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.current_user_has_society_permission(_society_id,'residents.manage',NULL) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF _days IS NULL OR _days < 1 OR _days > 180 THEN RAISE EXCEPTION 'invalid_window' USING ERRCODE='22023'; END IF;
  UPDATE public.society_settings SET tenancy_warning_days=_days WHERE society_id=_society_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'settings_not_found' USING ERRCODE='22023'; END IF;
  INSERT INTO public.audit_log(actor_id,society_id,target_table,target_id,action,metadata)
  VALUES(auth.uid(),_society_id,'society_settings',_society_id,'tenancy.warning_days_updated',jsonb_build_object('days',_days));
END; $$;

CREATE OR REPLACE FUNCTION public.send_tenancy_renewal_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; v_count integer := 0; a record;
BEGIN
  IF current_user NOT IN ('postgres','service_role','supabase_admin') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  FOR r IN
    WITH due AS (
      SELECT fr.id,fr.user_id,fr.flat_id,fr.lease_ends_on,f.society_id,f.flat_number
      FROM public.flat_residents fr JOIN public.flats f ON f.id=fr.flat_id
      LEFT JOIN public.society_settings ss ON ss.society_id=f.society_id
      WHERE fr.relationship='tenant' AND fr.is_active AND fr.moved_out_at IS NULL AND fr.archived_at IS NULL
        AND fr.notice_given_on IS NULL AND fr.lease_ends_on IS NOT NULL
        AND fr.lease_ends_on BETWEEN current_date AND current_date + coalesce(ss.tenancy_warning_days,30)
    ), ins AS (
      INSERT INTO public.tenancy_reminders_sent(flat_resident_id,window_key)
      SELECT id,lease_ends_on::text FROM due ON CONFLICT DO NOTHING RETURNING flat_resident_id
    ) SELECT d.* FROM due d JOIN ins ON ins.flat_resident_id=d.id
  LOOP
    PERFORM public._notify_user(r.user_id,r.society_id,'tenancy_expiring','Your lease ends soon',
      'Your lease for flat '||r.flat_number||' ends on '||to_char(r.lease_ends_on,'DD Mon YYYY')||'. Please contact your society office about renewal.',NULL);
    FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.society_id=r.society_id AND ur.is_active AND ur.role='society_admin'::public.app_role LOOP
      PERFORM public._notify_user(a.user_id,r.society_id,'tenancy_expiring','Lease ending soon',
        'Tenancy for flat '||r.flat_number||' ends on '||to_char(r.lease_ends_on,'DD Mon YYYY')||'.','/society/flats/'||r.flat_id);
    END LOOP;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END; $$;

REVOKE ALL ON FUNCTION public.send_tenancy_renewal_reminders() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.expire_stale_tenancies() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.list_tenancies(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_flat_occupancy(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_renew_tenancy(uuid,date) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_move_out_resident(uuid,date,text,text,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_archive_tenancy(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_set_tenancy_warning_days(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tenancies(uuid,text),public.get_flat_occupancy(uuid),public.admin_renew_tenancy(uuid,date),
  public.admin_move_out_resident(uuid,date,text,text,boolean),public.admin_archive_tenancy(uuid),public.admin_set_tenancy_warning_days(uuid,integer) TO authenticated;

SELECT cron.unschedule('expire-stale-tenancies-daily');
SELECT cron.schedule('expire-stale-tenancies-daily','15 0 * * *','SELECT public.expire_stale_tenancies(); SELECT public.send_tenancy_renewal_reminders();');