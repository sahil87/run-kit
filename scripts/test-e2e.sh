#!/usr/bin/env bash
set -euo pipefail

# Kill stale servers
lsof -iTCP:3020 -iTCP:3021 -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null || true

# Start dev server in background
RK_PORT=3020 just dev &
DEV_PID=$!

# Wait for server to be ready
for i in $(seq 1 30); do curl -s http://localhost:3020 >/dev/null 2>&1 && break; sleep 1; done

# Run tests
cd app/frontend && RK_PORT=3020 pnpm exec playwright test
