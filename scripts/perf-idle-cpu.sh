#!/usr/bin/env bash
# Idle-CPU probe (just perf-idle-cpu ...) against a LIVE rk daemon.
#
# Thin wrapper: the probe itself is scripts/perf-idle-cpu.mjs, which owns every
# flag (`--help` is authoritative there). This script only (1) refuses to start
# without Playwright — a fresh worktree has no app/frontend/node_modules until
# `just setup` runs — and (2) supplies the default base URL when the caller
# passed no --url. The default comes from `rk url`, which reports the address
# the daemon WOULD bind (a heuristic, no liveness probe): a 0.0.0.0 host is
# rewritten to 127.0.0.1 because the bind address is not a connectable client
# target. rk absent or failing falls back silently to the daemon's config
# default — the toolkit's fail-silent rk rule. "No daemon there" surfaces as
# the probe's own load failure (exit 1), not here.
#
# No NODE_PATH: ESM `import` ignores it. The probe resolves Playwright from
# app/frontend via createRequire, so it runs from any cwd.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_URL="http://127.0.0.1:3000"

if [ ! -d "$REPO_ROOT/app/frontend/node_modules/@playwright/test" ]; then
  echo "perf-idle-cpu: Playwright not installed — run \`just setup\` (or \`pnpm install --frozen-lockfile\` in app/frontend)" >&2
  exit 1
fi

has_url=0
for arg in "$@"; do
  case "$arg" in
    --url|--url=*) has_url=1 ;;
  esac
done

if [ "$has_url" -eq 0 ]; then
  base="$DEFAULT_URL"
  if command -v rk >/dev/null 2>&1; then
    if resolved="$(rk url --quiet 2>/dev/null)" && [ -n "$resolved" ]; then
      base="${resolved/\/\/0.0.0.0:/\/\/127.0.0.1:}"
    fi
  fi
  set -- --url "$base" "$@"
fi

exec node "$SCRIPT_DIR/perf-idle-cpu.mjs" "$@"
