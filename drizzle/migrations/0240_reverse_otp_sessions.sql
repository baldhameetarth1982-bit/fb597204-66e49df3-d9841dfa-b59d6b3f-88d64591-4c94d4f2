CREATE TABLE public.reverse_otp_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_session_id bigint NOT NULL UNIQUE,
  phone text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  attempt_token_hash text NOT NULL UNIQUE CHECK (length(attempt_token_hash) = 64),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','consumed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  consumed_at timestamptz
);
GRANT ALL ON public.reverse_otp_sessions TO service_role;
REVOKE ALL ON public.reverse_otp_sessions FROM anon, authenticated;
ALTER TABLE public.reverse_otp_sessions ENABLE ROW LEVEL SECURITY;
CREATE INDEX reverse_otp_sessions_created_idx ON public.reverse_otp_sessions (created_at);
COMMENT ON TABLE public.reverse_otp_sessions IS 'Server-only Reverse OTP sign-in attempts; no client policies by design.';