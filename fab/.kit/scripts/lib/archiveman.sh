#!/usr/bin/env bash
# fab/.kit/scripts/lib/archiveman.sh
#
# Archive Manager — CLI utility for archive/restore lifecycle operations.
# Supports `archive`, `restore`, `list` subcommands.
#
# Usage:
#   archiveman.sh archive <change> --description "..."
#   archiveman.sh restore <change> [--switch]
#   archiveman.sh list
#   archiveman.sh --help

set -euo pipefail
# Path resolution
LIB_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
FAB_ROOT="$(cd "$LIB_DIR/../../.." && pwd)"
RESOLVE="$LIB_DIR/resolve.sh"
CHANGEMAN="$LIB_DIR/changeman.sh"

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

# parse_date_bucket <folder-name> — Extract yyyy and mm from YYMMDD prefix.
# Outputs "yyyy mm" on stdout.
parse_date_bucket() {
  local name="$1"
  if [[ ! "$name" =~ ^[0-9]{6} ]]; then
    echo "ERROR: invalid folder name '$name': expected YYMMDD prefix" >&2
    return 1
  fi
  local yy="${name:0:2}"
  local mm="${name:2:2}"
  echo "20${yy}" "$mm"
}

# Globals: set by resolve_archive for the caller to read
_ARCHIVE_RESOLVED_NAME=""
_ARCHIVE_RESOLVED_DIR=""

# resolve_archive <override> — Resolve a change reference against fab/changes/archive/.
# Same logic as resolve.sh but scans archive/ instead of changes/.
resolve_archive() {
  _ARCHIVE_RESOLVED_NAME=""
  _ARCHIVE_RESOLVED_DIR=""

  local override="${1:-}"
  local archive_dir="$FAB_ROOT/changes/archive"

  if [ -z "$override" ]; then
    echo "ERROR: <change> argument is required for restore" >&2
    return 1
  fi

  if [ ! -d "$archive_dir" ]; then
    echo "No archive folder found." >&2
    return 1
  fi

  # Collect archive folder names from both flat and nested (yyyy/mm/) entries
  local folders=()
  local folder_dirs=()
  local d base

  # Flat entries: archive/{name}/ (skip year directories)
  for d in "$archive_dir"/*/; do
    [ -d "$d" ] || continue
    base="$(basename "$d")"
    [[ "$base" =~ ^[0-9]{4}$ ]] && continue
    folders+=("$base")
    folder_dirs+=("$d")
  done

  # Nested entries: archive/yyyy/mm/{name}/
  for d in "$archive_dir"/*/*/*/; do
    [ -d "$d" ] || continue
    base="$(basename "$d")"
    folders+=("$base")
    folder_dirs+=("$d")
  done

  if [ ${#folders[@]} -eq 0 ]; then
    echo "No archived changes found." >&2
    return 1
  fi

  # Case-insensitive matching
  local override_lower
  override_lower=$(echo "$override" | tr '[:upper:]' '[:lower:]')
  local exact_match="" exact_match_dir=""
  local partial_matches=() partial_match_dirs=()

  local i folder folder_lower
  for i in "${!folders[@]}"; do
    folder="${folders[$i]}"
    folder_lower=$(echo "$folder" | tr '[:upper:]' '[:lower:]')
    if [ "$folder_lower" = "$override_lower" ]; then
      exact_match="$folder"
      exact_match_dir="${folder_dirs[$i]}"
      break
    elif [[ "$folder_lower" == *"$override_lower"* ]]; then
      partial_matches+=("$folder")
      partial_match_dirs+=("${folder_dirs[$i]}")
    fi
  done

  if [ -n "$exact_match" ]; then
    _ARCHIVE_RESOLVED_NAME="$exact_match"
    _ARCHIVE_RESOLVED_DIR="$exact_match_dir"
  elif [ ${#partial_matches[@]} -eq 1 ]; then
    _ARCHIVE_RESOLVED_NAME="${partial_matches[0]}"
    _ARCHIVE_RESOLVED_DIR="${partial_match_dirs[0]}"
  elif [ ${#partial_matches[@]} -gt 1 ]; then
    local matches_list
    matches_list=$(printf ', %s' "${partial_matches[@]}")
    matches_list="${matches_list:2}"
    echo "Multiple archives match \"$override\": $matches_list." >&2
    return 1
  else
    echo "No archive matches \"$override\"." >&2
    return 1
  fi
}

# backfill_index <archive_dir> <index_file> — Add entries for archived folders missing from index.
backfill_index() {
  local archive_dir="$1" index_file="$2"
  local d base

  # Flat entries (pre-migration)
  for d in "$archive_dir"/*/; do
    [ -d "$d" ] || continue
    base="$(basename "$d")"
    [[ "$base" =~ ^[0-9]{4}$ ]] && continue
    if ! grep -qF "**${base}**" "$index_file" 2>/dev/null; then
      echo "- **${base}** — (no description — pre-index archive)" >> "$index_file"
    fi
  done

  # Nested entries
  for d in "$archive_dir"/*/*/*/; do
    [ -d "$d" ] || continue
    base="$(basename "$d")"
    if ! grep -qF "**${base}**" "$index_file" 2>/dev/null; then
      echo "- **${base}** — (no description — pre-index archive)" >> "$index_file"
    fi
  done
}

