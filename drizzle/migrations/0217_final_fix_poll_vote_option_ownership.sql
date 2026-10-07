CREATE OR REPLACE FUNCTION public._require_active_member_vote()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _soc uuid;
BEGIN
  IF TG_TABLE_NAME = 'poll_votes' THEN
    SELECT society_id INTO _soc FROM public.polls WHERE id = NEW.poll_id;
    -- The chosen option must belong to the same poll.
    IF NEW.option_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.poll_options o WHERE o.id = NEW.option_id AND o.poll_id = NEW.poll_id) THEN
      RAISE EXCEPTION 'invalid_option' USING ERRCODE = '22023';
    END IF;
  ELSE _soc := NEW.society_id; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = NEW.user_id AND ur.society_id = _soc
                 AND COALESCE(ur.is_active, true) AND ur.role IN ('resident','society_admin','block_admin')) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $function$;