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

VERSION="$(cat "$REPO_ROOT/VERSION")"
echo "==> Building rk v${VERSION}..."

cd "$REPO_ROOT/app/backend"
mkdir -p "$REPO_ROOT/dist"
CGO_ENABLED=0 go build -ldflags "-X main.version=${VERSION}" -o "$REPO_ROOT/dist/rk" ./cmd/rk

# macOS: build the virtual display helper if dependencies are available
if [ "$(uname)" = "Darwin" ] && [ -f "$REPO_ROOT/tools/rk-virtual-display/Makefile" ]; then
  if brew --prefix libvncserver &>/dev/null; then
    echo "==> Building rk-virtual-display (macOS virtual display helper)..."
    make -C "$REPO_ROOT/tools/rk-virtual-display" clean all
    cp "$REPO_ROOT/tools/rk-virtual-display/rk-virtual-display" "$REPO_ROOT/dist/"
    echo "==> Built dist/rk-virtual-display"
  else
    echo "==> Skipping rk-virtual-display (libvncserver not installed: brew install libvncserver)"
  fi
fi

echo "==> Built dist/rk (v${VERSION})"
