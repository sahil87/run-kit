#!/usr/bin/env bash
# Start Go backend (live-reload) + Vite dev server concurrently.
# Usage: ./scripts/dev.sh [--port PORT] [--host HOST]
cleanup() {
  kill 0 2>/dev/null
  sleep 0.5
  # Force-kill any stragglers (air, vite, go backend)
  kill -9 0 2>/dev/null
}
trap cleanup EXIT

# Parse --port flag (overrides RK_PORT)
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) export RK_PORT="$2"; shift 2 ;;
    --host) export RK_HOST="$2"; shift 2 ;;
    *) shift ;;
  esac
done

export LOG_LEVEL=debug
export RK_PORT="${RK_PORT:-3000}"
export RK_HOST="${RK_HOST:-0.0.0.0}"

# Ensure cwd is repo root (supports invocation from any directory)
cd "$(dirname "$0")/.." || exit 1

# Ensure tmux.conf exists for Go embed (canonical source: configs/tmux/default.conf)
cp "$PWD/configs/tmux/default.conf" "$PWD/app/backend/build/tmux.conf"

# Dev mode: Vite serves on RK_PORT, Go backend on RK_PORT+1, code-server on RK_PORT+2.
command -v air &>/dev/null || { echo "error: air not found (go install github.com/air-verse/air@latest)"; exit 1; }

# code-server — the `code` lens upstream (change 260811-k3vp): deterministic
# port RK_PORT+2, loopback-only, auth off (the rk origin is the trust boundary;
# the embed rides the same-origin /proxy/{port}/ path). code-server is a
# required dependency (Homebrew formula dependency) and always starts — with
# ONE carve-out: a PRESET RK_CODE_SERVER_PORT means the port is externally
# managed and nothing is started here. scripts/test-e2e.sh DEPENDS on this
# (it presets the port and the e2e spec binds a stub HTTP server there — an
# unconditional export/start would clobber the harness port and probe a port
# nobody serves on CI). The deterministic +2 port is load-bearing: code-server
# keys browser-side workspace state by the proxy pathname, so a stable port is
# what keeps tabs/layout across dev restarts. Output goes to a port-suffixed
# log (never /dev/null) so a silent startup death is diagnosable.
if [[ -n "${RK_CODE_SERVER_PORT:-}" ]]; then
  echo "code-server: externally managed on :${RK_CODE_SERVER_PORT} (not started here)"
else
  export RK_CODE_SERVER_PORT=$(( RK_PORT + 2 ))
  CODE_SERVER_LOG="/tmp/rk-dev-code-server-${RK_CODE_SERVER_PORT}.log"
  # `env -u VSCODE_IPC_HOOK_CLI`: inside a VS Code integrated terminal that var
  # makes code-server act as the `code` CLI ("open in existing instance") and
  # exit with "Please specify at least one file or folder" instead of serving.
  env -u VSCODE_IPC_HOOK_CLI code-server --bind-addr "127.0.0.1:${RK_CODE_SERVER_PORT}" --auth none > "$CODE_SERVER_LOG" 2>&1 &
  echo "code-server: 127.0.0.1:${RK_CODE_SERVER_PORT} (log: ${CODE_SERVER_LOG})"
fi

(cd app/backend && RK_PORT=$(( RK_PORT + 1 )) air) &

(cd app/frontend && pnpm dev --port "$RK_PORT") &
wait
