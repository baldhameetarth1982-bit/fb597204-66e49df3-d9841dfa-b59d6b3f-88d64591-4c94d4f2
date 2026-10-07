-- DISPOSABLE VERIFICATION DATABASES ONLY. Never part of the hosted migration track.
-- Historical migrations make the database call the live site's scheduler hooks.
-- A throwaway verification database must never reach the live site, so the
-- outbound HTTP extension is replaced by an inert function that sends nothing.
DROP EXTENSION IF EXISTS pg_net;
CREATE SCHEMA IF NOT EXISTS net;
CREATE OR REPLACE FUNCTION net.http_post(
  url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$;
CREATE OR REPLACE FUNCTION net.http_get(
  url text, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT 5000)
RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$;
