# run-kit task runner
# Usage: just <recipe>    List all: just --list

# This is automatically done by direnv
set dotenv-load := false

# ─── Doctor ──────────────────────────────────────────────────

# Check that all required tools and dependencies are installed
doctor:
    ./scripts/doctor.sh

# ─── Setup & Development ──────────────────────────────────────────────

# Copy default config files for local development
setup:
    pnpm install
    [ -f .env.local ] || cp .env .env.local
    [ -f Caddyfile ] || cp Caddyfile.example Caddyfile
    pnpm --filter run-kit-frontend exec playwright install --with-deps chromium

# Start Go backend (live-reload) + Vite dev server concurrently (just dev --port 4000)
# Backend runs at Frontend port + 1. Default: 3000
dev *args:
    ./scripts/dev.sh {{args}}

# ─── Prod & Daemon mode ────────────────────────────────────────────────────

# Build Go binary + frontend for production (embedded assets + ldflags)
build:
    ./scripts/build.sh

# Tag and push a semver release (patch/minor/major)
release bump:
    ./scripts/release.sh {{bump}}

# Build and run production binary
prod:
    just build
    ./dist/run-kit

# Run supervisor in dedicated tmux server (rk-sup)
up:
    tmux -L rk-sup has-session -t sup 2>/dev/null && tmux -L rk-sup new-window -t sup './scripts/supervisor.sh' || tmux -L rk-sup new-session -d -s sup './scripts/supervisor.sh'

# Stop supervisor
down:
    tmux -L rk-sup kill-server 2>/dev/null || true

restart:
    touch .restart-requested

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
