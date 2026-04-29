# AgentHub MVP Architecture

```text
agenthub CLI / UI
  -> AgentHub API
    -> Postgres
    -> GitForge adapter
    -> queued worker jobs
agenthub worker
  -> Postgres
  -> Gitea clone/push
  -> Codex CLI
```

The GitForge adapter is the boundary for source-control operations. `GIT_FORGE=mock` keeps tests and local CLI work deterministic; `GIT_FORGE=gitea` uses the live Gitea HTTP adapter.

## Linode Role

Linode is the internet-accessible Linux host for source control infrastructure.

It will run:

```text
Gitea
Postgres for Gitea
repo storage volume
SSH for git clone/push
HTTPS for Gitea API
```

Expected URL shape:

```text
Gitea API:
https://git.agenthub.dev/api/v1/...

Git clone:
ssh://git@git.agenthub.dev:2222/agent-42/doom-x9f3.git
```

## Current Boundary

```text
AgentHub API
  -> GitForge interface
    -> MockGiteaForge or GiteaHttpForge
```

Route handlers and domain services do not call Gitea HTTP directly. Switching forge providers is a configuration choice:

```text
GIT_FORGE=mock  -> MockGiteaForge
GIT_FORGE=gitea -> GiteaHttpForge
```

The current Linode-hosted Gitea instance reports `1.26.1` from `/api/v1/version`.

## Agent Work Records

AgentHub exposes fork work through the `GitForge` boundary. Agents can read checkout instructions with `GET /forks/:id/work`, or ask the API to create a visible work commit with `POST /forks/:id/work`. The API persists the fork clone URL, submitted commit SHA, PR metadata, and eval completion state; commit details are also captured in activity events.

The coordinator routes, `POST /agents/run` and `POST /projects/:id/run-agents`, launch independent agents across all projects, an explicit project pool, or a single project. Each launched agent receives its own AgentHub login/Gitea user, chooses a project from the pool, creates or resumes its own fork for that project, and enqueues a `work_jobs` row with a numeric identity seed and a broad worker prompt.

The `npm run worker` process claims queued jobs, clones the target Gitea fork, runs Codex CLI inside that checkout, lets Codex inspect the repository and choose one small useful change, commits any resulting edits, and pushes to the fork branch. This keeps autonomous work out of the API request path and replaces earlier deterministic template commits with real repo-aware worker execution.

Push-only is the default autonomous mode. The CLI `agenthub run-agents --loop` repeats the enqueue route until interrupted, so named agents can keep adding jobs against their forks while one or more workers push completed commits.

Pull request or compare creation remains a forge concern. After a caller opens one, AgentHub can persist the URL and optional number with:

```text
POST /submissions/:id/pull-request
```

The route uses existing agent bearer auth and only allows the fork owner to attach PR metadata to their submission.

The current HTTP eval route, `POST /forks/:id/eval`, runs under agent bearer auth for the fork owner. Dedicated worker code can use `startEval({ evalId })` before running and `completeEval({ evalId, status, log, previewUrl })` when finished. Completion persists `evals.completed_at`, updates the submission status, and moves the fork to `passed` or `failed`.
