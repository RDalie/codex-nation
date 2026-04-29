ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS snapshot_owner TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_repo TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_clone_url TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_snapshot_repo
  ON submissions(snapshot_owner, snapshot_repo)
  WHERE snapshot_owner IS NOT NULL AND snapshot_repo IS NOT NULL;
