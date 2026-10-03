CREATE TABLE public.temporary_occupants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_id uuid NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 80),
  relation text NOT NULL CHECK (relation IN ('guest','relative','caretaker','other')),
  phone text CHECK (phone IS NULL OR phone ~ '^[0-9+ ]{8,16}$'),
  stay_from date NOT NULL,
  stay_until date NOT NULL,
  ended_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (stay_until >= stay_from AND stay_until <= stay_from + 180)
);
CREATE INDEX temporary_occupants_flat_idx ON public.temporary_occupants(flat_id, stay_until);
CREATE INDEX temporary_occupants_society_idx ON public.temporary_occupants(society_id, stay_until);
GRANT SELECT ON public.temporary_occupants TO authenticated;
GRANT ALL ON public.temporary_occupants TO service_role;
ALTER TABLE public.temporary_occupants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Household or admins read temporary occupants" ON public.temporary_occupants
  FOR SELECT TO authenticated
  USING (flat_id IN (SELECT flat_id FROM public._my_active_flat()) OR public._helpdesk_is_admin(society_id));

CREATE OR REPLACE FUNCTION public.add_temporary_occupant(_name text, _relation text, _phone text, _from date, _until date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _f record; _id uuid; _rl record; _n int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO _f FROM public._my_active_flat() LIMIT 1;
  IF _f.flat_id IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO _rl FROM public.touch_rate_limit('temp_occupant', auth.uid()::text, 20, 86400);
  IF NOT _rl.allowed THEN RAISE EXCEPTION 'rate_limited'; END IF;
  IF _from < current_date - 1 THEN RAISE EXCEPTION 'invalid_dates'; END IF;
  SELECT count(*) INTO _n FROM public.temporary_occupants
   WHERE flat_id = _f.flat_id AND ended_at IS NULL AND stay_until >= current_date;
  IF _n >= 10 THEN RAISE EXCEPTION 'too_many_occupants'; END IF;
  INSERT INTO public.temporary_occupants(society_id, flat_id, full_name, relation, phone, stay_from, stay_until, created_by)
  VALUES (_f.society_id, _f.flat_id, btrim(_name), _relation, nullif(btrim(coalesce(_phone,'')),''), _from, _until, auth.uid())
  RETURNING id INTO _id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'temporary_occupant.added', 'temporary_occupants', _id, _f.society_id,
          jsonb_build_object('from', _from, 'until', _until, 'relation', _relation));
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.end_temporary_occupant(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.temporary_occupants;
BEGIN
  SELECT * INTO _r FROM public.temporary_occupants WHERE id = _id FOR UPDATE;
  IF _r.id IS NULL OR NOT (_r.flat_id IN (SELECT flat_id FROM public._my_active_flat()) OR public._helpdesk_is_admin(_r.society_id)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF _r.ended_at IS NOT NULL THEN RETURN; END IF;
  UPDATE public.temporary_occupants SET ended_at = now() WHERE id = _id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'temporary_occupant.ended', 'temporary_occupants', _id, _r.society_id, '{}'::jsonb);
END $$;

REVOKE EXECUTE ON FUNCTION public.add_temporary_occupant(text,text,text,date,date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.end_temporary_occupant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_temporary_occupant(text,text,text,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_temporary_occupant(uuid) TO authenticated;