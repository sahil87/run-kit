#!/usr/bin/env bash
# Run the production binary.
# Usage: ./scripts/prod.sh [--port PORT]
# Prod mode: Go backend serves on RUN_KIT_PORT directly (single port).

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) export RUN_KIT_PORT="$2"; shift 2 ;;
    *) shift ;;
  esac
done

export BACKEND_PORT="${RUN_KIT_PORT:-3000}"
export BACKEND_HOST="${RUN_KIT_HOST:-127.0.0.1}"

exec ./bin/run-kit
