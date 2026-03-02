#!/usr/bin/env bash
set -euo pipefail

# fab/.kit/sync/2-sync-workspace.sh — Structural bootstrap for fab
#
# Syncs kit assets (directories, skill copies/symlinks, .gitignore entries)
# into the workspace. Idempotent — safe to re-run at any time.

sync_dir="$(cd "$(dirname "$0")" && pwd)"
kit_dir="$(dirname "$sync_dir")"
fab_dir="$(dirname "$kit_dir")"
repo_root="$(dirname "$fab_dir")"

# ── Pre-flight ───────────────────────────────────────────────────────
if [ ! -f "$kit_dir/VERSION" ]; then
  echo "ERROR: fab/.kit/VERSION not found — kit may be corrupted." >&2
  exit 1
fi

version=$(cat "$kit_dir/VERSION")
echo "Found fab/.kit/ (v${version}). Setting up structure..."

# ── Helper functions ─────────────────────────────────────────────────

# frontmatter_field() — sourced from shared library
frontmatter_lib="$kit_dir/scripts/lib/frontmatter.sh"
if [ ! -f "$frontmatter_lib" ]; then
  echo "ERROR: Required library not found: $frontmatter_lib" >&2
  echo "       Ensure your fab kit includes scripts/lib/frontmatter.sh." >&2
  exit 1
fi
source "$frontmatter_lib"

