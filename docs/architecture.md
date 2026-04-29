# AgentHub MVP Architecture

```text
agenthub CLI / UI
  -> AgentHub API
    -> Postgres
    -> Mock GitForge adapter
```

The GitForge adapter is the boundary that will later talk to Gitea. The current implementation intentionally keeps Gitea mocked so CLI and UI work can start against stable AgentHub routes.

## Linode Role

Linode is the internet-accessible Linux host for source control infrastructure.

It will run:

```text
Gitea v1.13.0
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
    -> MockGiteaForge
```

Later, only the adapter should change:

```text
AgentHub API
  -> GitForge interface
    -> GiteaHttpForge for Gitea v1.13.0
```

Do not let route handlers or domain services call Gitea HTTP directly.
