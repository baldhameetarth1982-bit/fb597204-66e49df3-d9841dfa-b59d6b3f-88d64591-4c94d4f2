
-- 1) Close entitlement self-escalation: society admins/users could directly
--    write plan / trial / lifecycle / billing columns on public.societies.
CREATE OR REPLACE FUNCTION public._societies_protect_saas_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Only direct browser-role writes are restricted. SECURITY DEFINER RPCs and
  -- trusted server code run as a different role and keep working.
  IF current_user NOT IN ('authenticated','anon') OR public.is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.plan := 'basic'; NEW.plan_id := 'trial'; NEW.plan_status := 'none';
    NEW.plan_expires_at := NULL; NEW.plan_selected_at := NULL;
    NEW.trial_ends_at := now() + interval '14 days'; NEW.trial_consumed_at := NULL;
    NEW.status := 'pending'; NEW.billing_active := true;
    NEW.razorpay_account_id := NULL; NEW.payout_status := 'not_setup';
    NEW.payout_bank_last4 := NULL; NEW.payout_holder_name := NULL;
    RETURN NEW;
  END IF;
  IF NEW.plan IS DISTINCT FROM OLD.plan OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
     OR NEW.plan_status IS DISTINCT FROM OLD.plan_status OR NEW.plan_expires_at IS DISTINCT FROM OLD.plan_expires_at
     OR NEW.plan_selected_at IS DISTINCT FROM OLD.plan_selected_at OR NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
     OR NEW.trial_consumed_at IS DISTINCT FROM OLD.trial_consumed_at OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.billing_active IS DISTINCT FROM OLD.billing_active OR NEW.razorpay_account_id IS DISTINCT FROM OLD.razorpay_account_id
     OR NEW.payout_status IS DISTINCT FROM OLD.payout_status OR NEW.payout_bank_last4 IS DISTINCT FROM OLD.payout_bank_last4
     OR NEW.payout_holder_name IS DISTINCT FROM OLD.payout_holder_name THEN
    RAISE EXCEPTION 'protected_society_columns' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._societies_protect_saas_columns() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_societies_protect_saas_columns ON public.societies;
CREATE TRIGGER trg_societies_protect_saas_columns BEFORE INSERT OR UPDATE ON public.societies
  FOR EACH ROW EXECUTE FUNCTION public._societies_protect_saas_columns();

-- 2) Plan grants are now audited (same behavior otherwise).
CREATE OR REPLACE FUNCTION public.admin_grant_society_plan(_society_id uuid, _plan_id text, _months integer DEFAULT 1, _extend boolean DEFAULT true)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_caller uuid := auth.uid(); v_base timestamptz;
  v_months integer := LEAST(GREATEST(COALESCE(_months, 1), 1), 120);
  v_plan text := NULLIF(trim(_plan_id), ''); v_old record;
BEGIN
  IF v_caller IS NULL OR NOT public.is_super_admin(v_caller) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF _society_id IS NULL OR v_plan IS NULL THEN RAISE EXCEPTION 'society_id and plan_id required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.plans WHERE id = v_plan) THEN RAISE EXCEPTION 'Unknown plan: %', v_plan; END IF;
  SELECT plan_id, plan_status, plan_expires_at INTO v_old FROM public.societies WHERE id = _society_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown society'; END IF;
  IF _extend THEN v_base := GREATEST(COALESCE(v_old.plan_expires_at, now()), now()); ELSE v_base := now(); END IF;
  UPDATE public.societies SET plan_id = v_plan, plan_status = 'active', plan_selected_at = now(),
    plan_expires_at = v_base + (v_months || ' months')::interval, status = 'active', updated_at = now()
  WHERE id = _society_id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (v_caller, 'super_admin.plan_granted', 'societies', _society_id::text, _society_id,
    jsonb_build_object('from_plan', v_old.plan_id, 'from_status', v_old.plan_status, 'to_plan', v_plan, 'months', v_months, 'extend', _extend));
END; $function$;

