
-- ===========================================================
-- Stage 2A — Canonical Society Structure model
-- ===========================================================

-- 1) societies.structure_mode
ALTER TABLE public.societies
  ADD COLUMN IF NOT EXISTS structure_mode text
  CHECK (structure_mode IS NULL OR structure_mode IN ('structured','serial'));

-- 2) blocks additive columns
ALTER TABLE public.blocks
  ADD COLUMN IF NOT EXISTS structure_kind text NOT NULL DEFAULT 'block'
    CHECK (structure_kind IN ('block','tower','wing')),
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0
    CHECK (display_order >= 0);

-- normalized name (generated)
ALTER TABLE public.blocks
  ADD COLUMN IF NOT EXISTS normalized_name text
  GENERATED ALWAYS AS (lower(btrim(coalesce(name,'')))) STORED;

-- unique block name per society (case-insensitive, trimmed)
CREATE UNIQUE INDEX IF NOT EXISTS blocks_society_normalized_name_uidx
  ON public.blocks (society_id, normalized_name)
  WHERE normalized_name <> '';

-- 3) flats: allow serial mode (block_id nullable) + status columns
ALTER TABLE public.flats
  ALTER COLUMN block_id DROP NOT NULL;

ALTER TABLE public.flats
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0
    CHECK (display_order >= 0);

ALTER TABLE public.flats
  ADD COLUMN IF NOT EXISTS normalized_label text
  GENERATED ALWAYS AS (lower(btrim(coalesce(flat_number,'')))) STORED;

-- non-empty label always required
ALTER TABLE public.flats
  DROP CONSTRAINT IF EXISTS flats_flat_number_nonempty_chk;
ALTER TABLE public.flats
  ADD CONSTRAINT flats_flat_number_nonempty_chk
  CHECK (btrim(flat_number) <> '');

-- structured uniqueness: society + block + label
CREATE UNIQUE INDEX IF NOT EXISTS flats_structured_unique_uidx
  ON public.flats (society_id, block_id, normalized_label)
  WHERE block_id IS NOT NULL;

-- serial uniqueness: society + label (block_id null)
CREATE UNIQUE INDEX IF NOT EXISTS flats_serial_unique_uidx
  ON public.flats (society_id, normalized_label)
  WHERE block_id IS NULL;

-- 4) Trigger enforcing structure-mode rules
CREATE OR REPLACE FUNCTION public.flats_enforce_structure_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode text;
  v_block_soc uuid;
  v_block_active boolean;
BEGIN
  SELECT structure_mode INTO v_mode FROM public.societies WHERE id = NEW.society_id;

  IF v_mode = 'structured' THEN
    IF NEW.block_id IS NULL THEN
      RAISE EXCEPTION 'structured_mode_requires_block';
    END IF;
    SELECT society_id, is_active INTO v_block_soc, v_block_active
      FROM public.blocks WHERE id = NEW.block_id;
    IF v_block_soc IS NULL OR v_block_soc <> NEW.society_id THEN
      RAISE EXCEPTION 'block_not_in_society';
    END IF;
    IF NOT v_block_active THEN
      RAISE EXCEPTION 'block_inactive';
    END IF;
  ELSIF v_mode = 'serial' THEN
    IF NEW.block_id IS NOT NULL THEN
      RAISE EXCEPTION 'serial_mode_rejects_block';
    END IF;
    IF NEW.floor IS NOT NULL THEN
      NEW.floor := NULL;
    END IF;
  ELSE
    -- NULL mode: legacy permissive
    IF NEW.block_id IS NOT NULL THEN
      SELECT society_id INTO v_block_soc FROM public.blocks WHERE id = NEW.block_id;
      IF v_block_soc IS NULL OR v_block_soc <> NEW.society_id THEN
        RAISE EXCEPTION 'block_not_in_society';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS flats_enforce_structure_mode_trg ON public.flats;
CREATE TRIGGER flats_enforce_structure_mode_trg
  BEFORE INSERT OR UPDATE OF society_id, block_id, floor ON public.flats
  FOR EACH ROW EXECUTE FUNCTION public.flats_enforce_structure_mode();

