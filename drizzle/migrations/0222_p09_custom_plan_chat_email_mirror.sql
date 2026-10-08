-- P09: mirror custom-plan chat messages to email through the canonical message_deliveries queue.
-- Recipients: platform/system messages -> the requesting society admin; society messages -> active super admins.
-- Dedupe key (kind:message_id:channel:user) prevents duplicate emails on retry. Never blocks the chat insert.
CREATE OR REPLACE FUNCTION public._trg_custom_plan_message_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; u uuid;
BEGIN
  SELECT requested_by, society_id INTO r FROM public.custom_plan_requests WHERE id = NEW.request_id;
  IF NEW.sender_side IN ('platform','system') THEN
    IF r.requested_by IS NOT NULL AND r.requested_by IS DISTINCT FROM NEW.sender_id THEN
      PERFORM public._enqueue_message(NEW.society_id, r.requested_by, 'email', 'custom_plan_message', NEW.id::text,
        'SociyoHub: new message about your custom plan',
        'You have a new message about your custom plan request. Open SociyoHub → Subscription to read and reply.');
    END IF;
  ELSE
    FOR u IN SELECT DISTINCT ur.user_id FROM public.user_roles ur
             WHERE ur.role = 'super_admin' AND ur.user_id IS DISTINCT FROM NEW.sender_id LOOP
      PERFORM public._enqueue_message(NEW.society_id, u, 'email', 'custom_plan_message', NEW.id::text,
        'SociyoHub: new custom plan message from a society',
        'A society replied on a custom plan request. Open Super Admin → Custom Plans to respond.');
    END LOOP;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._trg_custom_plan_message_email() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS trg_custom_plan_message_email ON public.custom_plan_messages;
CREATE TRIGGER trg_custom_plan_message_email AFTER INSERT ON public.custom_plan_messages
FOR EACH ROW EXECUTE FUNCTION public._trg_custom_plan_message_email();