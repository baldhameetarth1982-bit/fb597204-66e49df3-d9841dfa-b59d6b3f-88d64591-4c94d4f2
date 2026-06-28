
-- 1. join_requests table
CREATE TABLE IF NOT EXISTS public.join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_id uuid NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  relationship text NOT NULL CHECK (relationship IN ('owner','tenant','family')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Exactly one open request per user; many historical rows OK.
CREATE UNIQUE INDEX IF NOT EXISTS idx_join_requests_one_open_per_user
  ON public.join_requests(user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_join_requests_society_status
  ON public.join_requests(society_id, status);
CREATE INDEX IF NOT EXISTS idx_join_requests_flat
  ON public.join_requests(flat_id);

GRANT SELECT, INSERT, UPDATE ON public.join_requests TO authenticated;
GRANT ALL ON public.join_requests TO service_role;
ALTER TABLE public.join_requests ENABLE ROW LEVEL SECURITY;

-- Requester can see their own
CREATE POLICY "join_requests: requester read own"
  ON public.join_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Society admin / super admin can see for their society
CREATE POLICY "join_requests: admin read society"
  ON public.join_requests FOR SELECT TO authenticated
  USING (
    public.is_society_admin_for(auth.uid(), society_id)
    OR public.is_super_admin(auth.uid())
  );

-- All writes go through SECURITY DEFINER RPCs; block direct INSERT/UPDATE.
CREATE POLICY "join_requests: no direct insert"
  ON public.join_requests FOR INSERT TO authenticated
  WITH CHECK (false);
CREATE POLICY "join_requests: no direct update"
  ON public.join_requests FOR UPDATE TO authenticated
  USING (false) WITH CHECK (false);

CREATE TRIGGER trg_join_requests_touch
  BEFORE UPDATE ON public.join_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. RPC: create a pending request
CREATE OR REPLACE FUNCTION public.request_join_flat(
  _flat_id uuid,
  _relationship text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_society uuid;
  v_existing uuid;
  v_already uuid;
  v_request_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _relationship NOT IN ('owner','tenant','family') THEN
    RAISE EXCEPTION 'Invalid relationship';
  END IF;

  SELECT society_id INTO v_society FROM public.flats WHERE id = _flat_id;
  IF v_society IS NULL THEN RAISE EXCEPTION 'Flat not found'; END IF;

  -- Block if user already belongs to any society
  SELECT society_id INTO v_already FROM public.profiles WHERE id = v_user;
  IF v_already IS NOT NULL THEN
    RAISE EXCEPTION 'You already belong to a society';
  END IF;

  -- Block if there is already a pending request from this user
  SELECT id INTO v_existing FROM public.join_requests
    WHERE user_id = v_user AND status = 'pending';
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'You already have a pending join request';
  END IF;

  INSERT INTO public.join_requests (society_id, flat_id, user_id, relationship, status)
  VALUES (v_society, _flat_id, v_user, _relationship, 'pending')
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_join_flat(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_join_flat(uuid, text) TO authenticated;

-- 3. RPC: admin responds (approve / reject)
CREATE OR REPLACE FUNCTION public.respond_join_request(
  _request_id uuid,
  _approve boolean,
  _reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_req RECORD;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_req FROM public.join_requests WHERE id = _request_id;
  IF v_req IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Request already resolved';
  END IF;

  IF NOT (public.is_society_admin_for(v_caller, v_req.society_id)
          OR public.is_super_admin(v_caller)) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF NOT _approve THEN
    UPDATE public.join_requests
      SET status='rejected', reviewer_id=v_caller, reviewed_at=now(),
          reason=NULLIF(trim(COALESCE(_reason, '')), ''),
          updated_at=now()
    WHERE id = _request_id;
    RETURN;
  END IF;

  -- Approve: link resident permanently
  PERFORM set_config('app.allow_society_change', 'on', true);
  UPDATE public.profiles
    SET society_id = v_req.society_id,
        updated_at = now()
  WHERE id = v_req.user_id;
  PERFORM set_config('app.allow_society_change', 'off', true);

  INSERT INTO public.user_roles (user_id, role, society_id)
  VALUES (v_req.user_id, 'resident'::public.app_role, v_req.society_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.flat_residents (flat_id, user_id, relationship, is_primary)
  VALUES (
    v_req.flat_id, v_req.user_id, v_req.relationship,
    NOT EXISTS (SELECT 1 FROM public.flat_residents WHERE flat_id = v_req.flat_id)
  )
  ON CONFLICT DO NOTHING;

  UPDATE public.join_requests
    SET status='approved', reviewer_id=v_caller, reviewed_at=now(),
        reason=NULLIF(trim(COALESCE(_reason, '')), ''),
        updated_at=now()
  WHERE id = _request_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.respond_join_request(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_join_request(uuid, boolean, text) TO authenticated;

-- 4. Public-safe society search (authenticated only, no PII)
CREATE OR REPLACE FUNCTION public.search_societies_by_name(_q text)
RETURNS TABLE(id uuid, name text, city text, state text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.name, s.city, s.state
  FROM public.societies s
  WHERE s.status = 'active'
    AND (_q IS NULL OR length(trim(_q)) = 0 OR s.name ILIKE '%' || trim(_q) || '%' OR s.city ILIKE '%' || trim(_q) || '%')
  ORDER BY s.name ASC
  LIMIT 25;
$$;
REVOKE EXECUTE ON FUNCTION public.search_societies_by_name(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_societies_by_name(text) TO authenticated;

-- 5. List a society's flats so residents can pick one when joining
CREATE OR REPLACE FUNCTION public.list_society_flats_public(_society_id uuid)
RETURNS TABLE(
  flat_id uuid,
  flat_number text,
  floor integer,
  block_id uuid,
  block_name text,
  is_occupied boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f.id, f.flat_number, f.floor, f.block_id, b.name,
    EXISTS (SELECT 1 FROM public.flat_residents fr WHERE fr.flat_id = f.id)
  FROM public.flats f
  LEFT JOIN public.blocks b ON b.id = f.block_id
  WHERE f.society_id = _society_id
  ORDER BY b.name NULLS LAST, f.floor NULLS LAST, f.flat_number ASC
  LIMIT 1000;
$$;
REVOKE EXECUTE ON FUNCTION public.list_society_flats_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_society_flats_public(uuid) TO authenticated;
