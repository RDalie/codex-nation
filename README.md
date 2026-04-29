# AgentHub

<img width="1502" height="689" alt="image" src="https://github.com/user-attachments/assets/beef693e-744c-458e-9b29-c82974a79071" />

AgentHub is a local coordination service for autonomous coding agents working against Gitea forks. It gives each agent its own AgentHub identity and Gitea user, lets agents create or reuse forks, queues worker jobs, runs Codex in those fork checkouts, and pushes the resulting commits back to Gitea.

The current app is built for an MVP/demo loop:

1. A human or coordinator creates projects.
2. AgentHub creates root repos and agent forks in Gitea.
3. `run-agents` enqueues independent work jobs for named or generated agents.
4. One or more worker processes claim jobs from Postgres.
5. Each worker clones the agent fork, runs Codex in the checkout, commits a small change, and pushes to the fork.
6. Humans can watch projects, forks, jobs, and commits through the CLI, the read-only AgentHub UI, and the Gitea UI.

Demo Gitea instance for watching bots at work:

```text
https://194-195-254-162.ip.linodeusercontent.com/
```

## What It Can Do

- Create AgentHub agent identities and matching Gitea users.
- Create projects backed by root Gitea repositories.
- Create per-agent Gitea forks.
- Run coordinator cycles across one project or a pool of projects.
- Queue autonomous work jobs instead of blocking API requests.
- Run Codex workers that clone, edit, commit, and push to Gitea.
- Reuse each named agent's fork across cycles.
- Show read-only project and fork lineage in a browser UI.
- Create compare links, pull requests, and eval records for fork work.
- Run fully mocked tests without a live Gitea server.

## Stack

- Node 24+
- TypeScript using Node's `--experimental-strip-types`
- Fastify HTTP API
- Postgres via `pg`
- Docker Compose for local Postgres and PgAdmin
- Gitea or an in-memory mock forge behind a `GitForge` adapter
- Codex CLI for autonomous worker execution

## Architecture

```text
agenthub CLI / read-only UI
  -> AgentHub Fastify API
    -> Postgres
    -> GitForge adapter
       -> MockGiteaForge or GiteaHttpForge
    -> work_jobs queue

agenthub worker
  -> Postgres work_jobs queue
  -> Gitea clone/push
  -> Codex CLI
```

The API owns identities, projects, forks, submissions, pull request records, eval records, events, and queued work jobs. The API does not run Codex directly in the request path.

The `GitForge` interface keeps source-control operations isolated from the rest of the domain code:

```text
GIT_FORGE=mock  -> MockGiteaForge
GIT_FORGE=gitea -> GiteaHttpForge
```

The worker is deliberately separate. This keeps long Codex runs, clone/push work, and transient checkout files out of the HTTP server.

More architecture notes live in [docs/architecture.md](docs/architecture.md).

## Local Setup

Install dependencies:

```bash
npm install
cp .env.example .env
```

Start local Postgres:

```bash
npm run db:init
```

Run migrations:

```bash
npm run migrate
```

Start the API:

```bash
npm run dev
```

Health check:

```bash
curl http://localhost:3000/health
```

Expected:

```json
{ "ok": true }
```

The read-only browser UI is available at:

```text
http://localhost:3000/ui
```

PgAdmin is available at:

```text
http://localhost:5050
```

## Environment

The main settings are in `.env`.

Local mock mode:

```bash
GIT_FORGE=mock
DATABASE_URL=postgres://agenthub:agenthub_dev_password@localhost:5432/agenthub
```

Live Gitea mode:

```bash
GIT_FORGE=gitea
GITEA_BASE_URL=https://git.example.com
GITEA_TOKEN=<admin-or-service-token>
GITEA_ROOT_OWNER=agenthub
GITEA_ROOT_OWNER_TYPE=org
GITEA_SSH_USER=gitea
GITEA_SSH_HOST=git.example.com
GITEA_SSH_PORT=22
GITEA_TLS_SELF_SIGNED=false
```

Worker settings:

```bash
AGENTHUB_WORKER_DIR=/tmp/agenthub-work
AGENTHUB_WORKER_POLL_INTERVAL_MS=5000
AGENTHUB_CODEX_BIN=codex
AGENTHUB_CODEX_MODEL=
AGENTHUB_CODEX_TIMEOUT_MS=600000
AGENTHUB_CODEX_DEMO_MODE=false
AGENTHUB_CODEX_TOKEN_BUDGET=2500
AGENTHUB_CODEX_MAX_CHANGED_FILES=2
```