# ─────────────────────────────────────────────────────────────────────────────
# archive subcommand
# ─────────────────────────────────────────────────────────────────────────────

cmd_archive() {
  local change_arg="" description=""

  # Parse arguments
  while [ $# -gt 0 ]; do
    case "$1" in
      --description)
        [ $# -lt 2 ] && { echo "ERROR: --description requires a value" >&2; exit 1; }
        description="$2"; shift 2 ;;
      *)
        if [ -z "$change_arg" ]; then
          change_arg="$1"; shift
        else
          echo "ERROR: Unknown flag '$1'" >&2; exit 1
        fi
        ;;
    esac
  done

  if [ -z "$change_arg" ]; then
    echo "ERROR: <change> argument is required for archive" >&2
    exit 1
  fi

  if [ -z "$description" ]; then
    echo "ERROR: --description is required for archive" >&2
    exit 1
  fi

  # Resolve change via standard resolve.sh (scans active changes)
  local folder
  folder=$("$RESOLVE" --folder "$change_arg") || exit 1

  local changes_dir="$FAB_ROOT/changes"
  local archive_dir="$changes_dir/archive"
  local change_dir="$changes_dir/$folder"

  # 1. Clean: delete .pr-done if present
  local clean_status="not_present"
  if [ -f "$change_dir/.pr-done" ]; then
    rm "$change_dir/.pr-done"
    clean_status="removed"
  fi

  # 2. Move: change folder → archive/yyyy/mm/
  local bucket_year bucket_month
  read -r bucket_year bucket_month <<< "$(parse_date_bucket "$folder")"
  local dest_dir="$archive_dir/$bucket_year/$bucket_month"
  mkdir -p "$dest_dir"
  if [ -e "$dest_dir/$folder" ]; then
    echo "ERROR: Archive destination already exists: $dest_dir/$folder" >&2
    exit 1
  fi
  mv "$change_dir" "$dest_dir/$folder"
  local move_status="moved"

  # 3. Index: update archive/index.md
  local index_file="$archive_dir/index.md"
  local index_status
  if [ ! -f "$index_file" ]; then
    printf '# Archive Index\n\n' > "$index_file"
    index_status="created"
  else
    index_status="updated"
  fi

  # Normalize description to single line (strip newlines/tabs)
  local normalized_desc
  normalized_desc=$(printf '%s' "$description" | tr '\n\r\t' '   ' | sed 's/  */ /g; s/^ //; s/ $//')

  # Prepend new entry after the header (line 1 = header, line 2 = blank)
  local new_entry="- **${folder}** — ${normalized_desc}"
  local tmp_file
  tmp_file=$(mktemp)
  # Keep header + blank line, insert new entry, then rest of file
  head -n 2 "$index_file" > "$tmp_file"
  echo "$new_entry" >> "$tmp_file"
  tail -n +3 "$index_file" >> "$tmp_file"
  mv "$tmp_file" "$index_file"

  # Backfill: add entries for any unindexed archived folders
  backfill_index "$archive_dir" "$index_file"

  # 4. Pointer: clear if active change matches
  local pointer_status="skipped"
  local active_folder
  active_folder=$("$CHANGEMAN" resolve 2>/dev/null) || active_folder=""
  if [ "$active_folder" = "$folder" ]; then
    "$CHANGEMAN" switch --blank > /dev/null
    pointer_status="cleared"
  fi

  # Output YAML
  cat <<YAML
action: archive
name: $folder
clean: $clean_status
move: $move_status
index: $index_status
pointer: $pointer_status
YAML
}

# ─────────────────────────────────────────────────────────────────────────────
# restore subcommand
# ─────────────────────────────────────────────────────────────────────────────

