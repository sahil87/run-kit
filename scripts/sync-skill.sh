#!/usr/bin/env bash
# Copy the canonical docs/site/skill.md into the cmd/rk package so it can be
# embedded via //go:embed. The Go module root is app/backend/ and docs/site/
# sits above it, so embed cannot reach the canonical file directly — this copy
# step bridges the gap (Constitution VIII: thin justfile, logic in scripts/).
# The committed copy is what a clean `go build ./...` (which does not run this
# script) compiles; TestSkillEmbedMatchesCanonical keeps it byte-honest against
# docs/site/skill.md on every `go test`.
set -euo pipefail

# Run from the repo root regardless of caller CWD.
cd "$(dirname "$0")/.."

SRC="docs/site/skill.md"
DEST="app/backend/cmd/rk/skill/skill.md"

mkdir -p "$(dirname "$DEST")"
cp -f "$SRC" "$DEST"
echo "synced skill bundle: $SRC -> $DEST"
