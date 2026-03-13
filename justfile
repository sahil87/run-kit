# run-kit task runner
# Usage: just <recipe>    List all: just --list

set dotenv-load := false

# ─── Development ──────────────────────────────────────────────

# Start Go backend (live-reload) + Vite dev server concurrently (just dev --port 4000)
dev *args:
    ./scripts/dev.sh {{args}}

# ─── Build & Prod ───────────────────────────────────────────────────

# Build Go binary + frontend for production
build:
    mkdir -p bin
    cd app/backend && go build -o ../../bin/run-kit ./cmd/run-kit
    cd app/frontend && pnpm build

# Build and run production binary (just prod --port 4000)
prod *args:
    just build
    ./scripts/prod.sh {{args}}

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

# ─── Daemon ──────────────────────────────────────────────

# Run supervisor in background tmux session (just bg --port 4000)
bg *args:
    tmux new-session -d -s runK './scripts/supervisor.sh {{args}}'

# Attach to supervisor session
logs:
    tmux attach-session -t runK

# Stop supervisor
down:
    tmux kill-session -t runK 2>/dev/null || true

# ─── HTTPS ───────────────────────────────────────────────────

# Start Caddy HTTPS proxy in front of dev server
https:
    caddy run --config Caddyfile

# One-time: install Caddy's local CA into system trust store
trust:
    caddy trust
