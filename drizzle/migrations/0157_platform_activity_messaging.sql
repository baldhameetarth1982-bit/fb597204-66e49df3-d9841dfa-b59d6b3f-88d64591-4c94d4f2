-- Privacy-minimised last-active timestamp: one row per user, no IP/device/history.
CREATE TABLE public.user_last_active (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_active_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.user_last_active TO service_role;
ALTER TABLE public.user_last_active ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.touch_last_active() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  INSERT INTO public.user_last_active(user_id, last_active_at) VALUES (auth.uid(), now())
  ON CONFLICT (user_id) DO UPDATE SET last_active_at = now()
  WHERE public.user_last_active.last_active_at < now() - interval '15 minutes';
END $$;
REVOKE ALL ON FUNCTION public.touch_last_active() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.touch_last_active() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_active_people() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  RETURN jsonb_build_object(
    'status','ok',
    'active_1d', (SELECT count(*) FROM public.user_last_active WHERE last_active_at > now() - interval '1 day'),
    'active_7d', (SELECT count(*) FROM public.user_last_active WHERE last_active_at > now() - interval '7 days'),
    'active_30d', (SELECT count(*) FROM public.user_last_active WHERE last_active_at > now() - interval '30 days'),
    'tracking_since', (SELECT min(last_active_at) FROM public.user_last_active));
END $$;
REVOKE ALL ON FUNCTION public.admin_active_people() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_active_people() TO authenticated;

-- Messaging provider abstraction (Email / SMS / WhatsApp). Credentials live only in server env.
CREATE TABLE public.messaging_channels (
  channel text PRIMARY KEY CHECK (channel IN ('email','sms','whatsapp')),
  enabled boolean NOT NULL DEFAULT false,
  last_health_at timestamptz,
  last_health_ok boolean,
  last_error text CHECK (char_length(last_error) <= 300),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
INSERT INTO public.messaging_channels(channel) VALUES ('email'),('sms'),('whatsapp');
GRANT ALL ON public.messaging_channels TO service_role;
ALTER TABLE public.messaging_channels ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.message_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid REFERENCES public.societies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email','sms','whatsapp')),
  source_kind text NOT NULL CHECK (char_length(source_kind) <= 40),
  source_id text,
  dedupe_key text NOT NULL UNIQUE CHECK (char_length(dedupe_key) <= 200),
  subject text NOT NULL CHECK (char_length(subject) <= 160),
  body text NOT NULL CHECK (char_length(body) <= 600),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','not_connected','disabled','no_address')),
  attempts int NOT NULL DEFAULT 0,
  last_error text CHECK (char_length(last_error) <= 300),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  provider_message_id text CHECK (char_length(provider_message_id) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_deliveries_due_idx ON public.message_deliveries(status, next_attempt_at);
CREATE INDEX message_deliveries_src_idx ON public.message_deliveries(source_kind, source_id);
GRANT ALL ON public.message_deliveries TO service_role;
ALTER TABLE public.message_deliveries ENABLE ROW LEVEL SECURITY;

-- Internal enqueue: definer/service only. Dedupe key prevents duplicates on retries.
CREATE OR REPLACE FUNCTION public._enqueue_message(_soc uuid, _user uuid, _channel text, _kind text, _src text, _subject text, _body text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.message_deliveries(society_id, user_id, channel, source_kind, source_id, dedupe_key, subject, body)
  VALUES (_soc, _user, _channel, _kind, _src, _kind||':'||coalesce(_src,'')||':'||_channel||':'||_user::text, left(_subject,160), left(_body,600))
  ON CONFLICT (dedupe_key) DO NOTHING;
$$;
REVOKE ALL ON FUNCTION public._enqueue_message(uuid,uuid,text,text,text,text,text) FROM public, anon, authenticated;

-- Emergency broadcasts fan out to external channels (still sent in-app first by the existing RPC).
CREATE OR REPLACE FUNCTION public._trg_emergency_enqueue_external() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b record; ch text;
BEGIN
  SELECT society_id, category_label, title, message INTO b FROM public.emergency_broadcasts WHERE id = NEW.broadcast_id;
  FOREACH ch IN ARRAY ARRAY['sms','whatsapp','email'] LOOP
    PERFORM public._enqueue_message(b.society_id, NEW.user_id, ch, 'emergency', NEW.broadcast_id::text,
      'EMERGENCY · '||b.category_label||': '||b.title, b.message);
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW; -- never block in-app emergency delivery
END $$;
CREATE TRIGGER trg_emergency_enqueue_external AFTER INSERT ON public.emergency_broadcast_recipients
FOR EACH ROW EXECUTE FUNCTION public._trg_emergency_enqueue_external();

CREATE OR REPLACE FUNCTION public.admin_messaging_overview() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  RETURN jsonb_build_object('status','ok',
    'channels', (SELECT jsonb_agg(jsonb_build_object('channel',c.channel,'enabled',c.enabled,'last_health_at',c.last_health_at,
        'last_health_ok',c.last_health_ok,'last_error',c.last_error,'updated_at',c.updated_at,
        'counts', (SELECT coalesce(jsonb_object_agg(s.status, s.n),'{}'::jsonb) FROM (
           SELECT status, count(*) n FROM public.message_deliveries d WHERE d.channel=c.channel AND d.created_at > now() - interval '7 days' GROUP BY status) s)
      ) ORDER BY c.channel) FROM public.messaging_channels c),
    'recent_failures', (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (
       SELECT id, channel, source_kind, attempts, last_error, updated_at FROM public.message_deliveries
       WHERE status='failed' ORDER BY updated_at DESC LIMIT 20) x));
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_messaging_channel(_channel text, _enabled boolean, _reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _before boolean;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF coalesce(char_length(btrim(_reason)),0) < 5 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT enabled INTO _before FROM public.messaging_channels WHERE channel=_channel FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_channel'; END IF;
  UPDATE public.messaging_channels SET enabled=_enabled, updated_at=now(), updated_by=auth.uid() WHERE channel=_channel;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, metadata)
  VALUES (auth.uid(), 'platform.messaging.channel_set', 'messaging_channels', _channel,
    jsonb_build_object('before',_before,'after',_enabled,'reason',left(btrim(_reason),300)));
END $$;

CREATE OR REPLACE FUNCTION public.admin_retry_failed_messages(_channel text, _reason text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF coalesce(char_length(btrim(_reason)),0) < 5 THEN RAISE EXCEPTION 'reason_required'; END IF;
  UPDATE public.message_deliveries SET status='queued', attempts=0, next_attempt_at=now(), updated_at=now()
  WHERE channel=_channel AND status IN ('failed','not_connected','disabled') AND created_at > now() - interval '3 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, metadata)
  VALUES (auth.uid(), 'platform.messaging.retry', 'message_deliveries', _channel, jsonb_build_object('count',n,'reason',left(btrim(_reason),300)));
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.admin_messaging_overview() FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_set_messaging_channel(text,boolean,text) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_retry_failed_messages(text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_messaging_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_messaging_channel(text,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_retry_failed_messages(text,text) TO authenticated;