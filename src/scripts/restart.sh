#!/usr/bin/env bash
set -euo pipefail

# Signal a restart if supervisor is running, otherwise start it.

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
