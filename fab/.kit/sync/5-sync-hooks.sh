#!/usr/bin/env bash
set -euo pipefail
sync_dir="$(cd "$(dirname "$0")" && pwd)"
kit_dir="$(dirname "$sync_dir")"
"$kit_dir/bin/fab" hook sync 2>/dev/null || echo "WARN: fab binary not found — skipping hook sync"
