#!/usr/bin/env bash
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
"$ROOT/fab/.kit/bin/fab" hook session-start 2>/dev/null; exit 0
