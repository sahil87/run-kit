#!/usr/bin/env bash
set -euo pipefail

E2E_PORT=3020
E2E_TMUX_SERVER="rk-e2e"

cleanup() {
  # Kill dev server process group
  kill 0 2>/dev/null || true
  # Kill the primary e2e tmux server AND any secondary rk-e2e-* servers tests
  # spun up (rk-e2e-multi-*, rk-e2e-coupling-*). The trap fires on EXIT
  # regardless of cause (normal completion, set -e error, SIGINT/SIGTERM from
  # Ctrl-C), so this reaps secondaries even when a spec's afterAll never ran.
  # Best-effort: a socket may already be gone.
  for sock in "/tmp/tmux-$(id -u)/${E2E_TMUX_SERVER}"*; do
    [ -S "$sock" ] && tmux -L "$(basename "$sock")" kill-server 2>/dev/null || true
  done
}
trap cleanup EXIT

# Kill stale servers
lsof -iTCP:$E2E_PORT -iTCP:$(( E2E_PORT + 1 )) -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null || true

# Start a dedicated tmux server for e2e tests
tmux -L "$E2E_TMUX_SERVER" new-session -d -s e2e-init -x 80 -y 24

# Start dev server in background
RK_PORT=$E2E_PORT just dev &
DEV_PID=$!

# Wait for server to be ready
for i in $(seq 1 30); do curl -s "http://localhost:$E2E_PORT" >/dev/null 2>&1 && break; sleep 1; done

# Run tests — pass server name so specs can target the right tmux server
cd app/frontend && RK_PORT=$E2E_PORT E2E_TMUX_SERVER="$E2E_TMUX_SERVER" pnpm exec playwright test
