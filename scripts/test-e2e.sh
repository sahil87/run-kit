#!/usr/bin/env bash
set -euo pipefail

E2E_PORT=3020
E2E_TMUX_SERVER="rk-test-e2e"

# DEV_PGID is the process-group ID of the detached dev server (set after launch).
# Empty until then so cleanup running early is a no-op for the group kill.
DEV_PGID=""

cleanup() {
  # Kill ONLY the dev server's own process group — never `kill 0`.
  #
  # `kill 0` signals every process in THIS script's group. Because the script
  # is not detached, that group is the CALLER's group: when this runs inside an
  # interactive session (or a subagent that launched it inline), `kill 0`
  # SIGTERMs the caller's tmux servers / `-CC` control clients sharing the
  # group — silently destroying live, unrelated tmux sessions (observed:
  # kit/abbb/runWork dying mid-session with no tmux kill-server command). The
  # dev server is launched via `setsid` into its OWN process group below, so we
  # target that group by negative PGID and leave the caller's group untouched.
  if [ -n "$DEV_PGID" ]; then
    kill -- "-$DEV_PGID" 2>/dev/null || true
  fi
  # Kill the primary e2e tmux server AND any secondary rk-test-e2e-* servers
  # tests spun up (rk-test-e2e-multi-*, rk-test-e2e-coupling-*). The trap fires
  # on EXIT regardless of cause (normal completion, set -e error,
  # SIGINT/SIGTERM from Ctrl-C), so this reaps secondaries even when a spec's
  # afterAll never ran. Best-effort: a socket may already be gone.
  for sock in "/tmp/tmux-$(id -u)/${E2E_TMUX_SERVER}"*; do
    [ -S "$sock" ] && tmux -L "$(basename "$sock")" kill-server 2>/dev/null || true
  done
}
trap cleanup EXIT

# Kill stale servers
lsof -iTCP:$E2E_PORT -iTCP:$(( E2E_PORT + 1 )) -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null || true

# Start a dedicated tmux server for e2e tests
tmux -L "$E2E_TMUX_SERVER" new-session -d -s e2e-init -x 80 -y 24

# Start the dev server in its OWN process group/session via setsid, so cleanup
# can kill the whole dev subtree (just -> air/vite/node children) by PGID
# without ever signalling the caller's group. setsid makes the child a session
# leader, so its PID == its PGID.
#
# RK_SERVER_ALLOWLIST scopes the backend's READ path: tmux.ListServers (and
# every consumer rooted at it — /api/servers, board enumeration) returns only
# rk-test-e2e* servers, so board routes open one SSE per test server instead of
# one per live operator server on a busy box. This is distinct from
# E2E_TMUX_SERVER, which scopes the WRITE socket the tests target.
setsid bash -c "RK_PORT=$E2E_PORT RK_SERVER_ALLOWLIST=$E2E_TMUX_SERVER exec just dev" &
DEV_PID=$!
DEV_PGID=$DEV_PID

# Wait for BOTH servers to be ready. The frontend (Vite, E2E_PORT) comes up
# almost instantly, but the Go backend (E2E_PORT+1) is built from scratch by
# air on a cold runner — a 15s+ compile in CI. Waiting only on Vite (the old
# behavior) let Playwright start while every /api call still got ECONNREFUSED,
# so sessions never rendered and tests timed out. Gate on the backend's
# /api/health endpoint, which only answers once the compiled binary is live.
BACKEND_PORT=$(( E2E_PORT + 1 ))
echo "waiting for frontend (:$E2E_PORT) and backend (:$BACKEND_PORT/api/health)..."
for i in $(seq 1 90); do
  if curl -sf "http://localhost:$E2E_PORT" >/dev/null 2>&1 \
    && curl -sf "http://localhost:$BACKEND_PORT/api/health" >/dev/null 2>&1; then
    echo "both servers ready after ${i}s"
    break
  fi
  if [ "$i" -eq 90 ]; then
    echo "ERROR: servers not ready after 90s (frontend and/or backend never came up)" >&2
    exit 1
  fi
  sleep 1
done

# Run tests — pass server name so specs can target the right tmux server.
# Forward any extra args ("$@") to playwright so callers can scope the run
# (e.g. `just test-e2e mobile-layout`) against the same seeded test server.
cd app/frontend && RK_PORT=$E2E_PORT E2E_TMUX_SERVER="$E2E_TMUX_SERVER" pnpm exec playwright test "$@"
