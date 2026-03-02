#!/usr/bin/env bash
set -euo pipefail

if [ -f .envrc ]; then
  direnv allow
else
  echo "  ⚠ .envrc not found — skipping direnv allow"
fi
