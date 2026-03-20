#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

SVG="$REPO_ROOT/app/frontend/public/logo.svg"
ICONS_DIR="$REPO_ROOT/app/frontend/public/icons"

npx --yes sharp-cli -i "$SVG" -o "$ICONS_DIR/icon-192.png" resize 192 192
npx --yes sharp-cli -i "$SVG" -o "$ICONS_DIR/icon-512.png" resize 512 512
npx --yes sharp-cli -i "$SVG" -o "$ICONS_DIR/icon-512-maskable.png" resize 512 512

echo "Regenerated PNGs in $ICONS_DIR"
