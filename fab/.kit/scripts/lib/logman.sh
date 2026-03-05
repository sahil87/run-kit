#!/usr/bin/env bash
# fab/.kit/scripts/lib/logman.sh
#
# History Logger — append-only JSON logging to .history.jsonl.
# No reads, no .status.yaml touches. Side-effect: appends one JSON line.
#
# Usage:
#   logman.sh command <cmd> [change] [args]
#   logman.sh confidence <change> <score> <delta> <trigger>
#   logman.sh review <change> <result> [rework]
#   logman.sh transition <change> <stage> <action> [from] [reason] [driver]
#   logman.sh --help

set -euo pipefail
LIB_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
RESOLVE="$LIB_DIR/resolve.sh"

show_help() {
  cat <<'EOF'
logman.sh - History Logger (append-only)

USAGE:
  logman.sh command <cmd> [change] [args]
  logman.sh confidence <change> <score> <delta> <trigger>
  logman.sh review <change> <result> [rework]
  logman.sh transition <change> <stage> <action> [from] [reason] [driver]
  logman.sh --help

SUBCOMMANDS:
  command     Log a skill invocation (change optional — resolves via fab/current)
  confidence  Log a confidence score change
  review      Log a review outcome
  transition  Log a stage transition (enter or re-entry)

ARGS:
  <cmd>     Skill or command name (always required for command subcommand)
  <change>  Change reference (any form accepted by resolve.sh)

EXAMPLES:
  logman.sh command "fab-continue" 9fg2 "spec"
  logman.sh command "fab-discuss"
  logman.sh confidence 9fg2 4.1 "+0.5" "calc-score"
  logman.sh review 9fg2 "passed"
  logman.sh review 9fg2 "failed" "fix-code"
  logman.sh transition 9fg2 spec enter "" "" "fab-ff"
  logman.sh transition 9fg2 apply re-entry review fix-code "fab-ff"
EOF
}

# resolve_change_dir <change> — get directory path via resolve.sh --dir
resolve_change_dir() {
  local dir
  dir=$("$RESOLVE" --dir "$1") || return 1
  # Trim trailing slash for consistent path joining
  echo "${dir%/}"
}

case "${1:-}" in
  --help|-h)
    show_help
    ;;
  command)
    if [ $# -lt 2 ] || [ $# -gt 4 ]; then
      echo "Usage: logman.sh command <cmd> [change] [args]" >&2
      exit 1
    fi
    cmd="$2"
    change="${3:-}"
    args="${4:-}"

    # Resolve change directory — behavior depends on whether change was provided
    if [ -n "$change" ]; then
      # Explicit change: fail loudly if it doesn't resolve
      change_dir=$(resolve_change_dir "$change") || exit 1
    else
      # No change arg: delegate to resolve.sh (reads fab/current internally).
      # Guard: only fire when an explicit active change pointer exists.
      # Deliberately skips resolve.sh's single-change guess fallback.
      current_file="$LIB_DIR/../../../current"
      [ -f "$current_file" ] || exit 0
      change_dir=$("$RESOLVE" --dir 2>/dev/null) || exit 0
      # Trim trailing slash for consistent path joining
      change_dir="${change_dir%/}"
      [ -d "$change_dir" ] || exit 0
    fi

    now=$(date -Iseconds)

    json="{\"ts\":\"${now}\",\"event\":\"command\",\"cmd\":\"${cmd}\""
    if [ -n "$args" ]; then
      json="${json},\"args\":\"${args}\""
    fi
    json="${json}}"

    echo "$json" >> "${change_dir}/.history.jsonl"
    ;;
  confidence)
    if [ $# -ne 5 ]; then
      echo "Usage: logman.sh confidence <change> <score> <delta> <trigger>" >&2
      exit 1
    fi
    change_dir=$(resolve_change_dir "$2") || exit 1
    score="$3"
    delta="$4"
    trigger="$5"
    now=$(date -Iseconds)

    echo "{\"ts\":\"${now}\",\"event\":\"confidence\",\"score\":${score},\"delta\":\"${delta}\",\"trigger\":\"${trigger}\"}" >> "${change_dir}/.history.jsonl"
    ;;
  review)
    if [ $# -lt 3 ] || [ $# -gt 4 ]; then
      echo "Usage: logman.sh review <change> <result> [rework]" >&2
      exit 1
    fi
    change_dir=$(resolve_change_dir "$2") || exit 1
    result="$3"
    rework="${4:-}"
    now=$(date -Iseconds)

    json="{\"ts\":\"${now}\",\"event\":\"review\",\"result\":\"${result}\""
    if [ -n "$rework" ]; then
      json="${json},\"rework\":\"${rework}\""
    fi
    json="${json}}"

    echo "$json" >> "${change_dir}/.history.jsonl"
    ;;
  transition)
    if [ $# -lt 4 ] || [ $# -gt 7 ]; then
      echo "Usage: logman.sh transition <change> <stage> <action> [from] [reason] [driver]" >&2
      exit 1
    fi
    change_dir=$(resolve_change_dir "$2") || exit 1
    stage="$3"
    action="$4"
    from="${5:-}"
    reason="${6:-}"
    driver="${7:-}"
    now=$(date -Iseconds)

    json="{\"ts\":\"${now}\",\"event\":\"stage-transition\",\"stage\":\"${stage}\",\"action\":\"${action}\""
    if [ -n "$from" ]; then
      json="${json},\"from\":\"${from}\""
    fi
    if [ -n "$reason" ]; then
      json="${json},\"reason\":\"${reason}\""
    fi
    if [ -n "$driver" ]; then
      json="${json},\"driver\":\"${driver}\""
    fi
    json="${json}}"

    echo "$json" >> "${change_dir}/.history.jsonl"
    ;;
  "")
    echo "ERROR: No subcommand provided. Try: logman.sh --help" >&2
    exit 1
    ;;
  *)
    echo "Unknown subcommand: $1" >&2
    echo "Try: logman.sh --help" >&2
    exit 1
    ;;
esac
