#!/usr/bin/env bash
# run-kit supervisor: build, run, and auto-restart on crash or .restart-requested signal.
# Usage: ./scripts/supervisor.sh [--port PORT]
set -euo pipefail

# Parse --port flag (overrides RUN_KIT_PORT)
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) export RUN_KIT_PORT="$2"; shift 2 ;;
    *) shift ;;
  esac
done

POLL=2
SIGNAL=".restart-requested"
pid=""

trap 'echo "[sup] Shutting down..."; kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; exit 0' SIGINT SIGTERM

run() {
  just build
  ./scripts/prod.sh &
  pid=$!
  echo "[sup] Started (PID $pid)"
}

rm -f "$SIGNAL"
run

while true; do
  if [[ -f "$SIGNAL" ]]; then
    echo "[sup] Restart signal detected."
    rm -f "$SIGNAL"
    kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null || true
    run
  elif ! kill -0 "$pid" 2>/dev/null; then
    echo "[sup] Process died — restarting..."
    run
  fi
  sleep "$POLL"
done
