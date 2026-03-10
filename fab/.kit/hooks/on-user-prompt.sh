#!/usr/bin/env bash
exec "$(dirname "$0")/../bin/fab" hook user-prompt 2>/dev/null; exit 0
