-- 1) Maintenance mode -------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS maintenance_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS maintenance_message text;
ALTER TABLE public.platform_settings DROP CONSTRAINT IF EXISTS platform_settings_maintenance_message_len;
ALTER TABLE public.platform_settings ADD CONSTRAINT platform_settings_maintenance_message_len
  CHECK (maintenance_message IS NULL OR char_length(maintenance_message) <= 300);

CREATE OR REPLACE FUNCTION public.get_app_status()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT jsonb_build_object('maintenance', ps.maintenance_mode, 'message', ps.maintenance_message)
                     FROM public.platform_settings ps WHERE ps.id = 1),
                  jsonb_build_object('maintenance', false, 'message', NULL));
$$;
REVOKE ALL ON FUNCTION public.get_app_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_app_status() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_maintenance_mode(_on boolean, _message text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_msg text := NULLIF(btrim(COALESCE(_message, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_msg IS NOT NULL AND char_length(v_msg) > 300 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023'; END IF;
  UPDATE public.platform_settings SET maintenance_mode = COALESCE(_on, false), maintenance_message = v_msg, updated_at = now() WHERE id = 1;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, metadata)
    VALUES (auth.uid(), CASE WHEN _on THEN 'platform.maintenance_on' ELSE 'platform.maintenance_off' END,
            'platform_settings', '1', jsonb_build_object('message', v_msg));
END $$;
REVOKE ALL ON FUNCTION public.admin_set_maintenance_mode(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_maintenance_mode(boolean, text) TO authenticated, service_role;

-- 2) Platform staff roles (kept apart from society roles in user_roles) -----
DO $$ BEGIN
  CREATE TYPE public.platform_staff_role AS ENUM ('operations', 'finance', 'marketing', 'support');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.platform_staff_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role public.platform_staff_role NOT NULL,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.platform_staff_roles TO authenticated;
GRANT ALL ON public.platform_staff_roles TO service_role;
ALTER TABLE public.platform_staff_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff read own platform roles" ON public.platform_staff_roles;
CREATE POLICY "staff read own platform roles" ON public.platform_staff_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_super_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.has_platform_role(_user_id uuid, _roles text[])
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT _user_id IS NOT NULL AND (
    public.is_super_admin(_user_id)
    OR EXISTS (SELECT 1 FROM public.platform_staff_roles s WHERE s.user_id = _user_id AND s.role::text = ANY(_roles))
  );
$$;
REVOKE ALL ON FUNCTION public.has_platform_role(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_platform_role(uuid, text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_user_platform_roles()
 RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(array_agg(s.role::text ORDER BY s.role), ARRAY[]::text[])
    FROM public.platform_staff_roles s WHERE s.user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.current_user_platform_roles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_platform_roles() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_platform_staff()
 RETURNS TABLE(user_id uuid, full_name text, email text, roles text[])
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT p.id, p.full_name, p.email, array_agg(s.role::text ORDER BY s.role)
      FROM public.platform_staff_roles s JOIN public.profiles p ON p.id = s.user_id
     GROUP BY p.id, p.full_name, p.email ORDER BY p.full_name NULLS LAST;
END $$;
REVOKE ALL ON FUNCTION public.admin_list_platform_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_platform_staff() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_grant_platform_role(_email text, _role text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_user uuid; v_n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF _role NOT IN ('operations', 'finance', 'marketing', 'support') THEN RETURN 'invalid_role'; END IF;
  SELECT count(*), min(p.id::text)::uuid INTO v_n, v_user FROM public.profiles p
   WHERE lower(btrim(p.email)) = lower(btrim(COALESCE(_email, '')));
  IF v_n = 0 THEN RETURN 'user_not_found'; END IF;
  IF v_n > 1 THEN RETURN 'email_ambiguous'; END IF;
  IF public.is_super_admin(v_user) THEN RETURN 'already_super_admin'; END IF;
  INSERT INTO public.platform_staff_roles(user_id, role, granted_by)
    VALUES (v_user, _role::public.platform_staff_role, auth.uid())
    ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, metadata)
    VALUES (auth.uid(), 'platform.staff_role_granted', 'platform_staff_roles', v_user::text, jsonb_build_object('role', _role));
  RETURN 'ok';
END $$;
REVOKE ALL ON FUNCTION public.admin_grant_platform_role(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_platform_role(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_revoke_platform_role(_user_id uuid, _role text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.platform_staff_roles WHERE user_id = _user_id AND role::text = _role;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, metadata)
    VALUES (auth.uid(), 'platform.staff_role_revoked', 'platform_staff_roles', _user_id::text, jsonb_build_object('role', _role));
END $$;
REVOKE ALL ON FUNCTION public.admin_revoke_platform_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_platform_role(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_users()
 RETURNS TABLE(id uuid, full_name text, email text, phone text, created_at timestamp with time zone, society_id uuid, society_name text, plan_id text, plan_status text, plan_expires_at timestamp with time zone, roles jsonb)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL OR NOT public.has_platform_role(v_user, ARRAY['operations','support']) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
  SELECT p.id, p.full_name, p.email, p.phone, p.created_at, p.society_id, s.name AS society_name,
    s.plan_id, s.plan_status, s.plan_expires_at,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('role', ur.role, 'society_id', ur.society_id, 'block_id', ur.block_id) ORDER BY ur.created_at)
      FROM public.user_roles ur WHERE ur.user_id = p.id), '[]'::jsonb) AS roles
  FROM public.profiles p
  LEFT JOIN public.societies s ON s.id = p.society_id
  ORDER BY p.created_at DESC
  LIMIT 1000;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_platform_summary()
 RETURNS TABLE(total_users bigint, total_societies bigint, active_societies bigint, trialing_societies bigint, successful_payment_total numeric, unpaid_bill_total numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL OR NOT public.has_platform_role(v_user, ARRAY['finance','operations']) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
  SELECT
    (SELECT count(*) FROM public.profiles)::bigint,
    (SELECT count(*) FROM public.societies)::bigint,
    (SELECT count(*) FROM public.societies WHERE plan_status = 'active')::bigint,
    (SELECT count(*) FROM public.societies WHERE plan_status = 'trialing' AND trial_ends_at > now())::bigint,
    COALESCE((SELECT sum(amount) FROM public.payments WHERE status = 'success'), 0)::numeric,
    COALESCE((SELECT sum(amount) FROM public.bills WHERE status IN ('unpaid','overdue')), 0)::numeric;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_income_summary()
 RETURNS TABLE(subscription_mrr numeric, collected_total numeric, collected_30d numeric, total_revenue numeric, plans jsonb, standard_paid_societies integer, custom_priced_societies integer, custom_mrr numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _threshold integer;
BEGIN
  IF NOT public.has_platform_role(auth.uid(), ARRAY['finance']) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  SELECT coalesce((SELECT enterprise_threshold_units FROM public.pricing_settings LIMIT 1),300) INTO _threshold;
  WITH paid AS (
    SELECT s.id, p.price_per_flat_inr AS rate,
           (SELECT count(*) FROM public.flats f WHERE f.society_id = s.id AND f.is_active) AS flats
      FROM public.societies s JOIN public.plans p ON p.id = s.plan_id
     WHERE s.plan_status = 'active' AND coalesce(s.status,'active') <> 'suspended'
       AND (s.plan_expires_at IS NULL OR s.plan_expires_at > now())
  )
  SELECT coalesce(sum(rate*flats) FILTER (WHERE flats <= _threshold AND rate > 0 AND flats > 0),0),
         count(*) FILTER (WHERE flats <= _threshold AND rate > 0 AND flats > 0)::int,
         count(*) FILTER (WHERE flats > _threshold)::int,
         coalesce(sum((SELECT cp.price_inr * 30.0 / nullif(cp.duration_days,0)
                         FROM public.custom_plans cp WHERE cp.society_id = paid.id
                         ORDER BY cp.applied_at DESC NULLS LAST, cp.created_at DESC LIMIT 1))
                  FILTER (WHERE flats > _threshold),0)
    INTO subscription_mrr, standard_paid_societies, custom_priced_societies, custom_mrr
    FROM paid;
  SELECT coalesce(sum(amount_paise),0)/100.0,
         coalesce(sum(amount_paise) FILTER (WHERE confirmed_at > now() - interval '30 days'),0)/100.0
    INTO collected_total, collected_30d
    FROM public.saas_subscription_payments WHERE confirmed_at IS NOT NULL;
  total_revenue := subscription_mrr + custom_mrr;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,
           'price_monthly_inr',p.price_per_flat_inr,'price_per_flat_inr',p.price_per_flat_inr,
           'society_count',(SELECT count(*) FROM public.societies s WHERE s.plan_id=p.id)) ORDER BY p.sort_order),'[]'::jsonb)
    INTO plans FROM public.plans p WHERE p.id NOT IN ('ad_free','resident');
  RETURN NEXT;
END $function$;

CREATE OR REPLACE FUNCTION public.admin_society_health_list()
 RETURNS TABLE(id uuid, name text, city text, plan_id text, plan_status text, plan_expires_at timestamp with time zone, trial_ends_at timestamp with time zone, status text, created_at timestamp with time zone, flats integer, declared_units integer, residents integer, admins integer, guards integer, staff integer, pending_joins integer, open_tickets integer, overdue_tickets integer, open_incidents integer, failed_payments integer, ai_requests_30d integer, last_activity_at timestamp with time zone)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_platform_role(auth.uid(), ARRAY['operations','support','finance']) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT s.id, s.name, s.city, s.plan_id, s.plan_status, s.plan_expires_at, s.trial_ends_at, s.status, s.created_at,
    (SELECT count(*)::int FROM public.flats f WHERE f.society_id = s.id AND coalesce(f.is_active,true)),
    s.total_units,
    (SELECT count(DISTINCT ur.user_id)::int FROM public.user_roles ur WHERE ur.society_id = s.id AND coalesce(ur.is_active,true) AND ur.role = 'resident'),
    (SELECT count(DISTINCT ur.user_id)::int FROM public.user_roles ur WHERE ur.society_id = s.id AND coalesce(ur.is_active,true) AND ur.role IN ('society_admin','block_admin')),
    (SELECT count(DISTINCT ur.user_id)::int FROM public.user_roles ur WHERE ur.society_id = s.id AND coalesce(ur.is_active,true) AND ur.role = 'security'),
    (SELECT count(DISTINCT ur.user_id)::int FROM public.user_roles ur WHERE ur.society_id = s.id AND coalesce(ur.is_active,true) AND ur.role::text = 'staff'),
    (SELECT count(*)::int FROM public.join_requests j WHERE j.society_id = s.id AND j.status = 'pending'),
    (SELECT count(*)::int FROM public.support_tickets t WHERE t.society_id = s.id AND t.status NOT IN ('resolved','closed')),
    (SELECT count(*)::int FROM public.support_tickets t WHERE t.society_id = s.id AND t.status NOT IN ('resolved','closed') AND t.created_at < now() - interval '7 days'),
    (SELECT count(*)::int FROM public.security_incidents i WHERE i.society_id = s.id AND coalesce(i.status,'open') NOT IN ('resolved','closed')),
    (SELECT count(*)::int FROM public.saas_subscription_payments p WHERE p.society_id = s.id AND p.lifecycle_status = 'failed' AND coalesce(p.failed_at, p.updated_at) > now() - interval '30 days'),
    (SELECT count(*)::int FROM public.ai_usage_events a WHERE a.society_id = s.id AND a.created_at > now() - interval '30 days'),
    (SELECT max(al.created_at) FROM public.audit_log al WHERE al.society_id = s.id)
  FROM public.societies s
  ORDER BY s.created_at DESC;
END $function$;

DROP POLICY IF EXISTS "ads marketing staff read" ON public.ads;
CREATE POLICY "ads marketing staff read" ON public.ads FOR SELECT TO authenticated
  USING (public.has_platform_role(auth.uid(), ARRAY['marketing']));
DROP POLICY IF EXISTS "ads marketing staff insert" ON public.ads;
CREATE POLICY "ads marketing staff insert" ON public.ads FOR INSERT TO authenticated
  WITH CHECK (public.has_platform_role(auth.uid(), ARRAY['marketing']));
DROP POLICY IF EXISTS "ads marketing staff update" ON public.ads;
CREATE POLICY "ads marketing staff update" ON public.ads FOR UPDATE TO authenticated
  USING (public.has_platform_role(auth.uid(), ARRAY['marketing']))
  WITH CHECK (public.has_platform_role(auth.uid(), ARRAY['marketing']));
DROP POLICY IF EXISTS "ads bucket marketing read" ON storage.objects;
CREATE POLICY "ads bucket marketing read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ads' AND public.has_platform_role(auth.uid(), ARRAY['marketing']));
DROP POLICY IF EXISTS "ads bucket marketing insert" ON storage.objects;
CREATE POLICY "ads bucket marketing insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ads' AND public.has_platform_role(auth.uid(), ARRAY['marketing']));

-- 3) Scheduled platform announcements ---------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 120),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 300),
  audience text NOT NULL CHECK (audience IN ('everyone', 'society_admins', 'residents', 'guards')),
  society_id uuid REFERENCES public.societies(id) ON DELETE CASCADE,
  send_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sent', 'cancelled')),
  recipients integer,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  cancelled_at timestamptz
);
CREATE INDEX IF NOT EXISTS platform_announcements_due ON public.platform_announcements(send_at) WHERE status = 'scheduled';
GRANT SELECT ON public.platform_announcements TO authenticated;
GRANT ALL ON public.platform_announcements TO service_role;
ALTER TABLE public.platform_announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "marketing reads announcements" ON public.platform_announcements;
CREATE POLICY "marketing reads announcements" ON public.platform_announcements FOR SELECT TO authenticated
  USING (public.has_platform_role(auth.uid(), ARRAY['marketing']));

