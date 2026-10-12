CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id uuid PRIMARY KEY,
  notify_announcements boolean NOT NULL DEFAULT true,
  notify_visitors boolean NOT NULL DEFAULT true,
  notify_bills boolean NOT NULL DEFAULT true,
  email_digest boolean NOT NULL DEFAULT false,
  marketing_emails boolean NOT NULL DEFAULT false,
  marketing_consent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.user_preferences TO authenticated;
GRANT ALL ON public.user_preferences TO service_role;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own preferences read" ON public.user_preferences FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Own preferences insert" ON public.user_preferences FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Own preferences update" ON public.user_preferences FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public._user_preferences_touch() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.marketing_emails AND (TG_OP = 'INSERT' OR NOT OLD.marketing_emails) THEN NEW.marketing_consent_at := now(); END IF;
  IF NOT NEW.marketing_emails THEN NEW.marketing_consent_at := NULL; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_user_preferences_touch ON public.user_preferences;
CREATE TRIGGER trg_user_preferences_touch BEFORE INSERT OR UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public._user_preferences_touch();

-- Which preference controls a notification kind (NULL = always delivered).
CREATE OR REPLACE FUNCTION public.notification_pref_category(_kind text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _kind IN ('notice','event','event_cancelled','community','group','meeting','survey','poll','vote','election') THEN 'announcements'
    WHEN _kind IN ('visitor_approval','visitor_decision','visitor_entered','visitor_exited','material_pass') THEN 'visitors'
    WHEN _kind IN ('billing','bill_due','payment') THEN 'bills'
    ELSE NULL END;
$$;

-- Respect each person's choices for every notification path; safety and urgent alerts always go through.
CREATE OR REPLACE FUNCTION public._user_notifications_respect_prefs() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c text; p public.user_preferences%ROWTYPE;
BEGIN
  IF NEW.priority = 'urgent' THEN RETURN NEW; END IF;
  c := public.notification_pref_category(NEW.kind);
  IF c IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO p FROM public.user_preferences WHERE user_id = NEW.user_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF (c = 'announcements' AND NOT p.notify_announcements)
     OR (c = 'visitors' AND NOT p.notify_visitors)
     OR (c = 'bills' AND NOT p.notify_bills) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_user_notifications_respect_prefs ON public.user_notifications;
CREATE TRIGGER trg_user_notifications_respect_prefs BEFORE INSERT ON public.user_notifications
  FOR EACH ROW EXECUTE FUNCTION public._user_notifications_respect_prefs();