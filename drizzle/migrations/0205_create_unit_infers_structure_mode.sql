CREATE OR REPLACE FUNCTION public.create_society_unit(_society_id uuid, _flat_number text, _block_id uuid DEFAULT NULL::uuid, _floor integer DEFAULT NULL::integer, _unit_type text DEFAULT 'flat'::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_mode text;
  v_id uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF NOT (public.is_society_admin_for(v_caller, _society_id) OR public.is_super_admin(v_caller)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _flat_number IS NULL OR btrim(_flat_number) = '' THEN
    RAISE EXCEPTION 'invalid_label';
  END IF;
  IF _block_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.blocks WHERE id = _block_id AND society_id = _society_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_block');
  END IF;

  SELECT structure_mode INTO v_mode FROM public.societies WHERE id = _society_id FOR UPDATE;
  IF v_mode IS NULL THEN
    -- Recovery path: infer the layout from existing structure instead of failing.
    v_mode := CASE WHEN _block_id IS NOT NULL
                     OR EXISTS (SELECT 1 FROM public.blocks WHERE society_id = _society_id)
                   THEN 'structured' ELSE 'serial' END;
    UPDATE public.societies SET structure_mode = v_mode WHERE id = _society_id AND structure_mode IS NULL;
    INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, meta)
    VALUES (v_caller, _society_id, 'society.structure_mode_inferred', 'societies', _society_id, jsonb_build_object('mode', v_mode));
  END IF;
  IF v_mode = 'structured' AND _block_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'block_required');
  END IF;

  INSERT INTO public.flats(society_id, block_id, flat_number, floor, unit_type)
  VALUES (_society_id,
          CASE WHEN v_mode = 'serial' THEN NULL ELSE _block_id END,
          btrim(_flat_number),
          CASE WHEN v_mode = 'serial' THEN NULL ELSE _floor END,
          coalesce(nullif(btrim(_unit_type),''), 'flat'))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_label');
END;
$function$;