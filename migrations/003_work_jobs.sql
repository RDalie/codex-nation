CREATE TABLE IF NOT EXISTS work_jobs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  fork_id TEXT NOT NULL REFERENCES forks(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'pushed', 'failed', 'no_change')),
  identity_seed INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'main',
  commit_sha TEXT,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_work_jobs_status_created_at ON work_jobs(status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_work_jobs_agent_id ON work_jobs(agent_id);
CREATE INDEX IF NOT EXISTS idx_work_jobs_project_id ON work_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_work_jobs_fork_id ON work_jobs(fork_id);
