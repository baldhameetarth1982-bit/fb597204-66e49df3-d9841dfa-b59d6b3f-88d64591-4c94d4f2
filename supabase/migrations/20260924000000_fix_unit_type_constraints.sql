-- Fix unit_type constraint mismatch between UI and DB
ALTER TABLE public.flats DROP CONSTRAINT IF EXISTS flats_unit_type_check;

ALTER TABLE public.flats ADD CONSTRAINT flats_unit_type_check 
  CHECK (unit_type IN (
    '1RK', '1BHK', '2BHK', '3BHK', '4BHK', 'Penthouse', 'House', 'Shop', 
    'flat', 'bungalow', 'villa', 'shop', 'office', 'residential', 'commercial'
  ));

-- Also update the RPC to be more robust by trimming input
CREATE OR REPLACE FUNCTION public.create_society_unit(
  _society_id uuid,
  _flat_number text,
  _block_id uuid DEFAULT NULL,
  _floor integer DEFAULT NULL,
  _unit_type text DEFAULT 'flat'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_mode text;
  v_id uuid;
  v_type text;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF NOT (public.is_society_admin_for(v_caller, _society_id) OR public.is_super_admin(v_caller)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _flat_number IS NULL OR btrim(_flat_number) = '' THEN
    RAISE EXCEPTION 'invalid_label';
  END IF;

  SELECT structure_mode INTO v_mode FROM public.societies WHERE id = _society_id;
  IF v_mode IS NULL THEN
    RAISE EXCEPTION 'structure_mode_not_configured';
  END IF;

  v_type := coalesce(nullif(btrim(_unit_type), ''), 'flat');

  INSERT INTO public.flats(society_id, block_id, flat_number, floor, unit_type)
  VALUES (_society_id,
          CASE WHEN v_mode = 'serial' THEN NULL ELSE _block_id END,
          btrim(_flat_number),
          CASE WHEN v_mode = 'serial' THEN NULL ELSE _floor END,
          v_type)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_label');
END;
$$;

-- Apply same robustness to update_society_unit
CREATE OR REPLACE FUNCTION public.update_society_unit(
  _unit_id uuid,
  _flat_number text DEFAULT NULL,
  _floor integer DEFAULT NULL,
  _unit_type text DEFAULT NULL,
  _display_order integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_soc uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT society_id INTO v_soc FROM public.flats WHERE id = _unit_id;
  IF v_soc IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF NOT (public.is_society_admin_for(v_caller, v_soc) OR public.is_super_admin(v_caller)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  UPDATE public.flats SET
    flat_number = coalesce(nullif(btrim(_flat_number),''), flat_number),
    floor = coalesce(_floor, floor),
    unit_type = coalesce(nullif(btrim(_unit_type),''), unit_type),
    display_order = coalesce(_display_order, display_order),
    updated_at = now()
  WHERE id = _unit_id;

  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_label');
END;
$$;
