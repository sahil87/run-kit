#!/usr/bin/env bash
# fab/.kit/scripts/lib/changeman.sh
#
# Change Manager — CLI utility for change lifecycle operations.
# Supports `list`, `new`, `rename`, `resolve`, and `switch` subcommands.
#
# Usage:
#   changeman.sh new --slug <slug> [--change-id <4char>] [--log-args <description>]
#   changeman.sh rename --folder <current-folder> --slug <new-slug>
#   changeman.sh resolve [<override>]
#   changeman.sh switch <name> | --blank
#   changeman.sh list [--archive]
#   changeman.sh --help

set -euo pipefail
# Path resolution
LIB_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
FAB_ROOT="$(cd "$LIB_DIR/../../.." && pwd)"
STATUSMAN="$LIB_DIR/statusman.sh"
RESOLVE="$LIB_DIR/resolve.sh"
LOGMAN="$LIB_DIR/logman.sh"

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

# detect_created_by — gh api → git config → "unknown" (silent failures)
detect_created_by() {
  local user
  user=$(gh api user --jq .login 2>/dev/null) && [ -n "$user" ] && echo "$user" && return 0
  user=$(git config user.name 2>/dev/null) && [ -n "$user" ] && echo "$user" && return 0
  echo "unknown"
}

# generate_random_id — 4 chars from [a-z0-9] via /dev/urandom
# Reads 128 bytes then filters, avoiding SIGPIPE from tr|head with pipefail.
generate_random_id() {
  local raw
  raw=$(head -c128 /dev/urandom | LC_ALL=C tr -dc 'a-z0-9')
  echo "${raw:0:4}"
}

# has_id_collision <changes_dir> <change_id> — check if any folder uses this ID
# Returns 0 (true) if collision exists, 1 (false) if no collision.
has_id_collision() {
  local changes_dir="$1" change_id="$2"
  for dir in "$changes_dir"/??????-"${change_id}"-*; do
    [ -d "$dir" ] && return 0
  done
  return 1
}

# ─────────────────────────────────────────────────────────────────────────────
# resolve subcommand
# ─────────────────────────────────────────────────────────────────────────────

# cmd_resolve — passthrough to resolve.sh --folder for backward compatibility
cmd_resolve() {
  "$RESOLVE" --folder "$@"
}

# ─────────────────────────────────────────────────────────────────────────────
# list subcommand
# ─────────────────────────────────────────────────────────────────────────────

cmd_list() {
  local archive=false

  # Parse arguments
  while [ $# -gt 0 ]; do
    case "$1" in
      --archive) archive=true; shift ;;
      *) echo "ERROR: Unknown flag '$1'" >&2; exit 1 ;;
    esac
  done

  # Determine scan directory
  local scan_dir
  if [ "$archive" = true ]; then
    scan_dir="$FAB_ROOT/changes/archive"
  else
    scan_dir="$FAB_ROOT/changes"
  fi

  if [ ! -d "$scan_dir" ]; then
    if [ "$archive" = true ]; then
      # No archive directory is a valid empty state
      return 0
    else
      echo "fab/changes/ not found." >&2
      return 1
    fi
  fi

  # Enumerate change directories
  local d base status_file display_output display_stage display_state
  local dirs=()

  if [ "$archive" = true ]; then
    # Flat entries (pre-migration): archive/{name}/
    for d in "$scan_dir"/*/; do
      [ -d "$d" ] || continue
      base="$(basename "$d")"
      [[ "$base" =~ ^[0-9]{4}$ ]] && continue
      dirs+=("$d")
    done
    # Nested entries: archive/yyyy/mm/{name}/
    for d in "$scan_dir"/*/*/*/; do
      [ -d "$d" ] || continue
      dirs+=("$d")
    done
  else
    for d in "$scan_dir"/*/; do
      [ -d "$d" ] || continue
      base="$(basename "$d")"
      # Skip archive/ when listing active changes
      [ "$base" = "archive" ] && continue
      dirs+=("$d")
    done
  fi

  for d in "${dirs[@]}"; do
    base="$(basename "$d")"

    status_file="$d/.status.yaml"
    if [ ! -f "$status_file" ]; then
      echo "$base:unknown:unknown"
      echo "Warning: .status.yaml not found for $base" >&2
      continue
    fi

    display_output=$("$STATUSMAN" display-stage "$status_file" 2>/dev/null) || display_output="unknown:unknown"
    display_stage="${display_output%%:*}"
    display_state="${display_output#*:}"

    # Read confidence score and indicative flag
    local conf_score="0.0" conf_indicative="false"
    local conf_output
    conf_output=$("$STATUSMAN" confidence "$status_file" 2>/dev/null) || true
    if [ -n "$conf_output" ]; then
      conf_score=$(echo "$conf_output" | grep '^score:' | cut -d: -f2)
      conf_score=${conf_score:-0.0}
      conf_indicative=$(echo "$conf_output" | grep '^indicative:' | cut -d: -f2)
      conf_indicative=${conf_indicative:-false}
    fi
    echo "$base:$display_stage:$display_state:$conf_score:$conf_indicative"
  done
}

