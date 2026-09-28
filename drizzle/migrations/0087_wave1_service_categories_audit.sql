CREATE OR REPLACE FUNCTION public._audit_service_categories()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public._rate_hit('ads_admin', coalesce(auth.uid()::text,'system'), 120, interval '1 hour');
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, metadata)
  VALUES (auth.uid(), CASE WHEN TG_OP = 'INSERT' THEN 'service_category.create'
      WHEN NEW.active IS DISTINCT FROM OLD.active THEN CASE WHEN NEW.active THEN 'service_category.activate' ELSE 'service_category.deactivate' END
      ELSE 'service_category.update' END,
    'service_categories', NEW.id::text, jsonb_build_object('label', NEW.label, 'active', NEW.active));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_audit_service_categories ON public.service_categories;
CREATE TRIGGER trg_audit_service_categories BEFORE INSERT OR UPDATE ON public.service_categories
  FOR EACH ROW EXECUTE FUNCTION public._audit_service_categories();