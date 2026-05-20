#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$EXT_DIR"

echo "Building extension..."
npm ci --silent
npm run build

echo "Packaging VSIX..."
npx vsce package --no-dependencies

VSIX_FILE=$(ls -1t *.vsix 2>/dev/null | head -1)

if [ -z "$VSIX_FILE" ]; then
  echo "ERROR: No .vsix file produced."
  exit 1
fi

echo "Installing $VSIX_FILE..."
code --install-extension "$VSIX_FILE" --force
code-insiders --install-extension "$VSIX_FILE" --force

echo "Done. Reload VS Code to activate."
