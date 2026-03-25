-- Job Tracker — initial schema
-- Run: supabase db push

-- ─────────────────────────────────────────────────────
-- job_postings
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_postings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url              text NOT NULL,
  url_hash         text UNIQUE NOT NULL,    -- sha256(normalized url) for dedup
  company          text,
  company_tier     int,                     -- 1 / 2 / 3 / null (unlisted)
  title            text,
  location         text,
  salary_min       int,                     -- nullable, extracted from page
  salary_max       int,
  score            int NOT NULL DEFAULT 0,  -- base relevance score
  resume_fit       int,                     -- 0–100 % overlap with active resume, nullable
  score_breakdown  jsonb,                   -- { b2b_domain, ai_emerging, core_design, methods, soft_skills, tools, company_bonus, seniority_bonus, location_bonus }
  keywords_matched text[],
  firehose_rule    text,                    -- e.g. "b2b-enterprise"
  priority         text,                    -- high / medium / low / skip
  is_job_posting   boolean DEFAULT true,    -- false if a non-job page slipped through
  page_content     text,                    -- full page markdown from Firehose
  notes            text,                    -- user free-text notes
  first_seen       timestamptz DEFAULT now(),
  last_seen        timestamptz DEFAULT now(),
  status           text DEFAULT 'new'       -- new / reviewed / applied / skipped
);

-- Index for common query patterns
CREATE INDEX IF NOT EXISTS idx_job_postings_priority ON job_postings (priority);
CREATE INDEX IF NOT EXISTS idx_job_postings_status   ON job_postings (status);
CREATE INDEX IF NOT EXISTS idx_job_postings_score    ON job_postings (score DESC);
CREATE INDEX IF NOT EXISTS idx_job_postings_seen     ON job_postings (first_seen DESC);
CREATE INDEX IF NOT EXISTS idx_job_postings_rule     ON job_postings (firehose_rule);
CREATE INDEX IF NOT EXISTS idx_job_postings_company  ON job_postings (company);

-- Enable Supabase Realtime (INSERT events only to minimize bandwidth)
ALTER TABLE job_postings REPLICA IDENTITY FULL;

-- ─────────────────────────────────────────────────────
-- resume_versions
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resume_versions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_at        timestamptz DEFAULT now(),
  filename           text,
  storage_path       text,                  -- path in Supabase Storage bucket "resumes"
  keywords_extracted text[],               -- matched keyword terms from taxonomy
  is_active          boolean DEFAULT false  -- only one active at a time
);

-- ─────────────────────────────────────────────────────
-- listener_state
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listener_state (
  key   text PRIMARY KEY,
  value text
);

-- Seed with initial state key
INSERT INTO listener_state (key, value)
VALUES ('last_event_id', NULL)
ON CONFLICT (key) DO NOTHING;
