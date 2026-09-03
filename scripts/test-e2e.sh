#!/usr/bin/env bash
set -euo pipefail

# Per-worktree derived identity (E2E_PORT / E2E_TMUX_FAMILY / E2E_TMUX_SERVER /
# E2E_CODE_SERVER_PORT) — see scripts/e2e-env.sh. Ambient RK_PORT is not an
# input; RK_E2E_PORT / preset E2E_TMUX_SERVER override. The derived stub port
# is promoted to the RK_CODE_SERVER_PORT preset dev.sh keys on (the harness's
# externally-managed carve-out).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/e2e-env.sh"
RK_CODE_SERVER_PORT="$E2E_CODE_SERVER_PORT"

# Hermetic per-run state: the backend's disk carve-outs (layout snapshots, the
# PR-status seed cache) land under this temp dir instead of the developer's
# real $XDG_STATE_HOME/run-kit, and the EXIT trap removes it. The config root
# is isolated too: RK_CONFIG_DIR (exported to the backend launch and the
# playwright run below) points settings reads/writes at the per-run
# $E2E_STATE_HOME/config instead of the developer's real
# ~/.config/run-kit/config.yaml, so parallel worktree runs cannot race on it.
# Specs that touch the file keep their snapshot/restore pattern as the
# fallback for the interactive `just pw` lane, which sets no RK_CONFIG_DIR.
E2E_STATE_HOME="$(mktemp -d)"
RK_CONFIG_DIR="$E2E_STATE_HOME/config"
mkdir -p "$RK_CONFIG_DIR"

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
  # dev server is launched into its OWN process group below (via `set -m` job
  # control), so we target that group by negative PGID and leave the caller's
  # group untouched.
  if [ -n "$DEV_PGID" ]; then
    kill -- "-$DEV_PGID" 2>/dev/null || true
  fi
  # Kill this worktree's own socket family: the primary (…-0) AND any
  # secondary servers tests spun up (…-multi-*, …-scope-*, …). The glob
  # anchors on E2E_TMUX_FAMILY (trailing hyphen included); because tokens are
  # hyphen-free, it can only ever match THIS worktree's family — never a
  # sibling worktree's. The trap fires on EXIT regardless of cause (normal
  # completion, set -e error, SIGINT/SIGTERM from Ctrl-C), so this reaps
  # secondaries even when a spec's afterAll never ran. Best-effort: a socket
  # may already be gone.
  for sock in "/tmp/tmux-$(id -u)/${E2E_TMUX_FAMILY}"*; do
    [ -S "$sock" ] && tmux -L "$(basename "$sock")" kill-server 2>/dev/null || true
  done
  rm -rf "$E2E_STATE_HOME"
}
trap cleanup EXIT

# Self-scoped stale-kill: probe ONLY the derived port triple. Nobody else can
# own these ports — they are this worktree's by construction — so this claims
# them from this worktree's own leftover `just dev`/previous run without the
# old machine-wide 3020/3021 kill hazard.
kill_triple() {
  lsof -iTCP:"$E2E_PORT" -iTCP:$(( E2E_PORT + 1 )) -iTCP:$(( E2E_PORT + 2 )) -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null || true
}
triple_busy() {
  # String capture, not a grep -q pipe: grep's early exit SIGPIPEs lsof and
  # pipefail would report the busy triple as free.
  [ -n "$(lsof -iTCP:"$E2E_PORT" -iTCP:$(( E2E_PORT + 1 )) -iTCP:$(( E2E_PORT + 2 )) -sTCP:LISTEN -t 2>/dev/null)" ]
}
kill_triple
sleep 1
_steps=0
# Step forward by 3 only when a derived port is STILL busy after the kill —
# an unkillable foreign owner (e.g. another user's process); a port this
# worktree owns dies to the kill above. Bounded to the 3400–3699 block.
while triple_busy; do
  if [ $(( E2E_PORT + 3 + 2 )) -gt 3699 ] || [ "$_steps" -ge 20 ]; then
    echo "ERROR: no free port triple in the e2e block (3400-3699); set RK_E2E_PORT explicitly." >&2
    exit 1
  fi
  E2E_PORT=$(( E2E_PORT + 3 ))
  RK_CODE_SERVER_PORT=$(( E2E_PORT + 2 ))
  _steps=$(( _steps + 1 ))
  kill_triple
  sleep 1
done
if [ "$_steps" -gt 0 ]; then
  echo "NOTE: derived ports busy with an unkillable owner; stepped forward to :$E2E_PORT."
  echo "      A stepped-forward rig is not derivable by 'just pw' — pass RK_E2E_PORT=$E2E_PORT to it."
