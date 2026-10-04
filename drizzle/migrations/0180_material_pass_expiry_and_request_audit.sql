ALTER TABLE public.material_passes DROP CONSTRAINT material_passes_status_check;
ALTER TABLE public.material_passes ADD CONSTRAINT material_passes_status_check CHECK (status = ANY (ARRAY['pending','approved','rejected','cancelled','in_progress','completed','expired']));

CREATE OR REPLACE FUNCTION public.request_material_pass(_flat_id uuid, _kind text, _description text, _from timestamp with time zone, _until timestamp with time zone, _lift boolean, _contractor text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _sid uuid; _id uuid;
BEGIN
  SELECT society_id INTO _sid FROM public._my_active_flat() WHERE flat_id = _flat_id;
  IF _sid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  IF _from < now() - interval '1 hour' THEN RAISE EXCEPTION 'Start time is in the past'; END IF;
  IF _until <= _from THEN RAISE EXCEPTION 'End time must be after start time'; END IF;
  IF (SELECT count(*) FROM material_passes WHERE requested_by=auth.uid() AND created_at > now()-interval '1 day') >= 10 THEN
    RAISE EXCEPTION 'rate_limited'; END IF;
  INSERT INTO material_passes(society_id, flat_id, requested_by, kind, description, valid_from, valid_until, lift_required, contractor_name)
  VALUES (_sid, _flat_id, auth.uid(), _kind, trim(_description), _from, _until, COALESCE(_lift,false), NULLIF(trim(_contractor),''))
  RETURNING id INTO _id;
  INSERT INTO audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'material_pass.request', 'material_passes', _id::text, _sid, jsonb_build_object('kind',_kind,'lift',COALESCE(_lift,false)));
  PERFORM public._notify_society_admins(_sid, 'material_pass', 'Pass awaiting approval',
    'A '||replace(_kind,'_',' ')||' pass request needs review.', '/society/passes');
  RETURN _id;
END $function$;

CREATE OR REPLACE FUNCTION public.expire_material_passes()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT id, society_id, requested_by, kind FROM material_passes
    WHERE status IN ('pending','approved') AND valid_until < now() LIMIT 1000 FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE material_passes SET status='expired' WHERE id=r.id;
    INSERT INTO audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (NULL, 'material_pass.expired', 'material_passes', r.id::text, r.society_id, '{}'::jsonb);
    PERFORM public._notify_user(r.requested_by, r.society_id, 'material_pass', 'Pass expired',
      'Your '||replace(r.kind,'_',' ')||' pass time window has ended.', '/app/passes');
    n := n + 1;
  END LOOP;
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION public.expire_material_passes() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('expire-material-passes-hourly', '20 * * * *', 'SELECT public.expire_material_passes()');