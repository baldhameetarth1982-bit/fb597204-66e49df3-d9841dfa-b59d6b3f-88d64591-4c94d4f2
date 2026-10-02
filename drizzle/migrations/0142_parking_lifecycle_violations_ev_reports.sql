-- Parking & Vehicles: allocation lifecycle, temporary parking, capacity, violations, EV, reports.
-- Extends parking_slots/vehicles; parking_slots.flat_id/vehicle_id stay as the mirror of the current permanent allocation.

ALTER TABLE public.parking_slots
  ADD COLUMN IF NOT EXISTS block_id uuid REFERENCES public.blocks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS floor text,
  ADD COLUMN IF NOT EXISTS ev_capable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS availability text NOT NULL DEFAULT 'open';
DO $$ BEGIN
  ALTER TABLE public.parking_slots ADD CONSTRAINT parking_slots_availability_chk CHECK (availability IN ('open','reserved','unavailable'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.parking_slots ADD CONSTRAINT parking_slots_floor_len CHECK (floor IS NULL OR char_length(floor) <= 20);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Allocations (permanent + temporary), history never deleted
CREATE TABLE public.parking_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  slot_id uuid NOT NULL REFERENCES public.parking_slots(id),
  kind text NOT NULL CHECK (kind IN ('permanent','temporary')),
  flat_id uuid REFERENCES public.flats(id),
  vehicle_id uuid REFERENCES public.vehicles(id),
  temp_purpose text CHECK (temp_purpose IS NULL OR temp_purpose IN ('guest','maintenance','replacement_vehicle','short_term','other')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  reason text CHECK (reason IS NULL OR char_length(reason) <= 300),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','expired','cancelled')),
  issued_by uuid,
  released_at timestamptz,
  released_by uuid,
  release_reason text CHECK (release_reason IS NULL OR char_length(release_reason) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'permanent' OR (ends_at IS NOT NULL AND ends_at > starts_at)),
  CHECK (kind = 'temporary' OR ends_at IS NULL),
  CHECK (flat_id IS NOT NULL OR vehicle_id IS NOT NULL OR kind = 'temporary')
);
CREATE UNIQUE INDEX parking_alloc_one_active_permanent ON public.parking_allocations(slot_id) WHERE status = 'active' AND kind = 'permanent';
CREATE INDEX parking_alloc_society ON public.parking_allocations(society_id, status, kind);
CREATE INDEX parking_alloc_flat ON public.parking_allocations(flat_id) WHERE status = 'active';
CREATE INDEX parking_alloc_vehicle ON public.parking_allocations(vehicle_id) WHERE status = 'active';
GRANT SELECT ON public.parking_allocations TO authenticated;
GRANT ALL ON public.parking_allocations TO service_role;
ALTER TABLE public.parking_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gate and admins view allocations" ON public.parking_allocations FOR SELECT TO authenticated
  USING (society_id = public._gate_society());
CREATE POLICY "residents view own flat allocations" ON public.parking_allocations FOR SELECT TO authenticated
  USING (flat_id IN (SELECT fr.flat_id FROM public.flat_residents fr WHERE fr.user_id = auth.uid() AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL));

-- Violations (never financial)
CREATE TABLE public.parking_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  violation_type text NOT NULL CHECK (violation_type IN ('wrong_slot','unauthorized','expired_temporary','blocking_access','ev_misuse','visitor_slot_misuse','other')),
  slot_id uuid REFERENCES public.parking_slots(id),
  vehicle_id uuid REFERENCES public.vehicles(id),
  flat_id uuid REFERENCES public.flats(id),
  plate_text text CHECK (plate_text IS NULL OR char_length(plate_text) <= 15),
  location text CHECK (location IS NULL OR char_length(location) <= 120),
  description text CHECK (description IS NULL OR char_length(description) <= 500),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  reported_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','warned','resolved','dismissed')),
  resolution_note text CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 500),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX parking_viol_society ON public.parking_violations(society_id, status, occurred_at DESC);
CREATE INDEX parking_viol_vehicle ON public.parking_violations(vehicle_id);
CREATE INDEX parking_viol_plate ON public.parking_violations(society_id, plate_text);
GRANT SELECT ON public.parking_violations TO authenticated;
GRANT ALL ON public.parking_violations TO service_role;
ALTER TABLE public.parking_violations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gate and admins view violations" ON public.parking_violations FOR SELECT TO authenticated
  USING (society_id = public._gate_society());
CREATE POLICY "residents view own flat violations" ON public.parking_violations FOR SELECT TO authenticated
  USING (flat_id IN (SELECT fr.flat_id FROM public.flat_residents fr WHERE fr.user_id = auth.uid() AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL));

-- EV chargers + sessions (no invented readings, no money)
CREATE TABLE public.ev_chargers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  slot_id uuid REFERENCES public.parking_slots(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  connector text CHECK (connector IS NULL OR char_length(connector) <= 40),
  rated_kw numeric(6,2) CHECK (rated_kw IS NULL OR (rated_kw > 0 AND rated_kw <= 400)),
  provider text NOT NULL DEFAULT 'manual' CHECK (provider IN ('manual','unconfigured')),
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','offline','disabled')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ev_chargers_slot_active ON public.ev_chargers(slot_id) WHERE is_active AND slot_id IS NOT NULL;
GRANT SELECT ON public.ev_chargers TO authenticated;
GRANT ALL ON public.ev_chargers TO service_role;
ALTER TABLE public.ev_chargers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gate and admins view chargers" ON public.ev_chargers FOR SELECT TO authenticated
  USING (society_id = public._gate_society());

CREATE TABLE public.ev_charging_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  charger_id uuid NOT NULL REFERENCES public.ev_chargers(id),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  flat_id uuid REFERENCES public.flats(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  energy_kwh numeric(8,3) CHECK (energy_kwh IS NULL OR (energy_kwh >= 0 AND energy_kwh <= 1000)),
  energy_source text CHECK (energy_source IS NULL OR energy_source IN ('meter_reading_entered','provider')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  started_by uuid NOT NULL,
  ended_by uuid,
  note text CHECK (note IS NULL OR char_length(note) <= 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ev_session_one_active_charger ON public.ev_charging_sessions(charger_id) WHERE status = 'active';
CREATE UNIQUE INDEX ev_session_one_active_vehicle ON public.ev_charging_sessions(vehicle_id) WHERE status = 'active';
CREATE INDEX ev_session_society ON public.ev_charging_sessions(society_id, started_at DESC);
GRANT SELECT ON public.ev_charging_sessions TO authenticated;
GRANT ALL ON public.ev_charging_sessions TO service_role;
ALTER TABLE public.ev_charging_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gate and admins view ev sessions" ON public.ev_charging_sessions FOR SELECT TO authenticated
  USING (society_id = public._gate_society());
CREATE POLICY "residents view own ev sessions" ON public.ev_charging_sessions FOR SELECT TO authenticated
  USING (flat_id IN (SELECT fr.flat_id FROM public.flat_residents fr WHERE fr.user_id = auth.uid() AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL));

-- Backfill existing permanent allotments into history
INSERT INTO public.parking_allocations (society_id, slot_id, kind, flat_id, vehicle_id, starts_at, reason, status)
SELECT society_id, id, 'permanent', flat_id, vehicle_id, coalesce(updated_at, created_at), 'Existing allotment', 'active'
FROM public.parking_slots WHERE is_active AND (flat_id IS NOT NULL OR vehicle_id IS NOT NULL);

-- ===== helpers =====
CREATE OR REPLACE FUNCTION public._parking_admin_society() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT society_id FROM public.user_roles WHERE user_id = auth.uid() AND role = 'society_admin'
    AND is_active IS NOT FALSE AND society_id IS NOT NULL ORDER BY created_at LIMIT 1 $$;

CREATE OR REPLACE FUNCTION public._flat_has_current_occupant(_flat uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.flat_residents fr WHERE fr.flat_id = _flat AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL
                   AND (fr.access_expires_at IS NULL OR fr.access_expires_at > now()))
      OR EXISTS (SELECT 1 FROM public.offline_residents o WHERE o.flat_id = _flat) $$;

CREATE OR REPLACE FUNCTION public._parking_audit(_sid uuid, _action text, _target text, _id uuid, _meta jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), _action, _target, _id::text, _sid, coalesce(_meta,'{}'::jsonb)) $$;

-- Lazy server-side expiry of temporary allocations (never trusts client time)
CREATE OR REPLACE FUNCTION public.parking_sweep(_sid uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  UPDATE public.parking_allocations SET status = 'expired', released_at = ends_at
  WHERE status = 'active' AND kind = 'temporary' AND ends_at <= now() AND (_sid IS NULL OR society_id = _sid);
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;

-- Validates a flat/vehicle pair for this society; returns the resolved flat
CREATE OR REPLACE FUNCTION public._parking_resolve_holder(_sid uuid, _flat uuid, _vehicle uuid, _require_occupant boolean) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE vflat uuid;
BEGIN
  IF _vehicle IS NOT NULL THEN
    SELECT flat_id INTO vflat FROM public.vehicles WHERE id = _vehicle AND society_id = _sid AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'vehicle_not_found' USING ERRCODE='P0002'; END IF;
    IF _flat IS NULL THEN _flat := vflat; END IF;
    IF vflat IS NOT NULL AND vflat <> _flat THEN RAISE EXCEPTION 'vehicle_flat_mismatch' USING ERRCODE='22023'; END IF;
  END IF;
  IF _flat IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.flats WHERE id = _flat AND society_id = _sid AND is_active IS NOT FALSE) THEN
      RAISE EXCEPTION 'flat_not_found' USING ERRCODE='P0002'; END IF;
    IF _require_occupant AND NOT public._flat_has_current_occupant(_flat) THEN
      RAISE EXCEPTION 'no_current_occupant' USING ERRCODE='22023'; END IF;
  END IF;
  RETURN _flat;
END $$;

-- ===== slot fields =====
CREATE OR REPLACE FUNCTION public.admin_parking_slot_save(_id uuid, _label text, _slot_type text, _block_id uuid, _floor text, _ev_capable boolean, _availability text, _notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._parking_admin_society(); pid uuid; cur record;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  PERFORM public._rate_hit('parking_admin', auth.uid()::text, 120, interval '1 hour');
  _label := upper(public._visitor_clean(_label, 20));
  IF _label IS NULL THEN RAISE EXCEPTION 'invalid_label' USING ERRCODE='22023'; END IF;
  IF coalesce(_slot_type,'car') NOT IN ('car','bike','visitor','other') THEN RAISE EXCEPTION 'invalid_type' USING ERRCODE='22023'; END IF;
  IF coalesce(_availability,'open') NOT IN ('open','reserved','unavailable') THEN RAISE EXCEPTION 'invalid_availability' USING ERRCODE='22023'; END IF;
  IF _block_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.blocks WHERE id = _block_id AND society_id = sid) THEN RAISE EXCEPTION 'block_not_found' USING ERRCODE='P0002'; END IF;
  IF _id IS NULL THEN
    INSERT INTO public.parking_slots (society_id, label, slot_type, block_id, floor, ev_capable, availability, notes)
    VALUES (sid, _label, coalesce(_slot_type,'car'), _block_id, public._visitor_clean(_floor,20), coalesce(_ev_capable,false), coalesce(_availability,'open'), public._visitor_clean(_notes,200))
    RETURNING id INTO pid;
  ELSE
    SELECT * INTO cur FROM public.parking_slots WHERE id = _id AND society_id = sid AND is_active FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
    IF coalesce(_slot_type,'car') = 'visitor' AND cur.slot_type <> 'visitor' AND EXISTS (SELECT 1 FROM public.parking_allocations WHERE slot_id = _id AND status = 'active') THEN
      RAISE EXCEPTION 'slot_has_allocation' USING ERRCODE='23505'; END IF;
    IF cur.slot_type = 'visitor' AND coalesce(_slot_type,'car') <> 'visitor' AND EXISTS (SELECT 1 FROM public.visitors WHERE parking_slot_id = _id AND status = 'inside') THEN
      RAISE EXCEPTION 'slot_in_use_by_visitor' USING ERRCODE='23505'; END IF;
    IF NOT coalesce(_ev_capable,false) AND EXISTS (SELECT 1 FROM public.ev_chargers WHERE slot_id = _id AND is_active) THEN
      RAISE EXCEPTION 'slot_has_charger' USING ERRCODE='23505'; END IF;
    UPDATE public.parking_slots SET label=_label, slot_type=coalesce(_slot_type,'car'), block_id=_block_id, floor=public._visitor_clean(_floor,20),
      ev_capable=coalesce(_ev_capable,false), availability=coalesce(_availability,'open'), notes=public._visitor_clean(_notes,200), updated_at=now()
    WHERE id = _id RETURNING id INTO pid;
  END IF;
  PERFORM public._parking_audit(sid, CASE WHEN _id IS NULL THEN 'parking.created' ELSE 'parking.updated' END, 'parking_slots', pid,
    jsonb_build_object('label', _label, 'type', coalesce(_slot_type,'car'), 'availability', coalesce(_availability,'open'), 'ev', coalesce(_ev_capable,false)));
  RETURN pid;
END $$;

-- ===== permanent assignment =====
CREATE OR REPLACE FUNCTION public.admin_parking_assign(_slot_id uuid, _flat_id uuid, _vehicle_id uuid, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._parking_admin_society(); s record; aid uuid; f uuid;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  PERFORM public._rate_hit('parking_admin', auth.uid()::text, 120, interval '1 hour');
  SELECT * INTO s FROM public.parking_slots WHERE id = _slot_id AND society_id = sid AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF s.slot_type = 'visitor' THEN RAISE EXCEPTION 'visitor_slot_not_assignable' USING ERRCODE='22023'; END IF;
  IF s.availability = 'unavailable' THEN RAISE EXCEPTION 'slot_unavailable' USING ERRCODE='22023'; END IF;
  IF _flat_id IS NULL AND _vehicle_id IS NULL THEN RAISE EXCEPTION 'holder_required' USING ERRCODE='22023'; END IF;
  f := public._parking_resolve_holder(sid, _flat_id, _vehicle_id, true);
  PERFORM public.parking_sweep(sid);
  -- idempotent: same holder already active
  SELECT id INTO aid FROM public.parking_allocations WHERE slot_id = _slot_id AND status = 'active' AND kind = 'permanent'
    AND flat_id IS NOT DISTINCT FROM f AND vehicle_id IS NOT DISTINCT FROM _vehicle_id;
  IF aid IS NOT NULL THEN RETURN aid; END IF;
  IF EXISTS (SELECT 1 FROM public.parking_allocations WHERE slot_id = _slot_id AND status = 'active' AND kind = 'permanent') THEN
    RAISE EXCEPTION 'slot_already_allocated' USING ERRCODE='23505'; END IF;
  IF EXISTS (SELECT 1 FROM public.parking_allocations WHERE slot_id = _slot_id AND status = 'active' AND kind = 'temporary' AND ends_at > now()
             AND flat_id IS DISTINCT FROM f) THEN
    RAISE EXCEPTION 'slot_temporarily_allocated' USING ERRCODE='23505'; END IF;
  INSERT INTO public.parking_allocations (society_id, slot_id, kind, flat_id, vehicle_id, reason, issued_by)
  VALUES (sid, _slot_id, 'permanent', f, _vehicle_id, public._visitor_clean(_reason,300), auth.uid()) RETURNING id INTO aid;
  UPDATE public.parking_slots SET flat_id = f, vehicle_id = _vehicle_id, updated_at = now() WHERE id = _slot_id;
  PERFORM public._parking_audit(sid, 'parking.assigned', 'parking_allocations', aid, jsonb_build_object('slot', s.label, 'flat_id', f, 'vehicle_id', _vehicle_id));
  IF f IS NOT NULL THEN PERFORM public._notify_flat(sid, f, 'parking', 'Parking allotted', 'Slot ' || s.label || ' is assigned to your home', '/app/vehicles'); END IF;
  RETURN aid;
END $$;

CREATE OR REPLACE FUNCTION public._parking_release_internal(_alloc uuid, _reason text, _effective timestamptz) RETURNS record
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM public.parking_allocations WHERE id = _alloc FOR UPDATE;
  UPDATE public.parking_allocations SET status = CASE WHEN kind = 'temporary' THEN 'cancelled' ELSE 'released' END,
    released_at = coalesce(_effective, now()), released_by = auth.uid(), release_reason = public._visitor_clean(_reason,300)
  WHERE id = _alloc;
  IF a.kind = 'permanent' THEN
    UPDATE public.parking_slots SET flat_id = NULL, vehicle_id = NULL, updated_at = now() WHERE id = a.slot_id;
  END IF;
  RETURN a;
END $$;
REVOKE ALL ON FUNCTION public._parking_release_internal(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_parking_release(_allocation_id uuid, _reason text, _effective_at timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._parking_admin_society(); a record; lbl text;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF public._visitor_clean(_reason, 300) IS NULL THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  IF _effective_at IS NOT NULL AND (_effective_at > now() + interval '1 minute' OR _effective_at < now() - interval '90 days') THEN
    RAISE EXCEPTION 'invalid_effective_date' USING ERRCODE='22023'; END IF;
  SELECT * INTO a FROM public.parking_allocations WHERE id = _allocation_id AND society_id = sid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF a.status <> 'active' THEN RETURN; END IF; -- idempotent
  PERFORM public._parking_release_internal(_allocation_id, _reason, _effective_at);
  SELECT label INTO lbl FROM public.parking_slots WHERE id = a.slot_id;
  PERFORM public._parking_audit(sid, 'parking.released', 'parking_allocations', _allocation_id, jsonb_build_object('slot', lbl, 'kind', a.kind, 'reason', public._visitor_clean(_reason,300)));
  IF a.flat_id IS NOT NULL THEN PERFORM public._notify_flat(sid, a.flat_id, 'parking', 'Parking released', 'Slot ' || coalesce(lbl,'') || ' is no longer assigned to your home', '/app/vehicles'); END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_parking_reallocate(_slot_id uuid, _flat_id uuid, _vehicle_id uuid, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._parking_admin_society(); cur uuid;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF public._visitor_clean(_reason, 300) IS NULL THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.parking_slots WHERE id = _slot_id AND society_id = sid AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  SELECT id INTO cur FROM public.parking_allocations WHERE slot_id = _slot_id AND status = 'active' AND kind = 'permanent';
  IF cur IS NOT NULL THEN PERFORM public.admin_parking_release(cur, 'Reallocated: ' || _reason, NULL); END IF;
  RETURN public.admin_parking_assign(_slot_id, _flat_id, _vehicle_id, _reason);
END $$;

-- ===== temporary =====
CREATE OR REPLACE FUNCTION public.admin_parking_temp_allocate(_slot_id uuid, _flat_id uuid, _vehicle_id uuid, _purpose text, _starts_at timestamptz, _ends_at timestamptz, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._parking_admin_society(); s record; aid uuid; f uuid; st timestamptz := greatest(coalesce(_starts_at, now()), now() - interval '5 minutes');
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  PERFORM public._rate_hit('parking_admin', auth.uid()::text, 120, interval '1 hour');
  IF coalesce(_purpose,'') NOT IN ('guest','maintenance','replacement_vehicle','short_term','other') THEN RAISE EXCEPTION 'invalid_purpose' USING ERRCODE='22023'; END IF;
  IF public._visitor_clean(_reason, 300) IS NULL THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  IF _ends_at IS NULL OR _ends_at <= st OR _ends_at <= now() THEN RAISE EXCEPTION 'invalid_window' USING ERRCODE='22023'; END IF;
  IF _ends_at - st > interval '30 days' OR st > now() + interval '60 days' THEN RAISE EXCEPTION 'window_too_long' USING ERRCODE='22023'; END IF;
  SELECT * INTO s FROM public.parking_slots WHERE id = _slot_id AND society_id = sid AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF s.slot_type = 'visitor' THEN RAISE EXCEPTION 'visitor_slot_not_assignable' USING ERRCODE='22023'; END IF;
  IF s.availability = 'unavailable' THEN RAISE EXCEPTION 'slot_unavailable' USING ERRCODE='22023'; END IF;
  IF _purpose <> 'maintenance' AND _flat_id IS NULL AND _vehicle_id IS NULL THEN RAISE EXCEPTION 'holder_required' USING ERRCODE='22023'; END IF;
  f := public._parking_resolve_holder(sid, _flat_id, _vehicle_id, _purpose <> 'maintenance');
  PERFORM public.parking_sweep(sid);
  IF EXISTS (SELECT 1 FROM public.parking_allocations WHERE slot_id = _slot_id AND status = 'active' AND kind = 'permanent'
             AND flat_id IS DISTINCT FROM f) THEN
    RAISE EXCEPTION 'slot_already_allocated' USING ERRCODE='23505'; END IF;
  IF EXISTS (SELECT 1 FROM public.parking_allocations WHERE slot_id = _slot_id AND status = 'active' AND kind = 'temporary'
             AND starts_at < _ends_at AND ends_at > st) THEN
    RAISE EXCEPTION 'overlapping_allocation' USING ERRCODE='23505'; END IF;
  INSERT INTO public.parking_allocations (society_id, slot_id, kind, flat_id, vehicle_id, temp_purpose, starts_at, ends_at, reason, issued_by)
  VALUES (sid, _slot_id, 'temporary', f, _vehicle_id, _purpose, st, _ends_at, public._visitor_clean(_reason,300), auth.uid()) RETURNING id INTO aid;
  PERFORM public._parking_audit(sid, 'parking.temporary_issued', 'parking_allocations', aid,
    jsonb_build_object('slot', s.label, 'purpose', _purpose, 'starts_at', st, 'ends_at', _ends_at, 'flat_id', f));
  IF f IS NOT NULL THEN PERFORM public._notify_flat(sid, f, 'parking', 'Temporary parking', 'Slot ' || s.label || ' is yours until ' || to_char(_ends_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon HH24:MI'), '/app/vehicles'); END IF;
  RETURN aid;
END $$;

-- ===== move-out / vehicle removal: never leave authorization behind =====
CREATE OR REPLACE FUNCTION public._parking_on_resident_end() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; sid uuid;
BEGIN
  IF (NEW.moved_out_at IS NOT NULL AND OLD.moved_out_at IS NULL) OR (NEW.is_active IS FALSE AND OLD.is_active IS NOT FALSE) THEN
    -- that person's vehicles lose slot links
    UPDATE public.parking_allocations pa SET vehicle_id = NULL
      WHERE pa.status = 'active' AND pa.flat_id IS NOT NULL AND pa.vehicle_id IN (SELECT id FROM public.vehicles WHERE user_id = NEW.user_id AND flat_id = NEW.flat_id);
    UPDATE public.parking_slots SET vehicle_id = NULL, updated_at = now()
      WHERE vehicle_id IN (SELECT id FROM public.vehicles WHERE user_id = NEW.user_id AND flat_id = NEW.flat_id);
    IF NOT public._flat_has_current_occupant(NEW.flat_id) THEN
      SELECT society_id INTO sid FROM public.flats WHERE id = NEW.flat_id;
      FOR a IN SELECT id, slot_id, kind FROM public.parking_allocations WHERE flat_id = NEW.flat_id AND status = 'active' LOOP
        PERFORM public._parking_release_internal(a.id, 'Home has no current resident (move-out)', now());
        INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
        VALUES (auth.uid(), 'parking.released_on_move_out', 'parking_allocations', a.id::text, sid, jsonb_build_object('flat_id', NEW.flat_id, 'kind', a.kind));
      END LOOP;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_parking_on_resident_end AFTER UPDATE OF moved_out_at, is_active ON public.flat_residents
  FOR EACH ROW EXECUTE FUNCTION public._parking_on_resident_end();

CREATE OR REPLACE FUNCTION public._parking_on_vehicle_off() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.is_active IS FALSE AND OLD.is_active IS NOT FALSE) OR NEW.society_id IS DISTINCT FROM OLD.society_id OR NEW.flat_id IS DISTINCT FROM OLD.flat_id THEN
    UPDATE public.parking_allocations SET vehicle_id = NULL WHERE vehicle_id = NEW.id AND status = 'active' AND flat_id IS NOT NULL;
    UPDATE public.parking_allocations SET status = 'released', released_at = now(), release_reason = 'Vehicle removed or moved'
      WHERE vehicle_id = NEW.id AND status = 'active';
    UPDATE public.parking_slots SET vehicle_id = NULL, updated_at = now() WHERE vehicle_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_parking_on_vehicle_off AFTER UPDATE OF is_active, society_id, flat_id ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public._parking_on_vehicle_off();

-- Legacy upsert delegates to the lifecycle so history is never bypassed
CREATE OR REPLACE FUNCTION public.admin_parking_upsert(_id uuid, _label text, _slot_type text, _flat_id uuid, _vehicle_id uuid, _notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid; cur record; curalloc uuid;
BEGIN
  SELECT * INTO cur FROM public.parking_slots WHERE id = _id;
  pid := public.admin_parking_slot_save(_id, _label, _slot_type, cur.block_id, cur.floor, coalesce(cur.ev_capable,false), coalesce(cur.availability,'open'), _notes);
  SELECT id INTO curalloc FROM public.parking_allocations WHERE slot_id = pid AND status = 'active' AND kind = 'permanent';
  IF _flat_id IS NULL AND _vehicle_id IS NULL THEN
    IF curalloc IS NOT NULL THEN PERFORM public.admin_parking_release(curalloc, 'Unassigned', NULL); END IF;
  ELSIF curalloc IS NULL THEN
    PERFORM public.admin_parking_assign(pid, _flat_id, _vehicle_id, NULL);
  ELSE
    PERFORM public.admin_parking_reallocate(pid, _flat_id, _vehicle_id, 'Updated');
  END IF;
  RETURN pid;
END $$;

CREATE OR REPLACE FUNCTION public.admin_parking_archive(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._parking_admin_society();
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.parking_slots WHERE id = _id AND society_id = sid AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  PERFORM public.parking_sweep(sid);
  IF EXISTS (SELECT 1 FROM public.parking_allocations WHERE slot_id = _id AND status = 'active') THEN RAISE EXCEPTION 'slot_has_allocation' USING ERRCODE='23505'; END IF;
  IF EXISTS (SELECT 1 FROM public.visitors WHERE parking_slot_id = _id AND status = 'inside') THEN RAISE EXCEPTION 'slot_in_use_by_visitor' USING ERRCODE='23505'; END IF;
  IF EXISTS (SELECT 1 FROM public.ev_chargers WHERE slot_id = _id AND is_active) THEN RAISE EXCEPTION 'slot_has_charger' USING ERRCODE='23505'; END IF;
  UPDATE public.parking_slots SET is_active = false, updated_at = now() WHERE id = _id;
  PERFORM public._parking_audit(sid, 'parking.archived', 'parking_slots', _id, '{}'::jsonb);
END $$;

-- ===== gate authorization now honours lifecycle + expiry + current occupancy =====
CREATE OR REPLACE FUNCTION public._vehicle_authorized_slots(_vehicle uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT string_agg(ps.label || CASE WHEN pa.kind = 'temporary' THEN ' (temporary until ' || to_char(pa.ends_at AT TIME ZONE 'Asia/Kolkata','DD Mon HH24:MI') || ')' ELSE '' END, ', ' ORDER BY ps.label)
  FROM public.vehicles v
  JOIN public.parking_allocations pa ON pa.society_id = v.society_id AND pa.status = 'active' AND pa.starts_at <= now()
       AND (pa.ends_at IS NULL OR pa.ends_at > now())
       AND (pa.vehicle_id = v.id OR (pa.vehicle_id IS NULL AND pa.flat_id = v.flat_id AND v.flat_id IS NOT NULL))
  JOIN public.parking_slots ps ON ps.id = pa.slot_id AND ps.is_active AND ps.availability <> 'unavailable'
  WHERE v.id = _vehicle AND v.is_active AND (pa.flat_id IS NULL OR public._flat_has_current_occupant(pa.flat_id)) $$;
REVOKE ALL ON FUNCTION public._vehicle_authorized_slots(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_verify_vehicle(_plate text)
 RETURNS TABLE(plate_number text, vehicle_type text, make_model text, color text, flat_label text, parking_label text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE sid uuid := public._gate_society(); p text := upper(regexp_replace(coalesce(_plate,''), '[^A-Za-z0-9]', '', 'g'));
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF char_length(p) < 3 OR char_length(p) > 15 THEN RAISE EXCEPTION 'invalid_plate' USING ERRCODE='22023'; END IF;
  RETURN QUERY
  SELECT v.plate_number, v.type, v.make_model, v.color, f.flat_number, public._vehicle_authorized_slots(v.id)
  FROM public.vehicles v LEFT JOIN public.flats f ON f.id = v.flat_id
  WHERE v.society_id = sid AND v.is_active AND upper(regexp_replace(v.plate_number, '[^A-Za-z0-9]', '', 'g')) LIKE '%' || p || '%'
  LIMIT 5;
END $function$;

-- ===== capacity =====
CREATE OR REPLACE FUNCTION public.admin_parking_capacity(_block_id uuid DEFAULT NULL, _floor text DEFAULT NULL, _slot_type text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gate_admin_society(); r jsonb;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  PERFORM public.parking_sweep(sid);
  WITH s AS (
    SELECT ps.*,
      EXISTS (SELECT 1 FROM public.parking_allocations pa WHERE pa.slot_id = ps.id AND pa.status='active' AND pa.kind='permanent') AS perm,
      EXISTS (SELECT 1 FROM public.parking_allocations pa WHERE pa.slot_id = ps.id AND pa.status='active' AND pa.kind='temporary' AND pa.starts_at <= now() AND pa.ends_at > now()) AS temp,
      EXISTS (SELECT 1 FROM public.visitors v WHERE v.parking_slot_id = ps.id AND v.status='inside') AS vis
    FROM public.parking_slots ps
    WHERE ps.society_id = sid AND ps.is_active
      AND (_block_id IS NULL OR ps.block_id = _block_id)
      AND (_floor IS NULL OR upper(ps.floor) = upper(_floor))
      AND (_slot_type IS NULL OR ps.slot_type = _slot_type)
  )
  SELECT jsonb_build_object(
    'total', count(*),
    'unavailable', count(*) FILTER (WHERE availability='unavailable'),
    'reserved', count(*) FILTER (WHERE availability='reserved' AND NOT perm AND NOT temp),
    'occupied', count(*) FILTER (WHERE availability<>'unavailable' AND slot_type<>'visitor' AND perm),
    'temporary', count(*) FILTER (WHERE availability<>'unavailable' AND slot_type<>'visitor' AND temp AND NOT perm),
    'available', count(*) FILTER (WHERE availability='open' AND slot_type<>'visitor' AND NOT perm AND NOT temp),
    'visitor_total', count(*) FILTER (WHERE slot_type='visitor' AND availability<>'unavailable'),
    'visitor_in_use', count(*) FILTER (WHERE slot_type='visitor' AND vis),
    'ev_capable', count(*) FILTER (WHERE ev_capable),
    'inactive', (SELECT count(*) FROM public.parking_slots WHERE society_id = sid AND NOT is_active),
    'as_of', now()
  ) INTO r FROM s;
  RETURN r;
END $$;

-- ===== violations =====
CREATE OR REPLACE FUNCTION public.parking_violation_report(_type text, _slot_id uuid, _plate text, _location text, _description text, _occurred_at timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gate_society(); vid uuid; vflat uuid; p text := upper(regexp_replace(coalesce(_plate,''), '[^A-Za-z0-9]', '', 'g')); nid uuid; occ timestamptz := coalesce(_occurred_at, now());
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  PERFORM public._rate_hit('parking_violation', auth.uid()::text, 60, interval '1 hour');
  IF coalesce(_type,'') NOT IN ('wrong_slot','unauthorized','expired_temporary','blocking_access','ev_misuse','visitor_slot_misuse','other') THEN RAISE EXCEPTION 'invalid_type' USING ERRCODE='22023'; END IF;
  IF occ > now() + interval '5 minutes' OR occ < now() - interval '30 days' THEN RAISE EXCEPTION 'invalid_time' USING ERRCODE='22023'; END IF;
  IF _slot_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.parking_slots WHERE id = _slot_id AND society_id = sid) THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF char_length(p) > 15 THEN RAISE EXCEPTION 'invalid_plate' USING ERRCODE='22023'; END IF;
  IF char_length(p) >= 3 THEN
    SELECT id, flat_id INTO vid, vflat FROM public.vehicles WHERE society_id = sid AND is_active AND upper(regexp_replace(plate_number, '[^A-Za-z0-9]', '', 'g')) = p LIMIT 1;
  END IF;
  IF _slot_id IS NULL AND char_length(p) < 3 THEN RAISE EXCEPTION 'slot_or_plate_required' USING ERRCODE='22023'; END IF;
  -- duplicate tap within 10 min merges
  SELECT id INTO nid FROM public.parking_violations WHERE society_id = sid AND reported_by = auth.uid() AND violation_type = _type
    AND slot_id IS NOT DISTINCT FROM _slot_id AND coalesce(plate_text,'') = coalesce(nullif(p,''),'') AND status = 'open' AND created_at > now() - interval '10 minutes';
  IF nid IS NOT NULL THEN RETURN nid; END IF;
  INSERT INTO public.parking_violations (society_id, violation_type, slot_id, vehicle_id, flat_id, plate_text, location, description, occurred_at, reported_by)
  VALUES (sid, _type, _slot_id, vid, vflat, nullif(p,''), public._visitor_clean(_location,120), public._visitor_clean(_description,500), occ, auth.uid()) RETURNING id INTO nid;
  PERFORM public._parking_audit(sid, 'parking.violation_reported', 'parking_violations', nid, jsonb_build_object('type', _type, 'matched_vehicle', vid IS NOT NULL));
  PERFORM public._notify_society_admins(sid, 'parking', 'Parking violation reported', replace(_type,'_',' ') || coalesce(' · ' || nullif(p,''), ''), '/society/parking');
  RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.admin_parking_violation_update(_id uuid, _status text, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._parking_admin_society(); v record;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF coalesce(_status,'') NOT IN ('warned','resolved','dismissed') THEN RAISE EXCEPTION 'invalid_status' USING ERRCODE='22023'; END IF;
  IF public._visitor_clean(_note, 500) IS NULL THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v FROM public.parking_violations WHERE id = _id AND society_id = sid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF v.status = _status THEN RETURN; END IF;
  IF v.status IN ('resolved','dismissed') THEN RAISE EXCEPTION 'already_closed' USING ERRCODE='22023'; END IF;
  UPDATE public.parking_violations SET status = _status, resolution_note = public._visitor_clean(_note,500),
    resolved_by = CASE WHEN _status IN ('resolved','dismissed') THEN auth.uid() ELSE resolved_by END,
    resolved_at = CASE WHEN _status IN ('resolved','dismissed') THEN now() ELSE resolved_at END, updated_at = now()
  WHERE id = _id;
  PERFORM public._parking_audit(sid, 'parking.violation_' || _status, 'parking_violations', _id, jsonb_build_object('from', v.status));
  IF v.flat_id IS NOT NULL AND _status = 'warned' THEN
    PERFORM public._notify_flat(sid, v.flat_id, 'parking', 'Parking warning', 'Committee note: ' || public._visitor_clean(_note,200), '/app/vehicles');
  END IF;
END $$;

-- ===== EV =====
CREATE OR REPLACE FUNCTION public.admin_ev_charger_save(_id uuid, _name text, _slot_id uuid, _connector text, _rated_kw numeric, _provider text, _status text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._parking_admin_society(); cid uuid;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF public._visitor_clean(_name, 60) IS NULL THEN RAISE EXCEPTION 'invalid_name' USING ERRCODE='22023'; END IF;
  IF coalesce(_provider,'manual') NOT IN ('manual','unconfigured') THEN RAISE EXCEPTION 'invalid_provider' USING ERRCODE='22023'; END IF;
  IF coalesce(_status,'available') NOT IN ('available','offline','disabled') THEN RAISE EXCEPTION 'invalid_status' USING ERRCODE='22023'; END IF;
  IF _slot_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.parking_slots WHERE id = _slot_id AND society_id = sid AND is_active AND ev_capable) THEN
    RAISE EXCEPTION 'slot_not_ev_capable' USING ERRCODE='22023'; END IF;
  IF _id IS NULL THEN
    INSERT INTO public.ev_chargers (society_id, slot_id, name, connector, rated_kw, provider, status)
    VALUES (sid, _slot_id, public._visitor_clean(_name,60), public._visitor_clean(_connector,40), _rated_kw, coalesce(_provider,'manual'), coalesce(_status,'available')) RETURNING id INTO cid;
  ELSE
    UPDATE public.ev_chargers SET slot_id=_slot_id, name=public._visitor_clean(_name,60), connector=public._visitor_clean(_connector,40), rated_kw=_rated_kw,
      provider=coalesce(_provider,'manual'), status=coalesce(_status,'available'), updated_at=now()
    WHERE id=_id AND society_id=sid AND is_active RETURNING id INTO cid;
    IF cid IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  END IF;
  PERFORM public._parking_audit(sid, CASE WHEN _id IS NULL THEN 'ev.charger_added' ELSE 'ev.charger_updated' END, 'ev_chargers', cid,
    jsonb_build_object('status', coalesce(_status,'available'), 'provider', coalesce(_provider,'manual')));
  RETURN cid;
END $$;

CREATE OR REPLACE FUNCTION public.admin_ev_charger_retire(_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._parking_admin_society();
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.ev_charging_sessions WHERE charger_id = _id AND status = 'active') THEN RAISE EXCEPTION 'charger_in_use' USING ERRCODE='23505'; END IF;
  UPDATE public.ev_chargers SET is_active = false, status = 'disabled', updated_at = now() WHERE id = _id AND society_id = sid AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  PERFORM public._parking_audit(sid, 'ev.charger_retired', 'ev_chargers', _id, '{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.ev_session_start(_charger_id uuid, _plate text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gate_society(); c record; v record; nid uuid; p text := upper(regexp_replace(coalesce(_plate,''), '[^A-Za-z0-9]', '', 'g'));
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  PERFORM public._rate_hit('ev_session', auth.uid()::text, 60, interval '1 hour');
  SELECT * INTO c FROM public.ev_chargers WHERE id = _charger_id AND society_id = sid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF NOT c.is_active OR c.status <> 'available' OR c.provider = 'unconfigured' THEN RAISE EXCEPTION 'charger_unavailable' USING ERRCODE='22023'; END IF;
  SELECT * INTO v FROM public.vehicles WHERE society_id = sid AND is_active AND upper(regexp_replace(plate_number, '[^A-Za-z0-9]', '', 'g')) = p LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'vehicle_not_found' USING ERRCODE='P0002'; END IF;
  IF v.flat_id IS NULL OR NOT public._flat_has_current_occupant(v.flat_id) THEN RAISE EXCEPTION 'no_current_occupant' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.ev_charging_sessions WHERE charger_id = c.id AND status = 'active') THEN RAISE EXCEPTION 'charger_in_use' USING ERRCODE='23505'; END IF;
  IF EXISTS (SELECT 1 FROM public.ev_charging_sessions WHERE vehicle_id = v.id AND status = 'active') THEN RAISE EXCEPTION 'vehicle_already_charging' USING ERRCODE='23505'; END IF;
  INSERT INTO public.ev_charging_sessions (society_id, charger_id, vehicle_id, flat_id, started_by)
  VALUES (sid, c.id, v.id, v.flat_id, auth.uid()) RETURNING id INTO nid;
  PERFORM public._parking_audit(sid, 'ev.session_started', 'ev_charging_sessions', nid, jsonb_build_object('charger', c.name));
  RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.ev_session_end(_session_id uuid, _energy_kwh numeric DEFAULT NULL, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gate_society(); s record;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _energy_kwh IS NOT NULL AND (_energy_kwh < 0 OR _energy_kwh > 1000) THEN RAISE EXCEPTION 'invalid_energy' USING ERRCODE='22023'; END IF;
  SELECT * INTO s FROM public.ev_charging_sessions WHERE id = _session_id AND society_id = sid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF s.status <> 'active' THEN RETURN; END IF;
  UPDATE public.ev_charging_sessions SET status = 'completed', ended_at = now(), ended_by = auth.uid(),
    energy_kwh = _energy_kwh, energy_source = CASE WHEN _energy_kwh IS NULL THEN NULL ELSE 'meter_reading_entered' END,
    note = public._visitor_clean(_note, 200)
  WHERE id = _session_id;
  PERFORM public._parking_audit(sid, 'ev.session_ended', 'ev_charging_sessions', _session_id, jsonb_build_object('energy_entered', _energy_kwh IS NOT NULL));
END $$;

-- ===== reports =====
CREATE OR REPLACE FUNCTION public.admin_parking_report(_from date, _to date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid := public._gate_admin_society(); f timestamptz; t timestamptz; r jsonb;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _from IS NULL OR _to IS NULL OR _to < _from OR _to - _from > 366 THEN RAISE EXCEPTION 'invalid_range' USING ERRCODE='22023'; END IF;
  PERFORM public._rate_hit('parking_report', auth.uid()::text, 60, interval '1 hour');
  PERFORM public.parking_sweep(sid);
  f := (_from::timestamp AT TIME ZONE 'Asia/Kolkata'); t := ((_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
  SELECT jsonb_build_object(
    'capacity', public.admin_parking_capacity(NULL, NULL, NULL),
    'assigned', (SELECT count(*) FROM public.parking_allocations WHERE society_id=sid AND kind='permanent' AND starts_at >= f AND starts_at < t),
    'released', (SELECT count(*) FROM public.parking_allocations WHERE society_id=sid AND kind='permanent' AND status='released' AND released_at >= f AND released_at < t),
    'temporary_issued', (SELECT count(*) FROM public.parking_allocations WHERE society_id=sid AND kind='temporary' AND created_at >= f AND created_at < t),
    'temporary_expired', (SELECT count(*) FROM public.parking_allocations WHERE society_id=sid AND kind='temporary' AND status='expired' AND ends_at >= f AND ends_at < t),
    'violations_by_type', coalesce((SELECT jsonb_object_agg(violation_type, n) FROM (SELECT violation_type, count(*) n FROM public.parking_violations WHERE society_id=sid AND occurred_at >= f AND occurred_at < t GROUP BY 1) x), '{}'::jsonb),
    'violations_by_status', coalesce((SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM public.parking_violations WHERE society_id=sid AND occurred_at >= f AND occurred_at < t GROUP BY 1) x), '{}'::jsonb),
    'repeat_vehicles', coalesce((SELECT jsonb_agg(jsonb_build_object('plate', plate_text, 'count', n) ORDER BY n DESC) FROM (SELECT plate_text, count(*) n FROM public.parking_violations WHERE society_id=sid AND plate_text IS NOT NULL AND occurred_at >= f AND occurred_at < t GROUP BY 1 HAVING count(*) > 1 LIMIT 20) x), '[]'::jsonb),
    'ev_sessions', (SELECT count(*) FROM public.ev_charging_sessions WHERE society_id=sid AND started_at >= f AND started_at < t),
    'ev_energy_entered_kwh', (SELECT coalesce(sum(energy_kwh),0) FROM public.ev_charging_sessions WHERE society_id=sid AND started_at >= f AND started_at < t AND energy_kwh IS NOT NULL),
    'ev_sessions_without_reading', (SELECT count(*) FROM public.ev_charging_sessions WHERE society_id=sid AND started_at >= f AND started_at < t AND status='completed' AND energy_kwh IS NULL),
    'visitor_parking_uses', (SELECT count(*) FROM public.visitors WHERE society_id=sid AND parking_slot_id IS NOT NULL AND entry_at >= f AND entry_at < t),
    'daily', coalesce((SELECT jsonb_agg(jsonb_build_object('day', d, 'assigned', a, 'temporary', tm, 'violations', vi, 'visitor_parking', vp) ORDER BY d) FROM (
        SELECT gs::date d,
          (SELECT count(*) FROM public.parking_allocations WHERE society_id=sid AND kind='permanent' AND (starts_at AT TIME ZONE 'Asia/Kolkata')::date = gs::date) a,
          (SELECT count(*) FROM public.parking_allocations WHERE society_id=sid AND kind='temporary' AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = gs::date) tm,
          (SELECT count(*) FROM public.parking_violations WHERE society_id=sid AND (occurred_at AT TIME ZONE 'Asia/Kolkata')::date = gs::date) vi,
          (SELECT count(*) FROM public.visitors WHERE society_id=sid AND parking_slot_id IS NOT NULL AND (entry_at AT TIME ZONE 'Asia/Kolkata')::date = gs::date) vp
        FROM generate_series(_from, _to, interval '1 day') gs) z), '[]'::jsonb),
    'from', _from, 'to', _to
  ) INTO r;
  PERFORM public._parking_audit(sid, 'parking.report_viewed', 'parking_slots', NULL, jsonb_build_object('from', _from, 'to', _to));
  RETURN r;
END $$;

-- grants
DO $$ DECLARE fn text; BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public._parking_admin_society()','public._flat_has_current_occupant(uuid)','public._parking_audit(uuid,text,text,uuid,jsonb)',
    'public.parking_sweep(uuid)','public._parking_resolve_holder(uuid,uuid,uuid,boolean)',
    'public.admin_parking_slot_save(uuid,text,text,uuid,text,boolean,text,text)','public.admin_parking_assign(uuid,uuid,uuid,text)',
    'public.admin_parking_release(uuid,text,timestamptz)','public.admin_parking_reallocate(uuid,uuid,uuid,text)',
    'public.admin_parking_temp_allocate(uuid,uuid,uuid,text,timestamptz,timestamptz,text)','public.admin_parking_upsert(uuid,text,text,uuid,uuid,text)',
    'public.admin_parking_archive(uuid)','public.guard_verify_vehicle(text)','public.admin_parking_capacity(uuid,text,text)',
    'public.parking_violation_report(text,uuid,text,text,text,timestamptz)','public.admin_parking_violation_update(uuid,text,text)',
    'public.admin_ev_charger_save(uuid,text,uuid,text,numeric,text,text)','public.admin_ev_charger_retire(uuid)',
    'public.ev_session_start(uuid,text)','public.ev_session_end(uuid,numeric,text)','public.admin_parking_report(date,date)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $$;
-- internal helpers: not callable by clients
REVOKE EXECUTE ON FUNCTION public._parking_audit(uuid,text,text,uuid,jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public._parking_resolve_holder(uuid,uuid,uuid,boolean) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.parking_sweep(uuid) FROM authenticated;
