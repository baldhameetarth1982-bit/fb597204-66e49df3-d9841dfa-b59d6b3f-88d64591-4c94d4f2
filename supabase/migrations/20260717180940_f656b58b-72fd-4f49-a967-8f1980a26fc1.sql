
CREATE TABLE IF NOT EXISTS public.billing_charge_heads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  name text NOT NULL,
  normalized_name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'general',
  default_amount numeric(12,2),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT billing_charge_heads_name_len CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT billing_charge_heads_amount_nonneg CHECK (default_amount IS NULL OR default_amount >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_charge_heads_active_unique
  ON public.billing_charge_heads (society_id, normalized_name) WHERE active = true;
CREATE INDEX IF NOT EXISTS billing_charge_heads_society_idx
  ON public.billing_charge_heads (society_id, active, name);
GRANT SELECT ON public.billing_charge_heads TO authenticated;
GRANT ALL ON public.billing_charge_heads TO service_role;
ALTER TABLE public.billing_charge_heads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "charge_heads_admin_read" ON public.billing_charge_heads FOR SELECT TO authenticated
  USING (public.current_user_has_society_permission(society_id, 'billing.manage'::text, NULL::uuid));

CREATE TABLE IF NOT EXISTS public.billing_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  billing_frequency text NOT NULL DEFAULT 'monthly',
  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT billing_templates_name_len CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT billing_templates_status_ck CHECK (status IN ('draft','active','archived')),
  CONSTRAINT billing_templates_freq_ck CHECK (billing_frequency IN ('monthly','quarterly','yearly','custom')),
  CONSTRAINT billing_templates_dates_ck CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS billing_templates_society_idx
  ON public.billing_templates (society_id, status, effective_from DESC);
GRANT SELECT ON public.billing_templates TO authenticated;
GRANT ALL ON public.billing_templates TO service_role;
ALTER TABLE public.billing_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "billing_templates_admin_read" ON public.billing_templates FOR SELECT TO authenticated
  USING (public.current_user_has_society_permission(society_id, 'billing.manage'::text, NULL::uuid));

CREATE TABLE IF NOT EXISTS public.billing_template_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.billing_templates(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  charge_head_id uuid NOT NULL REFERENCES public.billing_charge_heads(id) ON DELETE RESTRICT,
  rule_type text NOT NULL,
  amount numeric(12,2),
  unit_type text,
  rate_per_area numeric(12,4),
  area_unit text,
  required_approval boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT billing_lines_rule_ck CHECK (rule_type IN ('fixed_per_unit','unit_type_amount','area_based','manual_variable')),
  CONSTRAINT billing_lines_fixed_ck CHECK (rule_type <> 'fixed_per_unit' OR (amount IS NOT NULL AND amount >= 0)),
  CONSTRAINT billing_lines_unittype_ck CHECK (rule_type <> 'unit_type_amount' OR (amount IS NOT NULL AND amount >= 0 AND unit_type IS NOT NULL AND char_length(unit_type) > 0)),
  CONSTRAINT billing_lines_area_ck CHECK (rule_type <> 'area_based' OR (rate_per_area IS NOT NULL AND rate_per_area >= 0))
);
CREATE INDEX IF NOT EXISTS billing_template_lines_tpl_idx
  ON public.billing_template_lines (template_id, active, sort_order);
GRANT SELECT ON public.billing_template_lines TO authenticated;
GRANT ALL ON public.billing_template_lines TO service_role;
ALTER TABLE public.billing_template_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "billing_template_lines_admin_read" ON public.billing_template_lines FOR SELECT TO authenticated
  USING (public.current_user_has_society_permission(society_id, 'billing.manage'::text, NULL::uuid));

CREATE TABLE IF NOT EXISTS public.billing_cycle_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.billing_templates(id) ON DELETE RESTRICT,
  cycle_name text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT billing_cycles_name_len CHECK (char_length(cycle_name) BETWEEN 1 AND 120),
  CONSTRAINT billing_cycles_status_ck CHECK (status IN ('draft','ready','archived')),
  CONSTRAINT billing_cycles_dates_ck CHECK (period_end >= period_start AND due_date >= period_start)
);
CREATE INDEX IF NOT EXISTS billing_cycle_configs_society_idx
  ON public.billing_cycle_configs (society_id, status, period_start DESC);
