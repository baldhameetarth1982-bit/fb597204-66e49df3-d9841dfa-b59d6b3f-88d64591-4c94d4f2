
CREATE OR REPLACE FUNCTION public.admin_assign_resident_to_flat(
  _flat_id uuid,
  _user_id uuid,
  _relationship text DEFAULT 'owner',
  _is_primary boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_society uuid;
  v_user_society uuid;
  v_id uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _relationship NOT IN ('owner','tenant','family') THEN
    RAISE EXCEPTION 'Invalid relationship';
  END IF;

  SELECT society_id INTO v_society FROM public.flats WHERE id = _flat_id;
  IF v_society IS NULL THEN RAISE EXCEPTION 'Flat not found'; END IF;

  IF NOT (public.is_society_admin_for(v_caller, v_society) OR public.is_super_admin(v_caller)) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT society_id INTO v_user_society FROM public.profiles WHERE id = _user_id;
  IF v_user_society IS NULL OR v_user_society <> v_society THEN
    RAISE EXCEPTION 'Resident does not belong to this society';
  END IF;

  INSERT INTO public.flat_residents (flat_id, user_id, relationship, is_primary)
  VALUES (
    _flat_id, _user_id, _relationship,
    COALESCE(_is_primary, false) OR NOT EXISTS (SELECT 1 FROM public.flat_residents WHERE flat_id = _flat_id)
  )
  ON CONFLICT (flat_id, user_id) DO UPDATE
    SET relationship = EXCLUDED.relationship,
        is_primary = public.flat_residents.is_primary OR EXCLUDED.is_primary
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_assign_resident_to_flat(uuid, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_resident_to_flat(uuid, uuid, text, boolean) TO authenticated;

-- Helper for admins: list residents in their society with optional flat link summary
CREATE OR REPLACE FUNCTION public.admin_list_society_residents(_society_id uuid)
RETURNS TABLE(
  user_id uuid,
  full_name text,
  email text,
  phone text,
  flat_count bigint,
  flats jsonb
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.is_society_admin_for(v_caller, _society_id) OR public.is_super_admin(v_caller)) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.email,
    p.phone,
    COALESCE((SELECT count(*) FROM public.flat_residents fr WHERE fr.user_id = p.id), 0)::bigint,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'flat_id', f.id,
        'flat_number', f.flat_number,
        'block_name', b.name,
        'relationship', fr.relationship,
        'is_primary', fr.is_primary
      ))
      FROM public.flat_residents fr
      JOIN public.flats f ON f.id = fr.flat_id
      LEFT JOIN public.blocks b ON b.id = f.block_id
      WHERE fr.user_id = p.id
    ), '[]'::jsonb)
  FROM public.profiles p
  WHERE p.society_id = _society_id
  ORDER BY p.full_name NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_society_residents(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_society_residents(uuid) TO authenticated;
