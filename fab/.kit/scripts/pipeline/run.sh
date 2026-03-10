#!/usr/bin/env bash
set -euo pipefail

# fab/.kit/scripts/pipeline/run.sh — Pipeline orchestrator
#
# Usage: run.sh <manifest-path>
#
# Reads a YAML pipeline manifest and dispatches changes in dependency order.
# By default, exits when all changes are terminal (done/failed/invalid).
# Set watch: true in the manifest for infinite-loop mode (live editing).
#
# Requires: yq, wt, claude CLI

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
FAB_DIR="$(dirname "$KIT_DIR")"
CONFIG_FILE="${FAB_DIR}/project/config.yaml"
DISPATCH="$SCRIPT_DIR/dispatch.sh"
FAB_BIN="$KIT_DIR/bin/fab"
POLL_INTERVAL="${PIPELINE_POLL_INTERVAL:-30}"

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------

usage() {
  cat <<'EOF'
Usage: run.sh <manifest-path>

Pipeline orchestrator — dispatches fab changes in dependency order.

Reads the manifest on every iteration. Exits when all changes are
terminal. Set watch: true in manifest for infinite loop mode.

Arguments:
  manifest-path   Path to the pipeline manifest YAML file

Environment:
  PIPELINE_POLL_INTERVAL   Seconds between idle polls (default: 30)

Example:
  fab/.kit/scripts/pipeline/run.sh fab/pipelines/my-feature.yaml
EOF
}

# Argument parsing is deferred to the source guard at the bottom of the file.
# When sourced for testing, functions are available without requiring arguments.

# ---------------------------------------------------------------------------
# State tracking
# ---------------------------------------------------------------------------

declare -A WORKTREE_PATHS  # change-id → worktree path
declare -A PANE_IDS        # change-id → tmux pane ID
CURRENT_DISPATCH=""        # change-id being dispatched (for SIGINT summary)
LAST_PANE_ID=""            # last created pane (for stacking)
LOG_FILE=""                # dispatch output log file path

# Configurable timeouts (seconds)
PIPELINE_FF_TIMEOUT="${PIPELINE_FF_TIMEOUT:-1800}"   # 30 minutes
PIPELINE_SHIP_TIMEOUT="${PIPELINE_SHIP_TIMEOUT:-300}" # 5 minutes
PIPELINE_SHIP_DELAY="${PIPELINE_SHIP_DELAY:-8}"      # wait after hydrate:done before sending ship

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

log() {
  echo "$*"
}

write_stage() {
  local id="$1" stage="$2" manifest="$3"
  yq -i "(.changes[] | select(.id == \"$id\")).stage = \"$stage\"" "$manifest"
}

# ---------------------------------------------------------------------------
# Manifest Parsing & Validation
# ---------------------------------------------------------------------------

