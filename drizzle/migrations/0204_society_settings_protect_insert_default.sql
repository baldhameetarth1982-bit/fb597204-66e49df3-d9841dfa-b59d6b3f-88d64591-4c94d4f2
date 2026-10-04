CREATE OR REPLACE FUNCTION public._society_settings_protect_controls()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user NOT IN ('authenticated','anon') OR public.is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.handover_status := 'not_started'; NEW.handover_note := NULL;
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