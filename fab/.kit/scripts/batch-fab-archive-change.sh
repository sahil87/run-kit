#!/usr/bin/env bash
# ---
# name: batch-fab-archive-change
# description: "Archive multiple completed changes in one session"
# ---
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT_DIR="$(dirname "$SCRIPT_DIR")"
FAB_DIR="$(dirname "$KIT_DIR")"
CHANGES_DIR="${FAB_DIR}/changes"
FAB_BIN="$KIT_DIR/bin/fab"

usage() {
  cat <<'EOF'
Usage: batch-fab-archive-change [<change>...] [--list] [--all]

Archives multiple completed changes (hydrate done|skipped) by running
/fab-archive for each one sequentially.

With no arguments, archives all eligible changes (same as --all).

Options:
  --list    Show archivable changes without archiving
  --all     Archive all archivable changes (default when no arguments)

Examples:
  batch-fab-archive-change            # archive all eligible
  batch-fab-archive-change --list     # preview first
  batch-fab-archive-change v3rn ab12  # archive specific changes
EOF
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

is_archivable() {
  local status_file="$1"
  [[ -f "$status_file" ]] || return 1
  grep -qE '^\s*hydrate:\s*(done|skipped)' "$status_file"
}

list_archivable() {
  echo "Archivable changes (hydrate done|skipped):"
  echo ""
  local count=0
  for dir in "$CHANGES_DIR"/*/; do
    [[ -d "$dir" ]] || continue
    local name
    name=$(basename "$dir")
    [[ "$name" == "archive" ]] && continue
    if is_archivable "${dir}.status.yaml"; then
      printf "  %s\n" "$name"
      count=$((count + 1))
    fi
  done
  if [[ $count -eq 0 ]]; then
    echo "  (none)"
  fi
}

all_archivable_names() {
  for dir in "$CHANGES_DIR"/*/; do
    [[ -d "$dir" ]] || continue
    local name
    name=$(basename "$dir")
    [[ "$name" == "archive" ]] && continue
    if is_archivable "${dir}.status.yaml"; then
      printf '%s\n' "$name"
    fi
  done
}

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

if [[ ! -d "$CHANGES_DIR" ]]; then
  echo "Error: changes directory not found at $CHANGES_DIR" >&2
  exit 1
fi

if [[ $# -eq 0 ]]; then
  set -- --all
fi

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

changes=()
case "$1" in
  --list)  list_archivable; exit 0 ;;
  --all)
    mapfile -t changes < <(all_archivable_names)
    if [[ ${#changes[@]} -eq 0 ]]; then
      echo "No archivable changes found." >&2
      exit 1
    fi
    echo "Archiving ${#changes[@]} changes..."
    ;;
  -h|--help) usage; exit 0 ;;
  *)         changes=("$@") ;;
esac

# ---------------------------------------------------------------------------
# Build the comma-separated prompt for a single Claude session
# ---------------------------------------------------------------------------

resolved=()
for change in "${changes[@]}"; do
  if ! match=$("$FAB_BIN" change resolve "$change"); then
    continue
  fi

  local_status="${CHANGES_DIR}/${match}/.status.yaml"
  if ! is_archivable "$local_status"; then
    echo "Warning: '$match' not ready for archive (hydrate not done or skipped), skipping" >&2
    continue
  fi

  resolved+=("$match")
done

if [[ ${#resolved[@]} -eq 0 ]]; then
  echo "No valid changes to archive." >&2
  exit 1
fi

# Build prompt: archive each change sequentially
prompt="Run /fab-archive for each of these changes, one at a time: ${resolved[*]}"

echo "Archiving: ${resolved[*]}"
exec claude --dangerously-skip-permissions "$prompt"
