# run-kit task runner
# Usage: just <recipe>    List all: just --list

set dotenv-load := false

# ─── Development ──────────────────────────────────────────────

# Start Go backend (live-reload) + Vite dev server concurrently (just dev --port 4000)
dev *args:
    ./scripts/dev.sh {{args}}

# ─── Doctor ──────────────────────────────────────────────────

# Check that all required tools and dependencies are installed
doctor:
    ./scripts/doctor.sh

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
    ./scripts/test-e2e.sh

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

# Stop supervisor
down:
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
