#!/usr/bin/env bash
set -euo pipefail

# fab/.kit/scripts/fab-sync.sh — Single entry point for workspace sync
#
# Iterates kit-level sync scripts (fab/.kit/sync/*.sh), then project-specific
# sync scripts (fab/sync/*.sh) in sorted order. Replaces worktree-init.sh.
#
# Run from anywhere: fab/.kit/scripts/fab-sync.sh
# Safe to re-run (idempotent).

scripts_dir="$(cd "$(dirname "$0")" && pwd)"
kit_dir="$(dirname "$scripts_dir")"
fab_dir="$(dirname "$kit_dir")"

echo "fab-sync: running kit-level scripts..."
for script in "$kit_dir"/sync/*.sh; do
  [ -f "$script" ] || continue
  echo "  → $(basename "$script")"
  bash "$script"
done

if [ -d "$fab_dir/sync" ]; then
  echo "fab-sync: running project-specific scripts..."
  for script in "$fab_dir"/sync/*.sh; do
    [ -f "$script" ] || continue
    echo "  → $(basename "$script")"
    bash "$script"
  done
fi

echo "fab-sync: complete."
