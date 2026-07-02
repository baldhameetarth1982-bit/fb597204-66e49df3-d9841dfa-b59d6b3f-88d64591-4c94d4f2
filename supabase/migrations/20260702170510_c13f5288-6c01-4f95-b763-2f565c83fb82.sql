
REVOKE EXECUTE ON FUNCTION public.award_points_on_bill_paid() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_oneoff_bills(uuid, text, uuid, uuid, numeric, text, date) FROM anon, PUBLIC;

CREATE OR REPLACE FUNCTION public.custom_plans_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at := now(); RETURN NEW; END $function$;
