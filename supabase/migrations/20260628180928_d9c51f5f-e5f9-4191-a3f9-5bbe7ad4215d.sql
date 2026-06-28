
CREATE TABLE IF NOT EXISTS public.offline_residents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  flat_id uuid NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone text,
  email text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.offline_residents TO authenticated;
GRANT ALL ON public.offline_residents TO service_role;

ALTER TABLE public.offline_residents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "society members view offline residents"
ON public.offline_residents FOR SELECT TO authenticated
USING (public.society_has_access(society_id) OR public.is_super_admin(auth.uid()));

CREATE POLICY "society admins manage offline residents"
ON public.offline_residents FOR ALL TO authenticated
USING (public.is_society_admin_for(auth.uid(), society_id) OR public.is_super_admin(auth.uid()))
WITH CHECK (public.is_society_admin_for(auth.uid(), society_id) OR public.is_super_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS offline_residents_society_idx ON public.offline_residents(society_id, flat_id);

CREATE TRIGGER set_offline_residents_updated_at
BEFORE UPDATE ON public.offline_residents
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