# ─────────────────────────────────────────────────────────────────────────────
# switch subcommand
# ─────────────────────────────────────────────────────────────────────────────

# stage_number — map stage name to position (1-8)
stage_number() {
  case "$1" in
    intake) echo 1 ;; spec) echo 2 ;; tasks) echo 3 ;;
    apply) echo 4 ;; review) echo 5 ;; hydrate) echo 6 ;;
    ship) echo 7 ;; review-pr) echo 8 ;;
    *) echo "?" ;;
  esac
}

# next_stage — map current stage to the next stage in the pipeline
next_stage() {
  case "$1" in
    intake) echo "spec" ;; spec) echo "tasks" ;; tasks) echo "apply" ;;
    apply) echo "review" ;; review) echo "hydrate" ;; hydrate) echo "ship" ;;
    ship) echo "review-pr" ;; review-pr) echo "" ;;
  esac
}

# default_command — derive the default command for a routing stage
default_command() {
  case "$1" in
    intake)    echo "/fab-continue" ;;
    spec)      echo "/fab-continue" ;;
    tasks)     echo "/fab-continue" ;;
    apply)     echo "/fab-continue" ;;
    review)    echo "/fab-continue" ;;
    hydrate)   echo "/git-pr" ;;
    ship)      echo "/git-pr-review" ;;
    review-pr) echo "/fab-archive" ;;
    *)         echo "/fab-status" ;;
  esac
}

