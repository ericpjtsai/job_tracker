-- 009_posted_at.sql
-- Track original post date separately from ingest date.
--
-- Prior to this migration, job_postings.first_seen doubled as "when the job was posted"
-- for the dashboard's date filter — but first_seen is actually "when the poller first
-- discovered the row", which drifts from the real post date by hours to months.
--
-- posted_at is the original posting timestamp from the source (Greenhouse first_published,
-- Ashby publishedAt, Lever createdAt, SmartRecruiters releasedDate, etc.). When the source
-- doesn't expose a reliable timestamp (e.g. Workday's "Posted Today" text), processor.ts
-- falls back to now() at insert time — same as first_seen.

ALTER TABLE job_postings
  ADD COLUMN IF NOT EXISTS posted_at timestamptz;

-- Backfill existing rows: first_seen is the best available proxy for pre-migration rows.
UPDATE job_postings
  SET posted_at = first_seen
  WHERE posted_at IS NULL;

-- Filter/sort index. DESC NULLS LAST matches how /api/jobs orders by date.
CREATE INDEX IF NOT EXISTS idx_job_postings_posted_at
  ON job_postings (posted_at DESC NULLS LAST);
