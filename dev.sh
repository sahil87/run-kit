#!/usr/bin/env bash
set -euo pipefail

# Read port/host config from run-kit.yaml (optional)
RK_PORT=3000
RK_HOST="127.0.0.1"
if [[ -f run-kit.yaml ]]; then
  _val() { grep "^[[:space:]]\+$1:" run-kit.yaml 2>/dev/null | head -1 | sed 's/^[^:]*: *//' | sed 's/ *#.*//' | tr -d '"'"'" ; }
  _p=$(_val port); [[ "$_p" =~ ^[0-9]+$ ]] && RK_PORT="$_p"
  _h=$(_val host); [[ -n "$_h" ]] && [[ "$_h" =~ ^[a-zA-Z0-9._:-]+$ ]] && RK_HOST="$_h"
  unset _val _p _h
fi

GO_PID=""
VITE_PID=""

cleanup() {
  echo "[dev] Shutting down..."
  [[ -n "$GO_PID" ]] && kill "$GO_PID" 2>/dev/null || true
  [[ -n "$VITE_PID" ]] && kill "$VITE_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}

trap cleanup SIGINT SIGTERM EXIT

echo "[dev] Starting Go backend on ${RK_HOST}:${RK_PORT}..."
(cd packages/api && go run ./cmd/run-kit --port "$RK_PORT" --host "$RK_HOST") &
GO_PID=$!

echo "[dev] Starting Vite dev server..."
pnpm --filter run-kit-web dev &
VITE_PID=$!

echo ""
echo "  Go backend:  http://${RK_HOST}:${RK_PORT}"
echo "  Vite dev:    http://localhost:5173"
echo "  (Vite proxies /api/* and /relay/* to Go)"
echo ""

wait
