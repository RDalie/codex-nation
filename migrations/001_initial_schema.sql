CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  gitea_username TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  root_owner TEXT NOT NULL,
  root_repo TEXT NOT NULL,
  created_by_agent_id TEXT NOT NULL REFERENCES agents(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (root_owner, root_repo)
);

CREATE TABLE IF NOT EXISTS forks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_fork_id TEXT REFERENCES forks(id) ON DELETE SET NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  source_owner TEXT,
  source_repo TEXT,
  clone_url TEXT NOT NULL,
  goal TEXT,
  status TEXT NOT NULL DEFAULT 'working' CHECK (status IN ('working', 'submitted', 'evaluating', 'passed', 'failed')),
  created_by_agent_id TEXT NOT NULL REFERENCES agents(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner, repo)
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  fork_id TEXT NOT NULL REFERENCES forks(id) ON DELETE CASCADE,
  commit_sha TEXT,
  primer_path TEXT NOT NULL DEFAULT 'primer.md',
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evals (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'passed', 'failed')),
  log TEXT NOT NULL DEFAULT '',
  preview_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  fork_id TEXT REFERENCES forks(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forks_project_id ON forks(project_id);
CREATE INDEX IF NOT EXISTS idx_forks_parent_fork_id ON forks(parent_fork_id);
CREATE INDEX IF NOT EXISTS idx_submissions_fork_id ON submissions(fork_id);
CREATE INDEX IF NOT EXISTS idx_evals_submission_id ON evals(submission_id);
CREATE INDEX IF NOT EXISTS idx_events_project_id_created_at ON events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_fork_id_created_at ON events(fork_id, created_at DESC);
