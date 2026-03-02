#!/usr/bin/env bash
# fab/.kit/scripts/lib/statusman.sh
#
# Status Manager — CLI utility for workflow stages, states, and .status.yaml.
# Reads the canonical workflow schema and provides typed subcommands.
#
# Usage:
#   statusman.sh --help               Show usage
#   statusman.sh all-stages           List all stage IDs
#   statusman.sh progress-map <change>  Extract stage:state pairs
#   statusman.sh start <change> <stage> [driver]
#   statusman.sh finish <change> <stage> [driver]

set -euo pipefail

# Locate workflow schema and sibling scripts relative to this script
STATUSMAN_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
WORKFLOW_SCHEMA="$STATUSMAN_DIR/../../schemas/workflow.yaml"
RESOLVE="$STATUSMAN_DIR/resolve.sh"
LOGMAN="$STATUSMAN_DIR/logman.sh"

if [ ! -f "$WORKFLOW_SCHEMA" ]; then
  echo "ERROR: workflow.yaml not found at $WORKFLOW_SCHEMA" >&2
  echo "       STATUSMAN_DIR=$STATUSMAN_DIR" >&2
  exit 1
fi

# Require yq (Mike Farah's Go v4) for .status.yaml operations
if ! command -v yq &>/dev/null; then
  echo "ERROR: yq (v4) is required but not found. Install: https://github.com/mikefarah/yq" >&2
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# Change Argument Resolution (via resolve.sh)
# ─────────────────────────────────────────────────────────────────────────────

# resolve_to_status <arg> — Resolve a change argument to a .status.yaml path.
# If <arg> is an existing file, use it directly (backward compat).
# Otherwise, delegate to resolve.sh --status.
resolve_to_status() {
  local arg="$1"

  # Direct file path (backward compat for internal callers like preflight)
  if [ -f "$arg" ]; then
    echo "$arg"
    return 0
  fi

  # Delegate to resolve.sh
  local repo_root
  repo_root="$(cd "$STATUSMAN_DIR/../../../.." && pwd)"
  local resolved
  resolved=$("$RESOLVE" --status "$arg") || return 1
  local status_file="$repo_root/$resolved"

  if [ ! -f "$status_file" ]; then
    echo "ERROR: Resolved status file not found: $status_file" >&2
    return 1
  fi

  echo "$status_file"
}

# ─────────────────────────────────────────────────────────────────────────────
# Transition Lookup
# ─────────────────────────────────────────────────────────────────────────────

