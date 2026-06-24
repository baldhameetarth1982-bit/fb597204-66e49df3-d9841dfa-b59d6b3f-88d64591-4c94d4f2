-- 1) Audit log
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_table text,
  target_id text,
  society_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can read all audit entries"
  ON public.audit_log FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Society admins can read their society's entries"
  ON public.audit_log FOR SELECT TO authenticated
  USING (
    society_id IS NOT NULL
    AND public.is_society_admin_for(auth.uid(), society_id)
  );

CREATE INDEX IF NOT EXISTS audit_log_society_idx
  ON public.audit_log (society_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx
  ON public.audit_log (actor_id, created_at DESC);

-- 2) Membership authorization helper
CREATE OR REPLACE FUNCTION public.authorize_membership(_user_id uuid, _society_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _user_id IS NOT NULL
    AND _society_id IS NOT NULL
    AND (
      public.is_super_admin(_user_id)
      OR public.is_society_admin_for(_user_id, _society_id)
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = _user_id
          AND ur.society_id = _society_id
      )
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = _user_id
          AND p.society_id = _society_id
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.authorize_membership(uuid, uuid) TO authenticated, service_role;