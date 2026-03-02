#!/usr/bin/env bash
# fab/.kit/scripts/lib/resolve.sh
#
# Change Resolver — pure query, no side effects.
# Converts any change reference to a canonical output format.
#
# Usage:
#   resolve.sh [--id|--folder|--dir|--status] [<change>]
#   resolve.sh --help

set -euo pipefail

LIB_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
FAB_ROOT="$(cd "$LIB_DIR/../../.." && pwd)"

# ─────────────────────────────────────────────────────────────────────────────
# Resolution Logic
# ─────────────────────────────────────────────────────────────────────────────

# resolve_to_folder <override> — Resolve a change reference to a full folder name.
# Accepts: 4-char ID, folder name substring, full folder name, or empty (reads fab/current).
# Returns folder name on stdout. Exits 1 on failure (error on stderr).
resolve_to_folder() {
  local override="${1:-}"
  local changes_dir="$FAB_ROOT/changes"

  if [ -n "$override" ]; then
    # --- Override mode: match against fab/changes/ folders ---
    if [ ! -d "$changes_dir" ]; then
      echo "fab/changes/ not found." >&2
      return 1
    fi

    # Collect non-archive folder names
    local folders=()
    local d base
    for d in "$changes_dir"/*/; do
      [ -d "$d" ] || continue
      base="$(basename "$d")"
      [ "$base" = "archive" ] && continue
      folders+=("$base")
    done

    if [ ${#folders[@]} -eq 0 ]; then
      echo "No active changes found." >&2
      return 1
    fi

    # Case-insensitive matching
    local override_lower
    override_lower=$(echo "$override" | tr '[:upper:]' '[:lower:]')
    local exact_match=""
    local partial_matches=()

    local folder folder_lower
    for folder in "${folders[@]}"; do
      folder_lower=$(echo "$folder" | tr '[:upper:]' '[:lower:]')
      if [ "$folder_lower" = "$override_lower" ]; then
        exact_match="$folder"
        break
      elif [[ "$folder_lower" == *"$override_lower"* ]]; then
        partial_matches+=("$folder")
      fi
    done

    if [ -n "$exact_match" ]; then
      echo "$exact_match"
    elif [ ${#partial_matches[@]} -eq 1 ]; then
      echo "${partial_matches[0]}"
    elif [ ${#partial_matches[@]} -gt 1 ]; then
      local matches_list
      matches_list=$(printf ', %s' "${partial_matches[@]}")
      matches_list="${matches_list:2}"
      echo "Multiple changes match \"$override\": $matches_list." >&2
      return 1
    else
      echo "No change matches \"$override\"." >&2
      return 1
    fi
  else
    # --- Default mode: read fab/current ---
    local current_file="$FAB_ROOT/current"
    local name=""
    if [ -f "$current_file" ]; then
      name=$(tr -d '[:space:]' < "$current_file")
    fi

    if [ -n "$name" ]; then
      echo "$name"
      return 0
    fi

    # fab/current missing or empty — attempt single-change guess
    local candidates=()
    if [ -d "$changes_dir" ]; then
      local d base
      for d in "$changes_dir"/*/; do
        [ -d "$d" ] || continue
        base="$(basename "$d")"
        [ "$base" = "archive" ] && continue
        [ -f "$d/.status.yaml" ] || continue
        candidates+=("$base")
      done
    fi

    if [ ${#candidates[@]} -eq 1 ]; then
      echo "(resolved from single active change)" >&2
      echo "${candidates[0]}"
    elif [ ${#candidates[@]} -eq 0 ]; then
      echo "No active change." >&2
      return 1
    else
      echo "No active change (multiple changes exist — use /fab-switch)." >&2
      return 1
    fi
  fi
}

# extract_id <folder_name> — Extract 4-char change ID from YYMMDD-XXXX-slug format.
extract_id() {
  echo "$1" | cut -d'-' -f2
}

# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

show_help() {
  cat <<'EOF'
resolve.sh - Change Resolver (pure query, no side effects)

USAGE:
  resolve.sh [--id|--folder|--dir|--status] [<change>]
  resolve.sh --help

OUTPUT FLAGS (mutually exclusive):
  --id       4-char change ID (default)
  --folder   Full folder name
  --dir      Directory path (repo-root-relative)
  --status   .status.yaml path (repo-root-relative)

ARGS:
  <change>   Optional. 4-char ID, folder name substring, or full folder name.
             If omitted, reads fab/current (or guesses if single change).

EXAMPLES:
  resolve.sh 9fg2                   → 9fg2
  resolve.sh --folder 9fg2          → 260228-9fg2-refactor-kit-scripts
  resolve.sh --dir refactor-kit     → fab/changes/260228-9fg2-refactor-kit-scripts/
  resolve.sh --status               → fab/changes/{active}/.status.yaml
EOF
}

# Parse arguments
output_mode="id"
change_arg=""

while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h) show_help; exit 0 ;;
    --id)      output_mode="id"; shift ;;
    --folder)  output_mode="folder"; shift ;;
    --dir)     output_mode="dir"; shift ;;
    --status)  output_mode="status"; shift ;;
    *)         change_arg="$1"; shift ;;
  esac
done

# Resolve to folder name
folder=$(resolve_to_folder "$change_arg") || exit 1

# Format output
case "$output_mode" in
  id)     extract_id "$folder" ;;
  folder) echo "$folder" ;;
  dir)    echo "fab/changes/${folder}/" ;;
  status) echo "fab/changes/${folder}/.status.yaml" ;;
esac
