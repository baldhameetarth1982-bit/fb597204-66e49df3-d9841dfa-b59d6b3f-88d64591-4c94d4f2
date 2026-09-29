ALTER TABLE public.flat_residents
  ADD COLUMN IF NOT EXISTS lease_starts_on date,
  ADD COLUMN IF NOT EXISTS lease_ends_on date,
  ADD COLUMN IF NOT EXISTS notice_given_on date,
  ADD COLUMN IF NOT EXISTS termination_kind text,
  ADD COLUMN IF NOT EXISTS access_expires_at timestamptz;

ALTER TABLE public.flat_residents
  ADD CONSTRAINT flat_residents_lease_dates_valid CHECK (lease_ends_on IS NULL OR lease_starts_on IS NULL OR lease_ends_on >= lease_starts_on) NOT VALID,
  ADD CONSTRAINT flat_residents_notice_valid CHECK (notice_given_on IS NULL OR lease_ends_on IS NULL OR notice_given_on <= lease_ends_on) NOT VALID,
  ADD CONSTRAINT flat_residents_termination_kind_valid CHECK (termination_kind IS NULL OR termination_kind IN ('lease_expired','early_termination','move_out','admin_correction')) NOT VALID;

CREATE INDEX IF NOT EXISTS flat_residents_active_lease_expiry_idx
  ON public.flat_residents (lease_ends_on, flat_id)
  WHERE is_active AND moved_out_at IS NULL AND lease_ends_on IS NOT NULL;

