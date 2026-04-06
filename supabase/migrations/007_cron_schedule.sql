-- 007_cron_schedule.sql
-- Schedules all polling Edge Functions via pg_cron + pg_net.
-- This replaces the listener daemon's setInterval loops.
--
-- BEFORE running this migration, you MUST create two Supabase Vault secrets
-- (Supabase Cloud doesn't grant SQL Editor permission to set GUCs via ALTER DATABASE).
-- Run these in the SQL Editor first:
--
--   SELECT vault.create_secret(
--     'https://YOUR-PROJECT.supabase.co',
--     'project_url',
--     'Supabase project URL for pg_cron → Edge Function calls'
--   );
--
--   SELECT vault.create_secret(
--     'sb_secret_xxx',           -- the SUPABASE_SERVICE_ROLE_KEY value
--     'service_role_key',
--     'Service-role key for pg_cron → Edge Function auth'
--   );
--
-- Verify schedules after applying:
--   SELECT jobid, jobname, schedule, command FROM cron.job ORDER BY jobname;
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ─────────────────────────────────────────────────────
-- Guard: fail fast with a helpful message if Vault secrets are missing.
-- The cron jobs below depend on `project_url` and `service_role_key` being
-- present in vault.decrypted_secrets. They are NOT created by this migration —
-- they must be created manually via SQL Editor before applying. See header.
-- ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'project_url') THEN
    RAISE EXCEPTION 'Missing vault secret "project_url". Run: SELECT vault.create_secret(''https://YOUR-PROJECT.supabase.co'', ''project_url'', ''...''); — see migration header';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key') THEN
    RAISE EXCEPTION 'Missing vault secret "service_role_key". Run: SELECT vault.create_secret(''sb_secret_xxx'', ''service_role_key'', ''...''); — see migration header';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────
-- Idempotency: unschedule any existing jobs by name before re-creating them.
-- Safe to re-run the migration; cron.unschedule(text) is a no-op if not found.
-- ─────────────────────────────────────────────────────
DO $$
DECLARE
  job_names TEXT[] := ARRAY[
    'ats-batch-0', 'ats-batch-1', 'ats-batch-2', 'ats-batch-3',
    'mantiks-weekly',
    'linkedin-am', 'linkedin-pm',
    'serpapi-am', 'serpapi-pm',
    'hasdata-indeed-am', 'hasdata-indeed-pm',
    'hasdata-glass-am', 'hasdata-glass-pm',
    'github-am', 'github-pm',
    'enrich-batch',
    'fallback-check'
  ];
  jname TEXT;
BEGIN
  FOREACH jname IN ARRAY job_names LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = jname) THEN
      PERFORM cron.unschedule(jname);
    END IF;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────
-- Helper: HTTP POST to an Edge Function with service-role auth.
-- Reads project_url + service_role_key from Supabase Vault.
-- Returns the pg_net request_id (BIGINT). pg_net is async — the function
-- doesn't wait for the HTTP response. Health is tracked via source_health.
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION call_edge(fn TEXT, body JSONB DEFAULT '{}'::jsonb)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'project_url';
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE EXCEPTION 'call_edge: missing vault secret(s) project_url / service_role_key';
  END IF;

  RETURN net.http_post(
    url := v_url || '/functions/v1/' || fn,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type', 'application/json'
    ),
    body := body
  );
END;
$$;

-- ─────────────────────────────────────────────────────
-- ATS — split into 4 batches × 15 min apart (full cycle every hour)
-- ─────────────────────────────────────────────────────
SELECT cron.schedule('ats-batch-0',  '0 * * * *',  $$SELECT call_edge('poll-ats', '{"batch":0}'::jsonb)$$);
SELECT cron.schedule('ats-batch-1',  '15 * * * *', $$SELECT call_edge('poll-ats', '{"batch":1}'::jsonb)$$);
SELECT cron.schedule('ats-batch-2',  '30 * * * *', $$SELECT call_edge('poll-ats', '{"batch":2}'::jsonb)$$);
SELECT cron.schedule('ats-batch-3',  '45 * * * *', $$SELECT call_edge('poll-ats', '{"batch":3}'::jsonb)$$);

-- ─────────────────────────────────────────────────────
-- Mantiks — weekly (Monday 6am UTC)
-- ─────────────────────────────────────────────────────
SELECT cron.schedule('mantiks-weekly', '0 6 * * 1', $$SELECT call_edge('poll-mantiks')$$);

-- ─────────────────────────────────────────────────────
-- LinkedIn (rewrite of npm scraper) — 2x daily
-- ─────────────────────────────────────────────────────
SELECT cron.schedule('linkedin-am', '0 6 * * *',  $$SELECT call_edge('poll-linkedin')$$);
SELECT cron.schedule('linkedin-pm', '0 18 * * *', $$SELECT call_edge('poll-linkedin')$$);

-- ─────────────────────────────────────────────────────
-- SerpApi — 2x daily
-- ─────────────────────────────────────────────────────
SELECT cron.schedule('serpapi-am', '5 6 * * *',  $$SELECT call_edge('poll-serpapi')$$);
SELECT cron.schedule('serpapi-pm', '5 18 * * *', $$SELECT call_edge('poll-serpapi')$$);

-- ─────────────────────────────────────────────────────
-- HasData — Indeed + Glassdoor 2x daily, staggered to avoid bursts
-- ─────────────────────────────────────────────────────
SELECT cron.schedule('hasdata-indeed-am', '10 6 * * *',  $$SELECT call_edge('poll-hasdata', '{"platform":"indeed"}'::jsonb)$$);
SELECT cron.schedule('hasdata-indeed-pm', '10 18 * * *', $$SELECT call_edge('poll-hasdata', '{"platform":"indeed"}'::jsonb)$$);
SELECT cron.schedule('hasdata-glass-am',  '12 6 * * *',  $$SELECT call_edge('poll-hasdata', '{"platform":"glassdoor"}'::jsonb)$$);
SELECT cron.schedule('hasdata-glass-pm',  '12 18 * * *', $$SELECT call_edge('poll-hasdata', '{"platform":"glassdoor"}'::jsonb)$$);

-- ─────────────────────────────────────────────────────
-- GitHub Jobright repos — 2x daily
-- ─────────────────────────────────────────────────────
SELECT cron.schedule('github-am', '0 7 * * *',  $$SELECT call_edge('poll-github')$$);
SELECT cron.schedule('github-pm', '0 19 * * *', $$SELECT call_edge('poll-github')$$);

-- ─────────────────────────────────────────────────────
-- Enrichment queue worker — every 2 minutes
-- ─────────────────────────────────────────────────────
SELECT cron.schedule('enrich-batch', '*/2 * * * *', $$SELECT call_edge('enrich-batch')$$);

-- ─────────────────────────────────────────────────────
-- Fallback chain: every hour, fire linkedin-direct ONLY if both Mantiks and
-- the LinkedIn rewrite are clearly failing.
--   - Mantiks: no successful poll in 8 hours
--   - LinkedIn: 3+ consecutive failures
-- ─────────────────────────────────────────────────────
SELECT cron.schedule('fallback-check', '20 * * * *', $$
  SELECT call_edge('poll-linkedin-direct')
  WHERE EXISTS (
    SELECT 1 FROM source_health
    WHERE source_id = 'mantiks'
      AND (last_success_at IS NULL OR last_success_at < now() - interval '8 hours')
  ) AND EXISTS (
    SELECT 1 FROM source_health
    WHERE source_id = 'linkedin' AND consecutive_failures >= 3
  );
$$);
