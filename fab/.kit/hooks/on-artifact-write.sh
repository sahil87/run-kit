#!/usr/bin/env bash
exec "$(dirname "$0")/../bin/fab" hook artifact-write 2>/dev/null; exit 0