# lookup_transition <event> <stage> <current_state> — Look up transition rule.
# Checks stage-specific override first, falls back to default.
# Prints the target state on stdout. Exits 1 if no matching transition.
lookup_transition() {
  local event="$1"
  local stage="$2"
  local current_state="$3"

  # Check for stage-specific override section first, then default
  local sections="$stage default"
  for section in $sections; do
    local result
    result=$(yq "
      .transitions.${section} // [] |
      map(select(.event == \"${event}\" and (.from | contains([\"${current_state}\"])))) |
      .[0].to // \"\"
    " "$WORKFLOW_SCHEMA")

    if [ -n "$result" ] && [ "$result" != "" ] && [ "$result" != "null" ]; then
      echo "$result"
      return 0
    fi
  done

  echo "ERROR: Cannot ${event} stage '${stage}' — current state is '${current_state}', no valid transition" >&2
  return 1
}

# ─────────────────────────────────────────────────────────────────────────────
# State Queries
# ─────────────────────────────────────────────────────────────────────────────

# get_all_states — Return all valid state IDs (one per line)
get_all_states() {
  awk '
    /^states:/ { in_states = 1; next }
    in_states && /^[a-z_]+:/ && !/^ / { exit }
    in_states && /^  - id:/ { print $3 }
  ' "$WORKFLOW_SCHEMA"
}

# validate_state <state> — Return 0 if state is valid, 1 otherwise
validate_state() {
  local state="$1"
  get_all_states | grep -qx "$state"
}


# ─────────────────────────────────────────────────────────────────────────────
# Stage Queries
# ─────────────────────────────────────────────────────────────────────────────

# get_all_stages — Return all stage IDs in order (one per line)
get_all_stages() {
  awk '
    /^stages:/ { in_stages = 1; next }
    in_stages && /^[a-z_]+:/ && !/^ / { exit }
    in_stages && /^  - id:/ { print $3 }
  ' "$WORKFLOW_SCHEMA"
}

# validate_stage <stage> — Return 0 if stage is valid, 1 otherwise
validate_stage() {
  local stage="$1"
  get_all_stages | grep -qx "$stage"
}


# get_allowed_states <stage> — Return allowed states for a stage (one per line)
get_allowed_states() {
  local stage="$1"
  awk -v stage="$stage" '
    /^ *- id:/ { current_id = $3; in_stage = 0 }
    current_id == stage { in_stage = 1 }
    in_stage && /^ *allowed_states:/ {
      # Parse [state1, state2, state3] format
      gsub(/[\[\]]/, "")
      for (i = 2; i <= NF; i++) {
        state = $i
        gsub(/,/, "", state)
        print state
      }
      exit
    }
  ' "$WORKFLOW_SCHEMA"
}

# validate_stage_state <stage> <state> — Return 0 if state is allowed for stage
validate_stage_state() {
  local stage="$1"
  local state="$2"
  get_allowed_states "$stage" | grep -qx "$state"
}


# ─────────────────────────────────────────────────────────────────────────────
# .status.yaml Accessors
# ─────────────────────────────────────────────────────────────────────────────

# get_progress_map <status_file> — Extract all stage→state pairs
# Outputs one "stage:state" pair per line. Missing stages default to "pending".
get_progress_map() {
  local status_file="$1"
  local stage val
  for stage in $(get_all_stages); do
    val=$(yq ".progress.${stage} // \"pending\"" "$status_file")
    echo "${stage}:${val}"
  done
}

# get_checklist <status_file> — Extract checklist fields
# Outputs: generated:{val}, completed:{val}, total:{val}
get_checklist() {
  local status_file="$1"
  echo "generated:$(yq '.checklist.generated // "false"' "$status_file")"
  echo "completed:$(yq '.checklist.completed // 0' "$status_file")"
  echo "total:$(yq '.checklist.total // 0' "$status_file")"
}

# get_confidence <status_file> — Extract confidence fields
# Outputs: certain:{val}, confident:{val}, tentative:{val}, unresolved:{val}, score:{val}
get_confidence() {
  local status_file="$1"
  echo "certain:$(yq '.confidence.certain // 0' "$status_file")"
  echo "confident:$(yq '.confidence.confident // 0' "$status_file")"
  echo "tentative:$(yq '.confidence.tentative // 0' "$status_file")"
  echo "unresolved:$(yq '.confidence.unresolved // 0' "$status_file")"
  echo "score:$(yq '.confidence.score // "5.0"' "$status_file")"
}

# get_progress_line <status_file> — Single-line visual pipeline progress
# Iterates get_progress_map: done stages joined by " → ", active + " ⏳",
# failed + " ✗", pending omitted. All done appends " ✓". All pending = empty.
get_progress_line() {
  local status_file="$1"
  local parts=()
  local has_active=false has_pending=false

  while IFS=: read -r stage state; do
    case "$state" in
      done)    parts+=("$stage") ;;
      active)  parts+=("$stage ⏳"); has_active=true ;;
      ready)   parts+=("$stage ◷") ;;
      failed)  parts+=("$stage ✗") ;;
      skipped) parts+=("$stage ⏭") ;;
      pending) has_pending=true ;;
    esac
  done <<< "$(get_progress_map "$status_file")"

  if [ ${#parts[@]} -eq 0 ]; then
    return 0
  fi

  local line=""
  for ((i = 0; i < ${#parts[@]}; i++)); do
    if [ $i -gt 0 ]; then
      line+=" → "
    fi
    line+="${parts[$i]}"
  done

  if [ "$has_active" = "false" ] && [ "$has_pending" = "false" ]; then
    line+=" ✓"
  fi

  echo "$line"
}

# _apply_metrics_side_effect <tmpfile> <stage> <state> [driver]
# Internal helper: apply stage_metrics side-effects for a state change.
# Operates on tmpfile (caller handles atomicity).
_apply_metrics_side_effect() {
  local tmpfile="$1"
  local stage="$2"
  local state="$3"
  local driver="${4:-}"
  local now
  now=$(date -Iseconds)

  case "$state" in
    active)
      local iterations
      iterations=$(yq ".stage_metrics.${stage}.iterations // 0" "$tmpfile")
      iterations=$((iterations + 1))
      yq -i ".stage_metrics.${stage} = {\"started_at\": \"${now}\", \"driver\": \"${driver}\", \"iterations\": ${iterations}}" "$tmpfile"
      yq -i "(.stage_metrics.${stage}) style=\"flow\"" "$tmpfile"
      ;;
    done)
      yq -i ".stage_metrics.${stage}.completed_at = \"${now}\"" "$tmpfile"
      yq -i "(.stage_metrics.${stage}) style=\"flow\"" "$tmpfile"
      ;;
    pending)
      yq -i "del(.stage_metrics.${stage})" "$tmpfile"
      ;;
    skipped)
      yq -i "del(.stage_metrics.${stage})" "$tmpfile"
      ;;
    # ready: no metrics change (preserve existing metrics from active phase)
    # failed: no metrics change
  esac
}

# ─────────────────────────────────────────────────────────────────────────────
# Progression Queries
# ─────────────────────────────────────────────────────────────────────────────

# get_current_stage <status_file> — Determine active stage from .status.yaml
get_current_stage() {
  local status_file="$1"
  local stage state last_done="" found_last=false

  # Parse progress map once
  local progress_lines
  progress_lines=$(get_progress_map "$status_file")

  # Find first active or ready stage
  while IFS=: read -r stage state; do
    if [ "$state" = "active" ] || [ "$state" = "ready" ]; then
      echo "$stage"
      return 0
    fi
  done <<< "$progress_lines"

  # Fallback: find first pending stage after last done or skipped
  while IFS=: read -r stage state; do
    if [ "$state" = "done" ] || [ "$state" = "skipped" ]; then
      last_done="$stage"
    fi
  done <<< "$progress_lines"

  if [ -n "$last_done" ]; then
    while IFS=: read -r stage state; do
      if [ "$found_last" = "true" ] && [ "$state" = "pending" ]; then
        echo "$stage"
        return 0
      fi
      if [ "$stage" = "$last_done" ]; then
        found_last=true
      fi
    done <<< "$progress_lines"
  fi

  # Final fallback: all done (workflow complete)
  echo "hydrate"
}

