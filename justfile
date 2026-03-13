# run-kit task runner
# Usage: just <recipe>    List all: just --list

set dotenv-load := false

# ─── Development ──────────────────────────────────────────────

# Start Go backend (live-reload) + Vite dev server concurrently (just dev --port 3001)
dev *args:
    ./scripts/dev.sh {{args}}

# ─── Build ───────────────────────────────────────────────────

# Build Go binary + frontend for production
build:
    mkdir -p bin
    cd app/backend && go build -o ../../bin/run-kit ./cmd/run-kit
    cd app/frontend && pnpm build

# ─── Test ────────────────────────────────────────────────────

# Run all tests (backend + frontend + e2e)
test: test-backend test-frontend test-e2e

# Run Go tests
test-backend:
    cd app/backend && go test ./...

# Run Vitest unit tests
test-frontend:
    cd app/frontend && pnpm test

# Run Playwright e2e tests
test-e2e:
    cd app/frontend && pnpm exec playwright test

# ─── Quality ─────────────────────────────────────────────────

# Type-check frontend without emitting
check:
    cd app/frontend && pnpm exec tsc --noEmit

# Full verification: type-check, test, build
verify: check test build

# ─── Production ──────────────────────────────────────────────

# Start supervisor (builds, runs, auto-restart on crash)
up:
    ./scripts/supervisor.sh

# Start supervisor in a detached tmux session
bg:
    tmux new-session -d -s runK './scripts/supervisor.sh'
    @echo "Supervisor running in tmux session 'runK'"
    @echo "  Attach: just logs"
    @echo "  Stop:   just down"

# Attach to the supervisor tmux session
logs:
    tmux attach-session -t runK

# Stop the background supervisor
down:
    tmux send-keys -t runK C-c
    @sleep 1
    tmux kill-session -t runK 2>/dev/null || true

# ─── HTTPS ───────────────────────────────────────────────────

# Start Caddy HTTPS proxy in front of dev server
https:
    caddy run --config Caddyfile

# One-time: install Caddy's local CA into system trust store
trust:
    caddy trust
