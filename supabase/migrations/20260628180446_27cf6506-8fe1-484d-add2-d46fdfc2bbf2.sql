
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_offline boolean NOT NULL DEFAULT false;

ALTER TABLE public.society_settings ADD COLUMN IF NOT EXISTS opening_cash numeric NOT NULL DEFAULT 0;
ALTER TABLE public.society_settings ADD COLUMN IF NOT EXISTS opening_bank numeric NOT NULL DEFAULT 0;
ALTER TABLE public.society_settings ADD COLUMN IF NOT EXISTS financial_year_start_month int NOT NULL DEFAULT 4;
ALTER TABLE public.society_settings ADD COLUMN IF NOT EXISTS bylaws_html text;
ALTER TABLE public.society_settings ADD COLUMN IF NOT EXISTS bylaws_pdf_path text;

CREATE TABLE IF NOT EXISTS public.society_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('committee','service')),
  role_label text NOT NULL,
  name text NOT NULL,
  phone text,
  notes text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.society_contacts TO authenticated;
GRANT ALL ON public.society_contacts TO service_role;

ALTER TABLE public.society_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view contacts of their society"
ON public.society_contacts FOR SELECT TO authenticated
USING (
  public.society_has_access(society_id)
  OR public.is_super_admin(auth.uid())
);

CREATE POLICY "Society admins manage contacts"
ON public.society_contacts FOR ALL TO authenticated
USING (
  public.is_society_admin_for(auth.uid(), society_id)
  OR public.is_super_admin(auth.uid())
)
WITH CHECK (
  public.is_society_admin_for(auth.uid(), society_id)
  OR public.is_super_admin(auth.uid())
);

CREATE INDEX IF NOT EXISTS society_contacts_society_idx
  ON public.society_contacts(society_id, category, sort_order);

CREATE TRIGGER set_society_contacts_updated_at
BEFORE UPDATE ON public.society_contacts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
