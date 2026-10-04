CREATE OR REPLACE FUNCTION public.submit_join_request_unit(_society_id uuid, _code text, _full_name text, _block_id uuid, _flat_id uuid, _mobile text, _owner_or_tenant text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_user uuid := auth.uid(); v_ok boolean; v_enabled boolean; v_cur uuid; v_flat record; v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NULLIF(trim(COALESCE(_full_name,'')),'') IS NULL OR length(trim(_full_name)) > 120 THEN
    RETURN jsonb_build_object('ok',false,'reason','name_required'); END IF;
  IF _owner_or_tenant NOT IN ('owner','tenant') THEN RETURN jsonb_build_object('ok',false,'reason','role_required'); END IF;
  SELECT upper(invite_code) = upper(trim(COALESCE(_code,''))), COALESCE(invite_code_enabled,true)
    INTO v_ok, v_enabled FROM public.societies WHERE id=_society_id;
  IF NOT FOUND OR NOT v_enabled OR NOT COALESCE(v_ok,false) THEN RETURN jsonb_build_object('ok',false,'reason','invalid_code'); END IF;
  SELECT society_id INTO v_cur FROM public.profiles WHERE id=v_user;
  IF v_cur IS NOT NULL AND v_cur <> _society_id THEN RETURN jsonb_build_object('ok',false,'reason','already_member'); END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('join_user:'||v_user::text,0));
  IF EXISTS (SELECT 1 FROM public.join_requests jr WHERE jr.user_id=v_user AND jr.status='pending' AND jr.society_id<>_society_id) THEN
    RETURN jsonb_build_object('ok',false,'reason','pending_elsewhere'); END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('join_flat:'||COALESCE(_flat_id::text,''),0));
  SELECT f.id, f.society_id, f.block_id, f.flat_number, b.name AS block_name, COALESCE(b.is_active,true) AS block_active
    INTO v_flat FROM public.flats f LEFT JOIN public.blocks b ON b.id=f.block_id
   WHERE f.id=_flat_id AND COALESCE(f.is_active,true);
  IF NOT FOUND OR v_flat.society_id <> _society_id OR NOT v_flat.block_active
     OR v_flat.block_id IS DISTINCT FROM _block_id THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_unit'); END IF;

  IF EXISTS (SELECT 1 FROM public.flat_residents fr WHERE fr.flat_id=_flat_id AND fr.user_id=v_user AND COALESCE(fr.is_active,true) AND fr.moved_out_at IS NULL) THEN
    RETURN jsonb_build_object('ok',false,'reason','already_linked'); END IF;
  IF EXISTS (SELECT 1 FROM public.flat_residents fr WHERE fr.flat_id=_flat_id AND fr.relationship=_owner_or_tenant
              AND COALESCE(fr.is_active,true) AND fr.moved_out_at IS NULL) THEN
    RETURN jsonb_build_object('ok',false,'reason','unit_unavailable'); END IF;

  INSERT INTO public.join_requests (user_id, society_id, flat_id, full_name, flat_number_input, mobile, owner_or_tenant, relationship, status)
  VALUES (v_user, _society_id, _flat_id, trim(_full_name),
          CASE WHEN v_flat.block_name IS NULL THEN v_flat.flat_number ELSE v_flat.block_name||'-'||v_flat.flat_number END,
          NULLIF(trim(COALESCE(_mobile,'')),''), _owner_or_tenant, _owner_or_tenant, 'pending')
  ON CONFLICT (user_id, society_id) WHERE status='pending' DO UPDATE SET
    flat_id=EXCLUDED.flat_id, full_name=EXCLUDED.full_name, flat_number_input=EXCLUDED.flat_number_input,
    mobile=EXCLUDED.mobile, owner_or_tenant=EXCLUDED.owner_or_tenant, relationship=EXCLUDED.relationship, updated_at=now()
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok',true,'id',v_id);
END $function$;