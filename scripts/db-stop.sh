#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/Library/PostgreSQL/16/bin}"
DATA_DIR="${AGENTHUB_PGDATA:-$ROOT_DIR/.agenthub-postgres/data}"

if [[ ! -d "$DATA_DIR/base" ]]; then
  echo "Postgres data directory not initialized"
  exit 0
fi

if ! "$PG_BIN/pg_ctl" -D "$DATA_DIR" status >/dev/null 2>&1; then
  echo "AgentHub Postgres already stopped"
  exit 0
fi

"$PG_BIN/pg_ctl" -D "$DATA_DIR" stop