# get_display_stage <status_file> — Determine "where you are" stage for display
# Returns stage:state (e.g., "spec:active", "spec:ready", "intake:done", "intake:pending")
# Fallback: (1) first active, (2) first ready, (3) last done, (4) first stage with pending
get_display_stage() {
  local status_file="$1"
  local stage state last_done=""

  # Parse progress map once
  local progress_lines
  progress_lines=$(get_progress_map "$status_file")

  # Tier 1: first active stage
  while IFS=: read -r stage state; do
    if [ "$state" = "active" ]; then
      echo "${stage}:active"
      return 0
    fi
  done <<< "$progress_lines"

  # Tier 2: first ready stage
  while IFS=: read -r stage state; do
    if [ "$state" = "ready" ]; then
      echo "${stage}:ready"
      return 0
    fi
  done <<< "$progress_lines"

  # Tier 3: last done or skipped stage
  local last_done_state=""
  while IFS=: read -r stage state; do
    if [ "$state" = "done" ] || [ "$state" = "skipped" ]; then
      last_done="$stage"
      last_done_state="$state"
    fi
  done <<< "$progress_lines"

  if [ -n "$last_done" ]; then
    echo "${last_done}:${last_done_state}"
    return 0
  fi

  # Tier 4: nothing active, ready, or done — return first stage with pending
  local first_stage
  first_stage=$(get_all_stages | head -1)
  echo "${first_stage}:pending"
}

# get_next_stage <current_stage> — Return the next stage in sequence
get_next_stage() {
  local current="$1"
  local found=false

  for stage in $(get_all_stages); do
    if [ "$found" = "true" ]; then
      echo "$stage"
      return 0
    fi
    if [ "$stage" = "$current" ]; then
      found=true
    fi
  done

  # No next stage (at end)
  return 1
}

# ─────────────────────────────────────────────────────────────────────────────
# Write Functions
# ─────────────────────────────────────────────────────────────────────────────

# set_change_type <status_file> <type>
# Set the change_type field in .status.yaml.
# Validates type is one of the 7 canonical types. Writes atomically, updates last_updated.
# Returns 0 on success, 1 on validation failure.
set_change_type() {
  local status_file="$1"
  local change_type="$2"

  if [ ! -f "$status_file" ]; then
    echo "ERROR: Status file not found: $status_file" >&2
    return 1
  fi

  case "$change_type" in
    feat|fix|refactor|docs|test|ci|chore) ;;
    *)
      echo "ERROR: Invalid change type '$change_type' (valid: feat, fix, refactor, docs, test, ci, chore)" >&2
      return 1
      ;;
  esac

  local now
  now=$(date -Iseconds)
  local tmpfile
  tmpfile=$(mktemp "$(dirname "$status_file")/.status.yaml.XXXXXX")

  cp "$status_file" "$tmpfile"
  yq -i ".change_type = \"${change_type}\" | .last_updated = \"${now}\"" "$tmpfile"

  mv "$tmpfile" "$status_file"
}

# set_checklist_field <status_file> <field> <value>
# Update a single field in the checklist block of .status.yaml.
# Valid fields: generated (true/false), completed (non-negative int), total (non-negative int).
# Returns 0 on success, 1 on validation failure.
set_checklist_field() {
  local status_file="$1"
  local field="$2"
  local value="$3"

  if [ ! -f "$status_file" ]; then
    echo "ERROR: Status file not found: $status_file" >&2
    return 1
  fi

  case "$field" in
    generated)
      if [ "$value" != "true" ] && [ "$value" != "false" ]; then
        echo "ERROR: Invalid value '$value' for field 'generated' (expected true/false)" >&2
        return 1
      fi
      ;;
    completed|total)
      if ! [[ "$value" =~ ^[0-9]+$ ]]; then
        echo "ERROR: Invalid value '$value' for field '$field' (expected non-negative integer)" >&2
        return 1
      fi
      ;;
    *)
      echo "ERROR: Invalid checklist field '$field' (expected: generated, completed, total)" >&2
      return 1
      ;;
  esac

  local now
  now=$(date -Iseconds)
  local tmpfile
  tmpfile=$(mktemp "$(dirname "$status_file")/.status.yaml.XXXXXX")

  cp "$status_file" "$tmpfile"
  yq -i ".checklist.${field} = ${value} | .last_updated = \"${now}\"" "$tmpfile"

  mv "$tmpfile" "$status_file"
}