-- 3) Lifecycle status (replaces direct browser table update) — audited, reason required.
CREATE OR REPLACE FUNCTION public.admin_set_society_status(_society_id uuid, _status text, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_caller uuid := auth.uid(); v_old text;
BEGIN
  IF v_caller IS NULL OR NOT public.is_super_admin(v_caller) THEN RETURN jsonb_build_object('status','not_authorized'); END IF;
  IF _status NOT IN ('active','suspended') THEN RETURN jsonb_build_object('status','invalid_input'); END IF;
  IF _reason IS NULL OR char_length(btrim(_reason)) < 3 OR char_length(_reason) > 300 THEN RETURN jsonb_build_object('status','reason_required'); END IF;
  SELECT status INTO v_old FROM public.societies WHERE id = _society_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
  IF v_old = _status THEN RETURN jsonb_build_object('status','unchanged'); END IF;
  UPDATE public.societies SET status = _status, updated_at = now() WHERE id = _society_id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (v_caller, 'super_admin.society_' || _status, 'societies', _society_id::text, _society_id,
    jsonb_build_object('from', v_old, 'to', _status, 'reason', btrim(_reason)));
  RETURN jsonb_build_object('status','success');
END $$;

-- 4) Trial extension — audited, bounded.
CREATE OR REPLACE FUNCTION public.admin_extend_trial(_society_id uuid, _days integer, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_caller uuid := auth.uid(); v_old record; v_new timestamptz;
BEGIN
  IF v_caller IS NULL OR NOT public.is_super_admin(v_caller) THEN RETURN jsonb_build_object('status','not_authorized'); END IF;
  IF _days IS NULL OR _days < 1 OR _days > 60 THEN RETURN jsonb_build_object('status','invalid_input'); END IF;
  IF _reason IS NULL OR char_length(btrim(_reason)) < 3 OR char_length(_reason) > 300 THEN RETURN jsonb_build_object('status','reason_required'); END IF;
  SELECT plan_id, plan_status, trial_ends_at INTO v_old FROM public.societies WHERE id = _society_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
  IF lower(coalesce(v_old.plan_status,'')) = 'active' THEN RETURN jsonb_build_object('status','already_paid'); END IF;
  v_new := GREATEST(COALESCE(v_old.trial_ends_at, now()), now()) + make_interval(days => _days);
  UPDATE public.societies SET plan_status = 'trialing', trial_ends_at = v_new, updated_at = now() WHERE id = _society_id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (v_caller, 'super_admin.trial_extended', 'societies', _society_id::text, _society_id,
    jsonb_build_object('from_status', v_old.plan_status, 'from_trial_ends_at', v_old.trial_ends_at, 'to_trial_ends_at', v_new, 'days', _days, 'reason', btrim(_reason)));
  RETURN jsonb_build_object('status','success','trial_ends_at', v_new);
END $$;

-- 5) Richer list for operations (aggregates only, no resident PII).
CREATE OR REPLACE FUNCTION public.admin_list_societies_v2()
RETURNS TABLE(id uuid, name text, city text, plan_id text, plan_status text, plan_expires_at timestamptz,
  trial_ends_at timestamptz, status text, created_at timestamptz, unit_count bigint, member_count bigint, admin_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  SELECT s.id, s.name, s.city, s.plan_id, s.plan_status, s.plan_expires_at, s.trial_ends_at, s.status, s.created_at,
    (SELECT count(*) FROM public.flats f WHERE f.society_id = s.id AND coalesce(f.is_active,true)),
    (SELECT count(DISTINCT ur.user_id) FROM public.user_roles ur WHERE ur.society_id = s.id AND coalesce(ur.is_active,true)),
    (SELECT count(DISTINCT ur.user_id) FROM public.user_roles ur WHERE ur.society_id = s.id AND coalesce(ur.is_active,true) AND ur.role = 'society_admin')
  FROM public.societies s ORDER BY s.created_at DESC;
END $$;

-- 6) Single-society operational overview (aggregates + admin names + audit trail).
CREATE OR REPLACE FUNCTION public.admin_society_overview(_society_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s record; v jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN RETURN jsonb_build_object('status','not_authorized'); END IF;
  SELECT * INTO s FROM public.societies WHERE id = _society_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
  v := jsonb_build_object(
    'status','ok',
    'society', jsonb_build_object('id', s.id, 'name', s.name, 'city', s.city, 'state', s.state,
      'created_at', s.created_at, 'lifecycle', s.status, 'plan_id', s.plan_id, 'plan_status', s.plan_status,
      'plan_expires_at', s.plan_expires_at, 'trial_ends_at', s.trial_ends_at, 'total_units', s.total_units,
      'structure_mode', s.structure_mode, 'invite_code_enabled', s.invite_code_enabled),
    'counts', jsonb_build_object(
      'units', (SELECT count(*) FROM public.flats WHERE society_id = s.id AND coalesce(is_active,true)),
      'members', (SELECT count(DISTINCT user_id) FROM public.user_roles WHERE society_id = s.id AND coalesce(is_active,true)),
      'pending_joins', (SELECT count(*) FROM public.join_requests WHERE society_id = s.id AND status = 'pending'),
      'open_tickets', (SELECT count(*) FROM public.support_tickets WHERE society_id = s.id AND status NOT IN ('resolved','closed'))),
    'admins', coalesce((SELECT jsonb_agg(jsonb_build_object('name', coalesce(p.full_name,'Unnamed'), 'role', ur.role, 'since', ur.created_at) ORDER BY ur.created_at)
      FROM public.user_roles ur LEFT JOIN public.profiles p ON p.id = ur.user_id
      WHERE ur.society_id = s.id AND coalesce(ur.is_active,true) AND ur.role IN ('society_admin','block_admin')), '[]'::jsonb),
    'activity', coalesce((SELECT jsonb_agg(a ORDER BY a->>'at' DESC) FROM (
      SELECT jsonb_build_object('action', al.action, 'at', al.created_at) a FROM public.audit_log al
      WHERE al.society_id = s.id ORDER BY al.created_at DESC LIMIT 15) x), '[]'::jsonb)
  );
  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.admin_set_society_status(uuid,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_extend_trial(uuid,integer,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_societies_v2() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_society_overview(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_grant_society_plan(uuid,text,integer,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_society_status(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_extend_trial(uuid,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_societies_v2() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_society_overview(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_society_plan(uuid,text,integer,boolean) TO authenticated;
