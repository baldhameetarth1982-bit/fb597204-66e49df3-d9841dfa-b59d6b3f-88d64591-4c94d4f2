CREATE TABLE public.utility_meters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_id uuid REFERENCES public.flats(id) ON DELETE SET NULL,
  utility text NOT NULL CHECK (utility IN ('electricity','water','gas','other')),
  meter_number text NOT NULL CHECK (char_length(meter_number) BETWEEN 1 AND 60),
  label text CHECK (label IS NULL OR char_length(label) <= 80),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','replaced','retired')),
  replaced_by uuid REFERENCES public.utility_meters(id),
  installed_on date NOT NULL DEFAULT current_date,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX utility_meters_active_number ON public.utility_meters(society_id, utility, meter_number) WHERE status='active';
CREATE INDEX utility_meters_society ON public.utility_meters(society_id, status);

CREATE TABLE public.utility_meter_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  meter_id uuid NOT NULL REFERENCES public.utility_meters(id) ON DELETE CASCADE,
  reading_date date NOT NULL,
  reading numeric(14,3) NOT NULL CHECK (reading >= 0),
  units numeric(14,3) NOT NULL DEFAULT 0 CHECK (units >= 0),
  is_abnormal boolean NOT NULL DEFAULT false,
  note text CHECK (note IS NULL OR char_length(note) <= 200),
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meter_id, reading_date)
);
CREATE INDEX utility_meter_readings_meter ON public.utility_meter_readings(meter_id, reading_date DESC);

GRANT SELECT ON public.utility_meters, public.utility_meter_readings TO authenticated;
GRANT ALL ON public.utility_meters, public.utility_meter_readings TO service_role;
ALTER TABLE public.utility_meters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_meter_readings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Committee reads meters" ON public.utility_meters FOR SELECT TO authenticated
  USING (public.current_user_has_society_permission(society_id, 'society.settings', NULL));
CREATE POLICY "Committee reads readings" ON public.utility_meter_readings FOR SELECT TO authenticated
  USING (public.current_user_has_society_permission(society_id, 'society.settings', NULL));
CREATE TRIGGER utility_meter_readings_append_only BEFORE UPDATE OR DELETE ON public.utility_meter_readings
  FOR EACH ROW EXECUTE FUNCTION public._append_only();

CREATE OR REPLACE FUNCTION public.admin_register_meter(_society_id uuid, _utility text, _meter_number text, _flat_id uuid, _label text, _replaces uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _old public.utility_meters;
BEGIN
  IF NOT public.current_user_has_society_permission(_society_id, 'society.settings', NULL) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _flat_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM flats WHERE id=_flat_id AND society_id=_society_id) THEN
    RAISE EXCEPTION 'Home not in this society'; END IF;
  IF _replaces IS NOT NULL THEN
    SELECT * INTO _old FROM utility_meters WHERE id=_replaces AND society_id=_society_id AND status='active' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Meter to replace not found or not active'; END IF;
    UPDATE utility_meters SET status='replaced' WHERE id=_old.id;
    _flat_id := COALESCE(_flat_id, _old.flat_id); _utility := _old.utility;
  END IF;
  INSERT INTO utility_meters(society_id, flat_id, utility, meter_number, label, created_by)
  VALUES (_society_id, _flat_id, _utility, trim(_meter_number), NULLIF(trim(_label),''), auth.uid()) RETURNING id INTO _id;
  IF _replaces IS NOT NULL THEN UPDATE utility_meters SET replaced_by=_id WHERE id=_replaces; END IF;
  INSERT INTO audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), CASE WHEN _replaces IS NULL THEN 'meter.register' ELSE 'meter.replace' END, 'utility_meters', _id::text, _society_id,
          jsonb_build_object('utility', _utility, 'replaces', _replaces));
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_record_meter_reading(_meter_id uuid, _reading_date date, _reading numeric, _note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _m public.utility_meters; _prev public.utility_meter_readings; _units numeric; _avg numeric; _abn boolean := false; _id uuid;
BEGIN
  SELECT * INTO _m FROM utility_meters WHERE id=_meter_id FOR UPDATE;
  IF NOT FOUND OR NOT public.current_user_has_society_permission(_m.society_id, 'society.settings', NULL) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF _m.status <> 'active' THEN RAISE EXCEPTION 'Meter is not active'; END IF;
  IF _reading IS NULL OR _reading < 0 THEN RAISE EXCEPTION 'Reading must be zero or more'; END IF;
  IF _reading_date > current_date THEN RAISE EXCEPTION 'Reading date cannot be in the future'; END IF;
  IF _reading_date < _m.installed_on THEN RAISE EXCEPTION 'Reading date is before the meter was installed'; END IF;
  SELECT * INTO _prev FROM utility_meter_readings WHERE meter_id=_meter_id ORDER BY reading_date DESC LIMIT 1;
  IF FOUND THEN
    IF _reading_date <= _prev.reading_date THEN RAISE EXCEPTION 'Readings must be newer than the last reading (%)', _prev.reading_date; END IF;
    IF _reading < _prev.reading THEN RAISE EXCEPTION 'Reading is lower than the last reading (%). Replace the meter if it was changed.', _prev.reading; END IF;
    _units := _reading - _prev.reading;
    SELECT avg(units) INTO _avg FROM (SELECT units FROM utility_meter_readings WHERE meter_id=_meter_id AND units>0 ORDER BY reading_date DESC LIMIT 6) s;
    _abn := _avg IS NOT NULL AND _avg > 0 AND (_units > _avg*3 OR _units = 0);
  ELSE _units := 0; END IF;
  INSERT INTO utility_meter_readings(society_id, meter_id, reading_date, reading, units, is_abnormal, note, recorded_by)
  VALUES (_m.society_id, _meter_id, _reading_date, _reading, _units, _abn, NULLIF(trim(_note),''), auth.uid()) RETURNING id INTO _id;
  INSERT INTO audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'meter.reading', 'utility_meter_readings', _id::text, _m.society_id, jsonb_build_object('meter', _meter_id, 'units', _units, 'abnormal', _abn));
  RETURN jsonb_build_object('id', _id, 'units', _units, 'abnormal', _abn);
END $$;

REVOKE ALL ON FUNCTION public.admin_register_meter(uuid,text,text,uuid,text,uuid), public.admin_record_meter_reading(uuid,date,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_register_meter(uuid,text,text,uuid,text,uuid), public.admin_record_meter_reading(uuid,date,numeric,text) TO authenticated;