# set_confidence_block <status_file> <certain> <confident> <tentative> <unresolved> <score>
# Replace the entire confidence block in .status.yaml.
# Validates counts are non-negative integers and score is a non-negative float.
# Returns 0 on success, 1 on validation failure.
set_confidence_block() {
  local status_file="$1"
  local certain="$2"
  local confident="$3"
  local tentative="$4"
  local unresolved="$5"
  local score="$6"

  if [ ! -f "$status_file" ]; then
    echo "ERROR: Status file not found: $status_file" >&2
    return 1
  fi

  # Validate counts are non-negative integers
  local count_name count_val
  for count_name in certain confident tentative unresolved; do
    eval count_val=\$$count_name
    if ! [[ "$count_val" =~ ^[0-9]+$ ]]; then
      echo "ERROR: Invalid value '$count_val' for '$count_name' (expected non-negative integer)" >&2
      return 1
    fi
  done

  # Validate score is a non-negative float
  if ! [[ "$score" =~ ^[0-9]+\.?[0-9]*$ ]]; then
    echo "ERROR: Invalid score '$score' (expected non-negative float)" >&2
    return 1
  fi

  local now
  now=$(date -Iseconds)
  local tmpfile
  tmpfile=$(mktemp "$(dirname "$status_file")/.status.yaml.XXXXXX")

  cp "$status_file" "$tmpfile"
  yq -i "
    .confidence.certain = ${certain} |
    .confidence.confident = ${confident} |
    .confidence.tentative = ${tentative} |
    .confidence.unresolved = ${unresolved} |
    .confidence.score = ${score} |
    .last_updated = \"${now}\"
  " "$tmpfile"

  mv "$tmpfile" "$status_file"
}

# set_confidence_block_fuzzy <status_file> <certain> <confident> <tentative> <unresolved> <score> <mean_s> <mean_r> <mean_a> <mean_d>
# Replace the entire confidence block in .status.yaml, including fuzzy dimension data.
# Extends set_confidence_block with fuzzy: true flag and dimensions sub-block.
set_confidence_block_fuzzy() {
  local status_file="$1"
  local certain="$2"
  local confident="$3"
  local tentative="$4"
  local unresolved="$5"
  local score="$6"
  local mean_s="$7"
  local mean_r="$8"
  local mean_a="$9"
  local mean_d="${10}"

  if [ ! -f "$status_file" ]; then
    echo "ERROR: Status file not found: $status_file" >&2
    return 1
  fi

  # Validate counts are non-negative integers
  local count_name count_val
  for count_name in certain confident tentative unresolved; do
    eval count_val=\$$count_name
    if ! [[ "$count_val" =~ ^[0-9]+$ ]]; then
      echo "ERROR: Invalid value '$count_val' for '$count_name' (expected non-negative integer)" >&2
      return 1
    fi
  done

  # Validate score is a non-negative float
  if ! [[ "$score" =~ ^[0-9]+\.?[0-9]*$ ]]; then
    echo "ERROR: Invalid score '$score' (expected non-negative float)" >&2
    return 1
  fi

  local now
  now=$(date -Iseconds)
  local tmpfile
  tmpfile=$(mktemp "$(dirname "$status_file")/.status.yaml.XXXXXX")

  awk -v certain="$certain" \
      -v confident="$confident" \
      -v tentative="$tentative" \
      -v unresolved="$unresolved" \
      -v score="$score" \
      -v mean_s="$mean_s" \
      -v mean_r="$mean_r" \
      -v mean_a="$mean_a" \
      -v mean_d="$mean_d" \
      -v ts="$now" '
    /^confidence:/ {
      in_block = 1
      print "confidence:"
      print "  certain: " certain
      print "  confident: " confident
      print "  tentative: " tentative
      print "  unresolved: " unresolved
      print "  score: " score
      print "  fuzzy: true"
      print "  dimensions:"
      print "    signal: " mean_s
      print "    reversibility: " mean_r
      print "    competence: " mean_a
      print "    disambiguation: " mean_d
      next
    }
    in_block && /^[^ ]/ { in_block = 0 }
    in_block { next }
    /^last_updated:/ { print "last_updated: " ts; next }
    { print }
  ' "$status_file" > "$tmpfile"

  mv "$tmpfile" "$status_file"
}


# ─────────────────────────────────────────────────────────────────────────────
# Event Functions
# ─────────────────────────────────────────────────────────────────────────────

# event_start <status_file> <stage> [driver]
# {pending,failed} → active. Validates via lookup_transition.
event_start() {
  local status_file="$1"
  local stage="$2"
  local driver="${3:-}"

  if [ ! -f "$status_file" ]; then
    echo "ERROR: Status file not found: $status_file" >&2
    return 1
  fi
  if ! validate_stage "$stage"; then
    echo "ERROR: Invalid stage '$stage'" >&2
    return 1
  fi

  local current_state
  current_state=$(yq ".progress.${stage} // \"pending\"" "$status_file")

  local target_state
  if ! target_state=$(lookup_transition "start" "$stage" "$current_state"); then
    return 1
  fi

  local now
  now=$(date -Iseconds)
  local tmpfile
  tmpfile=$(mktemp "$(dirname "$status_file")/.status.yaml.XXXXXX")

  cp "$status_file" "$tmpfile"
  yq -i ".progress.${stage} = \"${target_state}\" | .last_updated = \"${now}\"" "$tmpfile"
  _apply_metrics_side_effect "$tmpfile" "$stage" "$target_state" "$driver"

  mv "$tmpfile" "$status_file"
}

