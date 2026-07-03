
-- 1) Profile fields required for Phase 2
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS property_number text,
  ADD COLUMN IF NOT EXISTS ugvcl_number text,
  ADD COLUMN IF NOT EXISTS share_certificate_number text,
  ADD COLUMN IF NOT EXISTS move_in_date date;

-- 2) Flat residents: preserve history on ownership change
ALTER TABLE public.flat_residents
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS moved_out_at date,
  ADD COLUMN IF NOT EXISTS ended_reason text;

CREATE INDEX IF NOT EXISTS idx_flat_residents_active
  ON public.flat_residents(flat_id) WHERE is_active = true;

-- 3) Deactivate resident (preserve history) RPC
CREATE OR REPLACE FUNCTION public.deactivate_flat_resident(
  _flat_resident_id uuid,
  _reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_flat uuid;
  v_society uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT fr.flat_id, f.society_id INTO v_flat, v_society
    FROM public.flat_residents fr
    JOIN public.flats f ON f.id = fr.flat_id
    WHERE fr.id = _flat_resident_id;
  IF v_flat IS NULL THEN RAISE EXCEPTION 'Resident link not found'; END IF;
  IF NOT (public.is_society_admin_for(v_caller, v_society) OR public.is_super_admin(v_caller)) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.flat_residents
    SET is_active = false,
        is_primary = false,
        moved_out_at = COALESCE(moved_out_at, CURRENT_DATE),
        ended_reason = NULLIF(trim(COALESCE(_reason,'')), '')
  WHERE id = _flat_resident_id;
END; $$;

-- 4) Outstanding for a flat: pending + overdue maintenance, minus advances
CREATE OR REPLACE FUNCTION public.flat_outstanding(_flat_id uuid)
RETURNS TABLE(pending numeric, overdue_count int, next_due date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE(SUM(CASE WHEN status IN ('pending','outstanding') AND period_start <= CURRENT_DATE THEN amount_due ELSE 0 END), 0),
    COUNT(*) FILTER (WHERE status IN ('pending','outstanding') AND due_date IS NOT NULL AND due_date < CURRENT_DATE)::int,
    MIN(due_date) FILTER (WHERE status IN ('pending','outstanding'))
  FROM public.maintenance_periods
  WHERE flat_id = _flat_id;
$$;

-- 5) Society-wide maintenance KPIs
CREATE OR REPLACE FUNCTION public.society_maintenance_summary(_society_id uuid)
RETURNS TABLE(
  total_houses int,
  paid_periods int,
  pending_periods int,
  advance_periods int,
  overdue_periods int,
  outstanding_amount numeric,
  advance_amount numeric,
  collection_percent numeric
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH t AS (
    SELECT status, amount_due, period_start, due_date FROM public.maintenance_periods
    WHERE society_id = _society_id
  )
  SELECT
    (SELECT COUNT(*)::int FROM public.flats WHERE society_id = _society_id),
    (SELECT COUNT(*)::int FROM t WHERE status = 'paid'),
    (SELECT COUNT(*)::int FROM t WHERE status IN ('pending','outstanding') AND period_start <= CURRENT_DATE),
    (SELECT COUNT(*)::int FROM t WHERE status = 'paid' AND period_start > CURRENT_DATE),
    (SELECT COUNT(*)::int FROM t WHERE status IN ('pending','outstanding') AND due_date IS NOT NULL AND due_date < CURRENT_DATE),
    (SELECT COALESCE(SUM(amount_due),0) FROM t WHERE status IN ('pending','outstanding') AND period_start <= CURRENT_DATE),
    (SELECT COALESCE(SUM(amount_due),0) FROM t WHERE status = 'paid' AND period_start > CURRENT_DATE),
    (SELECT CASE WHEN (COUNT(*) FILTER (WHERE period_start <= CURRENT_DATE)) = 0 THEN 0
      ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'paid' AND period_start <= CURRENT_DATE)
        / NULLIF(COUNT(*) FILTER (WHERE period_start <= CURRENT_DATE), 0), 1)
      END FROM t)
$$;

-- 6) Audit triggers
CREATE OR REPLACE FUNCTION public._audit_flat_residents() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_society uuid;
BEGIN
  SELECT society_id INTO v_society FROM public.flats
    WHERE id = COALESCE(NEW.flat_id, OLD.flat_id);
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (
    auth.uid(),
    TG_OP,
    'flat_residents',
    COALESCE(NEW.id, OLD.id)::text,
    v_society,
    jsonb_build_object(
      'flat_id', COALESCE(NEW.flat_id, OLD.flat_id),
      'user_id', COALESCE(NEW.user_id, OLD.user_id),
      'relationship', COALESCE(NEW.relationship, OLD.relationship),
      'is_active_new', NEW.is_active,
      'is_active_old', OLD.is_active
    )
  );
  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS audit_flat_residents ON public.flat_residents;
CREATE TRIGGER audit_flat_residents
  AFTER INSERT OR UPDATE OR DELETE ON public.flat_residents
  FOR EACH ROW EXECUTE FUNCTION public._audit_flat_residents();

CREATE OR REPLACE FUNCTION public._audit_maintenance_periods() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.amount_due IS NOT DISTINCT FROM OLD.amount_due THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.audit_log (actor_id, action, target_table, target_id, society_id, metadata)
  VALUES (
    auth.uid(),
    TG_OP || CASE WHEN TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status
                   THEN ':' || NEW.status ELSE '' END,
    'maintenance_periods',
    COALESCE(NEW.id, OLD.id)::text,
    COALESCE(NEW.society_id, OLD.society_id),
    jsonb_build_object(
      'flat_id', COALESCE(NEW.flat_id, OLD.flat_id),
      'period_label', COALESCE(NEW.period_label, OLD.period_label),
      'status_new', NEW.status,
      'status_old', OLD.status,
      'amount_new', NEW.amount_due,
      'amount_old', OLD.amount_due
    )
  );
  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS audit_maintenance_periods ON public.maintenance_periods;
CREATE TRIGGER audit_maintenance_periods
  AFTER INSERT OR UPDATE OR DELETE ON public.maintenance_periods
  FOR EACH ROW EXECUTE FUNCTION public._audit_maintenance_periods();
