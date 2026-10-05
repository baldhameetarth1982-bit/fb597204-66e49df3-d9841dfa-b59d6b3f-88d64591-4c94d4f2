CREATE OR REPLACE FUNCTION public._audit_income_categories()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
    VALUES (auth.uid(), NEW.society_id, 'finance.income_category_created', 'society_income_categories', NEW.id,
      jsonb_build_object('key', NEW.key, 'display_name', NEW.display_name, 'is_system', NEW.is_system));
  ELSIF TG_OP = 'UPDATE' THEN
    IF (OLD.display_name, OLD.description, OLD.category_group, OLD.is_active)
       IS DISTINCT FROM (NEW.display_name, NEW.description, NEW.category_group, NEW.is_active) THEN
      INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
      VALUES (auth.uid(), NEW.society_id, 'finance.income_category_updated', 'society_income_categories', NEW.id,
        jsonb_build_object(
          'old', jsonb_build_object('display_name', OLD.display_name, 'category_group', OLD.category_group, 'is_active', OLD.is_active),
          'new', jsonb_build_object('display_name', NEW.display_name, 'category_group', NEW.category_group, 'is_active', NEW.is_active)));
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log(actor_id, society_id, action, target_table, target_id, metadata)
    VALUES (auth.uid(), OLD.society_id, 'finance.income_category_deleted', 'society_income_categories', OLD.id,
      jsonb_build_object('key', OLD.key, 'display_name', OLD.display_name));
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

REVOKE ALL ON FUNCTION public._audit_income_categories() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sic_audit ON public.society_income_categories;
CREATE TRIGGER trg_sic_audit
AFTER INSERT OR UPDATE OR DELETE ON public.society_income_categories
FOR EACH ROW EXECUTE FUNCTION public._audit_income_categories();