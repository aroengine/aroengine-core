#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/perf/k6/core-openclaw-smoke.js"
ARTIFACT_DIR="$ROOT_DIR/artifacts/perf"
SUMMARY_PATH="$ARTIFACT_DIR/k6-summary.json"
CORE_LOG_PATH="$ARTIFACT_DIR/core-engine.log"
EXECUTOR_LOG_PATH="$ARTIFACT_DIR/openclaw-executor.log"
CORE_DIST_ENTRY="$ROOT_DIR/apps/core-engine/dist/index.js"
EXECUTOR_DIST_ENTRY="$ROOT_DIR/apps/openclaw-executor/dist/index.js"

CORE_HOST="127.0.0.1"
CORE_PORT="3100"
EXECUTOR_HOST="127.0.0.1"
EXECUTOR_PORT="3200"
OPENCLAW_SHARED_TOKEN_VALUE="openclaw-shared-token-test"
OPENCLAW_MANIFEST_VERSION_VALUE="1.0.0"
OPENCLAW_ALLOWED_COMMANDS_VALUE="integration.twilio.send_sms"
OPENCLAW_AGENT_ID_VALUE="aro-perf-agent"
OPENCLAW_AGENT_TIMEOUT_SECONDS_VALUE="30"
OPENCLAW_AGENT_LOCAL_MODE_VALUE="true"

if ! command -v k6 >/dev/null 2>&1; then
  echo "k6 is required for WP-0802 performance proof. Install k6 and re-run npm run perf:k6" >&2
  exit 1
fi

mkdir -p "$ARTIFACT_DIR"

npx tsc -b "$ROOT_DIR/apps/core-engine/tsconfig.json" "$ROOT_DIR/apps/openclaw-executor/tsconfig.json" --force --pretty false

start_service() {
  local name="$1"
  local log_path="$2"
  shift 2
  (
    cd "$ROOT_DIR"
    "$@"
  ) >"$log_path" 2>&1 &
  echo $!
}

wait_for_http_200() {
  local url="$1"
  local attempts=0
  local max_attempts=60

  until curl -fsS "$url" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [[ "$attempts" -ge "$max_attempts" ]]; then
      echo "Timed out waiting for $url" >&2
      return 1
    fi
    sleep 0.5
  done
}

cleanup() {
  if [[ -n "${CORE_PID:-}" ]] && kill -0 "$CORE_PID" >/dev/null 2>&1; then
    kill "$CORE_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${EXECUTOR_PID:-}" ]] && kill -0 "$EXECUTOR_PID" >/dev/null 2>&1; then
    kill "$EXECUTOR_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

CORE_PID=$(start_service \
  "core-engine" \
  "$CORE_LOG_PATH" \
  env \
  NODE_ENV=test \
  HOST="$CORE_HOST" \
  PORT="$CORE_PORT" \
  LOG_LEVEL=error \
  DATABASE_URL='postgresql://user:pass@localhost:5432/aro' \
  DATABASE_MIGRATION_LOCK_TIMEOUT='30000' \
  OPENCLAW_EXECUTOR_URL="http://$EXECUTOR_HOST:$EXECUTOR_PORT" \
  OPENCLAW_SHARED_TOKEN="$OPENCLAW_SHARED_TOKEN_VALUE" \
  OPENCLAW_PERMISSION_MANIFEST_VERSION="$OPENCLAW_MANIFEST_VERSION_VALUE" \
  node "$CORE_DIST_ENTRY")

EXECUTOR_PID=$(start_service \
  "openclaw-executor" \
  "$EXECUTOR_LOG_PATH" \
  env \
  NODE_ENV=test \
  HOST="$EXECUTOR_HOST" \
  PORT="$EXECUTOR_PORT" \
  OPENCLAW_SHARED_TOKEN="$OPENCLAW_SHARED_TOKEN_VALUE" \
  OPENCLAW_PERMISSION_MANIFEST_VERSION="$OPENCLAW_MANIFEST_VERSION_VALUE" \
  OPENCLAW_ALLOWED_COMMANDS="$OPENCLAW_ALLOWED_COMMANDS_VALUE" \
  OPENCLAW_AGENT_ID="$OPENCLAW_AGENT_ID_VALUE" \
  OPENCLAW_AGENT_TIMEOUT_SECONDS="$OPENCLAW_AGENT_TIMEOUT_SECONDS_VALUE" \
  OPENCLAW_AGENT_LOCAL_MODE="$OPENCLAW_AGENT_LOCAL_MODE_VALUE" \
  node "$EXECUTOR_DIST_ENTRY")

wait_for_http_200 "http://$CORE_HOST:$CORE_PORT/health"
wait_for_http_200 "http://$EXECUTOR_HOST:$EXECUTOR_PORT/health"

k6 run \
  "$SCRIPT_PATH" \
  --summary-export "$SUMMARY_PATH" \
  -e CORE_BASE_URL="http://$CORE_HOST:$CORE_PORT" \
  -e OPENCLAW_BASE_URL="http://$EXECUTOR_HOST:$EXECUTOR_PORT" \
  -e OPENCLAW_SHARED_TOKEN="$OPENCLAW_SHARED_TOKEN_VALUE" \
  -e OPENCLAW_PERMISSION_MANIFEST_VERSION="$OPENCLAW_MANIFEST_VERSION_VALUE"

echo "k6 summary exported to $SUMMARY_PATH"