cmd_switch() {
  local name="" blank=false

  # Parse arguments
  if [ $# -eq 0 ]; then
    echo "ERROR: switch requires <name> or --blank" >&2
    exit 1
  fi

  case "$1" in
    --blank) blank=true ;;
    *)       name="$1" ;;
  esac

  # --- Deactivation flow ---
  if [ "$blank" = true ]; then
    local current_file="$FAB_ROOT/current"
    if [ ! -f "$current_file" ]; then
      echo "No active change (already blank)."
    else
      rm "$current_file"
      echo "No active change."
    fi
    return 0
  fi

  # --- Normal switch flow ---

  # 1. Resolve change name
  local resolved
  resolved=$(cmd_resolve "$name") || exit 1

  # 2. Write fab/current (two-line format: ID on line 1, folder name on line 2)
  local change_id
  change_id=$(echo "$resolved" | cut -d'-' -f2)
  printf '%s\n%s' "$change_id" "$resolved" > "$FAB_ROOT/current"

  # 3. Derive display stage and routing stage
  local display_stage="unknown" display_state="pending" routing_stage="unknown"
  local status_file="$FAB_ROOT/changes/$resolved/.status.yaml"
  if [ -f "$status_file" ]; then
    local display_output
    display_output=$("$STATUSMAN" display-stage "$status_file" 2>/dev/null) || display_output="unknown:pending"
    display_stage="${display_output%%:*}"
    display_state="${display_output#*:}"
    routing_stage=$("$STATUSMAN" current-stage "$status_file" 2>/dev/null) || routing_stage="unknown"
  fi

  local dnum
  dnum=$(stage_number "$display_stage")

  # 4. Read confidence
  local conf_score="0.0" conf_indicative="false" conf_certain=0 conf_confident=0 conf_tentative=0 conf_unresolved=0
  if [ -f "$status_file" ]; then
    local conf_output
    conf_output=$("$STATUSMAN" confidence "$status_file" 2>/dev/null) || true
    if [ -n "$conf_output" ]; then
      conf_score=$(echo "$conf_output" | grep '^score:' | cut -d: -f2)
      conf_score=${conf_score:-0.0}
      conf_indicative=$(echo "$conf_output" | grep '^indicative:' | cut -d: -f2)
      conf_indicative=${conf_indicative:-false}
      conf_certain=$(echo "$conf_output" | grep '^certain:' | cut -d: -f2)
      conf_certain=${conf_certain:-0}
      conf_confident=$(echo "$conf_output" | grep '^confident:' | cut -d: -f2)
      conf_confident=${conf_confident:-0}
      conf_tentative=$(echo "$conf_output" | grep '^tentative:' | cut -d: -f2)
      conf_tentative=${conf_tentative:-0}
      conf_unresolved=$(echo "$conf_output" | grep '^unresolved:' | cut -d: -f2)
      conf_unresolved=${conf_unresolved:-0}
    fi
  fi

  # Derive confidence display
  local conf_display
  local total_counts=$((conf_certain + conf_confident + conf_tentative + conf_unresolved))
  local score_is_zero
  score_is_zero=$(awk "BEGIN { print ($conf_score + 0 == 0) ? 1 : 0 }")
  if [ "$score_is_zero" = "1" ] && [ "$total_counts" -eq 0 ]; then
    conf_display="not yet scored"
  elif [ "$conf_indicative" = "true" ]; then
    conf_display="$conf_score of 5.0 (indicative)"
  else
    conf_display="$conf_score of 5.0"
  fi

  # 5. Output summary
  echo "fab/current → $resolved"
  echo ""
  echo "Stage:       $display_stage ($dnum/8) — $display_state"
  echo "Confidence:  $conf_display"
  local cmd nstage
  cmd=$(default_command "$routing_stage")
  nstage=$(next_stage "$routing_stage")
  if [ -n "$nstage" ]; then
    echo "Next:        $nstage (via $cmd)"
  else
    echo "Next:        $cmd"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# new subcommand
# ─────────────────────────────────────────────────────────────────────────────

