
-- Stage 3A closure: preview eligibility + template overlap safety.

CREATE OR REPLACE FUNCTION public.preview_billing_template(
  _society_id uuid, _template_id uuid, _limit integer, _offset integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lines jsonb; v_units jsonb; v_total_units integer;
  v_summary_total numeric := 0; v_area_warnings integer := 0;
  v_lim integer := LEAST(GREATEST(COALESCE(_limit,25),1),200);
  v_off integer := GREATEST(COALESCE(_offset,0),0);
BEGIN
  PERFORM public._billing_require_admin(_society_id);
  IF NOT EXISTS (SELECT 1 FROM public.billing_templates WHERE id=_template_id AND society_id=_society_id) THEN
    RAISE EXCEPTION 'template_not_found' USING ERRCODE='P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(l ORDER BY (l->>'sort_order')::int, l->>'name'), '[]'::jsonb) INTO v_lines
  FROM (
    SELECT jsonb_build_object(
      'id', tl.id, 'charge_head_id', tl.charge_head_id, 'name', ch.name,
      'rule_type', tl.rule_type, 'amount', tl.amount,
      'unit_type', tl.unit_type, 'rate_per_area', tl.rate_per_area,
      'area_unit', tl.area_unit, 'required_approval', tl.required_approval,
      'sort_order', tl.sort_order
    ) AS l
    FROM public.billing_template_lines tl
    JOIN public.billing_charge_heads ch ON ch.id = tl.charge_head_id
    WHERE tl.template_id=_template_id AND tl.society_id=_society_id AND tl.active=true AND ch.active=true
  ) sub;

  -- Total: all active units (structured + serial)
  SELECT count(*) INTO v_total_units
    FROM public.flats f
   WHERE f.society_id = _society_id AND f.is_active = true;

  WITH page AS (
    SELECT f.id,
           f.flat_number,
           COALESCE(NULLIF(btrim(f.unit_type), ''), NULLIF(btrim(f.type), ''), '') AS unit_type,
           f.area_sqft,
           b.name AS block_name,
           f.display_order
      FROM public.flats f
      LEFT JOIN public.blocks b ON b.id = f.block_id
     WHERE f.society_id = _society_id AND f.is_active = true
     ORDER BY b.name NULLS LAST, f.display_order, f.flat_number
     LIMIT v_lim OFFSET v_off
  ),
  computed AS (
    SELECT p.id, p.flat_number, p.unit_type, p.area_sqft, p.block_name,
      (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'line_id', tl.id, 'name', ch.name, 'rule_type', tl.rule_type,
          'required_approval', tl.required_approval,
          'amount', CASE tl.rule_type
                      WHEN 'fixed_per_unit'   THEN tl.amount
                      WHEN 'unit_type_amount' THEN CASE WHEN lower(coalesce(p.unit_type,'')) = lower(coalesce(tl.unit_type,'')) THEN tl.amount ELSE 0 END
                      WHEN 'area_based'       THEN CASE WHEN p.area_sqft IS NULL OR p.area_sqft = 0 THEN NULL ELSE round(tl.rate_per_area * p.area_sqft, 2) END
                      ELSE NULL END,
          'warning', CASE WHEN tl.rule_type='area_based' AND (p.area_sqft IS NULL OR p.area_sqft=0) THEN 'area_not_available'
                          WHEN tl.rule_type='manual_variable' THEN 'requires_manual_entry' ELSE NULL END
        ) ORDER BY tl.sort_order), '[]'::jsonb)
        FROM public.billing_template_lines tl
        JOIN public.billing_charge_heads ch ON ch.id = tl.charge_head_id
       WHERE tl.template_id=_template_id AND tl.society_id=_society_id AND tl.active=true AND ch.active=true
      ) AS lines
    FROM page p
  )
  SELECT jsonb_agg(jsonb_build_object(
    'flat_id', c.id, 'block_name', c.block_name, 'flat_number', c.flat_number,
    'unit_type', c.unit_type, 'area_sqft', c.area_sqft, 'lines', c.lines,
    'unit_total', (SELECT COALESCE(sum((x->>'amount')::numeric),0) FROM jsonb_array_elements(c.lines) x WHERE x->>'amount' IS NOT NULL),
    'has_warning', (SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(c.lines) x WHERE x->>'warning' IS NOT NULL))
  )) INTO v_units FROM computed c;
  v_units := COALESCE(v_units, '[]'::jsonb);

  -- Summary total across all active units (structured + serial), fixed/unit_type/area_based only.
  SELECT COALESCE(sum(unit_sum),0), COALESCE(sum(CASE WHEN has_area_warn THEN 1 ELSE 0 END),0)
    INTO v_summary_total, v_area_warnings
  FROM (
    SELECT
      (
        SELECT COALESCE(sum(
          CASE tl.rule_type
            WHEN 'fixed_per_unit'   THEN tl.amount
            WHEN 'unit_type_amount' THEN CASE WHEN lower(coalesce(NULLIF(btrim(f.unit_type),''), NULLIF(btrim(f.type),''), '')) = lower(coalesce(tl.unit_type,'')) THEN tl.amount ELSE 0 END
            WHEN 'area_based'       THEN CASE WHEN f.area_sqft IS NULL OR f.area_sqft = 0 THEN 0 ELSE round(tl.rate_per_area * f.area_sqft, 2) END
            ELSE 0 END
        ),0)
        FROM public.billing_template_lines tl
        JOIN public.billing_charge_heads ch ON ch.id = tl.charge_head_id
       WHERE tl.template_id=_template_id AND tl.society_id=_society_id AND tl.active=true AND ch.active=true
      ) AS unit_sum,
      EXISTS(
        SELECT 1 FROM public.billing_template_lines tl
         WHERE tl.template_id=_template_id AND tl.society_id=_society_id AND tl.active=true
           AND tl.rule_type='area_based' AND (f.area_sqft IS NULL OR f.area_sqft = 0)
      ) AS has_area_warn
    FROM public.flats f
   WHERE f.society_id = _society_id AND f.is_active = true
  ) totals;

  RETURN jsonb_build_object(
    'preview_only', true, 'total_units', v_total_units,
    'page_limit', v_lim, 'page_offset', v_off,
    'lines', v_lines, 'units', v_units,
    'summary', jsonb_build_object('total_amount', v_summary_total, 'area_warning_units', v_area_warnings)
  );
END; $$;
REVOKE ALL ON FUNCTION public.preview_billing_template(uuid,uuid,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_billing_template(uuid,uuid,integer,integer) TO authenticated, service_role;

-- Prevent overlapping ACTIVE templates for same society+frequency (drafts/archived may overlap).
CREATE OR REPLACE FUNCTION public.billing_templates_prevent_active_overlap()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'active' THEN
    IF EXISTS (
      SELECT 1 FROM public.billing_templates t
       WHERE t.society_id = NEW.society_id
         AND t.billing_frequency = NEW.billing_frequency
         AND t.status = 'active'
         AND t.id <> NEW.id
         AND daterange(t.effective_from, COALESCE(t.effective_to, DATE '9999-12-31'), '[]')
             && daterange(NEW.effective_from, COALESCE(NEW.effective_to, DATE '9999-12-31'), '[]')
    ) THEN
      RAISE EXCEPTION 'invalid_effective_date' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_billing_templates_no_overlap ON public.billing_templates;
CREATE TRIGGER trg_billing_templates_no_overlap
  BEFORE INSERT OR UPDATE OF status, effective_from, effective_to, billing_frequency
  ON public.billing_templates
  FOR EACH ROW EXECUTE FUNCTION public.billing_templates_prevent_active_overlap();
