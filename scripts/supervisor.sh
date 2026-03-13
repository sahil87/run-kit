#!/usr/bin/env bash
# run-kit supervisor: build, run, and auto-restart on crash or signal.
set -euo pipefail

# Read port/host from run-kit.yaml (optional)
RK_PORT=3000
RK_HOST="127.0.0.1"
if [[ -f run-kit.yaml ]]; then
  _val() { grep "^[[:space:]]\+$1:" run-kit.yaml 2>/dev/null | head -1 | sed 's/^[^:]*: *//' | sed 's/ *#.*//' | tr -d '"'"'" ; }
  _valid_port() { [[ "$1" =~ ^[0-9]+$ ]] && (( $1 >= 1 && $1 <= 65535 )); }
  _p=$(_val port);  [[ -n "$_p" ]] && _valid_port "$_p" && RK_PORT="$_p"
  _h=$(_val host);  [[ -n "$_h" ]] && [[ "$_h" =~ ^[a-zA-Z0-9._:-]+$ ]] && RK_HOST="$_h"
  unset _val _valid_port _p _h
fi

HEALTH_URL="http://${RK_HOST}:${RK_PORT}/api/health"
HEALTH_TIMEOUT=10
POLL_INTERVAL=2
RESTART_SIGNAL=".restart-requested"

server_pid=""

trap 'echo "[supervisor] Shutting down..."; stop; exit 0' SIGINT SIGTERM

build() {
  echo "[supervisor] Building Go binary..."
  mkdir -p bin
  (cd app/backend && go build -o ../../bin/run-kit ./cmd/run-kit)
  echo "[supervisor] Building frontend..."
  (cd app/frontend && pnpm build)
}

start() {
  echo "[supervisor] Starting on ${RK_HOST}:${RK_PORT}..."
  ./bin/run-kit --port "$RK_PORT" --host "$RK_HOST" &
  server_pid=$!
}

stop() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    echo "[supervisor] Stopping (PID $server_pid)..."
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  server_pid=""
}

check_health() {
  local elapsed=0
  while (( elapsed < HEALTH_TIMEOUT )); do
    curl -sf "$HEALTH_URL" > /dev/null 2>&1 && return 0
    sleep 1
    (( elapsed++ ))
  done
  return 1
}

# Initial build + start
rm -f "$RESTART_SIGNAL"
build
start

echo "[supervisor] Waiting for health check..."
if ! check_health; then
  echo "[supervisor] Health check failed!"
  exit 1
fi

echo "[supervisor] Running. Watching for restart signal..."

while true; do
  # Restart on signal file
  if [[ -f "$RESTART_SIGNAL" ]]; then
    echo "[supervisor] Restart signal detected."
    rm -f "$RESTART_SIGNAL"
    if build; then
      stop
      start
      check_health || echo "[supervisor] WARNING: health check failed after restart"
    else
      echo "[supervisor] Build failed — keeping current version running"
    fi
  fi

  # Auto-restart on crash
  if [[ -n "$server_pid" ]] && ! kill -0 "$server_pid" 2>/dev/null; then
    echo "[supervisor] Process died — restarting..."
    start
  fi

  sleep "$POLL_INTERVAL"
done