GRANT SELECT ON public.billing_cycle_configs TO authenticated;
GRANT ALL ON public.billing_cycle_configs TO service_role;
ALTER TABLE public.billing_cycle_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "billing_cycles_admin_read" ON public.billing_cycle_configs FOR SELECT TO authenticated
  USING (public.current_user_has_society_permission(society_id, 'billing.manage'::text, NULL::uuid));

CREATE OR REPLACE FUNCTION public._billing_touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_billing_charge_heads_updated ON public.billing_charge_heads;
CREATE TRIGGER trg_billing_charge_heads_updated BEFORE UPDATE ON public.billing_charge_heads
  FOR EACH ROW EXECUTE FUNCTION public._billing_touch_updated_at();
DROP TRIGGER IF EXISTS trg_billing_templates_updated ON public.billing_templates;
CREATE TRIGGER trg_billing_templates_updated BEFORE UPDATE ON public.billing_templates
  FOR EACH ROW EXECUTE FUNCTION public._billing_touch_updated_at();
DROP TRIGGER IF EXISTS trg_billing_template_lines_updated ON public.billing_template_lines;
CREATE TRIGGER trg_billing_template_lines_updated BEFORE UPDATE ON public.billing_template_lines
  FOR EACH ROW EXECUTE FUNCTION public._billing_touch_updated_at();
DROP TRIGGER IF EXISTS trg_billing_cycle_configs_updated ON public.billing_cycle_configs;
CREATE TRIGGER trg_billing_cycle_configs_updated BEFORE UPDATE ON public.billing_cycle_configs
  FOR EACH ROW EXECUTE FUNCTION public._billing_touch_updated_at();

