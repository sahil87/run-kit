#!/usr/bin/env bash
# Add fab-kit bin and package bin directories to PATH
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
export PATH="$KIT_DIR/bin:$PATH"
for d in "$KIT_DIR"/packages/*/bin; do
  [ -d "$d" ] && export PATH="$d:$PATH"
done