cmd_new() {
  local slug="" change_id="" log_args=""
  local id_provided=false

  # Parse arguments
  while [ $# -gt 0 ]; do
    case "$1" in
      --slug)
        [ $# -lt 2 ] && { echo "ERROR: --slug requires a value" >&2; exit 1; }
        slug="$2"; shift 2 ;;
      --change-id)
        [ $# -lt 2 ] && { echo "ERROR: --change-id requires a value" >&2; exit 1; }
        change_id="$2"; id_provided=true; shift 2 ;;
      --log-args)
        [ $# -lt 2 ] && { echo "ERROR: --log-args requires a value" >&2; exit 1; }
        log_args="$2"; shift 2 ;;
      *)
        echo "ERROR: Unknown flag '$1'" >&2; exit 1 ;;
    esac
  done

  # Validate required --slug
  if [ -z "$slug" ]; then
    echo "ERROR: --slug is required" >&2
    exit 1
  fi

  # Validate slug format: alphanumeric start/end, hyphens allowed in middle
  if ! [[ "$slug" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$ ]]; then
    echo "ERROR: Invalid slug format '${slug}' (expected alphanumeric and hyphens, no leading/trailing hyphen)" >&2
    exit 1
  fi

  # Validate --change-id if provided
  if [ "$id_provided" = true ]; then
    if ! [[ "$change_id" =~ ^[a-z0-9]{4}$ ]]; then
      echo "ERROR: Invalid change-id '${change_id}' (expected 4 lowercase alphanumeric chars)" >&2
      exit 1
    fi
  fi

  # Generate date prefix
  local date_prefix
  date_prefix=$(date +%y%m%d)

  # Generate or use provided change ID, with collision detection
  local changes_dir="$FAB_ROOT/changes"
  local folder_name=""
  local max_retries=10

  if [ "$id_provided" = true ]; then
    folder_name="${date_prefix}-${change_id}-${slug}"
    # Provided ID collision is fatal — check any folder using this ID
    if has_id_collision "$changes_dir" "$change_id"; then
      local existing
      for dir in "$changes_dir"/??????-"${change_id}"-*; do
        [ -d "$dir" ] && existing=$(basename "$dir") && break
      done
      echo "ERROR: Change ID '${change_id}' already in use (${existing})" >&2
      exit 1
    fi
  else
    # Random ID with retry
    local attempt=0
    while [ $attempt -lt $max_retries ]; do
      change_id=$(generate_random_id)
      has_id_collision "$changes_dir" "$change_id" || break
      attempt=$((attempt + 1))
    done
    if [ $attempt -ge $max_retries ]; then
      echo "ERROR: Failed to generate unique change ID after ${max_retries} attempts" >&2
      exit 1
    fi
    folder_name="${date_prefix}-${change_id}-${slug}"
  fi

  # Create directory (plain mkdir — parent guaranteed by fab-sync.sh)
  mkdir "$changes_dir/$folder_name"

  # Detect created_by
  local created_by
  created_by=$(detect_created_by)

  # Initialize .status.yaml from template via sed
  local template="$FAB_ROOT/.kit/templates/status.yaml"
  local status_file="$changes_dir/$folder_name/.status.yaml"
  local now
  now=$(date -Iseconds)

  sed -e "s|{NAME}|${folder_name}|g" \
      -e "s|{CREATED}|${now}|g" \
      -e "s|{CREATED_BY}|${created_by}|g" \
      "$template" > "$status_file"

  # Stage transition: start intake
  "$STATUSMAN" start "$status_file" intake fab-new

  if [ -n "$log_args" ]; then
    "$LOGMAN" command "fab-new" "$folder_name" "$log_args"
  fi

  # Output: folder name only (one line to stdout)
  echo "$folder_name"
}

# ─────────────────────────────────────────────────────────────────────────────
# rename subcommand
# ─────────────────────────────────────────────────────────────────────────────

cmd_rename() {
  local folder="" slug=""

  # Parse arguments
  while [ $# -gt 0 ]; do
    case "$1" in
      --folder)
        [ $# -lt 2 ] && { echo "ERROR: --folder requires a value" >&2; exit 1; }
        folder="$2"; shift 2 ;;
      --slug)
        [ $# -lt 2 ] && { echo "ERROR: --slug requires a value" >&2; exit 1; }
        slug="$2"; shift 2 ;;
      *)
        echo "ERROR: Unknown flag '$1'" >&2; exit 1 ;;
    esac
  done

  # Validate required flags
  if [ -z "$folder" ]; then
    echo "ERROR: --folder is required" >&2
    exit 1
  fi
  if [ -z "$slug" ]; then
    echo "ERROR: --slug is required" >&2
    exit 1
  fi

  # Validate slug format (same regex as new)
  if ! [[ "$slug" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$ ]]; then
    echo "ERROR: Invalid slug format '${slug}' (expected alphanumeric and hyphens, no leading/trailing hyphen)" >&2
    exit 1
  fi

  local changes_dir="$FAB_ROOT/changes"

  # Verify source folder exists
  if [ ! -d "$changes_dir/$folder" ]; then
    echo "ERROR: Change folder '${folder}' not found" >&2
    exit 1
  fi

  # Extract {YYMMDD}-{XXXX} prefix (first two hyphen-separated segments)
  local prefix
  prefix=$(echo "$folder" | cut -d'-' -f1-2)

  # Construct new folder name
  local new_name="${prefix}-${slug}"

  # Check same-name
  if [ "$new_name" = "$folder" ]; then
    echo "ERROR: New name is the same as current name" >&2
    exit 1
  fi

  # Check destination collision
  if [ -d "$changes_dir/$new_name" ]; then
    echo "ERROR: Folder '${new_name}' already exists" >&2
    exit 1
  fi

  # Rename folder
  mv "$changes_dir/$folder" "$changes_dir/$new_name"

  # Update .status.yaml name field
  yq -i ".name = \"${new_name}\"" "$changes_dir/$new_name/.status.yaml"

  # Update fab/current if it points to the old folder (two-line format)
  local current_file="$FAB_ROOT/current"
  if [ -f "$current_file" ]; then
    local current_folder
    current_folder=$(sed -n '2p' "$current_file" | tr -d '[:space:]')
    if [ "$current_folder" = "$folder" ]; then
      # Line 1 (ID) stays the same — prefix is immutable across renames
      local current_id
      current_id=$(sed -n '1p' "$current_file" | tr -d '[:space:]')
      printf '%s\n%s' "$current_id" "$new_name" > "$current_file"
    fi
  fi

  # Log the rename
  "$LOGMAN" command "changeman-rename" "$new_name" "--folder $folder --slug $slug"

  # Output: new folder name
  echo "$new_name"
}

