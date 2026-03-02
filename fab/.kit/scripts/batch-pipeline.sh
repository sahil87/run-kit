#!/usr/bin/env bash
# ---
# name: batch-pipeline
# description: "Run a pipeline manifest — dispatches fab changes in dependency order"
# ---
set -euo pipefail

# batch-pipeline.sh — Entry point for the pipeline orchestrator
#
# Usage: batch-pipeline.sh [<manifest>] [--list] [-h|--help]
#
# If the argument contains no path separator and no .yaml extension,
# resolves it as fab/pipelines/{name}.yaml via partial name matching.
# No arguments or --list lists available pipelines.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PIPELINES_DIR="$REPO_ROOT/fab/pipelines"

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------

usage() {
  cat <<'EOF'
Usage: batch-pipeline.sh [<manifest>] [--list] [-h|--help]

Pipeline orchestrator — dispatches fab changes in dependency order.

Arguments:
  <manifest>    Pipeline name, partial name, or path to manifest YAML
                Bare names resolve to fab/pipelines/{name}.yaml
  --list        List available pipeline manifests
  -h, --help    Show this help message

Examples:
  batch-pipeline.sh my-feature          →  fab/pipelines/my-feature.yaml
  batch-pipeline.sh feat                →  partial match against fab/pipelines/*.yaml
  batch-pipeline.sh ./custom/path.yaml  →  passed through to run.sh unchanged
EOF
}

# ---------------------------------------------------------------------------
# List Pipelines
# ---------------------------------------------------------------------------

list_pipelines() {
  local found=0
  for f in "$PIPELINES_DIR"/*.yaml; do
    [[ -f "$f" ]] || continue
    local name
    name="$(basename "$f" .yaml)"
    [[ "$name" == "example" ]] && continue
    echo "$name"
    found=1
  done

  if [[ "$found" -eq 0 ]]; then
    echo "No pipelines found." >&2
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Name Resolution
# ---------------------------------------------------------------------------

resolve_pipeline() {
  local query="$1"
  local query_lower
  query_lower="$(echo "$query" | tr '[:upper:]' '[:lower:]')"

  local matches=()
  for f in "$PIPELINES_DIR"/*.yaml; do
    [[ -f "$f" ]] || continue
    local name
    name="$(basename "$f" .yaml)"
    [[ "$name" == "example" ]] && continue
    local name_lower
    name_lower="$(echo "$name" | tr '[:upper:]' '[:lower:]')"

    # Exact match wins immediately
    if [[ "$name_lower" == "$query_lower" ]]; then
      echo "$PIPELINES_DIR/$name.yaml"
      return 0
    fi

    # Substring match
    if [[ "$name_lower" == *"$query_lower"* ]]; then
      matches+=("$name")
    fi
  done

  if [[ ${#matches[@]} -eq 0 ]]; then
    echo "No pipeline matches '$query'." >&2
    return 1
  elif [[ ${#matches[@]} -eq 1 ]]; then
    echo "$PIPELINES_DIR/${matches[0]}.yaml"
    return 0
  else
    echo "Multiple pipelines match '$query': $(IFS=,; echo "${matches[*]}")" >&2
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

# No arguments → list
if [[ $# -eq 0 ]]; then
  list_pipelines
  exit $?
fi

case "$1" in
  -h|--help)
    usage
    exit 0
    ;;
  --list)
    list_pipelines
    exit $?
    ;;
esac

manifest="$1"
shift

# Explicit path (contains / or ends with .yaml) → pass through
if [[ "$manifest" == */* || "$manifest" == *.yaml ]]; then
  exec bash "$SCRIPT_DIR/pipeline/run.sh" "$manifest" "$@"
fi

# Bare name → resolve via partial matching
resolved=$(resolve_pipeline "$manifest") || exit 1
exec bash "$SCRIPT_DIR/pipeline/run.sh" "$resolved" "$@"
