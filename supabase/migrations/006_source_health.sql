-- 006_source_health.sql
-- Replaces the listener daemon's in-memory health tracking + adds an enrichment queue.
-- Edge Functions read/write source_health to coordinate state across stateless invocations.

CREATE TABLE IF NOT EXISTS source_health (
  source_id            text PRIMARY KEY,
  status               text NOT NULL DEFAULT 'idle',  -- idle | polling | healthy | error | disabled
  last_poll_at         timestamptz,
  last_success_at      timestamptz,
  last_error_at        timestamptz,
  last_error           text,
  consecutive_failures int NOT NULL DEFAULT 0,
  jobs_found_total     int NOT NULL DEFAULT 0,
  jobs_found_last      int NOT NULL DEFAULT 0,
  abort_requested      boolean NOT NULL DEFAULT false,
  progress_current     int NOT NULL DEFAULT 0,    -- ATS batches and rescore
  progress_total       int NOT NULL DEFAULT 0,
  meta                 jsonb NOT NULL DEFAULT '{}'::jsonb,  -- e.g. rescore offset, batch index
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Pre-seed all known source rows so:
--   1. The /api/sources GET returns a complete list before any poll has run
--   2. The fallback-check cron's EXISTS clauses have rows to match against
INSERT INTO source_health (source_id, status) VALUES
  ('ats',               'idle'),
  ('mantiks',           'idle'),
  ('linkedin',          'idle'),
  ('linkedin-direct',   'idle'),
  ('serpapi',           'idle'),
  ('hasdata-indeed',    'idle'),
  ('hasdata-glassdoor', 'idle'),
  ('github',            'idle'),
  ('rescore',           'idle'),
  ('enrich',            'idle')
ON CONFLICT (source_id) DO NOTHING;

-- ─────────────────────────────────────────────────────
-- Enrichment queue: replaces the per-insert fire-and-forget LLM call.
-- Polled by enrich-batch Edge Function every 2 minutes.
-- ─────────────────────────────────────────────────────
ALTER TABLE job_postings
  ADD COLUMN IF NOT EXISTS enrichment_status text NOT NULL DEFAULT 'pending';
  -- values: pending | processing | done | skipped | error

-- Partial index for efficient queue scans (uses first_seen — no created_at column on job_postings)
CREATE INDEX IF NOT EXISTS idx_jobs_enrichment_pending
  ON job_postings (first_seen)
  WHERE enrichment_status = 'pending';

-- Existing rows that already have keywords from the old listener should not be re-enriched.
-- Mark them done so the worker only picks up genuinely new rows.
UPDATE job_postings
   SET enrichment_status = 'done'
 WHERE keywords_matched IS NOT NULL
   AND array_length(keywords_matched, 1) > 0
   AND enrichment_status = 'pending';
