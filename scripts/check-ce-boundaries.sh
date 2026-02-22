#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CE_DIRS=(
  "apps/core-engine"
  "apps/openclaw-executor"
  "packages/shared"
  "packages/workflow-engine"
)

FORBIDDEN_PATTERNS=(
  "@aro/profile-backend-healthcare"
  "@aro/profile-ui-healthcare"
  "@aro/integrations"
  "apps/profile-backend-healthcare"
  "apps/profile-ui-healthcare"
  "packages/integrations"
)

echo "Checking CE boundaries..."

violations=0

for ce_dir in "${CE_DIRS[@]}"; do
  if [[ ! -d "$ce_dir" ]]; then
    continue
  fi

  for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
    if grep -RIn --include='*.ts' --include='*.mts' --include='*.cts' --include='*.tsx' "$pattern" "$ce_dir" >/tmp/aro_ce_violation.out 2>/dev/null; then
      echo "CE boundary violation in $ce_dir: found forbidden reference '$pattern'"
      cat /tmp/aro_ce_violation.out
      violations=1
    fi
  done
done

rm -f /tmp/aro_ce_violation.out

if [[ "$violations" -ne 0 ]]; then
  echo "CE boundary check failed."
  exit 1
fi

echo "CE boundary check passed."