#!/usr/bin/env bash
# ---
# name: fab-operator7
# description: "Launch operator7 in a dedicated tmux tab (singleton per session)"
# ---
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/spawn.sh"

TAB_NAME="operator"

# Must be inside tmux
if [[ -z "${TMUX:-}" ]]; then
  echo "Error: not inside a tmux session." >&2
  exit 1
fi

# Singleton: switch to existing tab if it exists
if tmux select-window -t "$TAB_NAME" 2>/dev/null; then
  echo "Switched to existing $TAB_NAME tab."
  exit 0
fi

# Resolve repo root so the new window starts in the correct directory
REPO_ROOT="$(git rev-parse --show-toplevel)"
CONFIG_FILE="$REPO_ROOT/fab/project/config.yaml"
SPAWN_CMD=$(fab_spawn_cmd "$CONFIG_FILE")

# Create new tab running the operator skill
tmux new-window -c "$REPO_ROOT" -n "$TAB_NAME" "$SPAWN_CMD '/fab-operator7'"
echo "Launched $TAB_NAME."
