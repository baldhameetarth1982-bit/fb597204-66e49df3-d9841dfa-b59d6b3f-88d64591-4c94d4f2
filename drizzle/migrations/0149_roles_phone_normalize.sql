CREATE OR REPLACE FUNCTION public._caller_phone_digits()
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN d ~ '^[6-9][0-9]{9}$' THEN '91' || d
              WHEN d ~ '^0[6-9][0-9]{9}$' THEN '91' || substr(d, 2)
              ELSE d END
  FROM (SELECT nullif(regexp_replace(coalesce(u.phone,''),'\D','','g'),'') AS d
        FROM auth.users u WHERE u.id = auth.uid()) x
$function$;
REVOKE ALL ON FUNCTION public._caller_phone_digits() FROM PUBLIC, anon, authenticated;