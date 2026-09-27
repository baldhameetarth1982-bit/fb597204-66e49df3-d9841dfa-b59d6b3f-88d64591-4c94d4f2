CREATE OR REPLACE FUNCTION public.respond_join_request(_request_id uuid, _approve boolean, _reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_req RECORD;
  v_flat_id uuid;
  v_key text;
  v_matches int;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_req FROM public.join_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Request already resolved';
  END IF;

  IF NOT (public.is_society_admin_for(v_caller, v_req.society_id)
          OR public.is_super_admin(v_caller)) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF NOT _approve THEN
    UPDATE public.join_requests
      SET status='rejected', reviewer_id=v_caller, reviewed_at=now(),
          reason=NULLIF(trim(COALESCE(_reason, '')), ''),
          updated_at=now()
    WHERE id = _request_id;
    RETURN;
  END IF;

  -- Resolve the house: use the linked flat, else match the typed house number
  -- against this society's own flats only (tenant-scoped).
  v_flat_id := v_req.flat_id;
  IF v_flat_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.flats WHERE id = v_flat_id AND society_id = v_req.society_id
  ) THEN
    v_flat_id := NULL;
  END IF;

  IF v_flat_id IS NULL THEN
    v_key := lower(regexp_replace(COALESCE(v_req.flat_number_input, ''), '[^a-zA-Z0-9]', '', 'g'));
    IF v_key = '' THEN
      RAISE EXCEPTION 'This request has no house number. Reject it and ask the resident to request again.';
    END IF;

    SELECT count(*), (array_agg(f.id))[1] INTO v_matches, v_flat_id
    FROM public.flats f
    LEFT JOIN public.blocks b ON b.id = f.block_id
    WHERE f.society_id = v_req.society_id
      AND COALESCE(f.is_active, true)
      AND lower(regexp_replace(COALESCE(b.name, '') || f.flat_number, '[^a-zA-Z0-9]', '', 'g')) = v_key;

    IF v_matches <> 1 THEN
      SELECT count(*), (array_agg(f.id))[1] INTO v_matches, v_flat_id
      FROM public.flats f
      WHERE f.society_id = v_req.society_id
        AND COALESCE(f.is_active, true)
        AND lower(regexp_replace(f.flat_number, '[^a-zA-Z0-9]', '', 'g')) = v_key;
    END IF;

    IF v_matches <> 1 THEN
      RAISE EXCEPTION 'House % is not in your Flats list. Add it under Flats, then approve again.', v_req.flat_number_input;
    END IF;
  END IF;

  PERFORM set_config('app.allow_society_change', 'on', true);
  UPDATE public.profiles
    SET society_id = v_req.society_id, updated_at = now()
  WHERE id = v_req.user_id;
  PERFORM set_config('app.allow_society_change', 'off', true);

  INSERT INTO public.user_roles (user_id, role, society_id)
  VALUES (v_req.user_id, 'resident'::public.app_role, v_req.society_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.flat_residents (flat_id, user_id, relationship, is_primary)
  VALUES (
    v_flat_id, v_req.user_id, v_req.relationship,
    NOT EXISTS (SELECT 1 FROM public.flat_residents WHERE flat_id = v_flat_id)
  )
  ON CONFLICT DO NOTHING;

  UPDATE public.join_requests
    SET status='approved', flat_id=v_flat_id, reviewer_id=v_caller, reviewed_at=now(),
        reason=NULLIF(trim(COALESCE(_reason, '')), ''),
        updated_at=now()
  WHERE id = _request_id;
END;
$function$;