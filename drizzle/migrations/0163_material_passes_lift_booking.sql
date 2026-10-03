CREATE TABLE public.material_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_id uuid NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('material_in','material_out','construction','move_in','move_out')),
  description text NOT NULL CHECK (char_length(description) BETWEEN 3 AND 300),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  lift_required boolean NOT NULL DEFAULT false,
  contractor_name text CHECK (contractor_name IS NULL OR char_length(contractor_name) <= 80),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled','in_progress','completed')),
  decision_reason text CHECK (decision_reason IS NULL OR char_length(decision_reason) <= 200),
  decided_by uuid, decided_at timestamptz, checked_in_at timestamptz, checked_out_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until > valid_from),
  CHECK (valid_until - valid_from <= interval '90 days')
);
CREATE INDEX material_passes_society ON public.material_passes(society_id, status, valid_from);
GRANT SELECT ON public.material_passes TO authenticated;
GRANT ALL ON public.material_passes TO service_role;
ALTER TABLE public.material_passes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Committee reads passes" ON public.material_passes FOR SELECT TO authenticated
  USING (public.current_user_has_society_permission(society_id, 'society.settings', NULL));
CREATE POLICY "Requester reads own passes" ON public.material_passes FOR SELECT TO authenticated
  USING (requested_by = auth.uid());
CREATE POLICY "Guards read approved passes" ON public.material_passes FOR SELECT TO authenticated
  USING (society_id = public._guard_role_society() AND status IN ('approved','in_progress','completed'));

CREATE OR REPLACE FUNCTION public.request_material_pass(_flat_id uuid, _kind text, _description text, _from timestamptz, _until timestamptz, _lift boolean, _contractor text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sid uuid; _id uuid;
BEGIN
  SELECT society_id INTO _sid FROM public._my_active_flat() WHERE flat_id = _flat_id;
  IF _sid IS NULL THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  IF _from < now() - interval '1 hour' THEN RAISE EXCEPTION 'Start time is in the past'; END IF;
  IF (SELECT count(*) FROM material_passes WHERE requested_by=auth.uid() AND created_at > now()-interval '1 day') >= 10 THEN
    RAISE EXCEPTION 'rate_limited'; END IF;
  INSERT INTO material_passes(society_id, flat_id, requested_by, kind, description, valid_from, valid_until, lift_required, contractor_name)
  VALUES (_sid, _flat_id, auth.uid(), _kind, trim(_description), _from, _until, COALESCE(_lift,false), NULLIF(trim(_contractor),''))
  RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.decide_material_pass(_pass_id uuid, _approve boolean, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p material_passes;
BEGIN
  SELECT * INTO _p FROM material_passes WHERE id=_pass_id FOR UPDATE;
  IF NOT FOUND OR NOT public.current_user_has_society_permission(_p.society_id, 'society.settings', NULL) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  IF _p.status <> 'pending' THEN RAISE EXCEPTION 'invalid_transition'; END IF;
  IF NOT _approve AND COALESCE(trim(_reason),'') = '' THEN RAISE EXCEPTION 'A reason is required to reject'; END IF;
  IF _approve AND _p.lift_required THEN
    PERFORM pg_advisory_xact_lock(hashtext('lift:'||_p.society_id::text));
    IF EXISTS (SELECT 1 FROM material_passes WHERE society_id=_p.society_id AND id<>_p.id AND lift_required
               AND status IN ('approved','in_progress') AND tstzrange(valid_from,valid_until) && tstzrange(_p.valid_from,_p.valid_until)) THEN
      RAISE EXCEPTION 'The service lift is already booked for part of this time'; END IF;
  END IF;
  UPDATE material_passes SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
    decision_reason = NULLIF(trim(_reason),''), decided_by=auth.uid(), decided_at=now() WHERE id=_p.id;
  INSERT INTO audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), CASE WHEN _approve THEN 'material_pass.approve' ELSE 'material_pass.reject' END, 'material_passes', _p.id::text, _p.society_id, jsonb_build_object('kind',_p.kind,'lift',_p.lift_required));
  PERFORM public._notify_user(_p.requested_by, _p.society_id, 'material_pass',
    CASE WHEN _approve THEN 'Pass approved' ELSE 'Pass rejected' END,
    CASE WHEN _approve THEN 'Your '||replace(_p.kind,'_',' ')||' pass is approved.' ELSE 'Reason: '||_reason END, '/app/passes');
END $$;

CREATE OR REPLACE FUNCTION public.cancel_material_pass(_pass_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE material_passes SET status='cancelled' WHERE id=_pass_id AND requested_by=auth.uid() AND status IN ('pending','approved');
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_transition'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.guard_mark_material_pass(_pass_id uuid, _action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p material_passes;
BEGIN
  SELECT * INTO _p FROM material_passes WHERE id=_pass_id FOR UPDATE;
  IF NOT FOUND OR _p.society_id IS DISTINCT FROM public._guard_role_society() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  IF _action='in' AND _p.status='approved' THEN
    IF now() < _p.valid_from - interval '30 minutes' OR now() > _p.valid_until THEN RAISE EXCEPTION 'Pass is not valid right now'; END IF;
    UPDATE material_passes SET status='in_progress', checked_in_at=now() WHERE id=_p.id;
  ELSIF _action='done' AND _p.status='in_progress' THEN
    UPDATE material_passes SET status='completed', checked_out_at=now() WHERE id=_p.id;
  ELSE RAISE EXCEPTION 'invalid_transition'; END IF;
  INSERT INTO audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'material_pass.'||_action, 'material_passes', _p.id::text, _p.society_id, '{}'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.request_material_pass(uuid,text,text,timestamptz,timestamptz,boolean,text), public.decide_material_pass(uuid,boolean,text), public.cancel_material_pass(uuid), public.guard_mark_material_pass(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_material_pass(uuid,text,text,timestamptz,timestamptz,boolean,text), public.decide_material_pass(uuid,boolean,text), public.cancel_material_pass(uuid), public.guard_mark_material_pass(uuid,text) TO authenticated;