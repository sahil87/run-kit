#!/usr/bin/env bash
# Add all fab-kit package bin directories to PATH
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
for d in "$KIT_DIR"/packages/*/bin; do
  [ -d "$d" ] && export PATH="$d:$PATH"
done
