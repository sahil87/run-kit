#!/usr/bin/env bash
set -euo pipefail

fab_root="$(dirname "$0")/../../.."
scripts_dir="$(cd "$(dirname "$0")/.." && pwd)"
kit_dir="$fab_root/.kit"

# --- Test-build guard ---
# kit.conf declares build-type. If "test", block usage and show warning.
if [ -f "$kit_dir/kit.conf" ]; then
  _build_type=$(grep -E '^build-type=' "$kit_dir/kit.conf" | cut -d= -f2 | tr -d '[:space:]')
  if [ "$_build_type" = "test" ]; then
    _repo=$(grep -E '^repo=' "$kit_dir/kit.conf" | cut -d= -f2 | tr -d '[:space:]')
    cat >&2 <<OOPS

  ╔══════════════════════════════════════════════════════════╗
  ║        ** THIS IS THE TEST VERSION OF FAB-KIT **         ║
  ║                                                          ║
  ║  The first rule of test builds:                          ║
  ║  you do not ship test builds.                            ║
  ║                                                          ║
  ║  I am the all-singing, all-dancing                       ║
  ║  crap of the CI pipeline.                                ║
  ║                                                          ║
  ║  The real one: github.com/$(printf "%-26s" "$_repo")     ║
  ╚══════════════════════════════════════════════════════════╝

OOPS
    exit 1
  fi
fi

# CLI entry points (subprocess calls, not sourced)
STATUSMAN="$scripts_dir/lib/statusman.sh"
CHANGEMAN="$scripts_dir/lib/changeman.sh"

# 1. Project initialization validation
if [ ! -f "$fab_root/project/config.yaml" ] || [ ! -f "$fab_root/project/constitution.md" ]; then
  echo "fab/ is not initialized. Run /fab-setup first." >&2
  exit 1
fi

# 1b. Sync staleness check (non-blocking — warning only)
if [ -f "$fab_root/.kit/VERSION" ]; then
  _kit_ver=$(cat "$fab_root/.kit/VERSION" | tr -d '[:space:]')
  _sync_ver_file="$fab_root/.kit-sync-version"
  if [ -f "$_sync_ver_file" ]; then
    _sync_ver=$(cat "$_sync_ver_file" | tr -d '[:space:]')
    if [ "$_kit_ver" != "$_sync_ver" ]; then
      echo "⚠ Skills out of sync — run fab-sync.sh to refresh (engine $_kit_ver, last synced $_sync_ver)" >&2
    fi
  else
    echo "⚠ Skills may be out of sync — run fab-sync.sh to refresh" >&2
  fi
fi

# 2. Resolve change name — from $1 override or fab/current
override="${1:-}"

if ! name=$("$CHANGEMAN" resolve "$override"); then
  # Add context-appropriate guidance to changeman's generic error
  if [ -n "$override" ]; then
    echo "Provide a more specific name." >&2
  else
    echo "Run /fab-new to start one." >&2
  fi
  exit 1
fi

# 3. Change directory validation
change_dir="$fab_root/changes/$name"
if [ ! -d "$change_dir" ]; then
  echo "Change directory not found: changes/$name/" >&2
  exit 1
fi

# 4. .status.yaml validation
status_file="$change_dir/.status.yaml"
if [ ! -f "$status_file" ]; then
  echo "Active change \"$name\" is corrupted — .status.yaml not found." >&2
  exit 1
fi

# 5. Schema validation — catch state/stage violations early
if ! "$STATUSMAN" validate-status-file "$status_file"; then
  echo "Status file validation failed for \"$name\". Fix .status.yaml or run /fab-new." >&2
  exit 1
fi

# --- All validations passed — emit structured YAML to stdout ---

# Extract progress via statusman CLI
declare -A progress
while IFS=: read -r s val; do
  progress[$s]="$val"
done < <("$STATUSMAN" progress-map "$status_file")

# Derive current stage via statusman CLI
stage=$("$STATUSMAN" current-stage "$status_file")

# Derive display stage via statusman CLI
display_output=$("$STATUSMAN" display-stage "$status_file")
display_stage="${display_output%%:*}"
display_state="${display_output#*:}"

# Extract checklist via statusman CLI
declare -A checklist
while IFS=: read -r key val; do
  checklist[$key]="$val"
done < <("$STATUSMAN" checklist "$status_file")

# Extract confidence via statusman CLI
declare -A confidence
while IFS=: read -r key val; do
  confidence[$key]="$val"
done < <("$STATUSMAN" confidence "$status_file")

# Emit YAML output with dynamic stage progress
cat <<EOF
name: $name
change_dir: fab/changes/$name
stage: $stage
display_stage: $display_stage
display_state: $display_state
progress:
$("$STATUSMAN" all-stages | while read -r s; do echo "  $s: ${progress[$s]}"; done)
checklist:
  generated: ${checklist[generated]}
  completed: ${checklist[completed]}
  total: ${checklist[total]}
confidence:
  certain: ${confidence[certain]}
  confident: ${confidence[confident]}
  tentative: ${confidence[tentative]}
  unresolved: ${confidence[unresolved]}
  score: ${confidence[score]}
EOF
