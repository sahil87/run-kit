# run-kit task runner
# Usage: just <recipe>    List all: just --list

set dotenv-load := false

# ─── Development ──────────────────────────────────────────────

# Start Go backend (live-reload) + Vite dev server concurrently (just dev --port 4000)
dev *args:
    ./scripts/dev.sh {{args}}

# ─── Setup & Build & Prod ────────────────────────────────────────────────────

# Copy default config files for local development
setup:
    [ -f .env.local ] || cp .env .env.local
    [ -f Caddyfile ] || cp Caddyfile.example Caddyfile

# Build Go binary + frontend for production
build:
    mkdir -p bin
    cd app/backend && go build -o ../../bin/run-kit ./cmd/run-kit
    cd app/frontend && pnpm build

# Build and run production binary
prod:
    just build
    ./scripts/prod.sh

# ─── Test ────────────────────────────────────────────────────

# Run all tests (backend + frontend + e2e)
test: test-backend test-frontend test-e2e

# Run Go tests
test-backend:
    cd app/backend && go test ./...

# Run Vitest unit tests
test-frontend:
    cd app/frontend && pnpm test

# Run Playwright e2e tests (port 3020 to avoid colliding with dev server on 3000/3001)
test-e2e:
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

# ─── Quality ─────────────────────────────────────────────────

# Type-check frontend without emitting
check:
    cd app/frontend && pnpm exec tsc --noEmit

# Full verification: type-check, test, build
verify: check test build

# ─── Daemon ──────────────────────────────────────────────

# Run supervisor in background tmux session
up:
    tmux has-session -t rk 2>/dev/null && tmux new-window -t rk './scripts/supervisor.sh' || tmux new-session -d -s rk './scripts/supervisor.sh'

# Stop supervisor and Caddy
down:
    caddy stop --address :2020 2>/dev/null || true
    tmux kill-session -t rk 2>/dev/null || true

restart:
    touch .restart-requested

# ─── HTTPS ───────────────────────────────────────────────────

# One-time: allow current user to manage Tailscale without sudo
ts-setup:
    sudo tailscale set --operator=$USER

# Provision Tailscale HTTPS certs into keys/
ts:
    mkdir -p keys
    tailscale cert --cert-file keys/${RK_HTTPS_HOST:-ubuntu-vm3.bat-ordinal.ts.net}.crt --key-file keys/${RK_HTTPS_HOST:-ubuntu-vm3.bat-ordinal.ts.net}.key ${RK_HTTPS_HOST:-ubuntu-vm3.bat-ordinal.ts.net}

# Start Caddy HTTPS proxy in front of dev server
https:
    caddy run --config Caddyfile

# One-time: install Caddy's local CA into system trust store
trust:
    caddy trust
