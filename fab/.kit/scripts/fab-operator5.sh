#!/usr/bin/env bash
# ---
# name: fab-operator5
# description: "Launch operator5 in a dedicated tmux tab (singleton per session)"
# ---
set -euo pipefail

TAB_NAME="operator"

# Must be inside tmux/byobu
if [[ -z "${TMUX:-}" ]]; then
  echo "Error: not inside a tmux/byobu session." >&2
  exit 1
fi

# Singleton: switch to existing tab if it exists
if tmux select-window -t "$TAB_NAME" 2>/dev/null; then
  echo "Switched to existing $TAB_NAME tab."
  exit 0
fi

# Resolve repo root so the new window starts in the correct directory
REPO_ROOT="$(git rev-parse --show-toplevel)"

# Create new tab running the operator skill
tmux new-window -c "$REPO_ROOT" -n "$TAB_NAME" "claude --dangerously-skip-permissions '/fab-operator5'"
echo "Launched $TAB_NAME."
