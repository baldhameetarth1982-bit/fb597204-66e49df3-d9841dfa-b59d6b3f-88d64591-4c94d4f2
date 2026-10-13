CREATE OR REPLACE FUNCTION public.saas_upi_quote(_society_id uuid, _plan_id text, _flat_quantity integer, _term_months integer, _discount_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  q jsonb; v_term integer := COALESCE(_term_months, 1); v_code text; c public.saas_discount_codes%ROWTYPE;
  v_status text; v_month bigint; v_gross bigint; v_tpct numeric; v_tdisc bigint; v_cdisc bigint := 0;
  v_net bigint; v_taxp numeric; v_tax bigint; v_uses integer; v_pf numeric;
BEGIN
  IF v_term NOT IN (1,3,12) THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023'; END IF;
  q := public.saas_subscription_quote(_society_id, _plan_id, _flat_quantity);
  IF q->>'pricing_type' = 'custom' OR COALESCE((q->>'custom_pricing')::boolean, false) OR q->>'amount_paise' IS NULL THEN
    RETURN q || jsonb_build_object('term_discount_percent', 0, 'term_discount_paise', 0, 'code_discount_paise', 0,
      'gross_amount_paise', q->'base_amount_paise', 'discount_code_status', NULL, 'discount_code_id', NULL);
  END IF;
  v_month := (q->>'base_amount_paise')::bigint;
  v_taxp := COALESCE((q->>'tax_percent')::numeric, 0);
  v_gross := v_month * v_term;
  v_tpct := public._saas_term_discount_percent(v_term);
  -- Term price per flat is rounded to whole rupees (e.g. 24 -> 23 a quarter).
  v_pf := COALESCE((q->>'price_per_flat_inr')::numeric, 0) * v_term;
  IF v_term = 1 OR v_pf <= 0 THEN v_tdisc := round(v_gross * v_tpct / 100)::bigint;
  ELSE v_tdisc := v_gross - round(v_gross * round(v_pf * (100 - v_tpct) / 100) / v_pf)::bigint; END IF;

  v_code := NULLIF(upper(trim(COALESCE(_discount_code, ''))), '');
  IF v_code IS NOT NULL THEN
    SELECT * INTO c FROM public.saas_discount_codes WHERE code = v_code;
    IF NOT FOUND OR NOT c.is_active THEN v_status := 'invalid';
    ELSIF c.valid_from IS NOT NULL AND now() < c.valid_from THEN v_status := 'not_started';
    ELSIF c.valid_until IS NOT NULL AND now() > c.valid_until THEN v_status := 'expired';
    ELSIF c.plan_ids IS NOT NULL AND NOT (_plan_id = ANY (c.plan_ids)) THEN v_status := 'not_for_plan';
    ELSIF EXISTS (SELECT 1 FROM public.saas_upi_payment_requests WHERE discount_code_id = c.id AND society_id = _society_id AND status IN ('pending','approved')) THEN v_status := 'already_used';
    ELSE
      SELECT count(*)::integer INTO v_uses FROM public.saas_upi_payment_requests WHERE discount_code_id = c.id AND status IN ('pending','approved');
      IF c.max_uses IS NOT NULL AND v_uses >= c.max_uses THEN v_status := 'used_up';
      ELSE v_status := 'applied'; v_cdisc := round((v_gross - v_tdisc) * c.percent_off / 100)::bigint; END IF;
    END IF;
  END IF;

  v_net := GREATEST(v_gross - v_tdisc - v_cdisc, 0);
  v_tax := round(v_net * v_taxp / 100)::bigint;
  RETURN q || jsonb_build_object(
    'term_months', v_term, 'gross_amount_paise', v_gross,
    'term_discount_percent', v_tpct, 'term_discount_paise', v_tdisc,
    'discount_code', v_code, 'discount_code_status', v_status,
    'discount_code_percent', CASE WHEN v_status = 'applied' THEN c.percent_off END,
    'discount_code_id', CASE WHEN v_status = 'applied' THEN c.id END,
    'code_discount_paise', v_cdisc,
    'base_amount_paise', v_net, 'tax_amount_paise', v_tax, 'amount_paise', v_net + v_tax);
END $function$;