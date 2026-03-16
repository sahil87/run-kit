#!/usr/bin/env bash
# run-kit supervisor: build, run, and auto-restart on .restart-requested signal.
set -euo pipefail

POLL=5
SIGNAL=".restart-requested"
BINARY="bin/run-kit"
pid=""
inode=""

binary_inode() {
  if [[ "$(uname)" == "Darwin" ]]; then
    stat -f %i "$BINARY" 2>/dev/null
  else
    stat -c %i "$BINARY" 2>/dev/null
  fi
}

cleanup() {
  echo "[sup] Shutting down..."
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM

start() {
  ./scripts/prod.sh &
  pid=$!
  inode=$(binary_inode)
  echo "[sup] Started (PID $pid)"
}

just build
start

while true; do
  if [[ -f "$SIGNAL" ]]; then
    echo "[sup] Restart signal detected."
    rm -f "$SIGNAL"
    just build
    if [[ "$(binary_inode)" != "$inode" ]]; then
      echo "[sup] Binary changed — restarting..."
      kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null || true
      start
    else
      echo "[sup] Build unchanged — skipping restart."
    fi
  elif ! kill -0 "$pid" 2>/dev/null; then
    echo "[sup] Process died — restarting in 10s..."
    sleep 10
    just build
    start
  fi
  sleep "$POLL"
done
