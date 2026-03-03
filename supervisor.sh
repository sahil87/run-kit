#!/usr/bin/env bash
set -euo pipefail

# run-kit supervisor: manages Next.js app + terminal relay as a single unit.
# Monitors .restart-requested file for signal-based restarts.
# Rolls back via git revert HEAD on build or health failure.

# Read port/host config from run-kit.yaml (optional)
RK_PORT=3000
RK_RELAY_PORT=3001
RK_HOST="127.0.0.1"
if [[ -f run-kit.yaml ]]; then
  _val() { grep "^[[:space:]]\+$1:" run-kit.yaml 2>/dev/null | head -1 | sed 's/^[^:]*: *//' | sed 's/ *#.*//' | tr -d '"'"'" ; }
  _valid_port() { [[ "$1" =~ ^[0-9]+$ ]] && (( $1 >= 1 && $1 <= 65535 )); }
  _p=$(_val port);        [[ -n "$_p" ]] && _valid_port "$_p" && RK_PORT="$_p"
  _r=$(_val relay_port);  [[ -n "$_r" ]] && _valid_port "$_r" && RK_RELAY_PORT="$_r"
  _h=$(_val host);        [[ -n "$_h" ]] && [[ "$_h" =~ ^[a-zA-Z0-9._:-]+$ ]] && RK_HOST="$_h"
  unset _val _valid_port _p _r _h
fi

HEALTH_URL="http://${RK_HOST}:${RK_PORT}/api/health"
HEALTH_TIMEOUT=10
POLL_INTERVAL=2
RESTART_SIGNAL=".restart-requested"

nextjs_pid=""
relay_pid=""

# Trap signals for clean shutdown
trap 'echo "[supervisor] Shutting down..."; stop_services; exit 0' SIGINT SIGTERM

start_services() {
  echo "[supervisor] Starting Next.js on ${RK_HOST}:${RK_PORT}..."
  pnpm start --port "$RK_PORT" --hostname "$RK_HOST" &
  nextjs_pid=$!

  echo "[supervisor] Starting terminal relay on ${RK_HOST}:${RK_RELAY_PORT}..."
  pnpm relay --port "$RK_RELAY_PORT" --host "$RK_HOST" &
  relay_pid=$!
}

stop_services() {
  if [[ -n "$nextjs_pid" ]] && kill -0 "$nextjs_pid" 2>/dev/null; then
    echo "[supervisor] Stopping Next.js (PID $nextjs_pid)..."
    kill "$nextjs_pid" 2>/dev/null || true
    wait "$nextjs_pid" 2>/dev/null || true
  fi
  if [[ -n "$relay_pid" ]] && kill -0 "$relay_pid" 2>/dev/null; then
    echo "[supervisor] Stopping relay (PID $relay_pid)..."
    kill "$relay_pid" 2>/dev/null || true
    wait "$relay_pid" 2>/dev/null || true
  fi
  nextjs_pid=""
  relay_pid=""
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
  if ! pnpm build 2>/dev/null; then
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
  if ! pnpm build; then
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

# Initial build + start
echo "[supervisor] Initial build..."
pnpm build
start_services

echo "[supervisor] Waiting for health check..."
if ! check_health; then
  echo "[supervisor] Initial health check failed!"
  exit 1
fi

echo "[supervisor] Services running. Monitoring for restart signal..."

# Main loop: watch for restart signal
while true; do
  if [[ -f "$RESTART_SIGNAL" ]]; then
    echo "[supervisor] Restart signal detected."
    do_restart || true
  fi

  # Check if individual processes died — restart only the dead one
  if [[ -n "$nextjs_pid" ]] && ! kill -0 "$nextjs_pid" 2>/dev/null; then
    echo "[supervisor] Next.js process died — restarting..."
    pnpm start --port "$RK_PORT" --hostname "$RK_HOST" &
    nextjs_pid=$!
  fi
  if [[ -n "$relay_pid" ]] && ! kill -0 "$relay_pid" 2>/dev/null; then
    echo "[supervisor] Relay process died — restarting relay..."
    pnpm relay --port "$RK_RELAY_PORT" --host "$RK_HOST" &
    relay_pid=$!
  fi

  sleep "$POLL_INTERVAL"
done