validate_manifest() {
  local manifest="$1"

  # Resolve base field — default to current branch if missing/empty
  local base
  base=$(yq -r '.base // ""' "$manifest")
  if [[ -z "$base" || "$base" == "null" ]]; then
    base=$(git branch --show-current 2>/dev/null || true)
    if [[ -z "$base" ]]; then
      base="main"
    fi
    # Write the resolved base back so get_parent_branch() reads it consistently
    yq -i ".base = \"$base\"" "$manifest"
  fi

  # Check changes list exists
  local count
  count=$(yq '.changes | length' "$manifest")
  if [[ "$count" -eq 0 ]]; then
    echo "Error: manifest has no changes" >&2
    return 1
  fi

  # Check each entry has required fields
  local i id deps_count
  for ((i = 0; i < count; i++)); do
    id=$(yq -r ".changes[$i].id // \"\"" "$manifest")
    if [[ -z "$id" || "$id" == "null" ]]; then
      echo "Error: changes[$i] missing 'id' field" >&2
      return 1
    fi

    # depends_on must exist (can be empty list)
    local has_deps
    has_deps=$(yq ".changes[$i] | has(\"depends_on\")" "$manifest")
    if [[ "$has_deps" != "true" ]]; then
      echo "Error: changes[$i] ($id) missing 'depends_on' field" >&2
      return 1
    fi

    # Single-dependency constraint — mark invalid but don't reject manifest
    deps_count=$(yq ".changes[$i].depends_on | length" "$manifest")
    if [[ "$deps_count" -gt 1 ]]; then
      local current_stage
      current_stage=$(yq -r "(.changes[$i]).stage // \"\"" "$manifest")
      if [[ -z "$current_stage" || "$current_stage" == "null" ]]; then
        echo "[pipeline] Multi-parent dependency not supported in v1: $id depends on $deps_count changes. Merge parent branches manually." >&2
        yq -i "(.changes[$i]).stage = \"invalid\"" "$manifest"
      fi
    fi
  done

  # Validate depends_on references exist
  local all_ids dep
  all_ids=$(yq -r '.changes[].id' "$manifest")
  for ((i = 0; i < count; i++)); do
    deps_count=$(yq ".changes[$i].depends_on | length" "$manifest")
    if [[ "$deps_count" -gt 0 ]]; then
      dep=$(yq -r ".changes[$i].depends_on[0]" "$manifest")
      if ! echo "$all_ids" | grep -qx "$dep"; then
        id=$(yq -r ".changes[$i].id" "$manifest")
        echo "Error: $id depends on $dep, which is not in the manifest" >&2
        return 1
      fi
    fi
  done

  # Circular dependency detection
  if ! detect_cycles "$manifest"; then
    return 1
  fi

  return 0
}

detect_cycles() {
  local manifest="$1"
  local count
  count=$(yq '.changes | length' "$manifest")

  # Build adjacency and run DFS
  declare -A visited  # 0=unvisited, 1=in-progress, 2=done
  local i id

  for ((i = 0; i < count; i++)); do
    id=$(yq -r ".changes[$i].id" "$manifest")
    visited["$id"]=0
  done

  for id in "${!visited[@]}"; do
    if [[ "${visited[$id]}" -eq 0 ]]; then
      if ! dfs_visit "$manifest" "$id"; then
        return 1
      fi
    fi
  done
  return 0
}

dfs_visit() {
  local manifest="$1" id="$2"
  visited["$id"]=1  # in-progress

  local count deps_count dep i
  count=$(yq '.changes | length' "$manifest")

  for ((i = 0; i < count; i++)); do
    local entry_id
    entry_id=$(yq -r ".changes[$i].id" "$manifest")
    if [[ "$entry_id" == "$id" ]]; then
      deps_count=$(yq ".changes[$i].depends_on | length" "$manifest")
      if [[ "$deps_count" -gt 0 ]]; then
        dep=$(yq -r ".changes[$i].depends_on[0]" "$manifest")
        if [[ "${visited[$dep]:-0}" -eq 1 ]]; then
          echo "Error: Circular dependency detected: $id <-> $dep" >&2
          return 1
        elif [[ "${visited[$dep]:-0}" -eq 0 ]]; then
          if ! dfs_visit "$manifest" "$dep"; then
            return 1
          fi
        fi
      fi
      break
    fi
  done

  visited["$id"]=2  # done
  return 0
}

# ---------------------------------------------------------------------------
# Dispatch Logic
# ---------------------------------------------------------------------------

get_stage() {
  local manifest="$1" id="$2"
  yq -r "(.changes[] | select(.id == \"$id\")).stage // \"\"" "$manifest"
}

is_terminal() {
  local stage="$1"
  [[ "$stage" == "done" || "$stage" == "failed" || "$stage" == "invalid" ]]
}

