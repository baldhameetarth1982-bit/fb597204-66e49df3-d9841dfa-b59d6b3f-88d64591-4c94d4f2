REVOKE EXECUTE ON FUNCTION public.search_societies_public(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.find_society_by_code(text)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_applicable_plans(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_razorpay_live()            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_public_pricing_settings() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.search_societies_public(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_society_by_code(text)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_applicable_plans(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_razorpay_live()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_pricing_settings() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.flat_outstanding(uuid)            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.society_maintenance_summary(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.flat_outstanding(uuid)            TO authenticated;
GRANT  EXECUTE ON FUNCTION public.society_maintenance_summary(uuid) TO authenticated;