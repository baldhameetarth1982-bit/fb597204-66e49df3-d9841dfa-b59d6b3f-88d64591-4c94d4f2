-- DISPOSABLE VERIFICATION DATABASES ONLY. Never part of the hosted migration track.
-- Historical migrations make the database call the live site's scheduler hooks.
-- A throwaway verification database must never reach the live site, so the
-- outbound HTTP entry points are replaced by inert functions that send nothing.
--
-- The extension is NOT dropped here: the hosted migration that installs it has
-- just started pg_net's background worker, and DROP EXTENSION in the same reset
-- deadlocks with that worker (SQLSTATE 40P01). Instead each request function is
-- detached from the extension and replaced in place, and the request queue is
-- emptied and closed to writes, so the worker has nothing to send. Idempotent.
DO $inert$
DECLARE
  f record;
BEGIN
  CREATE SCHEMA IF NOT EXISTS net;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    FOR f IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
      JOIN pg_extension e ON e.oid = d.refobjid AND e.extname = 'pg_net'
      WHERE n.nspname = 'net' AND p.proname IN ('http_get', 'http_post', 'http_delete')
    LOOP
      EXECUTE format('ALTER EXTENSION pg_net DROP FUNCTION %s', f.sig);
      EXECUTE format('DROP FUNCTION %s', f.sig);
    END LOOP;
    IF to_regclass('net.http_request_queue') IS NOT NULL THEN
      EXECUTE 'DELETE FROM net.http_request_queue';
      EXECUTE 'REVOKE INSERT, UPDATE ON net.http_request_queue FROM PUBLIC';
      EXECUTE $t$
        CREATE OR REPLACE FUNCTION net._disposable_block_queue() RETURNS trigger
        LANGUAGE plpgsql AS $b$ BEGIN RETURN NULL; END $b$;
      $t$;
      EXECUTE 'DROP TRIGGER IF EXISTS disposable_block_queue ON net.http_request_queue';
      EXECUTE 'CREATE TRIGGER disposable_block_queue BEFORE INSERT ON net.http_request_queue
               FOR EACH ROW EXECUTE FUNCTION net._disposable_block_queue()';
    END IF;
  END IF;
END
$inert$;

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

-- Safety assertion: every outbound entry point must be the inert stand-in.
DO $check$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'net' AND p.proname IN ('http_get', 'http_post', 'http_delete')
      AND (p.prolang <> (SELECT oid FROM pg_language WHERE lanname = 'sql')
           OR p.prosrc !~ '^\s*SELECT 0::bigint\s*$')
  ) THEN
    RAISE EXCEPTION 'disposable_inert_network_check_failed';
  END IF;
  IF net.http_post('https://example.invalid') <> 0 OR net.http_get('https://example.invalid') <> 0 THEN
    RAISE EXCEPTION 'disposable_inert_network_check_failed';
  END IF;
END
$check$;