# event_advance <status_file> <stage> [driver]
# active → ready. No metrics side-effect.
event_advance() {
  local status_file="$1"
  local stage="$2"
  local driver="${3:-}"

  if [ ! -f "$status_file" ]; then
    echo "ERROR: Status file not found: $status_file" >&2
    return 1
  fi
  if ! validate_stage "$stage"; then
    echo "ERROR: Invalid stage '$stage'" >&2
    return 1
  fi

  local current_state
  current_state=$(yq ".progress.${stage} // \"pending\"" "$status_file")

  local target_state
  if ! target_state=$(lookup_transition "advance" "$stage" "$current_state"); then
    return 1
  fi

  local now
  now=$(date -Iseconds)
  local tmpfile
  tmpfile=$(mktemp "$(dirname "$status_file")/.status.yaml.XXXXXX")

  cp "$status_file" "$tmpfile"
  yq -i ".progress.${stage} = \"${target_state}\" | .last_updated = \"${now}\"" "$tmpfile"
  # advance: no metrics side-effect (preserve existing from active phase)

  mv "$tmpfile" "$status_file"
}

# event_finish <status_file> <stage> [driver]
# {active,ready} → done. Side-effect: if next stage is pending, activate it.
# Auto-log: if stage is review, logs "passed" via logman.
event_finish() {
  local status_file="$1"
  local stage="$2"
  local driver="${3:-}"

  if [ ! -f "$status_file" ]; then
    echo "ERROR: Status file not found: $status_file" >&2
    return 1
  fi
  if ! validate_stage "$stage"; then
    echo "ERROR: Invalid stage '$stage'" >&2
    return 1
  fi

  local current_state
  current_state=$(yq ".progress.${stage} // \"pending\"" "$status_file")

  local target_state
  if ! target_state=$(lookup_transition "finish" "$stage" "$current_state"); then
    return 1
  fi

  local now
  now=$(date -Iseconds)
  local tmpfile
  tmpfile=$(mktemp "$(dirname "$status_file")/.status.yaml.XXXXXX")

  cp "$status_file" "$tmpfile"
  yq -i ".progress.${stage} = \"${target_state}\" | .last_updated = \"${now}\"" "$tmpfile"
  _apply_metrics_side_effect "$tmpfile" "$stage" "$target_state"

  # Side-effect: activate next pending stage
  local next_stage
  if next_stage=$(get_next_stage "$stage"); then
    local next_state
    next_state=$(yq ".progress.${next_stage} // \"pending\"" "$tmpfile")
    if [ "$next_state" = "pending" ]; then
      yq -i ".progress.${next_stage} = \"active\"" "$tmpfile"
      _apply_metrics_side_effect "$tmpfile" "$next_stage" "active" "$driver"
    fi
  fi

  mv "$tmpfile" "$status_file"

  # Auto-log review pass via logman
  if [ "$stage" = "review" ]; then
    local change_dir
    change_dir="$(dirname "$status_file")"
    local folder
    folder="$(basename "$change_dir")"
    "$LOGMAN" review "$folder" "passed" 2>/dev/null || true
  fi
}

# event_reset <status_file> <stage> [driver]
# {done,ready,skipped} → active. Cascade: all downstream stages → pending.
event_reset() {
  local status_file="$1"
  local stage="$2"
  local driver="${3:-}"

  if [ ! -f "$status_file" ]; then
    echo "ERROR: Status file not found: $status_file" >&2
    return 1
  fi
  if ! validate_stage "$stage"; then
    echo "ERROR: Invalid stage '$stage'" >&2
    return 1
  fi

  local current_state
  current_state=$(yq ".progress.${stage} // \"pending\"" "$status_file")

  local target_state
  if ! target_state=$(lookup_transition "reset" "$stage" "$current_state"); then
    return 1
  fi

  local now
  now=$(date -Iseconds)
  local tmpfile
  tmpfile=$(mktemp "$(dirname "$status_file")/.status.yaml.XXXXXX")

  cp "$status_file" "$tmpfile"
  yq -i ".progress.${stage} = \"${target_state}\" | .last_updated = \"${now}\"" "$tmpfile"
  _apply_metrics_side_effect "$tmpfile" "$stage" "$target_state" "$driver"

  # Cascade: set all downstream stages to pending, remove their metrics
  local found_target=false
  for s in $(get_all_stages); do
    if [ "$found_target" = "true" ]; then
      yq -i ".progress.${s} = \"pending\"" "$tmpfile"
      _apply_metrics_side_effect "$tmpfile" "$s" "pending"
    fi
    if [ "$s" = "$stage" ]; then
      found_target=true
    fi
  done

  mv "$tmpfile" "$status_file"
}

# event_skip <status_file> <stage> [driver]
# pending → skipped. Forward cascade: all downstream pending stages → skipped.
# No auto-activate of next stage. Metrics cleared (same as pending).
event_skip() {
  local status_file="$1"
  local stage="$2"
  local driver="${3:-}"

  if [ ! -f "$status_file" ]; then
    echo "ERROR: Status file not found: $status_file" >&2
    return 1
  fi
  if ! validate_stage "$stage"; then
    echo "ERROR: Invalid stage '$stage'" >&2
    return 1
  fi

  local current_state
  current_state=$(yq ".progress.${stage} // \"pending\"" "$status_file")

  local target_state
  if ! target_state=$(lookup_transition "skip" "$stage" "$current_state"); then
    return 1
  fi

  local now
  now=$(date -Iseconds)
  local tmpfile
  tmpfile=$(mktemp "$(dirname "$status_file")/.status.yaml.XXXXXX")

  cp "$status_file" "$tmpfile"
  yq -i ".progress.${stage} = \"${target_state}\" | .last_updated = \"${now}\"" "$tmpfile"
  _apply_metrics_side_effect "$tmpfile" "$stage" "$target_state"

  # Forward cascade: set all downstream pending stages to skipped
  local found_target=false
  for s in $(get_all_stages); do
    if [ "$found_target" = "true" ]; then
      local s_state
      s_state=$(yq ".progress.${s} // \"pending\"" "$tmpfile")
      if [ "$s_state" = "pending" ]; then
        yq -i ".progress.${s} = \"skipped\"" "$tmpfile"
        _apply_metrics_side_effect "$tmpfile" "$s" "skipped"
      fi
    fi
    if [ "$s" = "$stage" ]; then
      found_target=true
    fi
  done

  mv "$tmpfile" "$status_file"
}

