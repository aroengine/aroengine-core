#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if git grep -nE "(AKIA[0-9A-Z]{16}|sk_live_[0-9a-zA-Z]{16,}|whsec_[0-9a-zA-Z]{16,}|-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----)" -- . ':(exclude).env.example'; then
  echo "❌ Potential hardcoded secret detected."
  exit 1
fi

echo "✅ Secret scan passed."
