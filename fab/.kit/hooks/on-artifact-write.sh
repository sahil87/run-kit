#!/usr/bin/env bash
# fab/.kit/hooks/on-artifact-write.sh — Claude Code PostToolUse hook (Write/Edit)
#
# Detects fab artifact writes and triggers bookkeeping commands automatically.
# Registered for both PostToolUse Write and PostToolUse Edit matchers.
# MUST exit 0 always — bookkeeping failures must not interrupt the agent.

# Read stdin JSON (PostToolUse hook payload)
input="$(cat)"

# Extract file_path from tool_input — prefer JSON-safe parsing with jq when available
if command -v jq >/dev/null 2>&1; then
  file_path="$(printf '%s' "$input" | jq -r '(.tool_input.file_path? // .file_path? // empty)' 2>/dev/null)"
else
  # Fallback: simple string extraction (not fully JSON-safe)
  file_path="$(printf '%s' "$input" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//;s/"$//')"
fi
[ -n "$file_path" ] || exit 0

# Fast path: check if the path matches a fab artifact pattern
case "$file_path" in
  */fab/changes/*/intake.md|*/fab/changes/*/spec.md|*/fab/changes/*/tasks.md|*/fab/changes/*/checklist.md) ;;
  fab/changes/*/intake.md|fab/changes/*/spec.md|fab/changes/*/tasks.md|fab/changes/*/checklist.md) ;;
  *) exit 0 ;;
esac

# Derive change folder name from path
# Strip everything up to and including "fab/changes/", then strip the "/artifact.md" suffix
change_folder="${file_path#*fab/changes/}"
artifact="${change_folder##*/}"
change_folder="${change_folder%/*}"
[ -n "$change_folder" ] || exit 0
[ -n "$artifact" ] || exit 0

# Locate fab CLI
repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
fab_cmd="$repo_root/fab/.kit/bin/fab"
[ -x "$fab_cmd" ] || exit 0

# Verify the change resolves
"$fab_cmd" resolve --folder "$change_folder" >/dev/null 2>&1 || exit 0

context_parts=()

case "$artifact" in
  intake.md)
    # Infer change type from intake content via keyword matching
    # Resolve absolute path for reading
    if [[ "$file_path" = /* ]]; then
      abs_path="$file_path"
    else
      abs_path="$repo_root/$file_path"
    fi
    if [ -f "$abs_path" ]; then
      content="$(cat "$abs_path" 2>/dev/null)"
    else
      content=""
    fi

    change_type="feat"
    content_lower="$(printf '%s' "$content" | tr '[:upper:]' '[:lower:]')"
    if printf '%s' "$content_lower" | grep -qiE '\b(fix|bug|broken|regression)\b'; then
      change_type="fix"
    elif printf '%s' "$content_lower" | grep -qiE '\b(refactor|restructure|consolidate|split|rename|redesign)\b'; then
      change_type="refactor"
    elif printf '%s' "$content_lower" | grep -qiE '\b(docs|document|readme|guide)\b'; then
      change_type="docs"
    elif printf '%s' "$content_lower" | grep -qiE '\b(test|spec|coverage)\b'; then
      change_type="test"
    elif printf '%s' "$content_lower" | grep -qiE '\b(ci|pipeline|deploy|build)\b'; then
      change_type="ci"
    elif printf '%s' "$content_lower" | grep -qiE '\b(chore|cleanup|maintenance|housekeeping)\b'; then
      change_type="chore"
    fi

    "$fab_cmd" status set-change-type "$change_folder" "$change_type" 2>/dev/null || true
    context_parts+=("type: $change_type")

    score_out="$("$fab_cmd" score --stage intake "$change_folder" 2>/dev/null)" || true
    if [ -n "$score_out" ]; then
      score_val="$(printf '%s' "$score_out" | grep -o 'score:[[:space:]]*[0-9.]*' | head -1 | sed 's/score:[[:space:]]*//')"
      [ -n "$score_val" ] && context_parts+=("score: $score_val")
    fi
    ;;

  spec.md)
    score_out="$("$fab_cmd" score "$change_folder" 2>/dev/null)" || true
    if [ -n "$score_out" ]; then
      score_val="$(printf '%s' "$score_out" | grep -o 'score:[[:space:]]*[0-9.]*' | head -1 | sed 's/score:[[:space:]]*//')"
      [ -n "$score_val" ] && context_parts+=("score: $score_val")
    fi
    ;;

  tasks.md)
    if [[ "$file_path" = /* ]]; then
      abs_path="$file_path"
    else
      abs_path="$repo_root/$file_path"
    fi
    if [ -f "$abs_path" ]; then
      count="$(grep -c '^\- \[ \]' "$abs_path" 2>/dev/null)" || count=0
    else
      count=0
    fi
    "$fab_cmd" status set-checklist "$change_folder" total "$count" 2>/dev/null || true
    context_parts+=("tasks total: $count")
    ;;

  checklist.md)
    if [[ "$file_path" = /* ]]; then
      abs_path="$file_path"
    else
      abs_path="$repo_root/$file_path"
    fi
    "$fab_cmd" status set-checklist "$change_folder" generated true 2>/dev/null || true
    if [ -f "$abs_path" ]; then
      count="$(grep -cE '^\- \[(x| )\]' "$abs_path" 2>/dev/null)" || count=0
    else
      count=0
    fi
    "$fab_cmd" status set-checklist "$change_folder" total "$count" 2>/dev/null || true
    "$fab_cmd" status set-checklist "$change_folder" completed 0 2>/dev/null || true
    context_parts+=("checklist generated, total: $count")
    ;;
esac

# Return additionalContext JSON
if [ ${#context_parts[@]} -gt 0 ]; then
  ctx="Bookkeeping: $(IFS=', '; echo "${context_parts[*]}")"
  printf '{"additionalContext":"%s"}\n' "$ctx"
fi

exit 0
