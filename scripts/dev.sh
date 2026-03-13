#!/usr/bin/env bash
# Start Go backend (live-reload) + Vite dev server concurrently.
# Usage: ./scripts/dev.sh [--port PORT]
trap 'kill 0' EXIT

# Parse --port flag (overrides RUN_KIT_PORT)
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) export RUN_KIT_PORT="$2"; shift 2 ;;
    *) shift ;;
  esac
done

export LOG_LEVEL=debug

# Derive process-level ports from RUN_KIT_PORT (the "open in browser" port).
# Dev mode: frontend gets RUN_KIT_PORT, backend gets RUN_KIT_PORT+1.
export FRONTEND_PORT="${RUN_KIT_PORT:-3000}"
export BACKEND_PORT=$(( FRONTEND_PORT + 1 ))
export BACKEND_HOST="${RUN_KIT_HOST:-127.0.0.1}"

command -v air &>/dev/null || { echo "error: air not found (go install github.com/air-verse/air@latest)"; exit 1; }
(cd app/backend && air) &

(cd app/frontend && pnpm dev --port "$FRONTEND_PORT") &
wait
