-- Wake the dispatcher as soon as messages are queued (one async call per statement).
CREATE OR REPLACE FUNCTION public._trg_wake_messaging_dispatch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://project--68752e3a-4def-45ab-8ff0-b74d48f33a17.lovable.app/api/public/hooks/messaging-dispatch',
    headers := jsonb_build_object('Content-Type','application/json',
      'X-Scheduler-Token', (SELECT token FROM public._scheduler_tokens WHERE name='automation_cron')),
    body := '{}'::jsonb);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL; -- never block queueing; hourly run is the backstop
END $$;
CREATE TRIGGER trg_wake_messaging_dispatch AFTER INSERT ON public.message_deliveries
FOR EACH STATEMENT EXECUTE FUNCTION public._trg_wake_messaging_dispatch();

-- Hourly backstop for retries with backoff and any missed wake-ups.
SELECT cron.schedule('messaging-dispatch-hourly', '7 * * * *', $cron$
  SELECT net.http_post(
    url := 'https://project--68752e3a-4def-45ab-8ff0-b74d48f33a17.lovable.app/api/public/hooks/messaging-dispatch',
    headers := jsonb_build_object('Content-Type','application/json',
      'X-Scheduler-Token', (SELECT token FROM public._scheduler_tokens WHERE name='automation_cron')),
    body := '{}'::jsonb);
$cron$);