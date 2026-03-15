#!/usr/bin/env bash
# Start Go backend (live-reload) + Vite dev server concurrently.
# Usage: ./scripts/dev.sh [--port PORT] [--host HOST]
cleanup() {
  kill 0 2>/dev/null
  sleep 0.5
  # Force-kill any stragglers (air, vite, go backend)
  kill -9 0 2>/dev/null
}
trap cleanup EXIT

# Parse --port flag (overrides RK_PORT)
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) export RK_PORT="$2"; shift 2 ;;
    --host) export RK_HOST="$2"; shift 2 ;;
    *) shift ;;
  esac
done

export LOG_LEVEL=debug

# Derive process-level ports from RK_PORT (the "open in browser" port).
# Dev mode: frontend gets RK_PORT, backend gets RK_PORT+1.
export FRONTEND_PORT="${RK_PORT:-3000}"
export BACKEND_PORT=$(( FRONTEND_PORT + 1 ))
export BACKEND_HOST="${RK_HOST:-127.0.0.1}"

# Ensure cwd is repo root (supports invocation from any directory)
cd "$(dirname "$0")/.." || exit 1

command -v air &>/dev/null || { echo "error: air not found (go install github.com/air-verse/air@latest)"; exit 1; }
(cd app/backend && air) &

(cd app/frontend && pnpm dev --port "$FRONTEND_PORT") &
wait
