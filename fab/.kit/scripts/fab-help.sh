#!/usr/bin/env bash
set -euo pipefail

# fab/.kit/scripts/fab-help.sh — Print Fab Kit help overview
#
# Dynamically reads skill names and descriptions from YAML frontmatter
# in fab/.kit/skills/. Group assignments are maintained in this script.
#
# Run from anywhere: fab/.kit/scripts/fab-help.sh
# Safe to re-run (read-only, no side effects).

kit_dir="$(cd "$(dirname "$0")/.." && pwd)"

# Source shared frontmatter parser
source "$kit_dir/scripts/lib/frontmatter.sh"

if [ -f "$kit_dir/VERSION" ]; then
  version=$(cat "$kit_dir/VERSION")
else
  version="unknown"
fi

# ── Group mapping ────────────────────────────────────────────────────
# Display groups and their members. Order here = display order.
# Skills not listed in any group appear under "Other" at the end.
declare -a group_order=(
  "Start & Navigate"
  "Planning"
  "Completion"
  "Maintenance"
  "Setup"
  "Batch Operations"
)

declare -A skill_to_group=(
  [fab-new]="Start & Navigate"
  [fab-switch]="Start & Navigate"
  [fab-status]="Start & Navigate"
  [fab-discuss]="Start & Navigate"
  [fab-continue]="Planning"
  [fab-ff]="Planning"
  [fab-fff]="Planning"
  [fab-clarify]="Planning"
  [fab-archive]="Completion"
  [git-pr]="Completion"
  [docs-hydrate-specs]="Maintenance"
  [docs-reorg-specs]="Maintenance"
  [docs-reorg-memory]="Maintenance"
  [fab-setup]="Setup"
  [fab-help]="Setup"
  [docs-hydrate-memory]="Setup"
)

declare -A batch_to_group=(
  [batch-pipeline]="Batch Operations"
  [batch-pipeline-series]="Batch Operations"
  [batch-fab-switch-change]="Batch Operations"
  [batch-fab-archive-change]="Batch Operations"
  [batch-fab-new-backlog]="Batch Operations"
)

# ── Scan skill files ─────────────────────────────────────────────────
# Collect name:description pairs from frontmatter.
# Exclude _* (partials) and internal-* (internal tooling).
declare -A skill_descs=()
discovered_skills=()

for f in "$kit_dir"/skills/*.md; do
  [ -f "$f" ] || continue
  base="$(basename "$f" .md)"

  # Exclude partials and internal skills
  [[ "$base" == _* ]] && continue
  [[ "$base" == internal-* ]] && continue

  # Skip files without frontmatter
  if ! head -1 "$f" | grep -q '^---$'; then
    continue
  fi

  name=$(frontmatter_field "$f" "name")
  desc=$(frontmatter_field "$f" "description")

  [ -z "$name" ] && continue
  [ -z "$desc" ] && continue

  skill_descs[$name]="$desc"
  discovered_skills+=("$name")
done

# ── Scan batch scripts ───────────────────────────────────────────────
# Collect name:description pairs from shell-comment frontmatter.
declare -A batch_descs=()
discovered_batches=()

for f in "$kit_dir"/scripts/batch-*.sh; do
  [ -f "$f" ] || continue

  name=$(shell_frontmatter_field "$f" "name")
  desc=$(shell_frontmatter_field "$f" "description")

  [ -z "$name" ] && continue
  [ -z "$desc" ] && continue

  batch_descs[$name]="$desc"
  discovered_batches+=("$name")
done

# ── Compute dynamic alignment ───────────────────────────────────────
# Find the longest display name (including / prefix) across all entries.
max_len=0
for name in "${discovered_skills[@]}"; do
  display="/$name"
  len=${#display}
  if [ "$len" -gt "$max_len" ]; then
    max_len=$len
  fi
done

# Also account for batch script display names (no / prefix)
for name in "${discovered_batches[@]}"; do
  len=${#name}
  if [ "$len" -gt "$max_len" ]; then
    max_len=$len
  fi
done

# Also account for hardcoded non-skill entries
hardcoded_name="fab-sync.sh"
if [ ${#hardcoded_name} -gt "$max_len" ]; then
  max_len=${#hardcoded_name}
fi

# Minimum 2 spaces between name and description
pad_to=$((max_len + 2))

# format_entry <display_name> <description>
format_entry() {
  local display="$1" desc="$2"
  local name_len=${#display}
  local spaces=$((pad_to - name_len))
  printf "    %s%*s%s\n" "$display" "$spaces" "" "$desc"
}

# ── Render output ────────────────────────────────────────────────────
echo "Fab Kit v${version} — Specification-Driven Development"
echo ""
echo "WORKFLOW"
echo ""
echo "  /fab-new ─→ /fab-continue (or /fab-ff) ─→ /fab-archive"
echo "               ↕ /fab-clarify"
echo ""
echo "  Planning stages: spec → tasks"
echo "  Execution stages: apply → review → hydrate"
echo ""
echo "COMMANDS"

# Track which skills have been rendered (to find unmapped ones)
declare -A rendered=()

for group in "${group_order[@]}"; do
  echo ""
  echo "  $group"

  # Render skills in this group (in discovery order)
  for name in "${discovered_skills[@]}"; do
    if [ "${skill_to_group[$name]:-}" = "$group" ]; then
      format_entry "/$name" "${skill_descs[$name]}"
      rendered[$name]=1
    fi
  done

  # Render batch scripts in this group (in discovery order, no / prefix)
  for name in "${discovered_batches[@]}"; do
    if [ "${batch_to_group[$name]:-}" = "$group" ]; then
      format_entry "$name" "${batch_descs[$name]}"
    fi
  done

  # Render hardcoded non-skill entries for Setup group
  if [ "$group" = "Setup" ]; then
    format_entry "fab-sync.sh" "Repair directories and agents (no LLM needed)"
  fi
done

# Render "Other" group for unmapped skills
other_skills=()
for name in "${discovered_skills[@]}"; do
  if [ -z "${rendered[$name]:-}" ]; then
    other_skills+=("$name")
  fi
done

if [ ${#other_skills[@]} -gt 0 ]; then
  echo ""
  echo "  Other"
  for name in "${other_skills[@]}"; do
    format_entry "/$name" "${skill_descs[$name]}"
  done
fi

echo ""
echo "TYPICAL FLOW"
echo ""
echo "  Quick change:  /fab-new → /fab-ff → /fab-archive"
echo "  Careful change: /fab-new → /fab-continue (repeat) → /fab-archive"
echo "  Maintain docs:  /docs-hydrate-memory, /docs-hydrate-specs, /docs-reorg-specs, /docs-reorg-memory"
echo ""
echo "PACKAGES"
echo ""
echo "    wt create, wt list, wt open, wt delete, wt init          Git worktree management"
echo "    idea                                                     Per-repo backlog (fab/backlog.md)"
echo ""
echo "    Run <command> help for details."
