CREATE OR REPLACE FUNCTION public.regenerate_society_invite_code(_society_id uuid)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  new_code text;
  attempts int := 0;
  ok boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.is_society_admin_for(auth.uid(), _society_id) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT allowed INTO ok FROM public.touch_rate_limit('invite_code_change', auth.uid()::text, 20, 3600);
  IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'Too many changes. Try again later.'; END IF;
  LOOP
    new_code := public.generate_society_code();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.societies WHERE invite_code = new_code);
    attempts := attempts + 1;
    IF attempts > 10 THEN RAISE EXCEPTION 'Could not allocate invite code'; END IF;
  END LOOP;
  UPDATE public.societies SET invite_code = new_code, updated_at = now() WHERE id = _society_id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'society.invite_code.regenerate', 'societies', _society_id::text, _society_id,
    jsonb_build_object('by_platform', NOT public.is_society_admin_for(auth.uid(), _society_id)));
  RETURN new_code;
END $function$;

CREATE OR REPLACE FUNCTION public.set_society_invite_code_custom(_society_id uuid, _code text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_code text := upper(regexp_replace(COALESCE(_code,''),'[^A-Za-z0-9]','','g'));
  ok boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.is_society_admin_for(auth.uid(), _society_id) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  -- Rate limit before the uniqueness check so other societies' codes can't be probed.
  SELECT allowed INTO ok FROM public.touch_rate_limit('invite_code_change', auth.uid()::text, 20, 3600);
  IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'Too many changes. Try again later.'; END IF;
  IF length(v_code) < 4 OR length(v_code) > 12 THEN
    RAISE EXCEPTION 'Code must be 4-12 alphanumeric characters';
  END IF;
  IF EXISTS (SELECT 1 FROM public.societies WHERE invite_code = v_code AND id <> _society_id) THEN
    RAISE EXCEPTION 'Code already in use';
  END IF;
  UPDATE public.societies SET invite_code = v_code, updated_at = now() WHERE id = _society_id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'society.invite_code.custom', 'societies', _society_id::text, _society_id,
    jsonb_build_object('by_platform', NOT public.is_society_admin_for(auth.uid(), _society_id)));
  RETURN v_code;
END $function$;

CREATE OR REPLACE FUNCTION public.set_society_invite_code_enabled(_society_id uuid, _enabled boolean)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.is_society_admin_for(auth.uid(), _society_id) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.societies SET invite_code_enabled = COALESCE(_enabled, true), updated_at = now() WHERE id = _society_id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'society.invite_code.enabled', 'societies', _society_id::text, _society_id,
    jsonb_build_object('enabled', COALESCE(_enabled, true), 'by_platform', NOT public.is_society_admin_for(auth.uid(), _society_id)));
  RETURN _enabled;
END $function$;