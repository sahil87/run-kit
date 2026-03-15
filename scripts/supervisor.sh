#!/usr/bin/env bash
# run-kit supervisor: build, run, and auto-restart on .restart-requested signal.
# Caddy HTTPS proxy runs in a separate tmux window. Crash recovery as safety net.
set -euo pipefail

POLL=5
SIGNAL=".restart-requested"
BINARY="bin/run-kit"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
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
  # Caddy window dies with the session (just down), no explicit cleanup needed
  exit 0
}
trap cleanup SIGINT SIGTERM

start() {
  ./scripts/prod.sh &
  pid=$!
  inode=$(binary_inode)
  echo "[sup] Started (PID $pid)"
}

start_caddy() {
  if command -v caddy &>/dev/null && [[ -f Caddyfile ]]; then
    # Run Caddy in a separate tmux window for clean log separation
    # exec ensures Caddy is the window's direct process so tmux SIGHUP reaches it
    tmux new-window -t rk -n caddy "cd '$ROOT' && exec caddy run --config Caddyfile" 2>/dev/null || true
    echo "[sup] Caddy started in tmux window 'caddy'"
  else
    echo "[sup] Caddy not found or no Caddyfile — skipping HTTPS proxy"
  fi
}

just build
start
start_caddy

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
