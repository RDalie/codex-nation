#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/Library/PostgreSQL/16/bin}"
DATA_DIR="${AGENTHUB_PGDATA:-$ROOT_DIR/.agenthub-postgres/data}"
PORT="${AGENTHUB_PG_PORT:-55432}"
LOG_FILE="$ROOT_DIR/.agenthub-postgres/server.log"

if [[ ! -d "$DATA_DIR/base" ]]; then
  echo "Postgres data directory not initialized. Run npm run db:init first." >&2
  exit 1
fi

if "$PG_BIN/pg_ctl" -D "$DATA_DIR" status >/dev/null 2>&1; then
  echo "AgentHub Postgres already running"
  exit 0
fi

mkdir -p "$(dirname "$LOG_FILE")"
"$PG_BIN/pg_ctl" -D "$DATA_DIR" -l "$LOG_FILE" -o "-p $PORT -h 127.0.0.1" start
