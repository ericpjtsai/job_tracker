-- Add applied_dates array to track multiple application dates per job
ALTER TABLE job_postings
  ADD COLUMN IF NOT EXISTS applied_dates JSONB DEFAULT '[]'::jsonb;

-- Backfill: seed applied_dates from existing applied_at where not already populated
UPDATE job_postings
  SET applied_dates = jsonb_build_array(applied_at)
  WHERE applied_at IS NOT NULL
    AND (applied_dates IS NULL OR applied_dates = '[]'::jsonb);
