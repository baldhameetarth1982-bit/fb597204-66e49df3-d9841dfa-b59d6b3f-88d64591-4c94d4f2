UPDATE public.pricing_settings SET enterprise_threshold_units = 300
 WHERE enterprise_threshold_units IS DISTINCT FROM 300;
ALTER TABLE public.pricing_settings ALTER COLUMN enterprise_threshold_units SET DEFAULT 300;
ALTER TABLE public.pricing_settings DROP CONSTRAINT IF EXISTS pricing_settings_standard_ceiling_is_300;
ALTER TABLE public.pricing_settings ADD CONSTRAINT pricing_settings_standard_ceiling_is_300
  CHECK (enterprise_threshold_units = 300);
COMMENT ON COLUMN public.pricing_settings.enterprise_threshold_units IS
  'Standard-plan ceiling. Locked to 300 by product rule: standard <= 300 flats, custom plan > 300.';

CREATE OR REPLACE FUNCTION public.saas_subscription_quote(_society_id uuid, _plan_id text, _flat_quantity integer DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_threshold integer; v_flats integer; v_qty integer; v_price numeric(10,2); v_name text;
  o public.custom_plan_offers%ROWTYPE; v_type text; v_purchased integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (public.is_society_admin_for(auth.uid(), _society_id) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT price_per_flat_inr, name INTO v_price, v_name FROM public.plans
   WHERE id = _plan_id AND id IN ('basic','pro','premium');
  IF v_price IS NULL OR v_price <= 0 THEN RAISE EXCEPTION 'plan_not_available' USING ERRCODE = '22023'; END IF;
  v_threshold := 300; -- product rule; pricing_settings is CHECK-locked to the same value
  SELECT count(*)::integer INTO v_flats FROM public.flats WHERE society_id = _society_id AND is_active;
  SELECT pricing_type INTO v_type FROM public.societies WHERE id = _society_id;
  v_purchased := public._society_flat_capacity(_society_id);

  SELECT * INTO o FROM public.custom_plan_offers
   WHERE society_id = _society_id AND status IN ('accepted','active')
   ORDER BY (status = 'accepted') DESC, created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('plan_id', o.plan_id, 'plan_name', v_name, 'flat_count', o.flat_quantity,
      'current_flats', v_flats,
      'price_per_flat_inr', o.rate_per_flat_inr, 'threshold', v_threshold,
      'custom_pricing', o.plan_id <> _plan_id,
      'pricing_type', 'custom', 'custom_offer_id', o.id, 'term_months', o.term_months,
      'base_amount_paise', o.base_amount_paise, 'tax_amount_paise', o.tax_amount_paise,
      'amount_paise', CASE WHEN o.plan_id <> _plan_id OR o.flat_quantity < v_flats THEN NULL ELSE o.total_amount_paise END);
  END IF;

  IF _flat_quantity IS NOT NULL THEN
    IF _flat_quantity < 1 OR _flat_quantity > 100000 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
    IF _flat_quantity < v_flats THEN
      RAISE EXCEPTION 'quantity_below_current_flats' USING ERRCODE = '22023';
    END IF;
    v_qty := _flat_quantity;
  ELSE
    v_qty := GREATEST(v_flats, CASE WHEN v_type = 'standard' THEN COALESCE(v_purchased, 0) ELSE 0 END);
  END IF;
  RETURN jsonb_build_object(
    'plan_id', _plan_id, 'plan_name', v_name, 'flat_count', v_qty, 'current_flats', v_flats,
    'price_per_flat_inr', v_price, 'threshold', v_threshold,
    'custom_pricing', v_qty > v_threshold OR v_type = 'custom',
    'pricing_type', 'standard', 'term_months', 1,
    'base_amount_paise', CASE WHEN v_qty > v_threshold OR v_qty = 0 OR v_type = 'custom' THEN NULL ELSE round(v_qty * v_price * 100)::integer END,
    'tax_amount_paise', 0,
    'amount_paise', CASE WHEN v_qty > v_threshold OR v_qty = 0 OR v_type = 'custom' THEN NULL
                         ELSE round(v_qty * v_price * 100)::integer END
  );
END $function$;
REVOKE ALL ON FUNCTION public.saas_subscription_quote(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saas_subscription_quote(uuid, text, integer) TO authenticated, service_role;