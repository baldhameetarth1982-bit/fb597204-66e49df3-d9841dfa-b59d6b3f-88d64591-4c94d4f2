CREATE TABLE public.flat_pets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_id uuid NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  species text NOT NULL CHECK (species IN ('dog','cat','bird','fish','other')),
  breed text CHECK (breed IS NULL OR char_length(breed) <= 40),
  vaccinated_until date,
  is_active boolean NOT NULL DEFAULT true,
  added_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);
CREATE INDEX flat_pets_flat_idx ON public.flat_pets(flat_id) WHERE is_active;
CREATE INDEX flat_pets_society_idx ON public.flat_pets(society_id) WHERE is_active;
GRANT SELECT ON public.flat_pets TO authenticated;
GRANT ALL ON public.flat_pets TO service_role;
ALTER TABLE public.flat_pets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Home or committee can view pets" ON public.flat_pets FOR SELECT TO authenticated
USING (
  flat_id IN (SELECT flat_id FROM public._my_active_flat())
  OR society_id = public._gov_admin_society()
);

CREATE OR REPLACE FUNCTION public.resident_add_pet(_name text, _species text, _breed text, _vaccinated_until date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_flat uuid; v_soc uuid; v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT flat_id, society_id INTO v_flat, v_soc FROM public._my_active_flat();
  IF v_flat IS NULL THEN RAISE EXCEPTION 'No active home found.'; END IF;
  IF (SELECT count(*) FROM public.flat_pets WHERE flat_id = v_flat AND is_active) >= 10 THEN
    RAISE EXCEPTION 'Maximum 10 pets per home.'; END IF;
  INSERT INTO public.flat_pets(society_id, flat_id, name, species, breed, vaccinated_until, added_by)
  VALUES (v_soc, v_flat, btrim(_name), _species, nullif(btrim(coalesce(_breed,'')),''), _vaccinated_until, auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO public.audit_log(actor_id, society_id, target_table, target_id, action, metadata)
  VALUES (auth.uid(), v_soc, 'flat_pets', v_id, 'pet.add', jsonb_build_object('species', _species));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.resident_remove_pet(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_flat uuid; v_soc uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT flat_id INTO v_flat FROM public._my_active_flat();
  UPDATE public.flat_pets SET is_active = false, removed_at = now()
   WHERE id = _id AND flat_id = v_flat AND is_active RETURNING society_id INTO v_soc;
  IF v_soc IS NULL THEN RAISE EXCEPTION 'Pet not found.'; END IF;
  INSERT INTO public.audit_log(actor_id, society_id, target_table, target_id, action, metadata)
  VALUES (auth.uid(), v_soc, 'flat_pets', _id, 'pet.remove', '{}'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.resident_add_pet(text,text,text,date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resident_remove_pet(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resident_add_pet(text,text,text,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resident_remove_pet(uuid) TO authenticated;