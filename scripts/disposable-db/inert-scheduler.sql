-- DISPOSABLE VERIFICATION DATABASES ONLY. Never part of the hosted migration track.
-- The hosted database provides the pg_cron scheduler; a throwaway verification
-- database must not. This inert stand-in lets historical migrations register
-- their jobs while guaranteeing no job ever executes.
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (
  jobid bigserial PRIMARY KEY,
  schedule text NOT NULL,
  command text NOT NULL,
  nodename text NOT NULL DEFAULT 'disposable-inert',
  nodeport integer NOT NULL DEFAULT 0,
  database text NOT NULL DEFAULT current_database(),
  username text NOT NULL DEFAULT current_user,
  active boolean NOT NULL DEFAULT false,
  jobname text UNIQUE
);
CREATE OR REPLACE FUNCTION cron.schedule(job_name text, schedule text, command text)
RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command
  RETURNING jobid
$$;
CREATE OR REPLACE FUNCTION cron.schedule(schedule text, command text)
RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (schedule, command) VALUES (schedule, command) RETURNING jobid
$$;
CREATE OR REPLACE FUNCTION cron.unschedule(job_name text)
RETURNS boolean LANGUAGE sql AS $$
  WITH d AS (DELETE FROM cron.job WHERE jobname = job_name RETURNING 1) SELECT count(*) > 0 FROM d
$$;
CREATE OR REPLACE FUNCTION cron.unschedule(job_id bigint)
RETURNS boolean LANGUAGE sql AS $$
  WITH d AS (DELETE FROM cron.job WHERE jobid = job_id RETURNING 1) SELECT count(*) > 0 FROM d
$$;
CREATE OR REPLACE FUNCTION cron.alter_job(
  job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL,
  database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  UPDATE cron.job SET schedule = coalesce(alter_job.schedule, job.schedule),
                      command = coalesce(alter_job.command, job.command)
   WHERE job.jobid = job_id
$$;
