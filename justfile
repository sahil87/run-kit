# run-kit task runner
# Usage: just <recipe>    List all: just --list

set dotenv-load := false

# ─── Development ──────────────────────────────────────────────

# Start dev server (Next.js + terminal relay with hot reload)
dev:
    pnpm dev

# ─── Production ───────────────────────────────────────────────

# Build Next.js for production
build:
    pnpm build

# Start supervisor (builds, runs Next.js + relay, self-heals, auto-rollback)
up:
    pnpm supervisor

# Start supervisor in a detached tmux session
bg:
    tmux new-session -d -s runK 'pnpm supervisor'
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

# Signal a restart (build + health-check + auto-rollback); starts supervisor if not running
restart:
    src/scripts/restart.sh

# ─── HTTPS ────────────────────────────────────────────────────

# Start Caddy HTTPS proxy in front of dev server (requires caddy: brew install caddy)
https:
    caddy run --config Caddyfile

# Start supervisor + Caddy HTTPS proxy together
up-https:
    pnpm concurrently -n super,caddy -c blue,green "pnpm supervisor" "caddy run --config Caddyfile"

# One-time: install Caddy's local CA into system trust store
trust:
    caddy trust

# ─── Setup ────────────────────────────────────────────────────

# Check that all system dependencies are installed
doctor:
    src/scripts/doctor.sh

# ─── Quality ──────────────────────────────────────────────────

# Run all tests
test:
    pnpm test

# Type-check without emitting
check:
    npx tsc --noEmit

# Full verification: type-check then build
verify: check build