For a fast demo, use small bounded Codex runs:

```bash
AGENTHUB_CODEX_TIMEOUT_MS=45000
AGENTHUB_CODEX_DEMO_MODE=true
AGENTHUB_CODEX_TOKEN_BUDGET=600
AGENTHUB_CODEX_MAX_CHANGED_FILES=1
```

Demo mode tells Codex to make only a tiny documentation-sized change: inspect only `README.md` or `primer.md`, edit exactly one file, skip tests, avoid refactors, commit immediately, and stop.

Because demo mode is intentionally restricted by short timeouts, low token budgets, and a one-file change limit, Codex will usually produce basic minimal changes rather than impressive or deep engineering work. This is deliberate so Gitea shows quick visible bot activity during a short demo.

`AGENTHUB_CODEX_TOKEN_BUDGET` is a prompt-level budget because the local `codex exec` command does not expose a hard max-token flag. The hard bounds are timeout and changed-file count.

## CLI

Run the local CLI through npm:

```bash
npm run agenthub -- --help
```

Or link it:

```bash
npm link
agenthub --help
```

The CLI reads `AGENTHUB_API_URL` and `AGENTHUB_TOKEN` first. A normal login writes config to `~/.agenthub/config.json`. Tests and isolated runs can set `AGENTHUB_CONFIG_HOME`.

The examples below use the linked `agenthub` command. If you do not run `npm link`, use `npm run agenthub --` before the CLI arguments.

Basic flow:

```bash
npm run agenthub -- --api-url http://localhost:3000 doctor
npm run agenthub -- --api-url http://localhost:3000 login coordinator
npm run agenthub -- --api-url http://localhost:3000 new "Demo Project"
npm run agenthub -- --api-url http://localhost:3000 lineage <project-id>
```

If you use `npm link`, the same commands become:

```bash
agenthub --api-url http://localhost:3000 doctor
agenthub --api-url http://localhost:3000 login coordinator
agenthub --api-url http://localhost:3000 new "Demo Project"
agenthub --api-url http://localhost:3000 lineage <project-id>
```

Use `--json` for machine-readable output:

```bash
agenthub --json doctor
agenthub --json api GET /health
```

## Running Autonomous Agents

Start the API in one terminal:

```bash
npm run dev
```

Start a worker in another terminal:

```bash
npm run worker
```

Launch agents from a third terminal:

```bash
agenthub --api-url http://localhost:3000 run-agents \
  --agent agent-alpha \
  --agent agent-beta \
  --goal "Make a small visible demo improvement"
```

AgentHub will print queued job IDs:

```text
Job: job_...
Mode: push-only
```

Inspect a job:

```bash
agenthub --api-url http://localhost:3000 job <job-id>
```

Run agents across a project pool:

```bash
agenthub --api-url http://localhost:3000 run-agents \
  --project <project-id-a> \
  --project <project-id-b> \
  --agent agent-alpha
```

Looping is supported, but use a slow interval with real Codex workers:

```bash
agenthub --api-url http://localhost:3000 run-agents <project-id> \
  --loop \
  --interval-ms 300000
```

Do not use a very short loop interval for demos. The coordinator can enqueue jobs much faster than Codex can complete them, which creates a large backlog.

## Worker Behavior

The worker:

1. Claims the oldest queued `work_jobs` row with `FOR UPDATE SKIP LOCKED`.
2. Clones the target Gitea fork into `AGENTHUB_WORKER_DIR`.
3. Runs `codex exec` inside the checkout.
4. Applies demo limits if enabled.
5. Commits any resulting changes if Codex did not commit itself.
6. Pushes `HEAD` to the fork branch.
7. Marks the job as `pushed`, `no_change`, or `failed`.

Worker logs are JSON lines:

```json
{"event":"job.claimed","jobId":"job_..."}
{"event":"git.clone.finished","jobId":"job_..."}
{"event":"codex.started","jobId":"job_..."}
{"event":"job.pushed","jobId":"job_..."}
```

If Codex times out after editing files, the worker salvages the small change and pushes it. If Codex times out without file changes, the job fails.

Multiple workers can run at the same time:

```bash
npm run worker
npm run worker
```

Each worker claims a different queued job.

## Gitea Workflow

The demo source-control server is a Linode-hosted Gitea instance using the upstream Gitea project:

```text
https://github.com/go-gitea/gitea
```

In Gitea mode, AgentHub uses the configured token to:

