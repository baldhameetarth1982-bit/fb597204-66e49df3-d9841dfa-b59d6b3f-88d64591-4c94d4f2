-- Wave 0: one canonical gate/arrival state machine for every visitor category
-- (guest, delivery, service, cab, other). Existing RPCs keep doing the work;
-- this trigger makes the allowed transitions authoritative for ANY write path.
CREATE OR REPLACE FUNCTION public.gate_transition_allowed(_from text, _to text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _from IS NOT DISTINCT FROM _to THEN true
    WHEN _from IN ('expected','pending') THEN _to IN ('inside','denied','rejected','cancelled','expired')
    WHEN _from = 'awaiting' THEN _to IN ('approved','denied','rejected','cancelled','expired')
    WHEN _from = 'approved' THEN _to IN ('inside','denied','cancelled','expired')
    WHEN _from = 'inside' THEN _to = 'exited'
    ELSE false -- exited, denied, rejected, cancelled, expired are terminal
  END;
$$;

REVOKE ALL ON FUNCTION public.gate_transition_allowed(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gate_transition_allowed(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._enforce_gate_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF coalesce(NEW.status, 'inside') NOT IN ('expected','pending','awaiting','approved','inside') THEN
      RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '22023';
    END IF;
  ELSIF NOT public.gate_transition_allowed(coalesce(OLD.status, 'inside'), coalesce(NEW.status, 'inside')) THEN
    RAISE EXCEPTION 'invalid_transition' USING ERRCODE = '22023';
  END IF;
  IF NEW.society_id IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.society_id ELSE NEW.society_id END) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_gate_transition ON public.visitors;
CREATE TRIGGER trg_enforce_gate_transition
BEFORE INSERT OR UPDATE OF status, society_id ON public.visitors
FOR EACH ROW EXECUTE FUNCTION public._enforce_gate_transition();

-- Residents: only CURRENT active residents of the flat can see its gate history.
DROP POLICY IF EXISTS "residents view visitors for their flats" ON public.visitors;
CREATE POLICY "residents view visitors for their flats"
ON public.visitors FOR SELECT TO authenticated
USING (flat_id IN (
  SELECT fr.flat_id FROM public.flat_residents fr
  WHERE fr.user_id = auth.uid() AND fr.is_active IS NOT FALSE AND fr.moved_out_at IS NULL
));