CREATE OR REPLACE FUNCTION public._society_settings_protect_controls()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Direct browser writes may not change controls owned by audited RPCs.
  IF current_user NOT IN ('authenticated','anon') OR public.is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.handover_status := DEFAULT_HANDOVER(); -- placeholder replaced below
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._society_settings_protect_controls()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user NOT IN ('authenticated','anon') OR public.is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.handover_status := NULL; NEW.handover_note := NULL;
    NEW.handover_updated_at := NULL; NEW.handover_updated_by := NULL;
    RETURN NEW;
  END IF;
  IF NEW.handover_status IS DISTINCT FROM OLD.handover_status
     OR NEW.handover_note IS DISTINCT FROM OLD.handover_note
     OR NEW.handover_updated_at IS DISTINCT FROM OLD.handover_updated_at
     OR NEW.handover_updated_by IS DISTINCT FROM OLD.handover_updated_by
     OR NEW.bill_run_approval_required IS DISTINCT FROM OLD.bill_run_approval_required
     OR NEW.late_fee_enabled IS DISTINCT FROM OLD.late_fee_enabled
     OR NEW.society_id IS DISTINCT FROM OLD.society_id THEN
    RAISE EXCEPTION 'protected_settings_columns' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_society_settings_protect_controls ON public.society_settings;
CREATE TRIGGER trg_society_settings_protect_controls
BEFORE INSERT OR UPDATE ON public.society_settings
FOR EACH ROW EXECUTE FUNCTION public._society_settings_protect_controls();

CREATE OR REPLACE FUNCTION public._audit_user_roles()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.user_roles;
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (auth.uid(), 'user_role.' || lower(TG_OP), 'user_roles', r.id, r.society_id,
    jsonb_build_object('user_id', r.user_id, 'role', r.role,
      'old_role', CASE WHEN TG_OP = 'UPDATE' THEN OLD.role END,
      'old_active', CASE WHEN TG_OP = 'UPDATE' THEN OLD.is_active END,
      'is_active', CASE WHEN TG_OP <> 'DELETE' THEN NEW.is_active END));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._audit_user_roles() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit_user_roles ON public.user_roles;
CREATE TRIGGER trg_audit_user_roles
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public._audit_user_roles();

REVOKE EXECUTE ON FUNCTION public._amenity_on_resident_change() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._parking_on_resident_end() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._parking_on_vehicle_off() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._trg_emergency_enqueue_external() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._trg_wake_messaging_dispatch() FROM PUBLIC, anon;