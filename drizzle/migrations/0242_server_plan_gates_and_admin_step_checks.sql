-- Server-side plan locks: mirrors normalizePlan() in src/lib/plan-features.ts.
CREATE OR REPLACE FUNCTION public._society_plan_rank(_society_id uuid)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s record;
BEGIN
  IF _society_id IS NULL THEN RETURN 0; END IF;
  SELECT lower(btrim(coalesce(plan_id,''))) AS plan, lower(btrim(coalesce(plan_status,''))) AS pst,
         lower(btrim(coalesce(status,''))) AS soc, trial_ends_at, plan_expires_at
    INTO s FROM public.societies WHERE id = _society_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF s.soc <> '' AND s.soc <> 'active' THEN RETURN 0; END IF;
  IF s.pst IN ('expired','cancelled','canceled','past_due','inactive') THEN RETURN 0; END IF;
  IF s.pst IN ('trial','trialing') THEN
    RETURN CASE WHEN s.trial_ends_at IS NOT NULL AND s.trial_ends_at > now() THEN 2 ELSE 0 END;
  END IF;
  IF s.pst <> '' AND s.pst <> 'active' THEN RETURN 0; END IF;
  IF s.plan_expires_at IS NOT NULL AND s.plan_expires_at <= now() THEN RETURN 0; END IF;
  RETURN CASE WHEN s.plan IN ('pro','standard','growth') THEN 1
              WHEN s.plan IN ('premium','business','enterprise') THEN 2 ELSE 0 END;
