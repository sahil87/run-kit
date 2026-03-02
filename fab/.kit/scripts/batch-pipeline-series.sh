#!/usr/bin/env bash
# ---
# name: batch-pipeline-series
# description: "Run a sequential chain of changes — generates manifest and delegates to the orchestrator"
# ---
set -euo pipefail

# batch-pipeline-series.sh — Run changes in a simple sequential chain
#
# Usage: batch-pipeline-series <change> [<change>...] [--base <branch>]
#
# Generates a temporary manifest with a linear dependency chain
# (change1 → change2 → change3) and delegates to pipeline/run.sh.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PIPELINES_DIR="$REPO_ROOT/fab/pipelines"

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------

usage() {
  cat <<'EOF'
Usage: batch-pipeline-series <change> [<change>...] [--base <branch>]

Run changes in a simple sequential chain (A → B → C).

Generates a temporary manifest with linear dependencies and delegates
to the pipeline orchestrator. Exits when all changes complete (finite mode).

Arguments:
  <change>      Change name or ID (one or more)
  --base <br>   Base branch for the first change (default: current branch)
  -h, --help    Show this help message

Examples:
  batch-pipeline-series 260222-a7k2-user-model
  batch-pipeline-series 260222-a7k2-user-model 260222-b3m1-auth
  batch-pipeline-series change-a change-b change-c --base main
EOF
}

# ---------------------------------------------------------------------------
# Argument Parsing
# ---------------------------------------------------------------------------

changes=()
base_branch=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --base)
      if [[ $# -lt 2 ]]; then
        echo "Error: --base requires a branch name" >&2
        exit 1
      fi
      base_branch="$2"
      shift 2
      ;;
    -*)
      echo "Error: unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      changes+=("$1")
      shift
      ;;
  esac
done

# Validate minimum 1 change
if [[ ${#changes[@]} -lt 1 ]]; then
  echo "Error: at least 1 change required" >&2
  usage >&2
  exit 1
fi

# Default base to current branch
if [[ -z "$base_branch" ]]; then
  base_branch=$(git branch --show-current 2>/dev/null || true)
  if [[ -z "$base_branch" ]]; then
    base_branch="main"
  fi
fi

# ---------------------------------------------------------------------------
# Manifest Generation
# ---------------------------------------------------------------------------

mkdir -p "$PIPELINES_DIR"
manifest_path="$PIPELINES_DIR/.series-$(date +%s)-$$.yaml"

{
  echo "base: \"$base_branch\""
  echo "changes:"
  local_prev=""
  for ((i = 0; i < ${#changes[@]}; i++)); do
    echo "  - id: \"${changes[$i]}\""
    if [[ -z "$local_prev" ]]; then
      echo "    depends_on: []"
    else
      echo "    depends_on: [\"$local_prev\"]"
    fi
    local_prev="${changes[$i]}"
  done
} > "$manifest_path"

echo "Generated manifest: $manifest_path"
echo "Chain: ${changes[*]}"
echo "Base: $base_branch"
echo ""

# ---------------------------------------------------------------------------
# Delegate to run.sh
# ---------------------------------------------------------------------------

exec bash "$SCRIPT_DIR/pipeline/run.sh" "$manifest_path"