# ─────────────────────────────────────────────────────────────────────────────
# Help
# ─────────────────────────────────────────────────────────────────────────────

show_help() {
  cat <<'EOF'
changeman.sh - Change Manager CLI

USAGE:
  changeman.sh new --slug <slug> [--change-id <4char>] [--log-args <description>]
  changeman.sh rename --folder <current-folder> --slug <new-slug>
  changeman.sh resolve [<override>]
  changeman.sh switch <name> | --blank
  changeman.sh list [--archive]
  changeman.sh --help

SUBCOMMANDS:
  new      Create a new change directory with initialized .status.yaml
  rename   Rename an existing change folder's slug (preserves date-ID prefix)
  resolve  Resolve a change name from override or fab/current
  switch   Switch the active change (resolve + write pointer)
  list     List active changes with stage and state (or archived with --archive)

FLAGS (for new):
  --slug <slug>            Required. Folder name suffix (e.g., "add-oauth" or "DEV-988-add-oauth")
  --change-id <4char>      Optional. Explicit 4-char alphanumeric ID. Random if omitted.
  --log-args <description> Optional. Description logged via logman command.

FLAGS (for rename):
  --folder <current-folder> Required. Full current change folder name.
  --slug <new-slug>         Required. New slug to replace the current slug portion.

ARGS (for resolve):
  <override>  Optional. Full or partial change name (case-insensitive substring).
              If omitted, reads fab/current.

ARGS (for switch):
  <name>      Change name or partial match to switch to.
  --blank     Deactivate the current change (delete fab/current).

FLAGS (for list):
  --archive   List archived changes instead of active ones.

OUTPUT:
  On success: prints result to stdout.
  On error: prints diagnostic message to stderr, exits non-zero.

EXAMPLES:
  changeman.sh new --slug add-oauth
  changeman.sh new --slug DEV-988-add-oauth --change-id a7k2 --log-args "Add OAuth"
  changeman.sh rename --folder 260216-u6d5-old-slug --slug new-slug
  changeman.sh resolve a7k2
  changeman.sh resolve
  changeman.sh list
  changeman.sh list --archive
  changeman.sh switch a7k2
  changeman.sh switch --blank
EOF
}

# ─────────────────────────────────────────────────────────────────────────────
# CLI Dispatch
# ─────────────────────────────────────────────────────────────────────────────

case "${1:-}" in
  --help|-h)
    show_help
    ;;
  new)
    shift
    cmd_new "$@"
    ;;
  rename)
    shift
    cmd_rename "$@"
    ;;
  resolve)
    shift
    cmd_resolve "$@"
    ;;
  switch)
    shift
    cmd_switch "$@"
    ;;
  list)
    shift
    cmd_list "$@"
    ;;
  "")
    echo "ERROR: No subcommand provided. Try: changeman.sh --help" >&2
    exit 1
    ;;
  *)
    echo "ERROR: Unknown subcommand '$1'. Try: changeman.sh --help" >&2
    exit 1
    ;;
esac
