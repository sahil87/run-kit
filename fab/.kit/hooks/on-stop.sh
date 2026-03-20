#!/usr/bin/env bash
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
"$ROOT/fab/.kit/bin/fab" hook stop 2>/dev/null; exit 0
