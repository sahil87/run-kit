#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Building frontend..."
cd "$REPO_ROOT/app/frontend"
pnpm build

echo "==> Copying frontend dist to backend embed directory..."
rm -rf "$REPO_ROOT/app/backend/build/frontend"
cp -r "$REPO_ROOT/app/frontend/dist" "$REPO_ROOT/app/backend/build/frontend"
# Restore .gitkeep so the embed directory stays tracked in git
touch "$REPO_ROOT/app/backend/build/frontend/.gitkeep"

echo "==> Copying tmux.conf to backend embed directory..."
cp "$REPO_ROOT/config/tmux.conf" "$REPO_ROOT/app/backend/internal/tmux/tmux.conf"

VERSION="$(cat "$REPO_ROOT/VERSION")"
echo "==> Building run-kit v${VERSION}..."

cd "$REPO_ROOT/app/backend"
mkdir -p "$REPO_ROOT/dist"
CGO_ENABLED=0 go build -ldflags "-X main.version=${VERSION}" -o "$REPO_ROOT/dist/run-kit" ./cmd/run-kit

echo "==> Built dist/run-kit (v${VERSION})"
