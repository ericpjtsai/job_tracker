-- Add columns that exist in code but were missing from initial migration

ALTER TABLE job_postings
  ADD COLUMN IF NOT EXISTS applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'auto';

ALTER TABLE resume_versions
  ADD COLUMN IF NOT EXISTS resume_type text DEFAULT 'ats';

-- Index for import history queries (source_type + applied_at sorting)
CREATE INDEX IF NOT EXISTS idx_job_postings_source_type_applied ON job_postings (source_type, applied_at DESC NULLS LAST);
