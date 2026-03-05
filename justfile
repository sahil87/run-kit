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
    #!/usr/bin/env bash
    if tmux has-session -t runK 2>/dev/null; then
        touch .restart-requested
        echo "Restart signaled — supervisor will pick it up within 2s"
    else
        echo "Supervisor not running — starting it (includes build)..."
        tmux new-session -d -s runK 'pnpm supervisor'
        echo "Supervisor running in tmux session 'runK'"
        echo "  Attach: just logs"
        echo "  Stop:   just down"
    fi

# ─── Setup ───────────────────────────────────────────────────

# Generate locally-trusted TLS certs (requires mkcert: https://github.com/FiloSottile/mkcert)
certs:
    mkdir -p certs
    mkcert -install
    mkcert -cert-file certs/localhost.pem -key-file certs/localhost-key.pem localhost 127.0.0.1 ::1

# ─── Quality ──────────────────────────────────────────────────

# Run all tests
test:
    pnpm test

# Type-check without emitting
check:
    npx tsc --noEmit

# Full verification: type-check then build
verify: check build
