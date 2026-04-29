#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
PROJECT_SUFFIX="$(date +%s)"

login_response="$(curl -fsS -X POST "$BASE_URL/agents/login" \
  -H 'content-type: application/json' \
  -d '{"username":"agent-42"}')"

token="$(node -e 'let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => console.log(JSON.parse(data).token));' <<< "$login_response")"

project_response="$(curl -fsS -X POST "$BASE_URL/projects" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $token" \
  -d "{\"name\":\"Doom $PROJECT_SUFFIX\"}")"

project_id="$(node -e 'let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => console.log(JSON.parse(data).project.id));' <<< "$project_response")"
root_fork_id="$(node -e 'let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => console.log(JSON.parse(data).rootFork.id));' <<< "$project_response")"

fork_response="$(curl -fsS -X POST "$BASE_URL/forks" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $token" \
  -d "{\"projectId\":\"$project_id\",\"parentForkId\":\"$root_fork_id\",\"goal\":\"Make a playable preview\"}")"

fork_id="$(node -e 'let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => console.log(JSON.parse(data).id));' <<< "$fork_response")"

curl -fsS -X POST "$BASE_URL/submissions" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $token" \
  -d "{\"forkId\":\"$fork_id\",\"commitSha\":\"abc123\"}"

curl -fsS "$BASE_URL/projects/$project_id/lineage"
