DROP FUNCTION IF EXISTS public.admin_income_summary();
CREATE FUNCTION public.admin_income_summary()
RETURNS TABLE(subscription_mrr numeric, collected_total numeric, collected_30d numeric, total_revenue numeric, plans jsonb,
              standard_paid_societies integer, custom_priced_societies integer, custom_mrr numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE _threshold integer;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  SELECT coalesce((SELECT enterprise_threshold_units FROM public.pricing_settings LIMIT 1),300) INTO _threshold;

  WITH paid AS (
    SELECT s.id, p.price_per_flat_inr AS rate,
           (SELECT count(*) FROM public.flats f WHERE f.society_id = s.id AND f.is_active) AS flats
      FROM public.societies s JOIN public.plans p ON p.id = s.plan_id
     WHERE s.plan_status = 'active' AND coalesce(s.status,'active') <> 'suspended'
       AND (s.plan_expires_at IS NULL OR s.plan_expires_at > now())
  )
  SELECT coalesce(sum(rate*flats) FILTER (WHERE flats <= _threshold AND rate > 0 AND flats > 0),0),
         count(*) FILTER (WHERE flats <= _threshold AND rate > 0 AND flats > 0)::int,
         count(*) FILTER (WHERE flats > _threshold)::int,
         coalesce(sum((SELECT cp.price_inr * 30.0 / nullif(cp.duration_days,0)
                         FROM public.custom_plans cp WHERE cp.society_id = paid.id
                         ORDER BY cp.applied_at DESC NULLS LAST, cp.created_at DESC LIMIT 1))
                  FILTER (WHERE flats > _threshold),0)
    INTO subscription_mrr, standard_paid_societies, custom_priced_societies, custom_mrr
    FROM paid;

  SELECT coalesce(sum(amount_paise),0)/100.0,
         coalesce(sum(amount_paise) FILTER (WHERE confirmed_at > now() - interval '30 days'),0)/100.0
    INTO collected_total, collected_30d
    FROM public.saas_subscription_payments WHERE confirmed_at IS NOT NULL;
  total_revenue := subscription_mrr + custom_mrr;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,
           'price_monthly_inr',p.price_per_flat_inr,'price_per_flat_inr',p.price_per_flat_inr,
           'society_count',(SELECT count(*) FROM public.societies s WHERE s.plan_id=p.id)) ORDER BY p.sort_order),'[]'::jsonb)
    INTO plans FROM public.plans p WHERE p.id NOT IN ('ad_free','resident');
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.admin_income_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_income_summary() TO authenticated, service_role;