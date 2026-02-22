#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/apps/openclaw-executor"
ARTIFACT_DIR="$ROOT_DIR/artifacts/openclaw-executor"
STAGE_DIR="$ARTIFACT_DIR/stage"

VERSION="$(node -p "require('${APP_DIR}/package.json').version")"
TARBALL="$ARTIFACT_DIR/openclaw-executor-${VERSION}.tgz"

mkdir -p "$ARTIFACT_DIR"
rm -rf "$STAGE_DIR" "$TARBALL"

npm run build --workspace @aro/openclaw-executor

mkdir -p "$STAGE_DIR"
cp -R "$APP_DIR/dist" "$STAGE_DIR/dist"
cp "$APP_DIR/package.json" "$STAGE_DIR/package.json"
cp "$ROOT_DIR/LICENSE" "$STAGE_DIR/LICENSE"

cat > "$STAGE_DIR/README.md" <<EOF
# ARO OpenClaw Executor Artifact

This artifact is produced by:

npm run openclaw:package

Note:
- This is the internal ARO executor service artifact from apps/openclaw-executor.
- It is NOT the external OpenClaw CLI package installed via npm i -g openclaw.

Runtime:
- Node.js >= 20
- Required env vars: NODE_ENV, HOST, PORT, OPENCLAW_SHARED_TOKEN, OPENCLAW_PERMISSION_MANIFEST_VERSION, OPENCLAW_ALLOWED_COMMANDS
EOF

(
  cd "$STAGE_DIR"
  tar -czf "$TARBALL" .
)

echo "Created OpenClaw package: $TARBALL"