-- 5) Structure overview RPC
CREATE OR REPLACE FUNCTION public.get_society_structure_overview(_society_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_mode text;
  v_total_structures int;
  v_active_structures int;
  v_total_units int;
  v_active_units int;
  v_units_with_block int;
  v_units_no_block int;
  v_inconsistent int;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF NOT (public.is_society_admin_for(v_caller, _society_id) OR public.is_super_admin(v_caller)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT structure_mode INTO v_mode FROM public.societies WHERE id = _society_id;

  SELECT count(*), count(*) FILTER (WHERE is_active)
    INTO v_total_structures, v_active_structures
  FROM public.blocks WHERE society_id = _society_id;

  SELECT count(*),
         count(*) FILTER (WHERE is_active),
         count(*) FILTER (WHERE block_id IS NOT NULL),
         count(*) FILTER (WHERE block_id IS NULL)
    INTO v_total_units, v_active_units, v_units_with_block, v_units_no_block
  FROM public.flats WHERE society_id = _society_id;

  -- Inconsistent = mixed layout w.r.t. resolved mode
  v_inconsistent := CASE
    WHEN v_mode = 'structured' THEN v_units_no_block
    WHEN v_mode = 'serial' THEN v_units_with_block
    WHEN v_units_with_block > 0 AND v_units_no_block > 0 THEN v_units_with_block + v_units_no_block
    ELSE 0
  END;

  RETURN jsonb_build_object(
    'structure_mode', v_mode,
    'configured', v_mode IS NOT NULL,
    'total_structures', v_total_structures,
    'active_structures', v_active_structures,
    'total_units', v_total_units,
    'active_units', v_active_units,
    'units_with_block', v_units_with_block,
    'units_without_block', v_units_no_block,
    'inconsistent_units', v_inconsistent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_society_structure_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_society_structure_overview(uuid) TO authenticated;

-- 6) Configure structure mode RPC
CREATE OR REPLACE FUNCTION public.configure_society_structure_mode(_society_id uuid, _mode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_current text;
  v_total int;
  v_with_block int;
  v_no_block int;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF NOT (public.is_society_admin_for(v_caller, _society_id) OR public.is_super_admin(v_caller)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _mode NOT IN ('structured','serial') THEN
    RAISE EXCEPTION 'invalid_mode';
  END IF;

  SELECT structure_mode INTO v_current FROM public.societies WHERE id = _society_id FOR UPDATE;

  SELECT count(*),
         count(*) FILTER (WHERE block_id IS NOT NULL),
         count(*) FILTER (WHERE block_id IS NULL)
    INTO v_total, v_with_block, v_no_block
  FROM public.flats WHERE society_id = _society_id;

  IF v_current IS NOT NULL AND v_current <> _mode THEN
    IF v_total > 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'conversion_blocked_units_exist');
    END IF;
  END IF;

  IF v_current IS NULL AND v_total > 0 THEN
    IF v_with_block > 0 AND v_no_block > 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'review_required_mixed_units');
    END IF;
    IF _mode = 'structured' AND v_no_block > 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'review_required_units_without_block');
    END IF;
    IF _mode = 'serial' AND v_with_block > 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'review_required_units_have_block');
    END IF;
  END IF;

  UPDATE public.societies SET structure_mode = _mode, updated_at = now() WHERE id = _society_id;

  INSERT INTO public.audit_log(actor_id, society_id, action, entity_type, entity_id, meta)
  VALUES (v_caller, _society_id, 'configure_structure_mode', 'society', _society_id,
          jsonb_build_object('from', v_current, 'to', _mode));

  RETURN jsonb_build_object('ok', true, 'structure_mode', _mode);
END;
$$;

