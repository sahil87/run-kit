#!/usr/bin/env bash
set -euo pipefail

# run-kit supervisor: manages Go backend as a single unit.
# Monitors .restart-requested file for signal-based restarts.
# Rolls back via git revert HEAD on build or health failure.

# Read port/host config from run-kit.yaml (optional)
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

# Trap signals for clean shutdown
trap 'echo "[supervisor] Shutting down..."; stop_services; exit 0' SIGINT SIGTERM

build_all() {
  echo "[supervisor] Building Go binary..."
  (cd app/backend && go build -o ../../bin/run-kit ./cmd/run-kit)

  echo "[supervisor] Building frontend..."
  (cd app/frontend && pnpm build)
}

start_services() {
  echo "[supervisor] Starting Go server on ${RK_HOST}:${RK_PORT}..."
  ./bin/run-kit --port "$RK_PORT" --host "$RK_HOST" &
  server_pid=$!
}

stop_services() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    echo "[supervisor] Stopping server (PID $server_pid)..."
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  fuser -k "${RK_PORT}/tcp" 2>/dev/null || true
  server_pid=""
}

check_health() {
  local elapsed=0
  while (( elapsed < HEALTH_TIMEOUT )); do
    if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
      return 0
    fi
    sleep 1
    (( elapsed++ ))
  done
  return 1
}

rollback() {
  echo "[supervisor] Rolling back..."
  if ! git revert HEAD --no-edit 2>/dev/null; then
    echo "[supervisor] WARNING: git revert failed — manual intervention needed"
    return 1
  fi
  if ! build_all 2>/dev/null; then
    echo "[supervisor] WARNING: rollback build failed — manual intervention needed"
    return 1
  fi
  stop_services
  start_services
  if ! check_health; then
    echo "[supervisor] WARNING: rollback health check failed"
    return 1
  fi
  return 0
}

do_restart() {
  echo "[supervisor] Building..."
  if ! build_all; then
    echo "[supervisor] Build failed — rolling back..."
    rollback || true
    return 1
  fi

  stop_services
  start_services

  if ! check_health; then
    echo "[supervisor] Health check failed — rolling back..."
    stop_services
    rollback || true
    return 1
  fi

  echo "[supervisor] Restart successful."
  rm -f "$RESTART_SIGNAL"
  return 0
}

# Clear stale restart signal from before supervisor started
rm -f "$RESTART_SIGNAL"

# Create bin directory
mkdir -p bin

# Initial build + start
echo "[supervisor] Initial build..."
build_all
start_services

echo "[supervisor] Waiting for health check..."
if ! check_health; then
  echo "[supervisor] Initial health check failed!"
  exit 1
fi

echo "[supervisor] Server running. Monitoring for restart signal..."

# Main loop: watch for restart signal
while true; do
  if [[ -f "$RESTART_SIGNAL" ]]; then
    echo "[supervisor] Restart signal detected."
    do_restart || true
  fi

  # Check if process died — restart
  if [[ -n "$server_pid" ]] && ! kill -0 "$server_pid" 2>/dev/null; then
    echo "[supervisor] Server process died — restarting..."
    start_services
  fi

  sleep "$POLL_INTERVAL"
done
