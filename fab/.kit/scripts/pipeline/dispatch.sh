#!/usr/bin/env bash
set -euo pipefail

# fab/.kit/scripts/pipeline/dispatch.sh — Dispatch a single change into an interactive pane
#
# Usage: dispatch.sh <manifest-id> <fs-change-id> <parent-branch> <manifest-path> [last-pane-id]
#
# Creates a worktree, provisions artifacts, validates prerequisites,
# launches an interactive Claude session (tmux pane), sends fab-switch
# and fab-ff via send-keys, and returns the pane ID.
# Polls fab/current to confirm switch completion. Does NOT poll for
# fab-ff completion or shipping — run.sh handles that.
#
# Exit codes:
#   0  — pane created (stdout: worktree path + pane ID)
#   1  — infrastructure failure (caller should abort)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
FAB_DIR="$(dirname "$KIT_DIR")"
REPO_ROOT="$(dirname "$FAB_DIR")"
CONFIG_FILE="${FAB_DIR}/project/config.yaml"


# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------

usage() {
  cat <<'EOF'
Usage: dispatch.sh <manifest-id> <fs-change-id> <parent-branch> <manifest-path> [last-pane-id]

Dispatches a single change into an interactive Claude pane.

Arguments:
  manifest-id     Original change ID as written in the manifest (for manifest writes)
  fs-change-id    Resolved change folder name under fab/changes/ (for filesystem ops)
  parent-branch   Branch to base the worktree on (manifest's base for roots,
                  parent change's branch for dependents)
  manifest-path   Path to the pipeline manifest YAML file
  last-pane-id    Pane ID of the previous dispatch (empty for first dispatch)

Outputs worktree path and pane ID on stdout (two lines).
Polls fab/current to confirm switch completion. Does NOT poll for
fab-ff completion or shipping — run.sh handles that.

Exit code 0 = pane created.
Exit code 1 = infrastructure failure (caller should abort).
EOF
}

# Argument parsing is deferred to the source guard at the bottom of the file.
# When sourced for testing, functions are available without requiring arguments.
# Tests must set globals (MANIFEST_ID, CHANGE_ID, MANIFEST, FAB_DIR, etc.) before calling functions.

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

get_branch_prefix() {
  if [[ -f "$CONFIG_FILE" ]] && command -v yq &>/dev/null; then
    yq -r '.git.branch_prefix // ""' "$CONFIG_FILE"
  else
    echo ""
  fi
}

write_stage() {
  local id="$1" stage="$2" manifest="$3"
  yq -i "(.changes[] | select(.id == \"$id\")).stage = \"$stage\"" "$manifest"
}

log() {
  echo "$*" >&2
}

# check_pane_alive <pane_id> — verify tmux pane still exists
check_pane_alive() {
  local pane_id="$1"
  tmux list-panes -a -F '#{pane_id}' 2>/dev/null | grep -qx "$pane_id"
}

# ---------------------------------------------------------------------------
# Worktree Creation
# ---------------------------------------------------------------------------

# BRANCH_PREFIX and CHANGE_BRANCH are set in the source guard when run directly.
# Tests can set these globals manually.

create_worktree() {
  local wt_path

  # For dependent nodes (PARENT_BRANCH is another change's branch, not base),
  # create the change branch from the parent's local branch
  if ! git show-ref --verify --quiet "refs/heads/$CHANGE_BRANCH" 2>/dev/null; then
    # Branch doesn't exist locally — create it from parent
    if git show-ref --verify --quiet "refs/heads/$PARENT_BRANCH" 2>/dev/null; then
      # Parent exists locally — branch from it (dependent node)
      git branch "$CHANGE_BRANCH" "$PARENT_BRANCH" >/dev/null 2>&1
    fi
    # If parent not local, wt-create will create from HEAD (root node)
  fi

  wt_path=$(wt-create --non-interactive --reuse --worktree-open skip --worktree-name "$CHANGE_ID" "$CHANGE_BRANCH")

  if [[ -z "$wt_path" || ! -d "$wt_path" ]]; then
    echo "Error: wt-create failed — no worktree path returned" >&2
    return 1
  fi

  echo "$wt_path"
}

# ---------------------------------------------------------------------------
# Artifact Provisioning
# ---------------------------------------------------------------------------

provision_artifacts() {
  local wt_path="$1"
  local target_dir="$wt_path/fab/changes/$CHANGE_ID"
  local source_dir="$FAB_DIR/changes/$CHANGE_ID"

  if [[ ! -d "$source_dir" ]]; then
    echo "Error: source change folder not found at $source_dir" >&2
    return 1
  fi

  mkdir -p "$target_dir"
  # rsync -a is portable (macOS cp lacks GNU -u flag)
  rsync -a "$source_dir/" "$target_dir/"
  log "Synced artifacts: fab/changes/$CHANGE_ID → worktree"
}

# ---------------------------------------------------------------------------
# Prerequisite Validation
# ---------------------------------------------------------------------------

validate_prerequisites() {
  local wt_path="$1"
  local change_dir="$wt_path/fab/changes/$CHANGE_ID"

  if [[ ! -f "$change_dir/intake.md" ]]; then
    log "Failed: $CHANGE_ID — prerequisite failed: intake.md not found"
    write_stage "$MANIFEST_ID" "invalid" "$MANIFEST"
    return 2
  fi

  if [[ ! -f "$change_dir/spec.md" ]]; then
    log "Failed: $CHANGE_ID — prerequisite failed: spec.md not found"
    write_stage "$MANIFEST_ID" "invalid" "$MANIFEST"
    return 2
  fi

  # Confidence gate via fab dispatcher
  local wt_fab="$wt_path/fab/.kit/bin/fab"
  if [[ ! -x "$wt_fab" ]]; then
    log "Failed: $CHANGE_ID — infrastructure failure: fab dispatcher not found at $wt_fab"
    exit 1
  fi

  local gate_result
  gate_result=$("$wt_fab" score --check-gate "$CHANGE_ID" 2>/dev/null) || true
  local gate_status
  gate_status=$(echo "$gate_result" | grep "^gate:" | sed 's/gate: //')
  if [[ "$gate_status" == "fail" ]]; then
    local score threshold
    score=$(echo "$gate_result" | grep "^score:" | sed 's/score: //')
    threshold=$(echo "$gate_result" | grep "^threshold:" | sed 's/threshold: //')
    log "Failed: $CHANGE_ID — prerequisite failed: confidence $score below gate $threshold"
    write_stage "$MANIFEST_ID" "invalid" "$MANIFEST"
    return 2
  fi

  return 0
}

# ---------------------------------------------------------------------------
# Pipeline Execution — Interactive Pane
# ---------------------------------------------------------------------------

# Configurable delays and timeouts (seconds)
CLAUDE_STARTUP_DELAY="${CLAUDE_STARTUP_DELAY:-3}"
SWITCH_POLL_INTERVAL="${SWITCH_POLL_INTERVAL:-2}"
SWITCH_POLL_TIMEOUT="${SWITCH_POLL_TIMEOUT:-60}"
POST_SWITCH_DELAY="${POST_SWITCH_DELAY:-5}"

run_pipeline() {
  local wt_path="$1"

  # Step 1: Create bare interactive Claude session (no initial command)
  local pane_id
  if [[ -z "$LAST_PANE_ID" ]]; then
    # First dispatch — horizontal split from orchestrator pane
    pane_id=$(tmux split-window -h -d -P -F '#{pane_id}' -c "$wt_path" \
      "claude --dangerously-skip-permissions")
  else
    # Subsequent dispatch — vertical split stacked below previous session
    pane_id=$(tmux split-window -v -t "$LAST_PANE_ID" -d -P -F '#{pane_id}' -c "$wt_path" \
      "claude --dangerously-skip-permissions")
  fi

  # Rebalance: orchestrator stays left, dispatch panes split evenly on right
  tmux select-layout main-vertical 2>/dev/null || true

  if [[ -z "$pane_id" ]]; then
    log "Failed: $CHANGE_ID — tmux split-window failed (infrastructure)"
    write_stage "$MANIFEST_ID" "failed" "$MANIFEST"
    exit 1
  fi

  # Step 2: Send fab-switch to the interactive pane via send-keys
  sleep "$CLAUDE_STARTUP_DELAY"
  if ! check_pane_alive "$pane_id"; then
    log "Failed: $CHANGE_ID — pane died before fab-switch could be sent"
    write_stage "$MANIFEST_ID" "failed" "$MANIFEST"
    return 0
  fi
  tmux send-keys -t "$pane_id" "/fab-switch $CHANGE_ID" 2>/dev/null || {
    log "Failed: $CHANGE_ID — tmux send-keys failed for fab-switch"
    write_stage "$MANIFEST_ID" "failed" "$MANIFEST"
    return 0
  }
  sleep 0.5
  tmux send-keys -t "$pane_id" Enter 2>/dev/null || true

  # Step 3: Poll fab/current line 1 (4-char ID) until it matches the expected change
  local fab_current_file="$wt_path/fab/current"
  local expected_id
  expected_id=$(echo "$CHANGE_ID" | cut -d'-' -f2)
  local elapsed=0
  local switch_ok=false
  while [[ "$elapsed" -lt "$SWITCH_POLL_TIMEOUT" ]]; do
    sleep "$SWITCH_POLL_INTERVAL"
    elapsed=$((elapsed + SWITCH_POLL_INTERVAL))

    # Check pane still alive
    if ! check_pane_alive "$pane_id"; then
      log "Failed: $CHANGE_ID — interactive pane died during fab-switch"
      write_stage "$MANIFEST_ID" "failed" "$MANIFEST"
      return 0
    fi

    # Check fab/current line 1 (4-char ID)
    if [[ -f "$fab_current_file" ]]; then
      local current_id
      current_id=$(sed -n '1p' "$fab_current_file" 2>/dev/null | tr -d '[:space:]')
      if [[ "$current_id" == "$expected_id" ]]; then
        switch_ok=true
        break
      fi
    fi
  done

  if ! "$switch_ok"; then
    log "Failed: $CHANGE_ID — fab-switch polling timed out (${SWITCH_POLL_TIMEOUT}s)"
    write_stage "$MANIFEST_ID" "failed" "$MANIFEST"
    return 0
  fi

  # Step 4: Send fab-ff after switch completion
  sleep "$POST_SWITCH_DELAY"
  if ! check_pane_alive "$pane_id"; then
    log "Failed: $CHANGE_ID — pane died before fab-ff could be sent"
    write_stage "$MANIFEST_ID" "failed" "$MANIFEST"
    return 0
  fi
  tmux send-keys -t "$pane_id" "/fab-ff" 2>/dev/null || {
    log "Failed: $CHANGE_ID — tmux send-keys failed for fab-ff"
    write_stage "$MANIFEST_ID" "failed" "$MANIFEST"
    return 0
  }
  sleep 0.5
  tmux send-keys -t "$pane_id" Enter 2>/dev/null || true

  # Output pane ID — run.sh captures this
  echo "$pane_id"
  return 0
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  # Create worktree — infrastructure failure if this fails
  local wt_path
  wt_path=$(create_worktree) || {
    echo "Error: worktree creation failed for $CHANGE_ID" >&2
    exit 1
  }
  log "Dispatching: $CHANGE_ID (worktree: $wt_path)"

  # Provision artifacts — infrastructure failure if source missing
  provision_artifacts "$wt_path" || {
    echo "Error: artifact provisioning failed for $CHANGE_ID" >&2
    exit 1
  }

  # Validate prerequisites — writes invalid on failure, not infra error
  if ! validate_prerequisites "$wt_path"; then
    return 0
  fi

  # Launch interactive pane — returns pane ID on stdout
  local pane_id
  pane_id=$(run_pipeline "$wt_path") || return 0

  # Output: worktree path + pane ID (two lines, captured by run.sh)
  echo "$wt_path"
  echo "$pane_id"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  if [[ $# -lt 4 ]]; then
    usage >&2
    exit 1
  fi

  MANIFEST_ID="$1"
  CHANGE_ID="$2"
  PARENT_BRANCH="$3"
  MANIFEST="$4"
  LAST_PANE_ID="${5:-}"

  BRANCH_PREFIX="$(get_branch_prefix)"
  CHANGE_BRANCH="${BRANCH_PREFIX}${CHANGE_ID}"

  main
fi