is_dispatchable() {
  local manifest="$1" id="$2"
  local stage
  stage=$(get_stage "$manifest" "$id")

  # Terminal stages are never dispatchable
  if is_terminal "$stage"; then
    return 1
  fi

  # Check all dependencies are done
  local count i entry_id deps_count dep dep_stage
  count=$(yq '.changes | length' "$manifest")
  for ((i = 0; i < count; i++)); do
    entry_id=$(yq -r ".changes[$i].id" "$manifest")
    if [[ "$entry_id" == "$id" ]]; then
      deps_count=$(yq ".changes[$i].depends_on | length" "$manifest")
      if [[ "$deps_count" -gt 0 ]]; then
        dep=$(yq -r ".changes[$i].depends_on[0]" "$manifest")
        dep_stage=$(get_stage "$manifest" "$dep")
        if [[ "$dep_stage" != "done" ]]; then
          return 1
        fi
      fi
      return 0
    fi
  done
  return 1
}

find_next_dispatchable() {
  local manifest="$1"
  local count i id
  count=$(yq '.changes | length' "$manifest")

  for ((i = 0; i < count; i++)); do
    id=$(yq -r ".changes[$i].id" "$manifest")
    if is_dispatchable "$manifest" "$id"; then
      echo "$id"
      return 0
    fi
  done
  return 1
}

all_terminal() {
  local manifest="$1"
  local count i id stage
  count=$(yq '.changes | length' "$manifest")

  for ((i = 0; i < count; i++)); do
    id=$(yq -r ".changes[$i].id" "$manifest")
    stage=$(get_stage "$manifest" "$id")
    if ! is_terminal "$stage"; then
      return 1
    fi
  done
  return 0
}

get_parent_branch() {
  local manifest="$1" id="$2"
  local count i entry_id deps_count dep
  local base
  base=$(yq -r '.base' "$manifest")

  count=$(yq '.changes | length' "$manifest")
  for ((i = 0; i < count; i++)); do
    entry_id=$(yq -r ".changes[$i].id" "$manifest")
    if [[ "$entry_id" == "$id" ]]; then
      deps_count=$(yq ".changes[$i].depends_on | length" "$manifest")
      if [[ "$deps_count" -eq 0 ]]; then
        echo "$base"
      else
        dep=$(yq -r ".changes[$i].depends_on[0]" "$manifest")
        # Resolve parent's manifest ID to full folder name for branch construction
        local resolved_dep
        resolved_dep=$("$FAB_BIN" resolve --folder "$dep" 2>/dev/null) || resolved_dep="$dep"
        local prefix=""
        if [[ -f "$CONFIG_FILE" ]] && command -v yq &>/dev/null; then
          prefix=$(yq -r '.git.branch_prefix // ""' "$CONFIG_FILE")
        fi
        echo "${prefix}${resolved_dep}"
      fi
      return 0
    fi
  done
  echo "$base"
}

# ---------------------------------------------------------------------------
# Polling Loop
# ---------------------------------------------------------------------------

# check_pane_alive <pane_id> — verify tmux pane still exists
# Mirrors dispatch.sh's helper for use in the polling loop.
check_pane_alive() {
  local pane_id="$1"
  tmux list-panes -a -F '#{pane_id}' 2>/dev/null | grep -qx "$pane_id"
}

