
-- Phase 6: Visitor pre-approval & gate-pass codes
ALTER TABLE public.visitors
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'inside',
  ADD COLUMN IF NOT EXISTS pre_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gate_pass_code text,
  ADD COLUMN IF NOT EXISTS expected_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS notes text;

CREATE UNIQUE INDEX IF NOT EXISTS visitors_society_code_uniq
  ON public.visitors (society_id, gate_pass_code)
  WHERE gate_pass_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS visitors_society_status_idx
  ON public.visitors (society_id, status, entry_at DESC);

-- Resident pre-approves a visitor; returns the gate-pass code
CREATE OR REPLACE FUNCTION public.create_visitor_preapproval(
  _society_id uuid,
  _flat_id uuid,
  _visitor_name text,
  _phone text,
  _vehicle_number text,
  _purpose text,
  _expected_at timestamptz
) RETURNS TABLE (id uuid, gate_pass_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _code text;
  _new_id uuid;
  _belongs boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.flat_residents
    WHERE user_id = _uid AND flat_id = _flat_id
  ) INTO _belongs;
  IF NOT _belongs AND NOT public.has_role(_uid, 'society_admin') THEN
    RAISE EXCEPTION 'not your flat';
  END IF;

  -- generate 6-digit code unique per society
  LOOP
    _code := lpad((floor(random()*1000000))::int::text, 6, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.visitors v
      WHERE v.society_id = _society_id AND v.gate_pass_code = _code
        AND v.entry_at > now() - interval '7 days'
    );
  END LOOP;

  INSERT INTO public.visitors (
    society_id, flat_id, visitor_name, phone, vehicle_number, purpose,
    logged_by, status, pre_approved, gate_pass_code, expected_at, approved_by
  ) VALUES (
    _society_id, _flat_id, _visitor_name, _phone, _vehicle_number, _purpose,
    _uid, 'pending', true, _code, _expected_at, _uid
  )
  RETURNING visitors.id, visitors.gate_pass_code INTO _new_id, _code;

  RETURN QUERY SELECT _new_id, _code;
END;
$$;

-- Guard checks in a pre-approved visitor by code
CREATE OR REPLACE FUNCTION public.guard_checkin_by_code(
  _society_id uuid,
  _code text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _vid uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT (public.has_role(_uid, 'security') OR public.has_role(_uid, 'society_admin') OR public.has_role(_uid, 'block_admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.visitors
     SET status = 'inside', entry_at = now()
   WHERE society_id = _society_id
     AND gate_pass_code = _code
     AND status = 'pending'
   RETURNING id INTO _vid;

  IF _vid IS NULL THEN RAISE EXCEPTION 'invalid or already used code'; END IF;
  RETURN _vid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_visitor_preapproval(uuid,uuid,text,text,text,text,timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_visitor_preapproval(uuid,uuid,text,text,text,text,timestamptz) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_checkin_by_code(uuid,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.guard_checkin_by_code(uuid,text) TO authenticated;
