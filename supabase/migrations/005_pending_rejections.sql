-- Add rejected_at to job_postings for tracking rejection date
ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS rejected_at timestamptz;

-- Pending rejections detected from email scanning
CREATE TABLE IF NOT EXISTS pending_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES job_postings(id) ON DELETE CASCADE,
  rejection_company text NOT NULL,
  rejection_role text,
  rejection_date timestamptz,
  email_snippet text,
  email_body text,
  confidence text DEFAULT 'high',
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_rejections_status
  ON pending_rejections (status) WHERE status = 'pending';