cmd_restore() {
  local change_arg="" do_switch=false

  # Parse arguments
  while [ $# -gt 0 ]; do
    case "$1" in
      --switch) do_switch=true; shift ;;
      *)
        if [ -z "$change_arg" ]; then
          change_arg="$1"; shift
        else
          echo "ERROR: Unknown flag '$1'" >&2; exit 1
        fi
        ;;
    esac
  done

  if [ -z "$change_arg" ]; then
    echo "ERROR: <change> argument is required for restore" >&2
    exit 1
  fi

  # Resolve against archive folder (called directly, not in subshell, to preserve globals)
  resolve_archive "$change_arg" || exit 1
  local folder="$_ARCHIVE_RESOLVED_NAME"

  local changes_dir="$FAB_ROOT/changes"
  local archive_dir="$changes_dir/archive"

  # 1. Move: archive/{yyyy/mm/}folder → changes/
  local move_status
  if [ -d "$changes_dir/$folder" ]; then
    move_status="already_in_changes"
  else
    mv "$_ARCHIVE_RESOLVED_DIR" "$changes_dir/$folder"
    move_status="restored"
  fi

  # 2. Index: remove entry from archive/index.md
  local index_file="$archive_dir/index.md"
  local index_status="not_found"
  if [ -f "$index_file" ] && grep -qF "**${folder}**" "$index_file"; then
    local tmp_file
    tmp_file=$(mktemp)
    grep -vF "**${folder}**" "$index_file" > "$tmp_file"
    mv "$tmp_file" "$index_file"
    index_status="removed"
  fi

  # 3. Pointer: optionally activate via changeman switch
  local pointer_status="skipped"
  if [ "$do_switch" = true ]; then
    "$CHANGEMAN" switch "$folder" > /dev/null
    pointer_status="switched"
  fi

  # Output YAML
  cat <<YAML
action: restore
name: $folder
move: $move_status
index: $index_status
pointer: $pointer_status
YAML
}

# ─────────────────────────────────────────────────────────────────────────────
# list subcommand
# ─────────────────────────────────────────────────────────────────────────────

cmd_list() {
  local archive_dir="$FAB_ROOT/changes/archive"

  if [ ! -d "$archive_dir" ]; then
    return 0
  fi

  local d base

  # Flat entries (pre-migration): archive/{name}/
  for d in "$archive_dir"/*/; do
    [ -d "$d" ] || continue
    base="$(basename "$d")"
    [[ "$base" =~ ^[0-9]{4}$ ]] && continue
    echo "$base"
  done

  # Nested entries: archive/yyyy/mm/{name}/
  for d in "$archive_dir"/*/*/*/; do
    [ -d "$d" ] || continue
    base="$(basename "$d")"
    echo "$base"
  done
}

# ─────────────────────────────────────────────────────────────────────────────
# Help
# ─────────────────────────────────────────────────────────────────────────────

show_help() {
  cat <<'EOF'
archiveman.sh - Archive Manager CLI

USAGE:
  archiveman.sh archive <change> --description "..."
  archiveman.sh restore <change> [--switch]
  archiveman.sh list
  archiveman.sh --help

SUBCOMMANDS:
  archive   Archive a change: clean .pr-done, move to archive/yyyy/mm/, update index, clear pointer
  restore   Restore an archived change: move back, remove index entry, optionally activate
  list      List archived change folder names (one per line)

FLAGS (for archive):
  --description "..."  Required. Description text for the archive index entry.

FLAGS (for restore):
  --switch   Activate the restored change via changeman switch.

ARGS:
  <change>   Change name, substring, or 4-char ID.
             archive: resolved against fab/changes/ (active changes).
             restore: resolved against fab/changes/archive/ (archived changes).

EXAMPLES:
  archiveman.sh archive hcq9 --description "Offloaded archive to shell script"
  archiveman.sh restore hcq9 --switch
  archiveman.sh list
EOF
}

# ─────────────────────────────────────────────────────────────────────────────
# CLI Dispatch
# ─────────────────────────────────────────────────────────────────────────────

case "${1:-}" in
  --help|-h)
    show_help
    ;;
  archive)
    shift
    cmd_archive "$@"
    ;;
  restore)
    shift
    cmd_restore "$@"
    ;;
  list)
    shift
    cmd_list "$@"
    ;;
  "")
    echo "ERROR: No subcommand provided. Try: archiveman.sh --help" >&2
    exit 1
    ;;
  *)
    echo "ERROR: Unknown subcommand '$1'. Try: archiveman.sh --help" >&2
    exit 1
    ;;
esac
