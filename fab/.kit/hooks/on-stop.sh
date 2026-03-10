#!/usr/bin/env bash
# fab/.kit/hooks/on-stop.sh — Claude Code Stop hook
#
# Writes agent.idle_since timestamp to .fab-runtime.yaml via fab runtime.
# Fires when the agent finishes a response turn.
# MUST exit 0 always — hooks must never block the agent.

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0

symlink_path="$repo_root/.fab-status.yaml"
[ -L "$symlink_path" ] || exit 0

fab_cmd="$repo_root/fab/.kit/bin/fab"
[ -x "$fab_cmd" ] || exit 0

change_folder="$("$fab_cmd" resolve --folder 2>/dev/null)" || exit 0
[ -n "$change_folder" ] || exit 0

"$fab_cmd" runtime set-idle "$change_folder" 2>/dev/null || true
exit 0