CREATE OR REPLACE FUNCTION public.authorize_membership(_user_id uuid, _society_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT _user_id IS NOT NULL AND _society_id IS NOT NULL AND (
    public.is_super_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = _user_id AND ur.society_id = _society_id AND ur.is_active
    )
    OR EXISTS (
      SELECT 1
      FROM public.flat_residents fr
      JOIN public.flats f ON f.id = fr.flat_id
      WHERE fr.user_id = _user_id AND f.society_id = _society_id
        AND fr.is_active AND fr.moved_out_at IS NULL
        AND (fr.access_expires_at IS NULL OR fr.access_expires_at > now())
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.list_my_societies()
RETURNS TABLE(society_id uuid, society_name text, roles text[], is_current boolean, tenancy_ends_on date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH memberships AS (
    SELECT ur.society_id,
           array_agg(DISTINCT ur.role::text ORDER BY ur.role::text) AS roles,
           NULL::date AS tenancy_ends_on
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.is_active AND ur.society_id IS NOT NULL
    GROUP BY ur.society_id
    UNION ALL
    SELECT f.society_id,
           ARRAY['resident']::text[],
           max(fr.lease_ends_on) AS tenancy_ends_on
    FROM public.flat_residents fr
    JOIN public.flats f ON f.id = fr.flat_id
    WHERE fr.user_id = auth.uid() AND fr.is_active AND fr.moved_out_at IS NULL
      AND (fr.access_expires_at IS NULL OR fr.access_expires_at > now())
    GROUP BY f.society_id
  ), combined AS (
    SELECT m.society_id,
           array_agg(DISTINCT r ORDER BY r) AS roles,
           max(m.tenancy_ends_on) AS tenancy_ends_on
    FROM memberships m CROSS JOIN LATERAL unnest(m.roles) r
    GROUP BY m.society_id
  )
  SELECT s.id, s.name, c.roles, p.society_id = s.id, c.tenancy_ends_on
  FROM combined c
  JOIN public.societies s ON s.id = c.society_id
  JOIN public.profiles p ON p.id = auth.uid()
  WHERE public.society_has_access(s.id)
  ORDER BY (p.society_id = s.id) DESC, s.name;
$$;

CREATE OR REPLACE FUNCTION public.switch_active_society(_society_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_uid uuid := auth.uid(); v_from uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  IF NOT public.authorize_membership(v_uid, _society_id) OR NOT public.society_has_access(_society_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF NOT public._rate_hit('society_switch', v_uid::text, 30, interval '1 hour') THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;
  SELECT society_id INTO v_from FROM public.profiles WHERE id=v_uid FOR UPDATE;
  IF v_from IS NOT DISTINCT FROM _society_id THEN RETURN; END IF;
  UPDATE public.profiles SET society_id=_society_id, updated_at=now() WHERE id=v_uid;
  INSERT INTO public.audit_log(actor_id,society_id,target_table,target_id,action,metadata)
  VALUES(v_uid,_society_id,'profiles',v_uid,'session.society_switched',jsonb_build_object('from_society_id',v_from,'to_society_id',_society_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_tenancy_terms(
  _society_id uuid, _flat_resident_id uuid, _lease_starts_on date DEFAULT NULL,
  _lease_ends_on date DEFAULT NULL, _notice_given_on date DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_row public.flat_residents%ROWTYPE;
BEGIN
  IF NOT public.current_user_has_society_permission(_society_id,'residents.manage',NULL) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF _lease_starts_on IS NOT NULL AND _lease_ends_on IS NOT NULL AND _lease_ends_on < _lease_starts_on THEN
    RAISE EXCEPTION 'invalid_lease_dates' USING ERRCODE='22023';
  END IF;
  IF _notice_given_on IS NOT NULL AND _lease_ends_on IS NOT NULL AND _notice_given_on > _lease_ends_on THEN
    RAISE EXCEPTION 'invalid_notice_date' USING ERRCODE='22023';
  END IF;
  SELECT fr.* INTO v_row FROM public.flat_residents fr JOIN public.flats f ON f.id=fr.flat_id
  WHERE fr.id=_flat_resident_id AND f.society_id=_society_id FOR UPDATE OF fr;
  IF NOT FOUND THEN RAISE EXCEPTION 'relationship_not_found' USING ERRCODE='22023'; END IF;
  IF v_row.relationship <> 'tenant' THEN RAISE EXCEPTION 'not_tenant' USING ERRCODE='22023'; END IF;
  UPDATE public.flat_residents SET lease_starts_on=_lease_starts_on,lease_ends_on=_lease_ends_on,
    notice_given_on=_notice_given_on,access_expires_at=CASE WHEN _lease_ends_on IS NULL THEN NULL ELSE (_lease_ends_on + 1)::timestamp AT TIME ZONE 'Asia/Kolkata' END
  WHERE id=_flat_resident_id;
  INSERT INTO public.audit_log(actor_id,society_id,target_table,target_id,action,metadata)
  VALUES(auth.uid(),_society_id,'flat_residents',_flat_resident_id,'tenancy.terms_updated',
    jsonb_build_object('lease_starts_on',_lease_starts_on,'lease_ends_on',_lease_ends_on,'notice_given_on',_notice_given_on));
END;
$$;

CREATE OR REPLACE FUNCTION public.list_expiring_tenancies(_society_id uuid, _within_days integer DEFAULT 30)
RETURNS TABLE(flat_resident_id uuid,user_id uuid,flat_id uuid,flat_number text,resident_name text,lease_ends_on date,days_remaining integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.current_user_has_society_permission(_society_id,'residents.manage',NULL) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF _within_days < 1 OR _within_days > 180 THEN RAISE EXCEPTION 'invalid_window' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT fr.id,fr.user_id,fr.flat_id,f.flat_number,p.full_name,fr.lease_ends_on,(fr.lease_ends_on-current_date)::integer
  FROM public.flat_residents fr JOIN public.flats f ON f.id=fr.flat_id LEFT JOIN public.profiles p ON p.id=fr.user_id
  WHERE f.society_id=_society_id AND fr.relationship='tenant' AND fr.is_active AND fr.moved_out_at IS NULL
    AND fr.lease_ends_on BETWEEN current_date AND current_date + _within_days
  ORDER BY fr.lease_ends_on,f.flat_number LIMIT 500;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_stale_tenancies()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_count integer;
BEGIN
  IF current_user NOT IN ('postgres','service_role','supabase_admin') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  WITH expired AS (
    UPDATE public.flat_residents fr SET is_active=false,moved_out_at=coalesce(fr.moved_out_at,current_date),
      ended_reason=coalesce(fr.ended_reason,'Lease expired'),termination_kind='lease_expired'
    WHERE fr.is_active AND fr.moved_out_at IS NULL AND fr.relationship='tenant'
      AND fr.access_expires_at IS NOT NULL AND fr.access_expires_at <= now()
    RETURNING fr.id,fr.user_id,fr.flat_id
  ), audited AS (
    INSERT INTO public.audit_log(actor_id,society_id,target_table,target_id,action,metadata)
    SELECT NULL,f.society_id,'flat_residents',e.id,'tenancy.expired',jsonb_build_object('user_id',e.user_id,'flat_id',e.flat_id)
    FROM expired e JOIN public.flats f ON f.id=e.flat_id RETURNING 1
  ) SELECT count(*) INTO v_count FROM audited;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_current_auth_context()
RETURNS TABLE(profile jsonb, roles jsonb, primary_role text, society_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_user uuid:=auth.uid(); v_society uuid; v_primary text; v_roles jsonb; v_profile jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('role',ur.role,'society_id',ur.society_id,'block_id',ur.block_id) ORDER BY ur.created_at),'[]'::jsonb)
  INTO v_roles FROM public.user_roles ur WHERE ur.user_id=v_user AND ur.is_active;
  SELECT CASE WHEN p.society_id IS NOT NULL AND public.authorize_membership(v_user,p.society_id) THEN p.society_id ELSE (
    SELECT ur.society_id FROM public.user_roles ur WHERE ur.user_id=v_user AND ur.is_active AND ur.society_id IS NOT NULL
    ORDER BY CASE ur.role WHEN 'society_admin'::public.app_role THEN 1 WHEN 'resident'::public.app_role THEN 2 WHEN 'block_admin'::public.app_role THEN 3 WHEN 'security'::public.app_role THEN 4 ELSE 9 END,ur.created_at LIMIT 1) END
  INTO v_society FROM public.profiles p WHERE p.id=v_user;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=v_user AND is_active AND role='super_admin') THEN 'super_admin'
    WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=v_user AND is_active AND role='society_admin' AND (society_id=v_society OR v_society IS NULL)) THEN 'society_admin'
    WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=v_user AND is_active AND role='resident' AND (society_id=v_society OR v_society IS NULL)) THEN 'resident'
    WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=v_user AND is_active AND role='block_admin' AND (society_id=v_society OR v_society IS NULL)) THEN 'block_admin'
    WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=v_user AND is_active AND role='security' AND (society_id=v_society OR v_society IS NULL)) THEN 'security' ELSE NULL END INTO v_primary;
  SELECT to_jsonb(p)||jsonb_build_object('society_id',v_society) INTO v_profile FROM public.profiles p WHERE p.id=v_user;
  RETURN QUERY SELECT v_profile,v_roles,v_primary,v_society;
END;
$$;

REVOKE ALL ON FUNCTION public.list_my_societies() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.switch_active_society(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_set_tenancy_terms(uuid,uuid,date,date,date) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.list_expiring_tenancies(uuid,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.expire_stale_tenancies() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_societies() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.switch_active_society(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_tenancy_terms(uuid,uuid,date,date,date) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_expiring_tenancies(uuid,integer) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_tenancies() TO service_role;