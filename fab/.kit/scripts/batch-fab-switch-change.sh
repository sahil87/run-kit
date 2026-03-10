#!/usr/bin/env bash
# ---
# name: batch-fab-switch-change
# description: "Open tmux tabs in worktrees for one or more changes"
# ---
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT_DIR="$(dirname "$SCRIPT_DIR")"
FAB_DIR="$(dirname "$KIT_DIR")"
CHANGES_DIR="${FAB_DIR}/changes"
CONFIG_FILE="${FAB_DIR}/project/config.yaml"
FAB_BIN="$KIT_DIR/bin/fab"

usage() {
  cat <<'EOF'
Usage: batch-fab-switch-change <change> [<change>...]

Per change ID or name: opens a new tmux tab in its worktree and starts a
Claude Code session that runs /fab-switch <change>.

Options:
  --list    Show available changes
  --all     Open tabs for all changes

Examples:
  batch-fab-switch-change r7k3
  batch-fab-switch-change r7k3 ab12
  batch-fab-switch-change --all
EOF
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

list_changes() {
  echo "Available changes:"
  echo ""
  for dir in "$CHANGES_DIR"/*/; do
    [[ -d "$dir" ]] || continue
    local name
    name=$(basename "$dir")
    [[ "$name" == "archive" ]] && continue
    printf "  %s\n" "$name"
  done
}

all_change_names() {
  for dir in "$CHANGES_DIR"/*/; do
    [[ -d "$dir" ]] || continue
    local name
    name=$(basename "$dir")
    [[ "$name" == "archive" ]] && continue
    printf '%s\n' "$name"
  done
}

get_branch_prefix() {
  # Extract branch_prefix from fab/project/config.yaml
  # Looks for: branch_prefix: "value" or branch_prefix: ""
  if [[ -f "$CONFIG_FILE" ]]; then
    grep -E '^\s*branch_prefix:' "$CONFIG_FILE" | \
      sed -E 's/^\s*branch_prefix:\s*"?([^"]*)"?.*/\1/' || echo ""
  else
    echo ""
  fi
}

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

if [[ ! -d "$CHANGES_DIR" ]]; then
  echo "Error: changes directory not found at $CHANGES_DIR" >&2
  exit 1
fi

if [[ -z "${TMUX:-}" ]]; then
  echo "Error: not inside a tmux session" >&2
  exit 1
fi

if [[ $# -eq 0 ]]; then
  set -- --list
fi

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

changes=()
case "$1" in
  --list)  list_changes; exit 0 ;;
  --all)
    mapfile -t changes < <(all_change_names)
    if [[ ${#changes[@]} -eq 0 ]]; then
      echo "No changes found." >&2
      exit 1
    fi
    echo "Opening ${#changes[@]} tabs for all changes..."
    ;;
  -h|--help) usage; exit 0 ;;
  *)         changes=("$@") ;;
esac

# ---------------------------------------------------------------------------
# Open tabs
# ---------------------------------------------------------------------------

for change in "${changes[@]}"; do
  if ! match=$("$FAB_BIN" change resolve "$change"); then
    continue
  fi

  printf "  %s\n" "$match"

  # Get branch prefix from config and construct the branch name fab-switch would use
  branch_prefix=$(get_branch_prefix)
  branch_name="${branch_prefix}${match}"

  # Create worktree with the exact branch name fab-switch expects
  wt_path=$(wt create --non-interactive --reuse --worktree-name "$match" "$branch_name") || {
    echo "Error: failed to create worktree for '$match', skipping" >&2
    continue
  }

  # Escape single quotes for the nested shell: ' → '\''
  safe="${match//"'"/"'\''"}"

  # Call fab-switch (branch is already set up by the worktree)
  tmux new-window -n "${match}" -c "$wt_path" \
    "claude --dangerously-skip-permissions '/fab-switch ${safe}'"
done