# event_fail <status_file> <stage> [driver] [rework]
# active → failed. Review stage only. No metrics side-effect.
# Auto-log: if stage is review, logs "failed" with optional rework via logman.
event_fail() {
  local status_file="$1"
  local stage="$2"
  local driver="${3:-}"
  local rework="${4:-}"

  if [ ! -f "$status_file" ]; then
    echo "ERROR: Status file not found: $status_file" >&2
    return 1
  fi
  if ! validate_stage "$stage"; then
    echo "ERROR: Invalid stage '$stage'" >&2
    return 1
  fi

  local current_state
  current_state=$(yq ".progress.${stage} // \"pending\"" "$status_file")

  local target_state
  if ! target_state=$(lookup_transition "fail" "$stage" "$current_state"); then
    return 1
  fi

  local now
  now=$(date -Iseconds)
  local tmpfile
  tmpfile=$(mktemp "$(dirname "$status_file")/.status.yaml.XXXXXX")

  cp "$status_file" "$tmpfile"
  yq -i ".progress.${stage} = \"${target_state}\" | .last_updated = \"${now}\"" "$tmpfile"
  # fail: no metrics side-effect (preserve timing data)

  mv "$tmpfile" "$status_file"

  # Auto-log review failure via logman
  if [ "$stage" = "review" ]; then
    local change_dir
    change_dir="$(dirname "$status_file")"
    local folder
    folder="$(basename "$change_dir")"
    if [ -n "$rework" ]; then
      "$LOGMAN" review "$folder" "failed" "$rework" 2>/dev/null || true
    else
      "$LOGMAN" review "$folder" "failed" 2>/dev/null || true
    fi
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Issues & PRs
# ─────────────────────────────────────────────────────────────────────────────

# _append_to_array <status_file> <field> <value>
# Generic helper: append a value to a YAML array field. Idempotent (dedup).
# Uses atomic write pattern (temp file → mv). Updates last_updated.
_append_to_array() {
  local status_file="$1"
  local field="$2"
  local value="$3"

  if [ ! -f "$status_file" ]; then
    echo "ERROR: Status file not found: $status_file" >&2
    return 1
  fi

  # Check for exact duplicate (one value per line via yq, grep -xF for exact match)
  if yq ".${field} // [] | .[]" "$status_file" | grep -qxF "$value"; then
    # Value already present — refresh last_updated only
    local now
    now=$(date -Iseconds)
    local tmpfile
    tmpfile=$(mktemp "$(dirname "$status_file")/.status.yaml.XXXXXX")
    cp "$status_file" "$tmpfile"
    yq -i ".last_updated = \"${now}\"" "$tmpfile"
    mv "$tmpfile" "$status_file"
    return 0
  fi

  local now
  now=$(date -Iseconds)
  local tmpfile
  tmpfile=$(mktemp "$(dirname "$status_file")/.status.yaml.XXXXXX")

  cp "$status_file" "$tmpfile"
  yq -i ".${field} += [\"${value}\"] | .last_updated = \"${now}\"" "$tmpfile"

  mv "$tmpfile" "$status_file"
}

# _get_array <status_file> <field>
# Generic helper: emit array values one per line. Empty output for empty/missing array.
_get_array() {
  local status_file="$1"
  local field="$2"

  if [ ! -f "$status_file" ]; then
    echo "ERROR: Status file not found: $status_file" >&2
    return 1
  fi

  yq ".${field} // [] | .[]" "$status_file"
}

# add_issue <status_file> <id>
# Append an issue ID to the issues array. Idempotent.
add_issue() { _append_to_array "$1" "issues" "$2"; }

# get_issues <status_file>
# Emit issue IDs one per line. Empty output for empty/missing array.
get_issues() { _get_array "$1" "issues"; }

# add_pr <status_file> <url>
# Append a PR URL to the prs array. Idempotent.
add_pr() { _append_to_array "$1" "prs" "$2"; }

# get_prs <status_file>
# Emit PR URLs one per line. Empty output for empty/missing array.
get_prs() { _get_array "$1" "prs"; }

# ─────────────────────────────────────────────────────────────────────────────
# Validation
# ─────────────────────────────────────────────────────────────────────────────

# validate_status_file <status_file> — Validate .status.yaml against schema
# Returns 0 if valid, 1 if invalid (prints errors to stderr)
validate_status_file() {
  local status_file="$1"
  local errors=0

  # Check each stage has valid state (via yq, skips stage_metrics)
  local active_count=0
  for stage in $(get_all_stages); do
    local state
    state=$(yq ".progress.${stage} // \"\"" "$status_file")

    if [ -z "$state" ]; then
      echo "ERROR: Missing progress.$stage in $status_file" >&2
      errors=$((errors + 1))
      continue
    fi

    if ! validate_state "$state"; then
      echo "ERROR: Invalid state '$state' for stage $stage" >&2
      errors=$((errors + 1))
      continue
    fi

    if ! validate_stage_state "$stage" "$state"; then
      echo "ERROR: State '$state' not allowed for stage $stage" >&2
      errors=$((errors + 1))
    fi

    if [ "$state" = "active" ]; then
      active_count=$((active_count + 1))
    fi
  done

  # Check active count (0 or 1)
  if [ "$active_count" -gt 1 ]; then
    echo "ERROR: Multiple stages are active (expected 0 or 1)" >&2
    errors=$((errors + 1))
  fi

  [ $errors -eq 0 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# CLI Interface
# ─────────────────────────────────────────────────────────────────────────────

show_help() {
  cat <<'EOF'
statusman.sh - Status Manager CLI

USAGE:
  statusman.sh <subcommand> [args...]
  statusman.sh --help

SUBCOMMANDS:
  Stage queries:
    all-stages                         List all stages in order

  .status.yaml accessors:
    progress-map <change>              Extract stage:state pairs (one per line)
    checklist <change>                 Extract checklist fields (key:value lines)
    confidence <change>                Extract confidence fields (key:value lines)

  Progression:
    current-stage <change>             Detect active stage from .status.yaml
    display-stage <change>             Display stage (where you are) as stage:state
    progress-line <change>             Single-line visual progress (done → active ⏳)

  Validation:
    validate-status-file <change>      Validate .status.yaml against schema

  Event commands:
    start <change> <stage> [driver]            {pending,failed} → active
    advance <change> <stage> [driver]          active → ready
    finish <change> <stage> [driver]           {active,ready} → done (+next)
    reset <change> <stage> [driver]            {done,ready,skipped} → active (+cascade)
    skip <change> <stage> [driver]            {pending,active} → skipped (+cascade)
    fail <change> <stage> [driver] [rework]    active → failed (review only)

  Write commands:
    set-change-type <change> <type>            Set change_type (feat/fix/refactor/docs/test/ci/chore)
    set-checklist <change> <field> <value>      Update checklist field
    set-confidence <change> <certain> <confident> <tentative> <unresolved> <score>
    set-confidence-fuzzy <change> <certain> <confident> <tentative> <unresolved> <score> <mean_s> <mean_r> <mean_a> <mean_d>
    add-issue <change> <id>            Append issue ID to issues array (idempotent)
    get-issues <change>                List issue IDs (one per line)
    add-pr <change> <url>              Append PR URL to prs array (idempotent)
    get-prs <change>                   List PR URLs (one per line)

EXAMPLES:
  statusman.sh all-stages
  statusman.sh progress-map 6boq
  statusman.sh start 6boq spec fab-continue
  statusman.sh finish 6boq spec fab-continue

SEE ALSO:
  src/lib/statusman/SPEC-statusman.md - API reference
  fab/.kit/schemas/workflow.yaml - Schema definition
EOF
}

# ─────────────────────────────────────────────────────────────────────────────
# CLI Dispatch
# ─────────────────────────────────────────────────────────────────────────────

case "${1:-}" in
  --help|-h)
    show_help
    ;;
  "")
    show_help
    ;;

  # ── Stage Queries ──────────────────────────────────────────────────────
  all-stages)
    get_all_stages
    ;;

  # ── .status.yaml Accessors ─────────────────────────────────────────────
  progress-map)
    if [ $# -ne 2 ]; then
      echo "Usage: statusman.sh progress-map <change>" >&2
      exit 1
    fi
    _resolved_file=$(resolve_to_status "$2") || exit 1
    get_progress_map "$_resolved_file"
    ;;
  checklist)
    if [ $# -ne 2 ]; then
      echo "Usage: statusman.sh checklist <change>" >&2
      exit 1
    fi
    _resolved_file=$(resolve_to_status "$2") || exit 1
    get_checklist "$_resolved_file"
    ;;
  confidence)
    if [ $# -ne 2 ]; then
      echo "Usage: statusman.sh confidence <change>" >&2
      exit 1
    fi
    _resolved_file=$(resolve_to_status "$2") || exit 1
    get_confidence "$_resolved_file"
    ;;

  # ── Progression ────────────────────────────────────────────────────────
  current-stage)
    if [ $# -ne 2 ]; then
      echo "Usage: statusman.sh current-stage <change>" >&2
      exit 1
    fi
    _resolved_file=$(resolve_to_status "$2") || exit 1
    get_current_stage "$_resolved_file"
    ;;
  display-stage)
    if [ $# -ne 2 ]; then
      echo "Usage: statusman.sh display-stage <change>" >&2
      exit 1
    fi
    _resolved_file=$(resolve_to_status "$2") || exit 1
    get_display_stage "$_resolved_file"
    ;;
  progress-line)
    if [ $# -ne 2 ]; then
      echo "Usage: statusman.sh progress-line <change>" >&2
      exit 1
    fi
    _resolved_file=$(resolve_to_status "$2") || exit 1
    get_progress_line "$_resolved_file"
    ;;

  # ── Validation ─────────────────────────────────────────────────────────
  validate-status-file)
    if [ $# -ne 2 ]; then
      echo "Usage: statusman.sh validate-status-file <change>" >&2
      exit 1
    fi
    _resolved_file=$(resolve_to_status "$2") || exit 1
    validate_status_file "$_resolved_file"
    ;;

  # ── Event Commands ────────────────────────────────────────────────────
  start)
    if [ $# -lt 3 ] || [ $# -gt 4 ]; then
      echo "Usage: statusman.sh start <change> <stage> [driver]" >&2
      exit 1
    fi
    _resolved_file=$(resolve_to_status "$2") || exit 1
    event_start "$_resolved_file" "$3" "${4:-}"
    ;;
  advance)
    if [ $# -lt 3 ] || [ $# -gt 4 ]; then
      echo "Usage: statusman.sh advance <change> <stage> [driver]" >&2
      exit 1
    fi
    _resolved_file=$(resolve_to_status "$2") || exit 1
    event_advance "$_resolved_file" "$3" "${4:-}"
    ;;
  finish)
    if [ $# -lt 3 ] || [ $# -gt 4 ]; then
      echo "Usage: statusman.sh finish <change> <stage> [driver]" >&2
      exit 1
    fi
    _resolved_file=$(resolve_to_status "$2") || exit 1
    event_finish "$_resolved_file" "$3" "${4:-}"
    ;;
  reset)
    if [ $# -lt 3 ] || [ $# -gt 4 ]; then
      echo "Usage: statusman.sh reset <change> <stage> [driver]" >&2
      exit 1
    fi
    _resolved_file=$(resolve_to_status "$2") || exit 1
    event_reset "$_resolved_file" "$3" "${4:-}"
    ;;
  skip)
    if [ $# -lt 3 ] || [ $# -gt 4 ]; then
      echo "Usage: statusman.sh skip <change> <stage> [driver]" >&2
      exit 1
    fi
    _resolved_file=$(resolve_to_status "$2") || exit 1
    event_skip "$_resolved_file" "$3" "${4:-}"
    ;;
  fail)
    if [ $# -lt 3 ] || [ $# -gt 5 ]; then
      echo "Usage: statusman.sh fail <change> <stage> [driver] [rework]" >&2
      exit 1
    fi
    _resolved_file=$(resolve_to_status "$2") || exit 1
    event_fail "$_resolved_file" "$3" "${4:-}" "${5:-}"
    ;;

  # ── Write Commands ─────────────────────────────────────────────────────
  set-change-type)
    if [ $# -ne 3 ]; then
      echo "Usage: statusman.sh set-change-type <change> <type>" >&2
      exit 1
    fi
    _resolved_file=$(resolve_to_status "$2") || exit 1
    set_change_type "$_resolved_file" "$3"
    ;;
  set-checklist)
    if [ $# -ne 4 ]; then
      echo "Usage: statusman.sh set-checklist <change> <field> <value>" >&2
      exit 1
    fi
    _resolved_file=$(resolve_to_status "$2") || exit 1
    set_checklist_field "$_resolved_file" "$3" "$4"
    ;;
  set-confidence)
    if [ $# -ne 7 ]; then
      echo "Usage: statusman.sh set-confidence <change> <certain> <confident> <tentative> <unresolved> <score>" >&2
      exit 1
    fi
    _resolved_file=$(resolve_to_status "$2") || exit 1
    set_confidence_block "$_resolved_file" "$3" "$4" "$5" "$6" "$7"
    ;;
  set-confidence-fuzzy)
    if [ $# -ne 11 ]; then
      echo "Usage: statusman.sh set-confidence-fuzzy <change> <certain> <confident> <tentative> <unresolved> <score> <mean_s> <mean_r> <mean_a> <mean_d>" >&2
      exit 1
    fi
    _resolved_file=$(resolve_to_status "$2") || exit 1
    set_confidence_block_fuzzy "$_resolved_file" "$3" "$4" "$5" "$6" "$7" "$8" "$9" "${10}" "${11}"
    ;;
  add-issue)
    if [ $# -ne 3 ]; then
      echo "Usage: statusman.sh add-issue <change> <id>" >&2
      exit 1
    fi
    _resolved_file=$(resolve_to_status "$2") || exit 1
    add_issue "$_resolved_file" "$3"
    ;;
  get-issues)
    if [ $# -ne 2 ]; then
      echo "Usage: statusman.sh get-issues <change>" >&2
      exit 1
    fi
    _resolved_file=$(resolve_to_status "$2") || exit 1
    get_issues "$_resolved_file"
    ;;
  add-pr)
    if [ $# -ne 3 ]; then
      echo "Usage: statusman.sh add-pr <change> <url>" >&2
      exit 1
    fi
    _resolved_file=$(resolve_to_status "$2") || exit 1
    add_pr "$_resolved_file" "$3"
    ;;
  get-prs)
    if [ $# -ne 2 ]; then
      echo "Usage: statusman.sh get-prs <change>" >&2
      exit 1
    fi
    _resolved_file=$(resolve_to_status "$2") || exit 1
    get_prs "$_resolved_file"
    ;;
  *)
    echo "Unknown option: $1" >&2
    echo "Try: statusman.sh --help" >&2
    exit 1
    ;;
esac