# line_ensure_merge <source> <target> <label>
#   Read non-empty, non-comment lines from <source>. Append to <target> if missing.
#   Creates <target> if absent. Resolves symlinks to real files (legacy migration).
#   Prints Created/Updated/OK status using <label> for display.
line_ensure_merge() {
  local source="$1" target="$2" label="$3"

  # Legacy migration: if target is a symlink, resolve to real file
  if [ -L "$target" ]; then
    local resolved
    resolved="$(cat "$target" 2>/dev/null || true)"
    rm "$target"
    if [ -n "$resolved" ]; then
      printf '%s\n' "$resolved" > "$target"
    fi
    echo "$label: migrated from symlink to file"
  fi

  local existed=false
  [ -f "$target" ] && existed=true
  local added=()

  while IFS= read -r entry || [ -n "$entry" ]; do
    [[ -z "$entry" || "$entry" == \#* ]] && continue
    if [ ! -f "$target" ]; then
      echo "$entry" > "$target"
      added+=("$entry")
    elif ! grep -qxF "$entry" "$target"; then
      echo "" >> "$target"
      echo "$entry" >> "$target"
      added+=("$entry")
    fi
  done < "$source"

  if [ ${#added[@]} -gt 0 ]; then
    if [ "$existed" = false ]; then
      echo "Created: $label (added ${added[*]})"
    else
      echo "Updated: $label (added ${added[*]})"
    fi
  else
    echo "$label: OK"
  fi
}

# json_merge_permissions <source> <target> <label>
#   If <target> absent, copy <source>. If present, merge permissions.allow arrays via jq.
#   Warns and skips if jq is not available.
json_merge_permissions() {
  local source="$1" target="$2" label="$3"

  mkdir -p "$(dirname "$target")"

  if [ ! -f "$target" ]; then
    cp "$source" "$target"
    local count
    count=$(jq '.permissions.allow | length' "$target" 2>/dev/null || echo "?")
    echo "Created: $label ($count permission rules)"
  elif ! command -v jq >/dev/null 2>&1; then
    echo "WARN: jq not found — skipping $label merge"
  else
    local merged
    merged=$(jq -s '
      (.[0].permissions.allow // []) as $scaffold |
      (.[1] // {}) as $existing |
      ($existing.permissions.allow // []) as $current |
      ($scaffold | map(select(. as $s | $current | index($s) | not))) as $new |
      if ($new | length) > 0 then
        $existing | .permissions.allow = ($current + $new)
      else
        $existing
      end
    ' "$source" "$target")
    local new_count
    new_count=$(echo "$merged" | jq '
      (input.permissions.allow // [] | length) as $before |
      (.permissions.allow | length) - $before
    ' - "$target")
    if [ "$new_count" -gt 0 ]; then
      printf '%s\n' "$merged" > "$target"
      echo "Updated: $label (added $new_count permission rules)"
    else
      echo "$label: OK"
    fi
  fi
}

# ── 1. Directories ──────────────────────────────────────────────────
docs_dir="$repo_root/docs"
for dir in "$fab_dir/changes" "$fab_dir/changes/archive" "$docs_dir/memory" "$docs_dir/specs"; do
  if [ ! -d "$dir" ]; then
    mkdir -p "$dir"
    echo "Created: ${dir#"$repo_root"/}"
  fi
done

if [ ! -f "$fab_dir/changes/.gitkeep" ]; then
  touch "$fab_dir/changes/.gitkeep"
fi

if [ ! -f "$fab_dir/changes/archive/.gitkeep" ]; then
  touch "$fab_dir/changes/archive/.gitkeep"
fi

# ── 1b. fab/.kit-migration-version ────────────────────────────────────
# Track the local project's kit version. New projects get the engine version;
# existing projects (have config.yaml) get the base version 0.1.0 so
# `/fab-setup migrations` runs all needed migrations.
migration_version_file="$fab_dir/.kit-migration-version"

# Backward compat: migrate old fab/project/VERSION to new location
if [ -f "$fab_dir/project/VERSION" ]; then
  old_ver=$(cat "$fab_dir/project/VERSION" | tr -d '[:space:]')
  if [ -f "$migration_version_file" ]; then
    # Both exist — new file takes precedence, remove old
    rm "$fab_dir/project/VERSION"
    echo "Cleaned: stale fab/project/VERSION (migrated to fab/.kit-migration-version)"
  else
    # Old exists, new doesn't — migrate
    mv "$fab_dir/project/VERSION" "$migration_version_file"
    echo "Migrated: fab/project/VERSION → fab/.kit-migration-version ($old_ver)"
  fi
fi

if [ -f "$migration_version_file" ]; then
  echo "fab/.kit-migration-version: OK ($(cat "$migration_version_file"))"
elif [ -f "$fab_dir/project/config.yaml" ]; then
  # Existing project: set base version so `/fab-setup migrations` applies migrations
  echo "0.1.0" > "$migration_version_file"
  echo "Created: fab/.kit-migration-version (0.1.0 — existing project, run \`/fab-setup migrations\` to migrate)"
else
  # New project: match engine version
  cp "$kit_dir/VERSION" "$migration_version_file"
  echo "Created: fab/.kit-migration-version ($version)"
fi

# ── 2. Scaffold tree-walk ─────────────────────────────────────────
# Walk scaffold/ recursively. Dispatch based on fragment- prefix:
#   fragment- + .json → json_merge_permissions
#   fragment- + other → line_ensure_merge
#   no prefix         → copy-if-absent
scaffold_dir="$kit_dir/scaffold"

if [ -d "$scaffold_dir" ]; then
  while IFS= read -r scaffold_file; do
    # Compute path relative to scaffold/
    rel_path="${scaffold_file#"$scaffold_dir"/}"
    dir_part="$(dirname "$rel_path")"
    file_name="$(basename "$rel_path")"

    # Strip fragment- prefix if present
    is_fragment=false
    if [[ "$file_name" == fragment-* ]]; then
      is_fragment=true
      file_name="${file_name#fragment-}"
    fi

    # Compute destination path
    if [ "$dir_part" = "." ]; then
      dest_path="$file_name"
    else
      dest_path="$dir_part/$file_name"
    fi

    dest="$repo_root/$dest_path"

    # Ensure parent directory exists
    mkdir -p "$(dirname "$dest")"

    # Dispatch strategy
    if [ "$is_fragment" = true ]; then
      case "$file_name" in
        *.json) json_merge_permissions "$scaffold_file" "$dest" "$dest_path" ;;
        *)      line_ensure_merge "$scaffold_file" "$dest" "$dest_path" ;;
      esac
    else
      # copy-if-absent
      if [ ! -f "$dest" ]; then
        cp "$scaffold_file" "$dest"
        echo "Created: $dest_path"
      fi
    fi
  done < <(find "$scaffold_dir" -type f | sort)
fi

# ── 3. Skill deployment ────────────────────────────────────────────
# Canonical list: every *.md in .kit/skills/ except _preamble.md
skills=()
for f in "$kit_dir"/skills/*.md; do
  [ -f "$f" ] || continue
  [[ "$(basename "$f")" == _*.md ]] && continue
  skills+=("$(basename "$f" .md)")
done

# sync_agent_skills <agent_label> <base_dir> <format> <mode> [<rel_prefix>]
#   format: "directory" → <base>/<name>/SKILL.md, "flat" → <base>/<name>.md
#   mode: "symlink" (needs rel_prefix) or "copy" (copies file content)
#   rel_prefix: symlink mode → relative path from symlink location back to repo root
sync_agent_skills() {
  local agent_label="$1"
  local base_dir="$2"
  local format="$3"
  local mode="$4"
  local rel_prefix="${5:-}"

  mkdir -p "$base_dir"

  local created=0 repaired=0 ok=0

  for skill in "${skills[@]}"; do
    local src="$kit_dir/skills/${skill}.md"
    if [ ! -f "$src" ]; then
      echo "WARN: fab/.kit/skills/${skill}.md missing — skipping"
      continue
    fi

    local dest
    if [ "$format" = "directory" ]; then
      mkdir -p "$base_dir/$skill"
      dest="$base_dir/$skill/SKILL.md"
    else
      dest="$base_dir/${skill}.md"
    fi

    if [ "$mode" = "copy" ]; then
      if [ -n "$rel_prefix" ]; then
        # Copy with sed templating: compare templated content for idempotency
        local expected
        expected=$(sed "$rel_prefix" "$src")
        if [ -f "$dest" ] && [ ! -L "$dest" ]; then
          local current
          current=$(cat "$dest")
          if [ "$expected" = "$current" ]; then
            ok=$((ok + 1))
          else
            printf '%s\n' "$expected" > "$dest"
            repaired=$((repaired + 1))
          fi
        elif [ -e "$dest" ] || [ -L "$dest" ]; then
          rm "$dest"
          printf '%s\n' "$expected" > "$dest"
          repaired=$((repaired + 1))
        else
          printf '%s\n' "$expected" > "$dest"
          created=$((created + 1))
        fi
      else
        # Plain copy: use cmp for byte-accurate comparison
        if [ -f "$dest" ] && [ ! -L "$dest" ] && cmp -s "$src" "$dest"; then
          ok=$((ok + 1))
        elif [ -e "$dest" ] || [ -L "$dest" ]; then
          rm "$dest"
          cp "$src" "$dest"
          repaired=$((repaired + 1))
        else
          cp "$src" "$dest"
          created=$((created + 1))
        fi
      fi
    else
      local target="${rel_prefix}fab/.kit/skills/${skill}.md"
      if [ -L "$dest" ] && [ -e "$dest" ]; then
        ok=$((ok + 1))
      elif [ -L "$dest" ] || [ -e "$dest" ]; then
        rm "$dest"
        ln -s "$target" "$dest"
        repaired=$((repaired + 1))
      else
        ln -s "$target" "$dest"
        created=$((created + 1))
      fi
    fi
  done

  local total=$((created + repaired + ok))
  printf "%-12s %d/%d (created %d, repaired %d, already valid %d)\n" \
    "${agent_label}:" "$total" "${#skills[@]}" "$created" "$repaired" "$ok"
}

# clean_stale_skills <base_dir> <format>
#   Removes skill entries in base_dir that are NOT in the skills[] array.
#   format: "directory" → remove <base>/<name>/ dirs, "flat" → remove <base>/<name>.md files
clean_stale_skills() {
  local base_dir="$1"
  local format="$2"
  local removed=0

  [ -d "$base_dir" ] || return 0

  if [ "$format" = "directory" ]; then
    for entry in "$base_dir"/*/; do
      [ -d "$entry" ] || continue
      local name
      name="$(basename "$entry")"
      local found=false
      for skill in "${skills[@]}"; do
        if [ "$skill" = "$name" ]; then
          found=true
          break
        fi
      done
      if [ "$found" = false ]; then
        rm -rf "$entry"
        removed=$((removed + 1))
      fi
    done
  else
    for entry in "$base_dir"/*.md; do
      [ -f "$entry" ] || [ -L "$entry" ] || continue
      local name
      name="$(basename "$entry" .md)"
      local found=false
      for skill in "${skills[@]}"; do
        if [ "$skill" = "$name" ]; then
          found=true
          break
        fi
      done
      if [ "$found" = false ]; then
        rm -f "$entry"
        removed=$((removed + 1))
      fi
    done
  fi

  if [ "$removed" -gt 0 ]; then
    echo "Cleaned: $removed stale entries from ${base_dir#"$repo_root"/}"
  fi
}

# Claude Code: .claude/skills/<name>/SKILL.md (directory-based, copies)
sync_agent_skills "Claude Code" "$repo_root/.claude/skills" "directory" "copy"
clean_stale_skills "$repo_root/.claude/skills" "directory"

# OpenCode: .opencode/commands/<name>.md (flat file, symlinks)
sync_agent_skills "OpenCode" "$repo_root/.opencode/commands" "flat" "symlink" "../../"
clean_stale_skills "$repo_root/.opencode/commands" "flat"

# Codex: .agents/skills/<name>/SKILL.md (directory-based, copies — Codex ignores symlinks)
sync_agent_skills "Codex" "$repo_root/.agents/skills" "directory" "copy"
clean_stale_skills "$repo_root/.agents/skills" "directory"

# ── 4. Transitional agent cleanup ──────────────────────────────────
# Remove .claude/agents/ files matching known skill names (legacy from
# dual-deployment strategy). Preserves user-created agents.
# TODO: Remove this block after one release cycle.
claude_agents_dir="$repo_root/.claude/agents"
if [ -d "$claude_agents_dir" ]; then
  stale_agents=0
  for agent_file in "$claude_agents_dir"/*.md; do
    [ -f "$agent_file" ] || continue
    local_name="$(basename "$agent_file" .md)"
    for skill in "${skills[@]}"; do
      if [ "$skill" = "$local_name" ]; then
        rm -f "$agent_file"
        stale_agents=$((stale_agents + 1))
        break
      fi
    done
  done
  if [ "$stale_agents" -gt 0 ]; then
    echo "Cleaned: $stale_agents stale agent files from .claude/agents/"
  fi
fi

# ── 5. Sync version stamp ────────────────────────────────────────────
# Record the kit version that was last synced. Preflight compares this
# against fab/.kit/VERSION to detect stale skill deployments.
sync_version_file="$fab_dir/.kit-sync-version"
if [ -f "$sync_version_file" ]; then
  old_sync_ver=$(cat "$sync_version_file" | tr -d '[:space:]')
  if [ "$old_sync_ver" = "$version" ]; then
    echo "fab/.kit-sync-version: OK ($version)"
  else
    printf '%s\n' "$version" > "$sync_version_file"
    echo "Updated: fab/.kit-sync-version ($old_sync_ver → $version)"
  fi
else
  printf '%s\n' "$version" > "$sync_version_file"
  echo "Created: fab/.kit-sync-version ($version)"
fi

echo "Done."
