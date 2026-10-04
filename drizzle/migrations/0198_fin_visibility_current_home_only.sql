CREATE OR REPLACE FUNCTION public.resolve_financial_visibility(_society_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.app_role;
  v_setting text;
BEGIN
  IF v_uid IS NULL OR _society_id IS NULL THEN RETURN 'none'; END IF;
  IF public.current_user_is_super_admin() OR public.current_user_is_society_admin_for(_society_id) THEN
    RETURN 'admin';
  END IF;
  IF public.current_user_has_society_permission(_society_id, 'finance.read', NULL::uuid) THEN RETURN 'admin'; END IF;

  SELECT ur.role INTO v_role
  FROM public.user_roles ur
  WHERE ur.user_id = v_uid
    AND ur.society_id = _society_id
    AND COALESCE(ur.is_active, true)
  ORDER BY CASE ur.role
    WHEN 'society_admin' THEN 1
    WHEN 'block_admin' THEN 2
    WHEN 'security' THEN 3
    WHEN 'resident' THEN 4
    ELSE 5
  END
  LIMIT 1;

  IF v_role IS NULL OR v_role IN ('security', 'block_admin') THEN RETURN 'none'; END IF;
  -- Residents need a current (not moved-out, not expired) home in this society.
  IF v_role = 'resident' AND NOT EXISTS (
    SELECT 1
    FROM public.flat_residents fr
    JOIN public.flats f ON f.id = fr.flat_id
    WHERE fr.user_id = v_uid
      AND fr.is_active = true
      AND fr.moved_out_at IS NULL
      AND (fr.access_expires_at IS NULL OR fr.access_expires_at > now())
      AND f.society_id = _society_id
  ) THEN
    RETURN 'none';
  END IF;

  SELECT COALESCE(privacy_finances, 'admins_only')
  INTO v_setting
  FROM public.society_settings
  WHERE society_id = _society_id;

  IF v_setting = 'resident_summary' THEN RETURN 'summary'; END IF;
  IF v_setting = 'resident_detailed' THEN RETURN 'detailed'; END IF;
  RETURN 'none';
END;
$function$;