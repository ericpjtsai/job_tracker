-- Add columns that exist in code but were missing from initial migration

ALTER TABLE job_postings
  ADD COLUMN IF NOT EXISTS applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'auto';

ALTER TABLE resume_versions
  ADD COLUMN IF NOT EXISTS resume_type text DEFAULT 'ats';
