ALTER FUNCTION public._support_events_immutable() SET search_path = public, pg_temp;
ALTER FUNCTION public._visitor_clean(text, integer) SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public._support_events_immutable() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._visitor_clean(text, integer) FROM anon;