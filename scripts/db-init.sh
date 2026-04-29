#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/Library/PostgreSQL/16/bin}"
DATA_DIR="${AGENTHUB_PGDATA:-$ROOT_DIR/.agenthub-postgres/data}"
PORT="${AGENTHUB_PG_PORT:-55432}"

if [[ ! -x "$PG_BIN/initdb" ]]; then
  echo "initdb not found at $PG_BIN/initdb. Set PG_BIN to your Postgres bin directory." >&2
  exit 1
fi

if [[ ! -d "$DATA_DIR/base" ]]; then
  mkdir -p "$(dirname "$DATA_DIR")"
  "$PG_BIN/initdb" -D "$DATA_DIR" --username=postgres --auth-local=trust --auth-host=trust
fi

AGENTHUB_PGDATA="$DATA_DIR" AGENTHUB_PG_PORT="$PORT" PG_BIN="$PG_BIN" "$ROOT_DIR/scripts/db-start.sh"

"$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -c "
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'agenthub') THEN
    CREATE ROLE agenthub LOGIN PASSWORD 'agenthub';
  ELSE
    ALTER ROLE agenthub LOGIN PASSWORD 'agenthub';
  END IF;
END
\$\$;
"

if ! "$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'agenthub'" | grep -q 1; then
  "$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres -O agenthub agenthub
fi

echo "AgentHub Postgres is ready on localhost:$PORT"
echo "DATABASE_URL=postgres://agenthub:agenthub@localhost:$PORT/agenthub"
