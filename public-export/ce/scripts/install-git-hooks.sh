#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -d .git ]]; then
  echo "❌ .git directory not found. Run this script from the repository checkout."
  exit 1
fi

git config core.hooksPath .githooks
chmod +x .githooks/pre-push scripts/local-ci-gate.sh scripts/install-git-hooks.sh

echo "✅ Git hooks installed."
echo "   core.hooksPath is set to .githooks"
echo "   pre-push now enforces contributor identity (pyellamaraju) and local CI gate before every push."
