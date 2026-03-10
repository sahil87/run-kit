#!/usr/bin/env bash
exec "$(dirname "$0")/../bin/fab" hook stop 2>/dev/null; exit 0
