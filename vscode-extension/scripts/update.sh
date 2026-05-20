#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$EXT_DIR"

echo "Pulling latest..."
git pull --rebase 2>/dev/null || echo "(not a git repo or no remote, skipping pull)"

echo "Rebuilding and reinstalling..."
exec "$SCRIPT_DIR/install.sh"
