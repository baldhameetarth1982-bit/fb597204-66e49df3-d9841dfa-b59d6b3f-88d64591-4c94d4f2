-- P09 follow-up: add an ID-only direct link to custom-plan chat email copies.
-- {{app_url}} is expanded to the trusted public origin by the dispatcher at send time.
CREATE OR REPLACE FUNCTION public._trg_custom_plan_message_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; u uuid;
BEGIN
  SELECT requested_by, society_id INTO r FROM public.custom_plan_requests WHERE id = NEW.request_id;
  IF NEW.sender_side IN ('platform','system') THEN
    IF r.requested_by IS NOT NULL AND r.requested_by IS DISTINCT FROM NEW.sender_id THEN
      PERFORM public._enqueue_message(NEW.society_id, r.requested_by, 'email', 'custom_plan_message', NEW.id::text,
        'SociyoHub: new message about your custom plan',
        'You have a new message about your custom plan request. Open it in SociyoHub to read and reply: {{app_url}}/society/subscription?request=' || NEW.request_id::text || '#custom-plan');
    END IF;
  ELSE
    FOR u IN SELECT DISTINCT ur.user_id FROM public.user_roles ur
             WHERE ur.role = 'super_admin' AND ur.user_id IS DISTINCT FROM NEW.sender_id LOOP
      PERFORM public._enqueue_message(NEW.society_id, u, 'email', 'custom_plan_message', NEW.id::text,
        'SociyoHub: new custom plan message from a society',
        'A society replied on a custom plan request. Open it in SociyoHub to respond: {{app_url}}/admin/custom-plans?request=' || NEW.request_id::text);
    END LOOP;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._trg_custom_plan_message_email() FROM public, anon, authenticated;