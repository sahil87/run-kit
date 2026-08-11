#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Copying tmux config to backend embed directory..."
cp "$REPO_ROOT/configs/tmux/default.conf" "$REPO_ROOT/app/backend/build/tmux.conf"

echo "==> Building frontend..."
cd "$REPO_ROOT/app/frontend"
pnpm build

echo "==> Copying frontend dist to backend embed directory..."
rm -rf "$REPO_ROOT/app/backend/build/frontend"
cp -r "$REPO_ROOT/app/frontend/dist" "$REPO_ROOT/app/backend/build/frontend"
# Restore .gitkeep so the embed directory stays tracked in git
touch "$REPO_ROOT/app/backend/build/frontend/.gitkeep"

# Version comes from the latest git tag (fallback 0.0.0-dev), mirroring
# build-desktop.sh — there is deliberately NO VERSION file in this repo
# (tag-driven release flow, ea750837).
VERSION="$(git describe --tags --abbrev=0 2>/dev/null || true)"
VERSION="${VERSION#v}"
[ -n "$VERSION" ] || VERSION="0.0.0-dev"
echo "==> Building rk v${VERSION}..."

cd "$REPO_ROOT/app/backend"
mkdir -p "$REPO_ROOT/dist"
CGO_ENABLED=0 go build -ldflags "-X main.version=${VERSION}" -o "$REPO_ROOT/dist/rk" ./cmd/rk

echo "==> Built dist/rk (v${VERSION})"
