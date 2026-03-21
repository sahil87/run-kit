#!/usr/bin/env bash
# ---
# name: batch-fab-new-backlog
# description: "Create worktree tabs from backlog items"
# ---
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT_DIR="$(dirname "$SCRIPT_DIR")"
FAB_DIR="$(dirname "$KIT_DIR")"
BACKLOG_FILE="${FAB_DIR}/backlog.md"
CONFIG_FILE="${FAB_DIR}/project/config.yaml"

source "$SCRIPT_DIR/lib/spawn.sh"

usage() {
  cat <<'EOF'
Usage: batch-fab-new-backlog <backlog-id> [<backlog-id>...]

Per backlog ID: creates a git worktree (named after the ID), opens a new
tmux tab in that worktree, and starts a Claude Code session that runs
/fab-new with the item's description.

Options:
  --list    Show pending backlog items and their IDs
  --all     Open tabs for all pending backlog items

Examples:
  batch-fab-new-backlog 90g5 jgt6
  batch-fab-new-backlog --all
EOF
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Extract the description for a backlog ID, joining continuation lines.
extract_content() {
  local id="$1"
  local found=false
  local content=""

  while IFS= read -r line; do
    if ! $found; then
      # Match a list item whose ID field is [<id>] (anchored to line start)
      if [[ "$line" =~ ^-\ \[[x\ ]\]\ \[$id\] ]]; then
        # Strip the prefix:  - [x/ ] [ID] [ISSUE_ID]? (BUG)? YYYY-MM-DD:
        content=$(sed -E 's/^- \[[x ]\] \[[a-z0-9]{4}\] (\[[A-Z]+-[0-9]+\] )?(\(BUG\) )?[0-9]{4}-[0-9]{2}-[0-9]{2}: //' <<< "$line")
        found=true
      fi
    else
      # Continuation lines: start with whitespace, not a new list item
      if [[ "$line" =~ ^[[:space:]] && ! "$line" =~ ^[[:space:]]*-\ \[ ]]; then
        local trimmed="${line#"${line%%[![:space:]]*}"}"
        content="$content $trimmed"
      else
        break
      fi
    fi
  done < "$BACKLOG_FILE"

  $found || return 1
  echo "$content"
}

list_pending() {
  echo "Pending backlog items:"
  echo ""
  while IFS= read -r line; do
    local id
    id=$(sed -E 's/^- \[ \] \[([a-z0-9]{4})\].*$/\1/' <<< "$line")
    local desc
    desc=$(sed -E 's/^- \[ \] \[[a-z0-9]{4}\] (\[[A-Z]+-[0-9]+\] )?(\(BUG\) )?[0-9]{4}-[0-9]{2}-[0-9]{2}: //' <<< "$line")
    printf "  %-6s %s\n" "[$id]" "${desc:0:80}"
  done < <(grep -E '^\- \[ \] \[' "$BACKLOG_FILE")
}

all_pending_ids() {
  grep -E '^\- \[ \] \[' "$BACKLOG_FILE" | sed -E 's/^- \[ \] \[([a-z0-9]{4})\].*$/\1/'
}

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

if [[ ! -f "$BACKLOG_FILE" ]]; then
  echo "Error: backlog.md not found at $BACKLOG_FILE" >&2
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

ids=()
case "$1" in
  --list)  list_pending; exit 0 ;;
  --all)
    mapfile -t ids < <(all_pending_ids)
    if [[ ${#ids[@]} -eq 0 ]]; then
      echo "No pending backlog items found." >&2
      exit 1
    fi
    echo "Opening ${#ids[@]} tabs for all pending items..."
    ;;
  -h|--help) usage; exit 0 ;;
  *)         ids=("$@") ;;
esac

# ---------------------------------------------------------------------------
# Open tabs
# ---------------------------------------------------------------------------

SPAWN_CMD=$(fab_spawn_cmd "$CONFIG_FILE")

for id in "${ids[@]}"; do
  content=$(extract_content "$id") || {
    echo "Warning: [$id] not found in backlog, skipping" >&2
    continue
  }

  if [[ -z "$content" ]]; then
    echo "Warning: [$id] has empty content, skipping" >&2
    continue
  fi

  printf "  [%s] %s\n" "$id" "${content:0:70}..."

  # Create a worktree named after the backlog ID (last line = path)
  wt_path=$(wt create --non-interactive --worktree-name "$id") || {
    echo "Error: failed to create worktree for [$id], skipping" >&2
    continue
  }

  # Escape single quotes for the nested shell: ' → '\''
  safe="${content//"'"/"'\''"}"

  tmux new-window -n "fab-$id" -c "$wt_path" \
    "$SPAWN_CMD '/fab-new ${safe}'"
done
