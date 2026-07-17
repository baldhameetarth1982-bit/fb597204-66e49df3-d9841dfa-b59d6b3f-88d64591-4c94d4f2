
CREATE OR REPLACE FUNCTION public.admin_upsert_family_member(
  _society_id uuid,
  _resident_user_id uuid,
  _id uuid DEFAULT NULL,
  _full_name text DEFAULT NULL,
  _relation text DEFAULT NULL,
  _phone text DEFAULT NULL,
  _age int DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; BEGIN
  IF NOT public.is_society_admin_for(_society_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _resident_user_id AND society_id = _society_id) THEN
    RAISE EXCEPTION 'resident_not_in_society';
  END IF;
  IF _relation NOT IN ('spouse','child','parent','sibling','helper','other') THEN
    RAISE EXCEPTION 'invalid_relation';
  END IF;

  IF _id IS NULL THEN
    INSERT INTO public.family_members(user_id, full_name, relation, phone, age)
      VALUES (_resident_user_id, _full_name, _relation, _phone, _age)
      RETURNING id INTO v_id;
    INSERT INTO public.audit_log(actor_id, society_id, entity_type, entity_id, action, metadata)
      VALUES (auth.uid(), _society_id, 'family_members', v_id, 'create', jsonb_build_object('resident',_resident_user_id));
  ELSE
    UPDATE public.family_members
       SET full_name = _full_name, relation = _relation, phone = _phone, age = _age, updated_at = now()
     WHERE id = _id AND user_id = _resident_user_id
     RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'family_member_not_found'; END IF;
    INSERT INTO public.audit_log(actor_id, society_id, entity_type, entity_id, action, metadata)
      VALUES (auth.uid(), _society_id, 'family_members', v_id, 'update', '{}'::jsonb);
  END IF;
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.admin_upsert_family_member(uuid,uuid,uuid,text,text,text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_family_member(uuid,uuid,uuid,text,text,text,int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_upsert_vehicle(
  _society_id uuid,
  _id uuid DEFAULT NULL,
  _resident_user_id uuid DEFAULT NULL,
  _flat_id uuid DEFAULT NULL,
  _plate_number text DEFAULT NULL,
  _type text DEFAULT NULL,
  _make_model text DEFAULT NULL,
  _color text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_norm text; v_prev_active boolean; BEGIN
  IF NOT public.is_society_admin_for(_society_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  v_norm := upper(regexp_replace(coalesce(_plate_number,''), '\s+', '', 'g'));
  IF length(v_norm) < 3 THEN RAISE EXCEPTION 'invalid_plate'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _resident_user_id AND society_id = _society_id) THEN
    RAISE EXCEPTION 'resident_not_in_society';
  END IF;
  IF _flat_id IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM public.flats WHERE id = _flat_id AND society_id = _society_id
  ) THEN
    RAISE EXCEPTION 'unit_not_in_society';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(_society_id::text || '|' || v_norm, 0)
  );

  IF _id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.vehicles
       WHERE society_id = _society_id AND is_active = true
         AND upper(regexp_replace(plate_number, '\s+', '', 'g')) = v_norm
    ) THEN
      RAISE EXCEPTION 'duplicate_active_plate';
    END IF;
    INSERT INTO public.vehicles(society_id, user_id, flat_id, plate_number, type, make_model, color, is_active)
      VALUES (_society_id, _resident_user_id, _flat_id, v_norm,
              coalesce(nullif(_type,''),'car'), _make_model, _color, true)
      RETURNING id INTO v_id;
    INSERT INTO public.audit_log(actor_id, society_id, entity_type, entity_id, action, metadata)
      VALUES (auth.uid(), _society_id, 'vehicles', v_id, 'create', jsonb_build_object('plate', v_norm));
  ELSE
    SELECT is_active INTO v_prev_active FROM public.vehicles
     WHERE id = _id AND society_id = _society_id;
    IF v_prev_active IS NULL THEN RAISE EXCEPTION 'vehicle_not_found'; END IF;
    IF EXISTS (
      SELECT 1 FROM public.vehicles
       WHERE society_id = _society_id AND is_active = true AND id <> _id
         AND upper(regexp_replace(plate_number, '\s+', '', 'g')) = v_norm
    ) THEN
      RAISE EXCEPTION 'duplicate_active_plate';
    END IF;
    UPDATE public.vehicles
       SET user_id = _resident_user_id, flat_id = _flat_id, plate_number = v_norm,
           type = coalesce(nullif(_type,''), type),
           make_model = _make_model, color = _color, updated_at = now()
     WHERE id = _id AND society_id = _society_id
     RETURNING id INTO v_id;
    INSERT INTO public.audit_log(actor_id, society_id, entity_type, entity_id, action, metadata)
      VALUES (auth.uid(), _society_id, 'vehicles', v_id, 'update', jsonb_build_object('plate', v_norm));
  END IF;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'duplicate_active_plate';
END; $$;

REVOKE ALL ON FUNCTION public.admin_upsert_vehicle(uuid,uuid,uuid,uuid,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_vehicle(uuid,uuid,uuid,uuid,text,text,text,text) TO authenticated;