CREATE OR REPLACE FUNCTION public._billing_require_admin(_society_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _society_id IS NULL THEN RAISE EXCEPTION 'unavailable' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.current_user_has_society_permission(_society_id, 'billing.manage'::text, NULL::uuid) THEN
    RAISE EXCEPTION 'unavailable' USING ERRCODE = 'P0002';
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public._billing_require_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._billing_require_admin(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._billing_audit(_society_id uuid, _action text, _target_table text, _target_id uuid, _meta jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.audit_log (society_id, actor_id, action, target_table, target_id, metadata)
  VALUES (_society_id, auth.uid(), _action, _target_table, _target_id, COALESCE(_meta, '{}'::jsonb));
$$;
REVOKE ALL ON FUNCTION public._billing_audit(uuid, text, text, uuid, jsonb) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.save_charge_head(
  _society_id uuid, _id uuid, _name text, _description text, _category text, _default_amount numeric, _active boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_norm text := lower(btrim(_name));
BEGIN
  PERFORM public._billing_require_admin(_society_id);
  IF _name IS NULL OR char_length(btrim(_name)) = 0 THEN RAISE EXCEPTION 'invalid_rule' USING ERRCODE='22023'; END IF;
  IF _id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.billing_charge_heads WHERE society_id=_society_id AND normalized_name=v_norm AND active=true) THEN
      RAISE EXCEPTION 'duplicate_charge_head' USING ERRCODE='23505';
    END IF;
    INSERT INTO public.billing_charge_heads(society_id,name,normalized_name,description,category,default_amount,active,created_by)
    VALUES (_society_id, btrim(_name), v_norm, NULLIF(btrim(coalesce(_description,'')),''),
            COALESCE(NULLIF(btrim(coalesce(_category,'')),''),'general'), _default_amount, COALESCE(_active,true), auth.uid())
    RETURNING id INTO v_id;
    PERFORM public._billing_audit(_society_id,'billing.charge_head.create','billing_charge_heads',v_id,jsonb_build_object('name',_name));
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.billing_charge_heads WHERE id=_id AND society_id=_society_id) THEN
      RAISE EXCEPTION 'unavailable' USING ERRCODE='P0002';
    END IF;
    IF COALESCE(_active,true) AND EXISTS (
      SELECT 1 FROM public.billing_charge_heads WHERE society_id=_society_id AND normalized_name=v_norm AND active=true AND id<>_id
    ) THEN RAISE EXCEPTION 'duplicate_charge_head' USING ERRCODE='23505'; END IF;
    UPDATE public.billing_charge_heads
       SET name=btrim(_name), normalized_name=v_norm,
           description=NULLIF(btrim(coalesce(_description,'')),''),
           category=COALESCE(NULLIF(btrim(coalesce(_category,'')),''), category),
           default_amount=_default_amount,
           active=COALESCE(_active, active),
           archived_at = CASE WHEN COALESCE(_active,active)=false AND archived_at IS NULL THEN now() ELSE archived_at END
     WHERE id=_id;
    v_id := _id;
    PERFORM public._billing_audit(_society_id,'billing.charge_head.update','billing_charge_heads',v_id,jsonb_build_object('name',_name,'active',_active));
  END IF;
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.save_charge_head(uuid,uuid,text,text,text,numeric,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_charge_head(uuid,uuid,text,text,text,numeric,boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_billing_template(
  _society_id uuid, _id uuid, _name text, _status text, _billing_frequency text, _effective_from date, _effective_to date
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public._billing_require_admin(_society_id);
  IF _name IS NULL OR char_length(btrim(_name))=0 THEN RAISE EXCEPTION 'invalid_rule' USING ERRCODE='22023'; END IF;
  IF _effective_from IS NULL THEN RAISE EXCEPTION 'invalid_effective_date' USING ERRCODE='22023'; END IF;
  IF _effective_to IS NOT NULL AND _effective_to < _effective_from THEN RAISE EXCEPTION 'invalid_effective_date' USING ERRCODE='22023'; END IF;
  IF COALESCE(_status,'draft') NOT IN ('draft','active','archived') THEN RAISE EXCEPTION 'invalid_rule' USING ERRCODE='22023'; END IF;
  IF COALESCE(_billing_frequency,'monthly') NOT IN ('monthly','quarterly','yearly','custom') THEN RAISE EXCEPTION 'invalid_rule' USING ERRCODE='22023'; END IF;
  IF _id IS NULL THEN
    INSERT INTO public.billing_templates(society_id,name,status,billing_frequency,effective_from,effective_to,created_by)
    VALUES (_society_id, btrim(_name), COALESCE(_status,'draft'), COALESCE(_billing_frequency,'monthly'), _effective_from, _effective_to, auth.uid())
    RETURNING id INTO v_id;
    PERFORM public._billing_audit(_society_id,'billing.template.create','billing_templates',v_id,jsonb_build_object('name',_name));
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.billing_templates WHERE id=_id AND society_id=_society_id) THEN
      RAISE EXCEPTION 'template_not_found' USING ERRCODE='P0002';
    END IF;
    UPDATE public.billing_templates
       SET name=btrim(_name), status=COALESCE(_status,status),
           billing_frequency=COALESCE(_billing_frequency,billing_frequency),
           effective_from=_effective_from, effective_to=_effective_to,
           archived_at = CASE WHEN COALESCE(_status,status)='archived' AND archived_at IS NULL THEN now() ELSE archived_at END
     WHERE id=_id;
    v_id := _id;
    PERFORM public._billing_audit(_society_id,'billing.template.update','billing_templates',v_id,jsonb_build_object('name',_name,'status',_status));
  END IF;
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.save_billing_template(uuid,uuid,text,text,text,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_billing_template(uuid,uuid,text,text,text,date,date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_billing_template_line(
  _society_id uuid, _template_id uuid, _id uuid, _charge_head_id uuid, _rule_type text,
  _amount numeric, _unit_type text, _rate_per_area numeric, _area_unit text,
  _required_approval boolean, _sort_order integer, _active boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public._billing_require_admin(_society_id);
  IF NOT EXISTS (SELECT 1 FROM public.billing_templates WHERE id=_template_id AND society_id=_society_id) THEN
    RAISE EXCEPTION 'template_not_found' USING ERRCODE='P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.billing_charge_heads WHERE id=_charge_head_id AND society_id=_society_id) THEN
    RAISE EXCEPTION 'unavailable' USING ERRCODE='P0002';
  END IF;
  IF _rule_type NOT IN ('fixed_per_unit','unit_type_amount','area_based','manual_variable') THEN
    RAISE EXCEPTION 'invalid_rule' USING ERRCODE='22023';
  END IF;
  IF _rule_type='fixed_per_unit' AND (_amount IS NULL OR _amount<0) THEN RAISE EXCEPTION 'invalid_rule' USING ERRCODE='22023'; END IF;
  IF _rule_type='unit_type_amount' AND (_amount IS NULL OR _amount<0 OR _unit_type IS NULL OR char_length(btrim(_unit_type))=0) THEN
    RAISE EXCEPTION 'invalid_rule' USING ERRCODE='22023';
  END IF;
  IF _rule_type='area_based' AND (_rate_per_area IS NULL OR _rate_per_area<0) THEN RAISE EXCEPTION 'invalid_rule' USING ERRCODE='22023'; END IF;

  IF _id IS NULL THEN
    INSERT INTO public.billing_template_lines(template_id,society_id,charge_head_id,rule_type,amount,unit_type,rate_per_area,area_unit,required_approval,sort_order,active,created_by)
    VALUES (_template_id,_society_id,_charge_head_id,_rule_type,_amount,NULLIF(btrim(coalesce(_unit_type,'')),''),_rate_per_area,NULLIF(btrim(coalesce(_area_unit,'')),''),
            COALESCE(_required_approval, _rule_type='manual_variable'), COALESCE(_sort_order,0), COALESCE(_active,true), auth.uid())
    RETURNING id INTO v_id;
    PERFORM public._billing_audit(_society_id,'billing.line.create','billing_template_lines',v_id,jsonb_build_object('rule',_rule_type));
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.billing_template_lines WHERE id=_id AND society_id=_society_id AND template_id=_template_id) THEN
      RAISE EXCEPTION 'line_not_found' USING ERRCODE='P0002';
    END IF;
    UPDATE public.billing_template_lines
       SET charge_head_id=_charge_head_id, rule_type=_rule_type, amount=_amount,
           unit_type=NULLIF(btrim(coalesce(_unit_type,'')),''), rate_per_area=_rate_per_area,
           area_unit=NULLIF(btrim(coalesce(_area_unit,'')),''),
           required_approval=COALESCE(_required_approval,required_approval),
           sort_order=COALESCE(_sort_order,sort_order), active=COALESCE(_active,active)
     WHERE id=_id;
    v_id := _id;
    PERFORM public._billing_audit(_society_id,'billing.line.update','billing_template_lines',v_id,jsonb_build_object('rule',_rule_type));
  END IF;
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.save_billing_template_line(uuid,uuid,uuid,uuid,text,numeric,text,numeric,text,boolean,integer,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_billing_template_line(uuid,uuid,uuid,uuid,text,numeric,text,numeric,text,boolean,integer,boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.archive_billing_template_line(_society_id uuid, _id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._billing_require_admin(_society_id);
  IF NOT EXISTS (SELECT 1 FROM public.billing_template_lines WHERE id=_id AND society_id=_society_id) THEN
    RAISE EXCEPTION 'line_not_found' USING ERRCODE='P0002';
  END IF;
  UPDATE public.billing_template_lines SET active=false, archived_at=COALESCE(archived_at,now()) WHERE id=_id;
  PERFORM public._billing_audit(_society_id,'billing.line.archive','billing_template_lines',_id,'{}'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.archive_billing_template_line(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_billing_template_line(uuid,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.configure_billing_cycle(
  _society_id uuid, _id uuid, _template_id uuid, _cycle_name text,
  _period_start date, _period_end date, _due_date date, _status text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public._billing_require_admin(_society_id);
  IF _period_start IS NULL OR _period_end IS NULL OR _due_date IS NULL
     OR _period_end < _period_start OR _due_date < _period_start THEN
    RAISE EXCEPTION 'invalid_cycle' USING ERRCODE='22023';
  END IF;
  IF COALESCE(_status,'draft') NOT IN ('draft','ready','archived') THEN RAISE EXCEPTION 'invalid_cycle' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.billing_templates WHERE id=_template_id AND society_id=_society_id) THEN
    RAISE EXCEPTION 'template_not_found' USING ERRCODE='P0002';
  END IF;
  IF _id IS NULL THEN
    INSERT INTO public.billing_cycle_configs(society_id,template_id,cycle_name,period_start,period_end,due_date,status,created_by)
    VALUES (_society_id,_template_id,btrim(_cycle_name),_period_start,_period_end,_due_date,COALESCE(_status,'draft'),auth.uid())
    RETURNING id INTO v_id;
    PERFORM public._billing_audit(_society_id,'billing.cycle.create','billing_cycle_configs',v_id,jsonb_build_object('name',_cycle_name));
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.billing_cycle_configs WHERE id=_id AND society_id=_society_id) THEN
      RAISE EXCEPTION 'unavailable' USING ERRCODE='P0002';
    END IF;
    UPDATE public.billing_cycle_configs
       SET template_id=_template_id, cycle_name=btrim(_cycle_name),
           period_start=_period_start, period_end=_period_end, due_date=_due_date,
           status=COALESCE(_status,status),
           archived_at = CASE WHEN COALESCE(_status,status)='archived' AND archived_at IS NULL THEN now() ELSE archived_at END
     WHERE id=_id;
    v_id := _id;
    PERFORM public._billing_audit(_society_id,'billing.cycle.update','billing_cycle_configs',v_id,jsonb_build_object('status',_status));
  END IF;
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.configure_billing_cycle(uuid,uuid,uuid,text,date,date,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.configure_billing_cycle(uuid,uuid,uuid,text,date,date,date,text) TO authenticated, service_role;

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

  SELECT count(*) INTO v_total_units FROM public.flats f
   WHERE f.society_id=_society_id AND f.block_id IS NOT NULL;

  WITH page AS (
    SELECT f.id, f.flat_number, f.type AS unit_type, f.area_sqft, b.name AS block_name
      FROM public.flats f
      LEFT JOIN public.blocks b ON b.id = f.block_id
     WHERE f.society_id=_society_id AND f.block_id IS NOT NULL
     ORDER BY b.name NULLS LAST, f.flat_number
     LIMIT v_lim OFFSET v_off
  ),
  computed AS (
    SELECT p.id, p.flat_number, p.unit_type, p.area_sqft, p.block_name,
      (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'line_id', tl.id, 'name', ch.name, 'rule_type', tl.rule_type,
          'required_approval', tl.required_approval,
          'amount', CASE tl.rule_type
                      WHEN 'fixed_per_unit' THEN tl.amount
                      WHEN 'unit_type_amount' THEN CASE WHEN lower(coalesce(p.unit_type,''))=lower(coalesce(tl.unit_type,'')) THEN tl.amount ELSE 0 END
                      WHEN 'area_based' THEN CASE WHEN p.area_sqft IS NULL OR p.area_sqft=0 THEN NULL ELSE round(tl.rate_per_area*p.area_sqft,2) END
                      ELSE NULL END,
          'warning', CASE WHEN tl.rule_type='area_based' AND (p.area_sqft IS NULL OR p.area_sqft=0) THEN 'area_not_available'
                          WHEN tl.rule_type='manual_variable' THEN 'requires_manual_entry' ELSE NULL END
        ) ORDER BY tl.sort_order), '[]'::jsonb)
        FROM public.billing_template_lines tl
        JOIN public.billing_charge_heads ch ON ch.id=tl.charge_head_id
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

  SELECT COALESCE(sum(unit_sum),0), COALESCE(sum(CASE WHEN has_area_warn THEN 1 ELSE 0 END),0)
    INTO v_summary_total, v_area_warnings
  FROM (
    SELECT
      (
        SELECT COALESCE(sum(
          CASE tl.rule_type
            WHEN 'fixed_per_unit' THEN tl.amount
            WHEN 'unit_type_amount' THEN CASE WHEN lower(coalesce(f.type,''))=lower(coalesce(tl.unit_type,'')) THEN tl.amount ELSE 0 END
            WHEN 'area_based' THEN CASE WHEN f.area_sqft IS NULL OR f.area_sqft=0 THEN 0 ELSE round(tl.rate_per_area*f.area_sqft,2) END
            ELSE 0 END
        ),0)
        FROM public.billing_template_lines tl
        JOIN public.billing_charge_heads ch ON ch.id=tl.charge_head_id
       WHERE tl.template_id=_template_id AND tl.society_id=_society_id AND tl.active=true AND ch.active=true
      ) AS unit_sum,
      EXISTS(
        SELECT 1 FROM public.billing_template_lines tl
         WHERE tl.template_id=_template_id AND tl.society_id=_society_id AND tl.active=true
           AND tl.rule_type='area_based' AND (f.area_sqft IS NULL OR f.area_sqft=0)
      ) AS has_area_warn
    FROM public.flats f
   WHERE f.society_id=_society_id AND f.block_id IS NOT NULL
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
