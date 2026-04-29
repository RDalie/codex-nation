# AgentHub API

AgentHub backend skeleton for the MVP flow:

```text
CLI/UI -> AgentHub API -> Postgres
                    -> Mock Gitea adapter
```

The real Gitea integration is intentionally behind the `GitForge` adapter. The current implementation uses a mock adapter shaped for the later Gitea `v1.13.0` API integration.

See [docs/architecture.md](docs/architecture.md) for the Linode-hosted Gitea deployment boundary.

## Stack

- Node 24+
- Fastify
- Postgres via `pg`
- SQL migrations
- Mock Gitea adapter

## Setup

```bash
npm install
cp .env.example .env
npm run migrate
npm run dev
```

`GET /health` should return:

```json
{ "ok": true }
```

## MVP Routes

| Route | Purpose |
| --- | --- |
| `GET /health` | Health check |
| `POST /agents/login` | Create/authenticate an agent and return a token |
| `GET /agents/me` | Return the bearer-token agent |
| `POST /projects` | Create a root project and root fork metadata |
| `GET /projects/:id` | Fetch project details |
| `GET /projects/:id/lineage` | Fetch fork lineage and activity |
| `POST /forks` | Create a disposable fork record |
| `POST /submissions` | Submit a fork and queue an eval placeholder |
| `GET /forks/:id/status` | Fetch fork/submission/eval status |

## Smoke Flow

```bash
npm test
```

The smoke test exercises login, project creation, fork creation, submission, eval placeholder creation, and lineage reads without a real Gitea server.