CREATE OR REPLACE FUNCTION public._send_platform_announcement(_id uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE a public.platform_announcements%ROWTYPE; v_n integer;
BEGIN
  SELECT * INTO a FROM public.platform_announcements WHERE id = _id AND status = 'scheduled' FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN 0; END IF;
  WITH targets AS (
    SELECT DISTINCT ON (ur.user_id) ur.user_id, ur.society_id
      FROM public.user_roles ur
     WHERE coalesce(ur.is_active, true)
       AND ur.society_id IS NOT NULL
       AND (a.society_id IS NULL OR ur.society_id = a.society_id)
       AND CASE a.audience
             WHEN 'everyone' THEN ur.role::text IN ('resident', 'society_admin', 'block_admin', 'security')
             WHEN 'society_admins' THEN ur.role::text IN ('society_admin', 'block_admin')
             WHEN 'residents' THEN ur.role::text = 'resident'
             WHEN 'guards' THEN ur.role::text = 'security'
           END
     ORDER BY ur.user_id, ur.society_id
  ), ins AS (
    INSERT INTO public.user_notifications(user_id, society_id, kind, title, body, link, dedupe_key)
    SELECT t.user_id, t.society_id, 'announcement', left(a.title, 120), left(a.body, 300), NULL, 'platform-announcement:' || a.id
      FROM targets t
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_n FROM ins;
  UPDATE public.platform_announcements SET status = 'sent', sent_at = now(), recipients = v_n WHERE id = a.id;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public._send_platform_announcement(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._send_platform_announcement(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_schedule_announcement(_title text, _body text, _audience text, _society_id uuid, _send_at timestamptz)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_id uuid; v_at timestamptz := COALESCE(_send_at, now());
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_platform_role(auth.uid(), ARRAY['marketing']) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_at < now() - interval '5 minutes' OR v_at > now() + interval '90 days' THEN
    RAISE EXCEPTION 'invalid_send_time' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.platform_announcements(title, body, audience, society_id, send_at, created_by)
    VALUES (btrim(_title), btrim(_body), _audience, _society_id, v_at, auth.uid()) RETURNING id INTO v_id;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, society_id, metadata)
    VALUES (auth.uid(), 'platform.announcement_scheduled', 'platform_announcements', v_id::text, _society_id,
            jsonb_build_object('audience', _audience, 'send_at', v_at));
  IF v_at <= now() THEN PERFORM public._send_platform_announcement(v_id); END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_schedule_announcement(text, text, text, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_schedule_announcement(text, text, text, uuid, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_cancel_announcement(_id uuid)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ok boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_platform_role(auth.uid(), ARRAY['marketing']) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.platform_announcements SET status = 'cancelled', cancelled_at = now()
   WHERE id = _id AND status = 'scheduled' RETURNING true INTO v_ok;
  IF v_ok THEN
    INSERT INTO public.audit_log(actor_id, action, target_table, target_id, metadata)
      VALUES (auth.uid(), 'platform.announcement_cancelled', 'platform_announcements', _id::text, '{}'::jsonb);
  END IF;
  RETURN COALESCE(v_ok, false);
END $$;
REVOKE ALL ON FUNCTION public.admin_cancel_announcement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_announcement(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.send_due_platform_announcements()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r record; v_total integer := 0;
BEGIN
  FOR r IN SELECT id FROM public.platform_announcements WHERE status = 'scheduled' AND send_at <= now() ORDER BY send_at LIMIT 50 LOOP
    v_total := v_total + public._send_platform_announcement(r.id);
  END LOOP;
  RETURN v_total;
END $$;
REVOKE ALL ON FUNCTION public.send_due_platform_announcements() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_due_platform_announcements() TO service_role;

DO $$ BEGIN
  PERFORM cron.unschedule('platform-announcements-hourly');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('platform-announcements-hourly', '0 * * * *', $$SELECT public.send_due_platform_announcements();$$);