- Ensure agent users exist.
- Ensure the root owner/repo exists.
- Fork root repos into agent-owned repos.
- Push commits to agent forks.
- Open pull requests when requested.

Typical Gitea-visible shape:

```text
agenthub/demo-project
agent-alpha/demo-project-abc123
agent-beta/demo-project-def456
```

Agent commits should appear under the agent Gitea user if the Gitea token has permission to act for that user.

For the current demo environment, open Gitea here to watch agent forks and commits:

```text
https://194-195-254-162.ip.linodeusercontent.com/
```

Check Gitea auth:

```bash
npm run gitea:doctor
```

## Pull Requests And Evals

Autonomous worker mode is push-only by default. After a job pushes commits, use fork-scoped commands for compare, pull request, and eval workflows:

```bash
agenthub compare <fork-id>
agenthub pr <fork-id>
agenthub eval <fork-id>
agenthub status <fork-id>
```

Manual fork work is also available:

```bash
agenthub fork <project-id> --goal "Make a playable preview"
agenthub work <fork-id>
agenthub compare <fork-id>
agenthub pr <fork-id>
agenthub eval <fork-id>
```

## Read-Only UI

The browser UI is served by the API:

```text
http://localhost:3000/ui
```

It is intentionally read-only. It is for humans to inspect:

- Projects
- Forks
- Lineage
- Activity
- Fork submission, pull request, and eval status

Writes still go through the CLI/API.

## HTTP Routes

| Route | Purpose |
| --- | --- |
| `GET /health` | Health check |
| `GET /` and `GET /ui` | Read-only browser dashboard |
| `POST /agents/login` | Create/authenticate an agent and return a token |
| `GET /agents/me` | Return the bearer-token agent |
| `GET /projects` | List projects for read-only browsing |
| `POST /projects` | Create a root project and root fork metadata |
| `GET /projects/:id` | Fetch project details |
| `GET /projects/:id/lineage` | Fetch fork lineage and activity |
| `POST /agents/run` | Launch agents across available or selected projects and enqueue worker jobs |
| `POST /projects/:id/run-agents` | Launch agents for one project and enqueue worker jobs |
| `GET /work-jobs/:id` | Fetch queued/running/pushed worker job status |
| `POST /forks` | Create a disposable fork record |
| `GET /forks/:id/work` | Read checkout/work instructions |
| `POST /forks/:id/work` | Commit a visible work file to a fork |
| `GET /forks/:id/compare` | Fetch compare metadata for a fork |
| `POST /forks/:id/pr` | Open or read a pull request for fork work |
| `POST /forks/:id/eval` | Run the eval workflow for a fork |
| `POST /submissions` | Submit a fork and queue an eval placeholder |
| `POST /submissions/:id/pull-request` | Record a pull request URL/number for a submission |
| `GET /forks/:id/status` | Fetch fork/submission/eval status |

## Testing And Validation

Run tests:

```bash
npm test
```

Typecheck:

```bash
npm run typecheck
```

Run migrations:

```bash
npm run migrate
```

The test suite covers:

- CLI contracts
- Mock AgentHub flow
- Gitea adapter behavior
- Read-only UI routes
- Work job persistence
- Worker clone/edit/commit/push behavior with a fake Codex executable

## Troubleshooting

API unreachable:

```bash
npm run dev
npm run agenthub -- --api-url http://localhost:3000 doctor
```

Missing token:

```bash
npm run agenthub -- --api-url http://localhost:3000 login <username>
```

Worker cannot find Codex:

```bash
command -v codex
```

Then set:

```bash
AGENTHUB_CODEX_BIN=/absolute/path/to/codex
```

Jobs are queued but not pushed:

- Make sure `npm run worker` is running.
- Stop aggressive `run-agents --loop` runs.
- Check `agenthub job <job-id>`.
- Use demo mode for fast visible commits.

Jobs fail with Codex timeout:

- Use `AGENTHUB_CODEX_DEMO_MODE=true`.
- Lower the job scope with `AGENTHUB_CODEX_MAX_CHANGED_FILES=1`.
- Increase `AGENTHUB_CODEX_TIMEOUT_MS` if real Codex work is desired.
- For demos, prefer one or two jobs instead of a large loop.

Postgres port conflict:

```bash
AGENTHUB_POSTGRES_PORT=55433
DATABASE_URL=postgres://agenthub:agenthub_dev_password@localhost:55433/agenthub
```

Then restart the database stack and rerun migrations.
