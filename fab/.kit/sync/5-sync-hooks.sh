#!/usr/bin/env bash
set -euo pipefail

# fab/.kit/sync/5-sync-hooks.sh — Register hook scripts into .claude/settings.local.json
#
# Discovers on-*.sh files in fab/.kit/hooks/, maps filenames to Claude Code
# hook events (with optional matchers), and merges entries into
# .claude/settings.local.json. Idempotent.

sync_dir="$(cd "$(dirname "$0")" && pwd)"
kit_dir="$(dirname "$sync_dir")"
fab_dir="$(dirname "$kit_dir")"
repo_root="$(dirname "$fab_dir")"

hooks_dir="$kit_dir/hooks"
settings_file="$repo_root/.claude/settings.local.json"

# ── Collect hook scripts ─────────────────────────────────────────────
hooks=()
for script in "$hooks_dir"/on-*.sh; do
  [ -f "$script" ] || continue
  hooks+=("$(basename "$script")")
done

# No hooks to register — silent skip
if [ ${#hooks[@]} -eq 0 ]; then
  exit 0
fi

# Need jq for JSON merging
if ! command -v jq >/dev/null 2>&1; then
  echo "WARN: jq not found -- skipping hook sync"
  exit 0
fi

# ── Mapping table: filename → event:matcher pairs ────────────────────
# Each entry is "filename|event|matcher". A single script can appear
# multiple times with different matchers.
HOOK_MAPPINGS=(
  "on-session-start.sh|SessionStart|"
  "on-stop.sh|Stop|"
  "on-artifact-write.sh|PostToolUse|Write"
  "on-artifact-write.sh|PostToolUse|Edit"
)

# ── Build desired hooks JSON ─────────────────────────────────────────
# Construct a JSON object: { "EventName": [{"matcher":"...","hooks":[{"type":"command","command":"..."}]}], ... }
desired='{}'

for mapping in "${HOOK_MAPPINGS[@]}"; do
  IFS='|' read -r hook_file event matcher <<< "$mapping"

  # Only register if the script actually exists in the hooks directory
  found=false
  for h in "${hooks[@]}"; do
    if [ "$h" = "$hook_file" ]; then
      found=true
      break
    fi
  done
  $found || continue

  entry=$(jq -n --arg cmd "bash fab/.kit/hooks/$hook_file" --arg matcher "$matcher" \
    '{"matcher":$matcher,"hooks":[{"type":"command","command":$cmd}]}')
  desired=$(echo "$desired" | jq --arg ev "$event" --argjson entry "$entry" \
    '.[$ev] = ((.[$ev] // []) + [$entry])')
done

# ── Ensure settings file exists ──────────────────────────────────────
mkdir -p "$(dirname "$settings_file")"
if [ ! -f "$settings_file" ]; then
  echo '{}' > "$settings_file"
fi

# ── Merge hooks into settings ────────────────────────────────────────
# For each event in desired hooks, append matcher entries that don't already exist
# (duplicate detection by matcher + hooks[].command pair).
merged=$(jq --argjson desired "$desired" '
  reduce ($desired | to_entries[]) as $ev (
    .;
    reduce $ev.value[] as $new_entry (
      .;
      ($new_entry.hooks[0].command) as $cmd |
      ($new_entry.matcher) as $mat |
      if ((.hooks[$ev.key] // []) | map(select(.matcher == $mat)) | [.[].hooks[].command] | index($cmd)) then
        .
      else
        .hooks[$ev.key] = ((.hooks[$ev.key] // []) + [$new_entry])
      end
    )
  )
' "$settings_file")

# ── Detect changes and write ─────────────────────────────────────────
existing_hooks=$(jq -cS '.hooks // {}' "$settings_file")
new_hooks=$(echo "$merged" | jq -cS '.hooks // {}')

if [ "$existing_hooks" = "$new_hooks" ]; then
  echo ".claude/settings.local.json hooks: OK"
else
  # Count new entries
  existing_count=$(echo "$existing_hooks" | jq -r '[.[]? | length] | add // 0')
  new_count=$(echo "$new_hooks" | jq -r '[.[]? | length] | add // 0')
  added=$((new_count - existing_count))

  printf '%s\n' "$merged" > "$settings_file"

  if [ "$existing_count" -eq 0 ]; then
    echo "Created: .claude/settings.local.json hooks ($new_count hook entries)"
  else
    echo "Updated: .claude/settings.local.json hooks (added $added hook entries)"
  fi
fi
