#!/usr/bin/env bash
exec "$(dirname "$0")/../bin/fab" hook session-start 2>/dev/null; exit 0