fi

# Start a dedicated tmux server for e2e tests
tmux -L "$E2E_TMUX_SERVER" new-session -d -s e2e-init -x 80 -y 24
# Convention: test servers carry the @rk_srv_ephemeral creator opt-out mark (belt-and-braces alongside the rk-test-* name umbrella).
tmux -L "$E2E_TMUX_SERVER" set-option -s @rk_srv_ephemeral 1
# The rig's servers are rk's own substrate: mark them @rk_srv_managed so the
# WS-attach conf reload fires (specs rely on rk's tmux.conf — e.g.
# allow-passthrough for wrapped OSC — reaching the server on first view;
# an unmarked server is external and rk no longer pushes conf into it).
tmux -L "$E2E_TMUX_SERVER" set-option -s @rk_srv_managed 1

# Pre-seed LEGACY option names so the daemon's once-per-server migration sweep
# converges them to @rk_srv_*/@rk_win_* on attach (the WS-attach/reload-config
# sweep hook). Removed when the legacy-name deprecation window closes. The
# e2e-init first window carries window-scope legacy role/url/note; the legacy
# sweep spec asserts the convergence.
E2E_INIT_WIN_ID="$(tmux -L "$E2E_TMUX_SERVER" display-message -p -t e2e-init '#{window_id}')"
tmux -L "$E2E_TMUX_SERVER" set-option -s @rk_origin e2e-legacy
tmux -L "$E2E_TMUX_SERVER" set-option -s @rk_session_order '["e2e-init"]'
tmux -L "$E2E_TMUX_SERVER" set-option -w -t "$E2E_INIT_WIN_ID" @rk_role operator
tmux -L "$E2E_TMUX_SERVER" set-option -w -t "$E2E_INIT_WIN_ID" @rk_url /about:blank
tmux -L "$E2E_TMUX_SERVER" set-option -w -t "$E2E_INIT_WIN_ID" @rk_note '1:e2e-legacy-note'

# Start the dev server in its OWN process group, so cleanup can kill the whole
# dev subtree (just -> air/vite/node children) by PGID without ever signalling
# the caller's group (the `kill 0` grenade this replaced killed live operator
# tmux servers — see the cleanup() comment above).
#
# `set -m` enables job control, which makes each `&` background job a process-
# group leader (its PGID == its PID). This is portable: it needs no external
# binary, so it works on macOS (which has no `setsid` — that's util-linux, not
# BSD) as well as Linux/CI. We scope monitor mode to just this launch and turn
# it back off immediately (after capturing the PGID) so the rest of the script
# keeps its normal job behavior.
#
# RK_SERVER_ALLOWLIST scopes the backend's READ path: tmux.ListServers (and
# every consumer rooted at it — /api/servers, board enumeration) returns only
# this worktree's e2e family, so board routes open one SSE per test server
# instead of one per live operator server on a busy box. It is anchored on
# E2E_TMUX_FAMILY (trailing hyphen) so the primary (…-0) and every secondary
# are admitted. This is distinct from E2E_TMUX_SERVER, which scopes the WRITE
# socket the tests target.
#
# RK_CODE_SERVER_PORT (260811-k3vp) configures the code lens/surface for the
# code-surface spec — the spec binds a stub HTTP server on this port and
# toggles it to drive the reachable/not-running states. The value is the
# derived triple's +2 (e2e-env.sh; a preset env var still wins), so parallel
# worktrees never collide on the stub. The same value is exported to the
# playwright run below so the spec and the backend agree on the port.
set -m
bash -c "RK_PORT=$E2E_PORT RK_SERVER_ALLOWLIST=$E2E_TMUX_FAMILY E2E_TMUX_FAMILY=$E2E_TMUX_FAMILY RK_CODE_SERVER_PORT=$RK_CODE_SERVER_PORT XDG_STATE_HOME=$E2E_STATE_HOME RK_CONFIG_DIR=$RK_CONFIG_DIR exec just dev" &
DEV_PID=$!
set +m

