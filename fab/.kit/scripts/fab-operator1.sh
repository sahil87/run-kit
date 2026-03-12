#!/usr/bin/env bash
# ---
# name: fab-operator1
# description: "Launch operator1 in a dedicated tmux tab (singleton per session)"
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

# Create new tab running the operator skill
tmux new-window -n "$TAB_NAME" "claude --dangerously-skip-permissions '/fab-operator1'"
echo "Launched $TAB_NAME."
