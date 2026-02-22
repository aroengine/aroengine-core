#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST_FILE="$ROOT_DIR/docs/implementation/PUBLIC-CE-MANIFEST.txt"
EXPORT_ROOT="$ROOT_DIR/public-export"
EXPORT_DIR="$EXPORT_ROOT/ce"

if [[ ! -f "$MANIFEST_FILE" ]]; then
  echo "Manifest not found: $MANIFEST_FILE"
  exit 1
fi

mkdir -p "$EXPORT_ROOT"
rm -rf "$EXPORT_DIR"
mkdir -p "$EXPORT_DIR"

cd "$ROOT_DIR"

echo "Running CE boundary check before export..."
bash "$ROOT_DIR/scripts/check-ce-boundaries.sh"

echo "Exporting CE allowlist to $EXPORT_DIR"

while IFS= read -r path || [[ -n "$path" ]]; do
  [[ -z "$path" || "$path" =~ ^# ]] && continue

  if [[ ! -e "$path" ]]; then
    echo "Skipping missing path: $path"
    continue
  fi

  target_dir="$EXPORT_DIR/$(dirname "$path")"
  mkdir -p "$target_dir"

  if [[ -d "$path" ]]; then
    rsync -a --exclude 'node_modules' --exclude 'dist' --exclude 'coverage' "$path" "$target_dir/"
  else
    cp "$path" "$target_dir/"
  fi
done < "$MANIFEST_FILE"

echo "CE export completed: $EXPORT_DIR"