# Verify job control actually put the child in its OWN process group before we
# trust DEV_PGID for the negative-PGID kill in cleanup(). `set -m` normally
# makes a background job a group leader (PGID == PID), but if it silently did
# NOT (an unexpected shell/environment), DEV_PGID would equal THIS script's
# PGID — and `kill -- -$DEV_PGID` would grenade the caller's whole group (the
# exact disaster this design prevents). Read the child's real PGID via `ps` and
# abort if it matches our own. DEV_PGID stays empty on abort, so the EXIT trap's
# group-kill is a no-op. (Per PR #220 review.)
DEV_PGID=$(ps -o pgid= -p "$DEV_PID" 2>/dev/null | tr -d ' ')
SELF_PGID=$(ps -o pgid= -p "$$" 2>/dev/null | tr -d ' ')
if [ -z "$DEV_PGID" ]; then
  echo "ERROR: could not read dev server PGID (pid $DEV_PID); aborting before the EXIT trap can mis-target." >&2
  exit 1
fi
if [ "$DEV_PGID" = "$SELF_PGID" ]; then
  echo "ERROR: dev server shares this script's process group ($DEV_PGID) — job control did not isolate it. Aborting so cleanup never signals the caller's group." >&2
  DEV_PGID=""
  exit 1
fi

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

# Run tests — pass server/family names so specs can target the right tmux
# server and name secondaries inside this worktree's family. Forward any extra
# args ("$@") to playwright so callers can scope the run (e.g. `just test-e2e
# mobile-layout`) against the same seeded test server. Playwright reads the
# base port from E2E_PORT — a variable only the harness sets (ambient direnv
# exports RK_PORT, so a spec-side RK_PORT read would defeat the :3333
# fail-closed fallback on a bare `playwright test`); RK_PORT is still passed
# for any non-Playwright reader in the child env.
run_playwright() {
  cd app/frontend && RK_PORT=$E2E_PORT E2E_PORT=$E2E_PORT E2E_TMUX_SERVER="$E2E_TMUX_SERVER" E2E_TMUX_FAMILY="$E2E_TMUX_FAMILY" RK_CODE_SERVER_PORT="$RK_CODE_SERVER_PORT" RK_CONFIG_DIR="$RK_CONFIG_DIR" pnpm exec playwright test "$@"
}

# Concurrency throttle (load, not correctness — the derived identity already
# isolates): a flock counting semaphore over RK_E2E_SLOTS slot files
# (/tmp/rk-e2e-slot-<uid>-{0..N-1}, default N=2, 1 = strict series) shared by
# every worktree on this box. The suite is timing-sensitive under parallel
# Playwright+Vite+Go CPU load, so cross-worktree runs queue for a slot before
# entering the Playwright phase. Server startup above is NOT throttled (cheap
# and port-isolated); `just pw` stays unthrottled (interactive lane). The uid
# suffix keeps slots per-user — opening another user's slot file (or inheriting
# their lock holder) must not abort this run under `set -e`.
if command -v flock >/dev/null 2>&1; then
  E2E_SLOTS="${RK_E2E_SLOTS:-2}"
  [[ "$E2E_SLOTS" =~ ^[0-9]+$ ]] || E2E_SLOTS=2
  [ "$E2E_SLOTS" -ge 1 ] || E2E_SLOTS=1
  # Slot-file opens are guarded: a bare `exec {fd}>>` on an unopenable path
  # (unexpected /tmp perms, fd exhaustion) exits the script under set -e, so
  # every open sits in an `if` — an unopenable slot is skipped, and if even
  # slot 0 cannot be opened the throttle degrades to unthrottled rather than
  # failing the run over throttle plumbing.
  _e2e_lock_fd=""
  for (( i=0; i<E2E_SLOTS; i++ )); do
    if ! exec {fd}>>"/tmp/rk-e2e-slot-$(id -u)-$i" 2>/dev/null; then continue; fi
    if flock -n "$fd"; then _e2e_lock_fd=$fd; break; fi
    exec {fd}>&-
  done
  if [ -z "$_e2e_lock_fd" ]; then
    if exec {fd}>>"/tmp/rk-e2e-slot-$(id -u)-0" 2>/dev/null; then
      echo "e2e throttle: all $E2E_SLOTS slot(s) busy — blocking on slot 0 (tune via RK_E2E_SLOTS)"
      flock "$fd"
      _e2e_lock_fd=$fd
    else
      echo "e2e throttle: cannot open slot files — running unthrottled" >&2
    fi
  fi
  if run_playwright "$@"; then _pw_status=0; else _pw_status=$?; fi
  [ -n "$_e2e_lock_fd" ] && flock -u "$_e2e_lock_fd" 2>/dev/null || true
  exit "$_pw_status"
else
  # Stock macOS has no flock(1) — degrade to unthrottled (isolation holds).
  echo "e2e throttle: flock(1) not found — running unthrottled" >&2
  run_playwright "$@"
fi
