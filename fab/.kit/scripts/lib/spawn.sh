#!/usr/bin/env bash
# Shared helper: read agent spawn command from config.yaml
fab_spawn_cmd() {
  local config="$1"
  local cmd
  cmd=$(yq -r '.agent.spawn_command // empty' "$config" 2>/dev/null || true)
  if [[ -z "$cmd" ]]; then
    cmd="claude --dangerously-skip-permissions"
  fi
  printf '%s' "$cmd"
}
