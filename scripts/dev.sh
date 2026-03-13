#!/usr/bin/env bash
# Start Go backend (live-reload) + Vite dev server concurrently.
# Extra arguments are forwarded to `pnpm dev` (e.g. --port 3001).
set -euo pipefail

pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; wait; }
trap cleanup EXIT

LOG_LEVEL=debug
export LOG_LEVEL

if command -v air &>/dev/null; then
  (cd app/backend && air) & pids+=($!)
else
  echo "tip: install air for Go live-reload (go install github.com/air-verse/air@latest)"
  (cd app/backend && go run ./cmd/run-kit) & pids+=($!)
fi

(cd app/frontend && pnpm dev "$@") & pids+=($!)
wait
