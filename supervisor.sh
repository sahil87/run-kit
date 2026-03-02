#!/usr/bin/env bash
set -euo pipefail

# run-kit supervisor: manages Next.js app + terminal relay as a single unit.
# Monitors .restart-requested file for signal-based restarts.
# Rolls back via git revert HEAD on build or health failure.

HEALTH_URL="http://localhost:3000/api/health"
HEALTH_TIMEOUT=10
POLL_INTERVAL=2
RESTART_SIGNAL=".restart-requested"

nextjs_pid=""
relay_pid=""

# Trap signals for clean shutdown
trap 'echo "[supervisor] Shutting down..."; stop_services; exit 0' SIGINT SIGTERM

start_services() {
  echo "[supervisor] Starting Next.js..."
  pnpm start &
  nextjs_pid=$!

  echo "[supervisor] Starting terminal relay..."
  pnpm relay &
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

do_restart() {
  echo "[supervisor] Building..."
  if ! pnpm build; then
    echo "[supervisor] Build failed — rolling back..."
    git revert HEAD --no-edit
    pnpm build
    stop_services
    start_services
    check_health || echo "[supervisor] WARNING: rollback health check failed"
    return 1
  fi

  stop_services
  start_services

  if ! check_health; then
    echo "[supervisor] Health check failed — rolling back..."
    stop_services
    git revert HEAD --no-edit
    pnpm build
    start_services
    check_health || echo "[supervisor] WARNING: rollback health check failed"
    return 1
  fi

  echo "[supervisor] Restart successful."
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
    rm -f "$RESTART_SIGNAL"
    do_restart || true
  fi

  # Check if processes are still alive
  if [[ -n "$nextjs_pid" ]] && ! kill -0 "$nextjs_pid" 2>/dev/null; then
    echo "[supervisor] Next.js process died — restarting..."
    pnpm start &
    nextjs_pid=$!
  fi
  if [[ -n "$relay_pid" ]] && ! kill -0 "$relay_pid" 2>/dev/null; then
    echo "[supervisor] Relay process died — restarting relay..."
    pnpm relay &
    relay_pid=$!
  fi

  sleep "$POLL_INTERVAL"
done
