#!/usr/bin/env bash
# Run the production binary.
# Prod mode: Go backend serves on RK_PORT directly (single port).

export BACKEND_PORT="${RK_PORT:-3000}"
export BACKEND_HOST="${RK_HOST:-127.0.0.1}"

exec ./bin/run-kit
