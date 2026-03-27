# run-kit task runner
# Usage: just <recipe>    List all: just --list

# This is automatically done by direnv
set dotenv-load := false

# ─── Doctor ──────────────────────────────────────────────────

# Check that all required tools and dependencies are installed
doctor:
    scripts/doctor.sh

# ─── Setup & Development ──────────────────────────────────────────────

# Copy default config files for local development
setup:
    cd app/frontend && pnpm install
    [ -f .env.local ] || cp .env .env.local
    cd app/frontend && pnpm exec playwright install --with-deps chromium

# Start Go backend (live-reload) + Vite dev server concurrently (just dev --port 4000)
# Backend runs at Frontend port + 1. Default: 3000
dev *args:
    scripts/dev.sh {{args}}

# Run any rk CLI command from source (just dev-rk serve -d)
dev-rk *args:
    cd app/backend && RK_PORT=$(( ${RK_PORT:-3000} + 1 )) go run ./cmd/rk {{args}}

# Start only the Go backend with live-reload (port RK_PORT+1, default 3001)
dev-backend:
    cd app/backend && LOG_LEVEL=debug RK_PORT=$(( ${RK_PORT:-3000} + 1 )) air

# Start only the Vite dev server (port RK_PORT, default 3000)
dev-frontend:
    cd app/frontend && pnpm dev --port "${RK_PORT:-3000}"

# ─── Prod & Daemon mode ────────────────────────────────────────────────────

# Build Go binary + frontend for production (embedded assets + ldflags)
build:
    scripts/build.sh

# Bump version, commit, tag, and push (CI handles the rest)
release bump="patch":
    scripts/release.sh {{bump}}

# Build and run production binary
prod:
    just build
    ./dist/rk

# Start rk daemon in background tmux session
up:
    just build
    ./dist/rk serve -d

# Stop rk daemon
down:
    ./dist/rk serve --stop

# Restart rk daemon
restart:
    just build
    ./dist/rk serve --restart

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
    scripts/test-e2e.sh

# Run ad-hoc Playwright commands (just pw test, just pw test mobile-layout, just pw test --ui)
# Requires a dev server on port 3020: RK_PORT=3020 just dev
pw *args:
    cd app/frontend && RK_PORT="${RK_PORT:-3020}" E2E_TMUX_SERVER="${E2E_TMUX_SERVER:-rk-e2e}" pnpm exec playwright {{args}}

# ─── Assets ──────────────────────────────────────────────────

# Generate icon variants from canonical icon.svg
icons:
    scripts/generate-icons.sh

# ─── Quality ─────────────────────────────────────────────────

# Type-check frontend without emitting
check:
    cd app/frontend && pnpm exec tsc --noEmit

# Full verification: type-check, test, build
verify: check test build
