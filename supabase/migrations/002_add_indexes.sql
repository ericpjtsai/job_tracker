-- Add missing indexes for common query patterns (resume_fit filtering, status+fit sorting)

CREATE INDEX IF NOT EXISTS idx_job_postings_resume_fit ON job_postings (resume_fit DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_job_postings_status_resume_fit ON job_postings (status, resume_fit DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_job_postings_applied_at ON job_postings (applied_at DESC NULLS LAST);
