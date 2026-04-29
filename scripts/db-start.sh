#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"
export PATH="/Applications/Docker.app/Contents/Resources/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if command -v docker >/dev/null 2>&1; then
  DOCKER=(docker)
elif [[ -x /opt/homebrew/bin/docker ]]; then
  DOCKER=(/opt/homebrew/bin/docker)
elif [[ -x /usr/local/bin/docker ]]; then
  DOCKER=(/usr/local/bin/docker)
else
  echo "Docker is required. Install Docker Desktop." >&2
  exit 1
fi

if "${DOCKER[@]}" compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE=("${DOCKER[@]}" compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker-compose)
else
  echo "Docker Compose is required. Install Docker Desktop or docker-compose." >&2
  exit 1
fi

"${DOCKER_COMPOSE[@]}" up -d postgres pgadmin

for _ in {1..30}; do
  if "${DOCKER_COMPOSE[@]}" exec -T postgres pg_isready -U agenthub -d agenthub >/dev/null 2>&1; then
    HOST_PORT="$("${DOCKER_COMPOSE[@]}" port postgres 5432 | awk -F: '{print $NF}')"
    echo "AgentHub Postgres is ready on localhost:$HOST_PORT"
    echo "DATABASE_URL=postgres://agenthub:agenthub_dev_password@localhost:$HOST_PORT/agenthub"
    exit 0
  fi
  sleep 1
done

echo "Timed out waiting for AgentHub Postgres to become healthy" >&2
exit 1