# poll_change <manifest-id> <resolved-id> <pane-id> <wt-path> <status-file>
# State machine: polling_fab_ff → shipping → done
#                      ↓            ↓
#                    failed       failed
poll_change() {
  local manifest_id="$1"
  local resolved_id="$2"
  local pane_id="$3"
  local wt_path="$4"
  local status_file="$5"

  local state="polling_fab_ff"
  local start_time=$SECONDS
  local ship_start_time=0
  local poll_interval=5

  while true; do
    sleep "$poll_interval"

    local elapsed=$((SECONDS - start_time))
    local mins=$((elapsed / 60))
    local secs=$((elapsed % 60))

    # Check pane alive
    if ! check_pane_alive "$pane_id"; then
      printf "\n"
      log "Failed: $resolved_id — interactive pane died unexpectedly"
      write_stage "$manifest_id" "failed" "$MANIFEST"
      return 0
    fi

    # Render progress (truncate to terminal width to prevent wrap artifacts)
    local progress_line=""
    if [[ -f "$status_file" ]]; then
      progress_line=$("$FAB_BIN" status progress-line "$resolved_id" 2>/dev/null) || progress_line=""
    fi
    local full_line
    full_line=$(printf "%s: %s (%dm %02ds)" "$resolved_id" "$progress_line" "$mins" "$secs")
    local cols=${COLUMNS:-$(tput cols 2>/dev/null || echo 80)}
    if (( ${#full_line} >= cols )); then
      full_line="${full_line:0:$((cols - 1))}"
    fi
    printf "\r\033[2K%s" "$full_line"

    case "$state" in
      polling_fab_ff)
        # Check for timeout
        if [[ "$elapsed" -ge "$PIPELINE_FF_TIMEOUT" ]]; then
          printf "\n"
          log "Failed: $resolved_id — fab-ff timeout (${PIPELINE_FF_TIMEOUT}s)"
          write_stage "$manifest_id" "failed" "$MANIFEST"
          return 0
        fi

        if [[ -f "$status_file" ]]; then
          # Check progress-map for terminal states
          local progress_map
          progress_map=$("$FAB_BIN" status progress-map "$resolved_id" 2>/dev/null) || progress_map=""

          # Check for hydrate:done (fab-ff complete)
          if echo "$progress_map" | grep -q "^hydrate:done$"; then
            printf "\n"
            log "fab-ff complete: $resolved_id — waiting for Claude to finish turn..."
            sleep "$PIPELINE_SHIP_DELAY"
            log "Sending /git-pr"
            tmux send-keys -t "$pane_id" "/git-pr" 2>/dev/null || {
              printf "\n"
              log "Failed: $resolved_id — tmux send-keys failed for ship command"
              write_stage "$manifest_id" "failed" "$MANIFEST"
              return 0
            }
            sleep 0.5
            tmux send-keys -t "$pane_id" Enter 2>/dev/null || true
            state="shipping"
            ship_start_time=$SECONDS
          fi
        fi
        ;;

      shipping)
        # Check for ship timeout
        local ship_elapsed=$((SECONDS - ship_start_time))
        if [[ "$ship_elapsed" -ge "$PIPELINE_SHIP_TIMEOUT" ]]; then
          printf "\n"
          log "Failed: $resolved_id — ship timeout (${PIPELINE_SHIP_TIMEOUT}s)"
          write_stage "$manifest_id" "failed" "$MANIFEST"
          return 0
        fi

        # Sentinel avoids TOCTOU race with commit+push
        local pr_sentinel="$wt_path/fab/changes/$resolved_id/.pr-done"
        if [[ -f "$pr_sentinel" ]]; then
          printf "\n"
          log "Done: $resolved_id — pr complete"
          write_stage "$manifest_id" "done" "$MANIFEST"
          return 0
        fi
        ;;
    esac
  done
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

print_summary() {
  local manifest="$1"
  local count completed=() failed=() blocked=() skipped=() pending=() in_progress=()

  count=$(yq '.changes | length' "$manifest")
  local i id stage
  for ((i = 0; i < count; i++)); do
    id=$(yq -r ".changes[$i].id" "$manifest")
    stage=$(get_stage "$manifest" "$id")

    if [[ "$id" == "$CURRENT_DISPATCH" ]]; then
      in_progress+=("$id")
    elif [[ "$stage" == "done" ]]; then
      completed+=("$id")
    elif [[ "$stage" == "failed" ]]; then
      failed+=("$id")
    elif [[ "$stage" == "invalid" ]]; then
      skipped+=("$id")
    elif [[ -z "$stage" || "$stage" == "null" ]]; then
      pending+=("$id")
    else
      # Intermediate stage — blocked or pending re-dispatch
      pending+=("$id")
    fi
  done

  # Check for blocked (deps on failed)
  local truly_pending=() truly_blocked=()
  for id in "${pending[@]}"; do
    local dep_stage dep_id deps_count
    for ((i = 0; i < count; i++)); do
      local entry_id
      entry_id=$(yq -r ".changes[$i].id" "$manifest")
      if [[ "$entry_id" == "$id" ]]; then
        deps_count=$(yq ".changes[$i].depends_on | length" "$manifest")
        if [[ "$deps_count" -gt 0 ]]; then
          dep_id=$(yq -r ".changes[$i].depends_on[0]" "$manifest")
          dep_stage=$(get_stage "$manifest" "$dep_id")
          if [[ "$dep_stage" == "failed" || "$dep_stage" == "invalid" ]]; then
            truly_blocked+=("$id")
            continue 2
          fi
        fi
        break
      fi
    done
    truly_pending+=("$id")
  done

  local manifest_name
  manifest_name=$(basename "$MANIFEST" .yaml)

  echo ""
  log "Pipeline stopped: $manifest_name"
  log "  Completed:   ${#completed[@]} (${completed[*]:-none})"
  log "  Failed:      ${#failed[@]} (${failed[*]:-none})"
  log "  Blocked:     ${#truly_blocked[@]} (${truly_blocked[*]:-none})"
  log "  Skipped:     ${#skipped[@]} (${skipped[*]:-none})"
  log "  Pending:     ${#truly_pending[@]} (${truly_pending[*]:-none})"
  if [[ ${#in_progress[@]} -gt 0 ]]; then
    log "  In progress: ${#in_progress[@]} (${in_progress[*]})"
  fi

  # List worktree paths
  if [[ ${#WORKTREE_PATHS[@]} -gt 0 ]]; then
    echo ""
    log "Worktrees:"
    for id in "${!WORKTREE_PATHS[@]}"; do
      log "  $id → ${WORKTREE_PATHS[$id]}"
    done
  fi
}

# ---------------------------------------------------------------------------
# SIGINT Handler
# ---------------------------------------------------------------------------

on_sigint() {
  echo ""
  log "Caught SIGINT — shutting down..."
  # Kill all tracked interactive panes
  for id in "${!PANE_IDS[@]}"; do
    tmux kill-pane -t "${PANE_IDS[$id]}" 2>/dev/null || true
  done
  print_summary "$MANIFEST"
  exit 130
}

# ---------------------------------------------------------------------------
# Main Loop
# ---------------------------------------------------------------------------

main() {
  trap on_sigint INT

  local manifest_name
  manifest_name=$(basename "$MANIFEST" .yaml)

  # Set up log file for dispatch output
  LOG_FILE="/tmp/fab-pipeline-${manifest_name}.log"
  : > "$LOG_FILE"  # truncate

  log "Starting pipeline: $MANIFEST"
  log "Manifest poll interval: ${POLL_INTERVAL}s"
  log "Log file: $LOG_FILE"
  echo ""
  local waiting_shown=false

  # Initial validation
  if ! validate_manifest "$MANIFEST"; then
    exit 1
  fi

  while true; do
    # Re-read and re-validate manifest each iteration
    if ! validate_manifest "$MANIFEST" 2>/dev/null; then
      # Validation failure on re-read — log and continue polling
      # (human may be mid-edit)
      sleep "$POLL_INTERVAL"
      continue
    fi

    # Find next dispatchable change
    local next_id
    if next_id=$(find_next_dispatchable "$MANIFEST"); then
      CURRENT_DISPATCH="$next_id"
      if $waiting_shown; then printf "\n"; fi  # clear in-place waiting line

      # Resolve manifest ID to full change folder name
      local resolved_id
      if resolved_id=$("$FAB_BIN" resolve --folder "$next_id" 2>/dev/null); then
        log "Resolved: $next_id → $resolved_id"
      else
        log "Failed: $next_id — resolve failed (no matching change folder)"
        yq -i "(.changes[] | select(.id == \"$next_id\")).stage = \"invalid\"" "$MANIFEST"
        CURRENT_DISPATCH=""
        continue
      fi

      local parent_branch
      parent_branch=$(get_parent_branch "$MANIFEST" "$next_id")

      # Write separator to log file
      printf '\n═══ Dispatching: %s at %s ═══\n\n' \
        "$resolved_id" "$(date '+%H:%M:%S')" >> "$LOG_FILE"

      # Dispatch — captures stdout (worktree path + pane ID)
      local dispatch_output dispatch_exit=0
      dispatch_output=$(bash "$DISPATCH" "$next_id" "$resolved_id" "$parent_branch" "$MANIFEST" "$LAST_PANE_ID" \
        2>> "$LOG_FILE") || dispatch_exit=$?

      if [[ "$dispatch_exit" -eq 1 ]]; then
        log "Infrastructure failure during dispatch of $next_id — aborting (see $LOG_FILE)"
        print_summary "$MANIFEST"
        exit 1
      fi

      # Parse dispatch output: worktree path (line 1), pane ID (line 2)
      local wt_path pane_id
      wt_path=$(echo "$dispatch_output" | sed -n '1p')
      pane_id=$(echo "$dispatch_output" | sed -n '2p')

      if [[ -n "$wt_path" ]]; then
        WORKTREE_PATHS["$next_id"]="$wt_path"
      fi

      if [[ -n "$pane_id" ]]; then
        PANE_IDS["$next_id"]="$pane_id"
        LAST_PANE_ID="$pane_id"
        log "Dispatched: $resolved_id (pane: $pane_id)"

        # Poll for completion
        local status_file="$wt_path/fab/changes/$resolved_id/.status.yaml"
        poll_change "$next_id" "$resolved_id" "$pane_id" "$wt_path" "$status_file"
      else
        # No pane ID — dispatch handled failure internally (wrote to manifest)
        local result_stage
        result_stage=$(get_stage "$MANIFEST" "$next_id")
        if [[ "$result_stage" == "failed" || "$result_stage" == "invalid" ]]; then
          log "Failed: $resolved_id ($result_stage)"
        fi
      fi

      CURRENT_DISPATCH=""
    else
      # Nothing to dispatch — check for finite exit
      local watch
      watch=$(yq -r '.watch // false' "$MANIFEST")

      if [[ "$watch" != "true" ]] && all_terminal "$MANIFEST"; then
        if $waiting_shown; then printf "\n"; fi
        log "All changes terminal — exiting."
        print_summary "$MANIFEST"
        exit 0
      fi

      # Show detailed status for idle message
      local total completed_count failed_count invalid_count pending_count
      total=$(yq '.changes | length' "$MANIFEST")
      completed_count=$(yq '[.changes[] | select(.stage == "done")] | length' "$MANIFEST")
      failed_count=$(yq '[.changes[] | select(.stage == "failed")] | length' "$MANIFEST")
      invalid_count=$(yq '[.changes[] | select(.stage == "invalid")] | length' "$MANIFEST")
      pending_count=$((total - completed_count - failed_count - invalid_count))

      # In-place update: overwrite the same line each poll cycle
      waiting_shown=true
      printf "\r\033[2KWaiting… %s done, %s pending — polling every %ss" \
        "$completed_count" "$pending_count" "$POLL_INTERVAL"
      sleep "$POLL_INTERVAL"
    fi
  done
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  if [[ $# -lt 1 ]]; then
    usage >&2
    exit 1
  fi

  MANIFEST="$1"

  if [[ ! -f "$MANIFEST" ]]; then
    echo "Error: manifest not found: $MANIFEST" >&2
    exit 1
  fi

  main
fi
