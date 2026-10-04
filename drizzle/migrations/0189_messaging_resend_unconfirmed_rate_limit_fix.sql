CREATE OR REPLACE FUNCTION public.admin_resend_unconfirmed_messages(_channel text, _reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int; ok boolean;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF coalesce(char_length(btrim(_reason)),0) < 5 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF _channel NOT IN ('email','sms','whatsapp') THEN RAISE EXCEPTION 'invalid_channel'; END IF;
  SELECT allowed INTO ok FROM public.touch_rate_limit('messaging_resend_unconfirmed', auth.uid()::text, 10, 3600);
  IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'rate_limited'; END IF;
  UPDATE public.message_deliveries SET status='queued', next_attempt_at=now(), send_started_at=NULL,
    last_error='Resent by Super Admin after an unconfirmed send', updated_at=now()
  WHERE channel=_channel AND status='unconfirmed' AND created_at > now() - interval '3 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO public.audit_log(actor_id, action, target_table, target_id, metadata)
  VALUES (auth.uid(), 'platform.messaging.resend_unconfirmed', 'message_deliveries', _channel, jsonb_build_object('count',n,'reason',left(btrim(_reason),300)));
  RETURN n;
END $$;