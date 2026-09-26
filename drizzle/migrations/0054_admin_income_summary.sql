CREATE OR REPLACE FUNCTION public.admin_income_summary()
RETURNS TABLE(subscription_mrr numeric, collected_total numeric, collected_30d numeric, total_revenue numeric, plans jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  SELECT coalesce(sum(p.price_monthly_inr),0) INTO subscription_mrr
    FROM public.societies s JOIN public.plans p ON p.id = s.plan_id
    WHERE s.plan_status = 'active' AND coalesce(s.status,'active') <> 'suspended'
      AND (s.plan_expires_at IS NULL OR s.plan_expires_at > now());
  SELECT coalesce(sum(amount_paise),0)/100.0,
         coalesce(sum(amount_paise) FILTER (WHERE confirmed_at > now() - interval '30 days'),0)/100.0
    INTO collected_total, collected_30d
    FROM public.saas_subscription_payments WHERE confirmed_at IS NOT NULL;
  total_revenue := subscription_mrr;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'price_monthly_inr',p.price_monthly_inr,
           'society_count',(SELECT count(*) FROM public.societies s WHERE s.plan_id=p.id)) ORDER BY p.price_monthly_inr),'[]'::jsonb)
    INTO plans FROM public.plans p WHERE p.id NOT IN ('ad_free','resident');
  RETURN NEXT;
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_income_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_income_summary() TO authenticated;