END;
$function$;
REVOKE ALL ON FUNCTION public._society_plan_rank(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._society_plan_rank(uuid) TO authenticated, service_role;

-- Every signed-in create path (direct API or RPC) is checked; system jobs (no user) and fully verified Super Admins pass.
CREATE OR REPLACE FUNCTION public._trg_enforce_plan_feature()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_sid uuid; v_min integer := coalesce(nullif(TG_ARGV[0], '')::integer, 1);
BEGIN
  IF auth.uid() IS NULL OR public.is_super_admin(auth.uid()) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'post_comments' THEN
    SELECT p.society_id INTO v_sid FROM public.posts p WHERE p.id = NEW.post_id;
  ELSE
    v_sid := NEW.society_id;
  END IF;
  IF TG_TABLE_NAME = 'polls' THEN
    IF coalesce(NEW.kind, 'poll') = 'vote' THEN v_min := 2; END IF;
  END IF;
  IF public._society_plan_rank(v_sid) < v_min THEN
    RAISE EXCEPTION 'plan_required' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._trg_enforce_plan_feature() FROM PUBLIC, anon, authenticated;

-- Growth (rank 1)
CREATE TRIGGER trg_plan_gate BEFORE INSERT ON public.visitors FOR EACH ROW EXECUTE FUNCTION public._trg_enforce_plan_feature('1');
CREATE TRIGGER trg_plan_gate BEFORE INSERT ON public.visitor_recurring_passes FOR EACH ROW EXECUTE FUNCTION public._trg_enforce_plan_feature('1');
CREATE TRIGGER trg_plan_gate BEFORE INSERT ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public._trg_enforce_plan_feature('1');
CREATE TRIGGER trg_plan_gate BEFORE INSERT ON public.amenities FOR EACH ROW EXECUTE FUNCTION public._trg_enforce_plan_feature('1');
CREATE TRIGGER trg_plan_gate BEFORE INSERT ON public.amenity_bookings FOR EACH ROW EXECUTE FUNCTION public._trg_enforce_plan_feature('1');
CREATE TRIGGER trg_plan_gate BEFORE INSERT ON public.polls FOR EACH ROW EXECUTE FUNCTION public._trg_enforce_plan_feature('1');
CREATE TRIGGER trg_plan_gate BEFORE INSERT ON public.posts FOR EACH ROW EXECUTE FUNCTION public._trg_enforce_plan_feature('1');
CREATE TRIGGER trg_plan_gate BEFORE INSERT ON public.post_comments FOR EACH ROW EXECUTE FUNCTION public._trg_enforce_plan_feature('1');
-- Pro (rank 2)
CREATE TRIGGER trg_plan_gate BEFORE INSERT ON public.meetings FOR EACH ROW EXECUTE FUNCTION public._trg_enforce_plan_feature('2');
CREATE TRIGGER trg_plan_gate BEFORE INSERT ON public.agms FOR EACH ROW EXECUTE FUNCTION public._trg_enforce_plan_feature('2');
CREATE TRIGGER trg_plan_gate BEFORE INSERT ON public.elections FOR EACH ROW EXECUTE FUNCTION public._trg_enforce_plan_feature('2');

-- Close Super Admin step-up bypasses: these checked the role row directly.
CREATE OR REPLACE FUNCTION public.current_user_can_admin_migrations(_society_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT public.is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.is_active = true
      AND ur.role = 'society_admin' AND ur.society_id = _society_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.current_user_has_society_permission(_society_id uuid, _capability text, _block_id uuid DEFAULT NULL::uuid)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.app_role;
  v_block_scoped boolean;
BEGIN
  IF v_uid IS NULL OR _society_id IS NULL OR _capability IS NULL THEN RETURN false; END IF;
  IF NOT public.is_known_capability(_capability) THEN RETURN false; END IF;

  IF public.is_super_admin(v_uid) THEN RETURN true; END IF;

  IF _capability = 'finance.read' THEN
    RETURN public.is_society_admin_for(v_uid, _society_id)
      OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_uid AND ur.society_id = _society_id AND ur.is_active AND ur.role = 'auditor')
      OR EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.society_staff st ON st.user_id = ur.user_id AND st.society_id = ur.society_id AND st.is_active
                 WHERE ur.user_id = v_uid AND ur.society_id = _society_id AND ur.is_active AND ur.role = 'staff' AND 'finance.read' = ANY(ur.permissions));
  END IF;
  IF _capability LIKE 'staff.%' THEN
    RETURN EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.society_staff st ON st.user_id = ur.user_id AND st.society_id = ur.society_id AND st.is_active
                   WHERE ur.user_id = v_uid AND ur.society_id = _society_id AND ur.is_active AND ur.role = 'staff' AND _capability = ANY(ur.permissions));
  END IF;

  SELECT ur.role INTO v_role FROM public.user_roles ur
    WHERE ur.user_id = v_uid AND ur.society_id = _society_id AND COALESCE(ur.is_active,true)
    ORDER BY CASE ur.role WHEN 'society_admin' THEN 1 WHEN 'block_admin' THEN 2
                          WHEN 'security' THEN 3 WHEN 'resident' THEN 4 ELSE 5 END LIMIT 1;
  IF v_role IS NULL THEN RETURN false; END IF;

  IF v_role = 'society_admin' THEN
    RETURN _capability IN (
      'team.view','team.manage','privacy.view','privacy.manage',
      'society.settings','blocks.view','blocks.manage','flats.manage',
      'directory.view','residents.view_society','residents.private_detail','residents.manage',
      'finance.admin','billing.manage','notices.manage','polls.manage','self.household'
    );
  END IF;

  IF v_role = 'block_admin' THEN
    IF _capability NOT IN ('directory.view','residents.view_block','blocks.view','self.household') THEN
      RETURN false;
    END IF;
    v_block_scoped := _capability IN ('directory.view','residents.view_block','blocks.view');
    IF NOT v_block_scoped THEN RETURN true; END IF;
    IF _block_id IS NULL THEN RETURN false; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.blocks
      WHERE id = _block_id AND society_id = _society_id AND COALESCE(is_active,true)
    ) THEN RETURN false; END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.user_role_block_scopes s
      JOIN public.user_roles ur ON ur.id = s.role_id
      WHERE ur.user_id = v_uid AND ur.society_id = _society_id
        AND ur.role = 'block_admin' AND COALESCE(ur.is_active, true)
        AND s.is_active AND s.block_id = _block_id
    );
  END IF;

  IF v_role = 'security' THEN RETURN _capability IN ('guard.operate','self.household'); END IF;
  IF v_role = 'resident' THEN RETURN _capability = 'self.household'; END IF;
  RETURN false;
END; $function$;