REVOKE ALL ON FUNCTION public.configure_society_structure_mode(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.configure_society_structure_mode(uuid, text) TO authenticated;

-- 7) list_society_units_page (server pagination)
CREATE OR REPLACE FUNCTION public.list_society_units_page(
  _society_id uuid,
  _search text DEFAULT NULL,
  _block_id uuid DEFAULT NULL,
  _floor integer DEFAULT NULL,
  _unit_type text DEFAULT NULL,
  _active boolean DEFAULT NULL,
  _limit integer DEFAULT 25,
  _offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_lim int;
  v_off int;
  v_total int;
  v_items jsonb;
  v_search text;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF NOT (public.is_society_admin_for(v_caller, _society_id) OR public.is_super_admin(v_caller)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_lim := greatest(1, least(coalesce(_limit,25), 100));
  v_off := greatest(0, coalesce(_offset,0));
  v_search := nullif(btrim(coalesce(_search,'')),'');

  WITH filtered AS (
    SELECT f.id, f.flat_number, f.floor, f.unit_type, f.status, f.is_active,
           f.display_order, f.block_id, b.name AS block_name,
           f.created_at
    FROM public.flats f
    LEFT JOIN public.blocks b ON b.id = f.block_id
    WHERE f.society_id = _society_id
      AND (_block_id IS NULL OR f.block_id = _block_id)
      AND (_floor IS NULL OR f.floor = _floor)
      AND (_unit_type IS NULL OR f.unit_type = _unit_type)
      AND (_active IS NULL OR f.is_active = _active)
      AND (v_search IS NULL
           OR f.normalized_label LIKE '%' || lower(v_search) || '%'
           OR lower(coalesce(b.name,'')) LIKE '%' || lower(v_search) || '%')
  )
  SELECT count(*) INTO v_total FROM filtered;

  SELECT coalesce(jsonb_agg(row_to_json(x) ORDER BY x.display_order, x.block_name NULLS FIRST, x.flat_number), '[]'::jsonb)
    INTO v_items
  FROM (
    SELECT f.id, f.flat_number, f.floor, f.unit_type, f.status, f.is_active,
           f.display_order, f.block_id, b.name AS block_name
    FROM public.flats f
    LEFT JOIN public.blocks b ON b.id = f.block_id
    WHERE f.society_id = _society_id
      AND (_block_id IS NULL OR f.block_id = _block_id)
      AND (_floor IS NULL OR f.floor = _floor)
      AND (_unit_type IS NULL OR f.unit_type = _unit_type)
      AND (_active IS NULL OR f.is_active = _active)
      AND (v_search IS NULL
           OR f.normalized_label LIKE '%' || lower(v_search) || '%'
           OR lower(coalesce(b.name,'')) LIKE '%' || lower(v_search) || '%')
    ORDER BY f.display_order, b.name NULLS FIRST, f.flat_number
    LIMIT v_lim OFFSET v_off
  ) x;

  RETURN jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_lim,
    'offset', v_off,
    'has_next', (v_off + v_lim) < v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_society_units_page(uuid, text, uuid, integer, text, boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_society_units_page(uuid, text, uuid, integer, text, boolean, integer, integer) TO authenticated;

-- 8) create_society_unit
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

  INSERT INTO public.flats(society_id, block_id, flat_number, floor, unit_type)
  VALUES (_society_id,
          CASE WHEN v_mode = 'serial' THEN NULL ELSE _block_id END,
          btrim(_flat_number),
          CASE WHEN v_mode = 'serial' THEN NULL ELSE _floor END,
          coalesce(nullif(_unit_type,''), 'flat'))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_label');
END;
$$;

REVOKE ALL ON FUNCTION public.create_society_unit(uuid, text, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_society_unit(uuid, text, uuid, integer, text) TO authenticated;

-- 9) update_society_unit
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
    unit_type = coalesce(nullif(_unit_type,''), unit_type),
    display_order = coalesce(_display_order, display_order),
    updated_at = now()
  WHERE id = _unit_id;

  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_label');
END;
$$;

REVOKE ALL ON FUNCTION public.update_society_unit(uuid, text, integer, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_society_unit(uuid, text, integer, text, integer) TO authenticated;

-- 10) set_society_unit_active / set_society_block_active
CREATE OR REPLACE FUNCTION public.set_society_unit_active(_unit_id uuid, _active boolean)
RETURNS jsonb
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
  UPDATE public.flats SET is_active = _active, updated_at = now() WHERE id = _unit_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.set_society_unit_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_society_unit_active(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_society_block_active(_block_id uuid, _active boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_soc uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  SELECT society_id INTO v_soc FROM public.blocks WHERE id = _block_id;
  IF v_soc IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF NOT (public.is_society_admin_for(v_caller, v_soc) OR public.is_super_admin(v_caller)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  UPDATE public.blocks SET is_active = _active, updated_at = now() WHERE id = _block_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.set_society_block_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_society_block_active(uuid, boolean) TO authenticated;

-- 11) Update commit_society_wizard:
--     - set societies.structure_mode
--     - serial branch: no fake "Houses" block; flats.block_id stays NULL
CREATE OR REPLACE FUNCTION public.commit_society_wizard(_society_id uuid, _payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
declare
  v_caller uuid := auth.uid();
  v_layout text;
  v_label text;
  v_info jsonb;
  v_opening jsonb;
  v_maint jsonb;
  v_dyn jsonb;
  v_fy text;
  s jsonb; u jsonb;
  v_struct_id uuid;
  v_block_id uuid;
  v_flat_id uuid;
  v_sort int;
  v_sort2 int;
begin
  if v_caller is null then raise exception 'Not authenticated'; end if;
  if not (public.is_society_admin_for(v_caller, _society_id) or public.is_super_admin(v_caller)) then
    raise exception 'Not authorized';
  end if;

  v_info := coalesce(_payload->'info', '{}'::jsonb);
  v_layout := coalesce(_payload->>'layout', 'structured');
  v_label := coalesce(nullif(_payload->>'structure_label',''), 'Block');
  v_opening := coalesce(_payload->'opening', '{}'::jsonb);
  v_maint := coalesce(_payload->'maintenance', '{}'::jsonb);
  v_dyn := coalesce(_payload->'dynamic_fields', '[]'::jsonb);
  v_fy := coalesce(_payload->>'financial_year_label', to_char(current_date, 'YYYY'));

  update public.societies set
    name = coalesce(nullif(v_info->>'name',''), name),
    registration_no = nullif(v_info->>'registration_no',''),
    address = nullif(v_info->>'address',''),
    city = nullif(v_info->>'city',''),
    state = nullif(v_info->>'state',''),
    pincode = nullif(v_info->>'pincode',''),
    logo_url = coalesce(nullif(v_info->>'logo_url',''), logo_url),
    layout = v_layout::public.society_layout,
    structure_label = v_label,
    structure_mode = case when v_layout = 'serial' then 'serial' else 'structured' end,
    updated_at = now()
  where id = _society_id;

  -- Wipe existing draft hierarchy (only if setup not completed yet)
  if not exists (select 1 from public.society_settings where society_id = _society_id and setup_completed_at is not null) then
    delete from public.hierarchy_nodes where society_id = _society_id;
  end if;

  if v_layout = 'structured' then
    v_sort := 0;
    for s in select * from jsonb_array_elements(coalesce(_payload->'structures','[]'::jsonb)) loop
      v_sort := v_sort + 1;
      insert into public.hierarchy_nodes (society_id, parent_id, kind, name, code, sort_order, meta)
        values (_society_id, null, 'structure', coalesce(s->>'name','Block'), s->>'code', v_sort,
                jsonb_build_object(
                  'floors', s->'floors',
                  'units_per_floor', s->'units_per_floor',
                  'ground_floor', s->'ground_floor',
                  'numbering_format', s->>'numbering_format',
                  'custom_pattern', s->>'custom_pattern'
                ))
      returning id into v_struct_id;

      insert into public.blocks (society_id, name, display_order, created_at)
        values (_society_id, coalesce(s->>'name','Block'), v_sort, now())
      returning id into v_block_id;

      update public.hierarchy_nodes set legacy_block_id = v_block_id where id = v_struct_id;

      v_sort2 := 0;
      for u in select * from jsonb_array_elements(coalesce(s->'units','[]'::jsonb)) loop
        v_sort2 := v_sort2 + 1;
        insert into public.hierarchy_nodes (society_id, parent_id, kind, name, code, sort_order, meta)
          values (_society_id, v_struct_id, 'unit',
                  coalesce(u->>'name', u->>'code'),
                  u->>'code', v_sort2,
                  jsonb_build_object('note', u->>'note', 'floor', u->>'floor'));

        insert into public.flats (society_id, block_id, flat_number, floor, display_order, created_at)
          values (_society_id, v_block_id, coalesce(u->>'code', u->>'name','?'),
                  coalesce((u->>'floor')::int, 1), v_sort2, now())
        returning id into v_flat_id;

        update public.hierarchy_nodes h set legacy_flat_id = v_flat_id
          where h.society_id = _society_id and h.parent_id = v_struct_id and h.code = u->>'code';
      end loop;
    end loop;
  else
    -- Serial layout: NO fake block; units live directly under the society
    insert into public.hierarchy_nodes (society_id, parent_id, kind, name, code, sort_order, meta)
      values (_society_id, null, 'structure', 'Houses', 'H', 1, '{"serial": true, "deprecated": true}'::jsonb)
    returning id into v_struct_id;

    v_sort := 0;
    for u in select * from jsonb_array_elements(coalesce(_payload->'serial_units','[]'::jsonb)) loop
      v_sort := v_sort + 1;
      insert into public.flats (society_id, block_id, flat_number, floor, display_order, created_at)
        values (_society_id, NULL, coalesce(u->>'code', u->>'name','?'), NULL, v_sort, now())
      returning id into v_flat_id;

      insert into public.hierarchy_nodes (society_id, parent_id, kind, name, code, sort_order, legacy_flat_id, meta)
        values (_society_id, v_struct_id, 'unit',
                coalesce(u->>'name', u->>'code'), u->>'code', v_sort, v_flat_id,
                jsonb_build_object('note', u->>'note'));
    end loop;
  end if;

  insert into public.society_settings (
    society_id, registration_no, address, city, state, pincode, structure_type,
    opening_cash, opening_bank, opening_balance_date,
    maintenance_frequency, maintenance_due_day, grace_days, late_fee_amount, late_fee_type,
    wizard_step, dynamic_profile_fields, wizard_state, financial_year_label
  )
  values (
    _society_id,
    nullif(v_info->>'registration_no',''),
    nullif(v_info->>'address',''),
    nullif(v_info->>'city',''),
    nullif(v_info->>'state',''),
    nullif(v_info->>'pincode',''),
    case when v_layout = 'serial' then 'serial' else lower(v_label)||'s' end,
    coalesce((v_opening->>'cash')::numeric, 0),
    coalesce((v_opening->>'bank')::numeric, 0),
    coalesce((v_opening->>'as_of')::date, current_date),
    coalesce(nullif(v_maint->>'frequency',''), 'monthly'),
    coalesce((v_maint->>'due_day')::int, 10),
    coalesce((v_maint->>'grace_days')::int, 5),
    coalesce((v_maint->>'late_fee_amount')::numeric, 0),
    coalesce(nullif(v_maint->>'late_fee_type',''), 'flat'),
    99,
    v_dyn,
    '{}'::jsonb,
    v_fy
  )
  on conflict (society_id) do update set
    registration_no = excluded.registration_no,
    address = excluded.address,
    city = excluded.city,
    state = excluded.state,
    pincode = excluded.pincode,
    structure_type = excluded.structure_type,
    maintenance_frequency = excluded.maintenance_frequency,
    maintenance_due_day = excluded.maintenance_due_day,
    grace_days = excluded.grace_days,
    late_fee_amount = excluded.late_fee_amount,
    late_fee_type = excluded.late_fee_type,
    dynamic_profile_fields = excluded.dynamic_profile_fields,
    wizard_state = '{}'::jsonb,
    wizard_step = 99,
    financial_year_label = excluded.financial_year_label,
    updated_at = now();

  update public.society_settings set setup_completed_at = coalesce(setup_completed_at, now())
    where society_id = _society_id;
end $function$;
