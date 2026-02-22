#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

required_scripts=(lint typecheck test test:integration)

if [[ ! -f package.json ]]; then
  echo "❌ Local CI gate failed: package.json not found at repo root ($ROOT_DIR)."
  echo "   Define package scripts before pushing."
  exit 1
fi

missing_scripts=()
for script_name in "${required_scripts[@]}"; do
  if ! grep -q "\"${script_name}\"" package.json; then
    missing_scripts+=("$script_name")
  fi
done

if (( ${#missing_scripts[@]} > 0 )); then
  echo "❌ Local CI gate failed: missing npm scripts in package.json: ${missing_scripts[*]}"
  echo "   Required: lint, typecheck, test, test:integration"
  exit 1
fi

echo "🔎 Running local CI gate..."

echo "> npm run lint"
npm run lint

echo "> npm run typecheck"
npm run typecheck

echo "> npm run test"
npm run test

echo "> npm run test:integration"
npm run test:integration

echo "✅ Local CI gate passed."
