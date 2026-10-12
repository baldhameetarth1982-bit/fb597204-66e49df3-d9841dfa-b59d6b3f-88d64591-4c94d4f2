CREATE TABLE public.admin_passkeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  credential_id text NOT NULL UNIQUE,
  public_key text NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  transports text[] NOT NULL DEFAULT '{}',
  rp_id text NOT NULL,
  device_label text NOT NULL DEFAULT 'Device' CHECK (length(device_label) <= 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX admin_passkeys_user_idx ON public.admin_passkeys (user_id);

CREATE TABLE public.admin_webauthn_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('register','authenticate')),
  challenge text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_webauthn_challenges_user_idx ON public.admin_webauthn_challenges (user_id, kind);

CREATE TABLE public.admin_step_sessions (
  user_id uuid NOT NULL,
  session_id uuid NOT NULL,
  method text NOT NULL CHECK (method IN ('passkey','backup_code')),
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, session_id)
);

CREATE TABLE public.admin_backup_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_backup_codes_user_idx ON public.admin_backup_codes (user_id) WHERE used_at IS NULL;

GRANT ALL ON public.admin_passkeys, public.admin_webauthn_challenges, public.admin_step_sessions, public.admin_backup_codes TO service_role;
ALTER TABLE public.admin_passkeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_webauthn_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_step_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_backup_codes ENABLE ROW LEVEL SECURITY;

-- True when the current request may use Super Admin power for _uid:
-- service/cron calls and checks about another person pass; the signed-in
-- person themself needs an authenticator-code (aal2) session plus a
-- biometric or backup-code check recorded for this exact sign-in session.
CREATE OR REPLACE FUNCTION public._super_admin_step_ok(_uid uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT auth.uid() IS NULL
      OR _uid IS DISTINCT FROM auth.uid()
      OR (coalesce(auth.jwt()->>'aal','') = 'aal2'
          AND EXISTS (SELECT 1 FROM public.admin_step_sessions s
                      WHERE s.user_id = auth.uid()
                        AND s.session_id = public._auth_session_id()
                        AND s.verified_at > now() - interval '12 hours'))
$f$;
REVOKE ALL ON FUNCTION public._super_admin_step_ok(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._super_admin_step_ok(uuid) TO authenticated, service_role, anon;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role AND COALESCE(is_active,true))
          AND (_role <> 'super_admin'::public.app_role OR public._super_admin_step_ok(_user_id)) $f$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $f$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role='super_admin'::public.app_role AND COALESCE(is_active,true))
          AND public._super_admin_step_ok(_user_id) $f$;

CREATE OR REPLACE FUNCTION public.is_super_admin_internal(_actor_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$ SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=_actor_id AND ur.role='super_admin' AND COALESCE(ur.is_active,true))
          AND public._super_admin_step_ok(_actor_id) $f$;