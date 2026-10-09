-- DISPOSABLE VERIFICATION DATABASES ONLY. Never part of the hosted migration track.
-- The assembler comments out the historical `CREATE EXTENSION pg_net`, so the
-- real outbound-HTTP extension is never installed here. This file installs
-- inert, signature-compatible stand-ins in schema `net` that send nothing.
-- It never alters, drops or takes ownership of any extension. Idempotent.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'disposable_inert_network_check_failed: real pg_net is installed';
  END IF;
END
$guard$;

CREATE SCHEMA IF NOT EXISTS net;

CREATE OR REPLACE FUNCTION net.http_post(
  url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$;
CREATE OR REPLACE FUNCTION net.http_get(
  url text, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT 5000)
RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$;
CREATE OR REPLACE FUNCTION net.http_delete(
  url text, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT 5000)
RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$;

GRANT USAGE ON SCHEMA net TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION net.http_post(text, jsonb, jsonb, jsonb, integer),
  net.http_get(text, jsonb, jsonb, integer),
  net.http_delete(text, jsonb, jsonb, integer)
  TO postgres, authenticated, service_role;

-- Safety assertion: every outbound entry point is the inert stand-in, no
-- request queue exists, and calls return 0 without enqueuing anything.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     OR to_regclass('net.http_request_queue') IS NOT NULL
     OR to_regclass('net._http_response') IS NOT NULL THEN
    RAISE EXCEPTION 'disposable_inert_network_check_failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'net' AND p.proname IN ('http_get', 'http_post', 'http_delete')
      AND (p.prolang <> (SELECT oid FROM pg_language WHERE lanname = 'sql')
           OR p.prosrc !~ '^\s*SELECT 0::bigint\s*$')
  ) OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'net' AND p.proname IN ('http_get', 'http_post', 'http_delete')) <> 3 THEN
    RAISE EXCEPTION 'disposable_inert_network_check_failed';
  END IF;
  IF net.http_post('disposable-inert-check') <> 0 OR net.http_get('disposable-inert-check') <> 0
     OR net.http_delete('disposable-inert-check') <> 0 THEN
    RAISE EXCEPTION 'disposable_inert_network_check_failed';
  END IF;
END
$check$;
