#!/usr/bin/env bash
# Build desktop-shell packages: DMGs (mac), NSIS installer (win), or
# AppImage + deb (linux). Target comes from the optional argument
# (mac|win|linux) and defaults to the host platform.
#
# Version comes from the latest git tag (fallback 0.0.0-dev) and is injected
# via electron-builder --config.extraMetadata.version so the packaged
# package.json → app.getVersion() → runkitShell.version all agree. There is
# deliberately NO VERSION file in this repo.
set -euo pipefail

cd "$(dirname "$0")/../app/desktop"

if [ "$#" -gt 1 ]; then
  echo "usage: build-desktop.sh [mac|win|linux]  (default: host platform)" >&2
  exit 1
fi

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  case "$(uname -s)" in
    Darwin) TARGET=mac ;;
    Linux) TARGET=linux ;;
    MINGW* | MSYS* | CYGWIN*) TARGET=win ;;
    *)
      echo "error: unsupported host platform '$(uname -s)' — pass an explicit target (mac|win|linux)" >&2
      exit 1
      ;;
  esac
fi

case "$TARGET" in
  mac) PLATFORM_FLAG=--mac ;;
  win) PLATFORM_FLAG=--win ;;
  linux) PLATFORM_FLAG=--linux ;;
  *)
    echo "usage: build-desktop.sh [mac|win|linux]  (default: host platform)" >&2
    exit 1
    ;;
esac

VERSION="$(git describe --tags --abbrev=0 2>/dev/null || true)"
VERSION="${VERSION#v}"
[ -n "$VERSION" ] || VERSION="0.0.0-dev"

if [ ! -f build/icon.png ]; then
  echo "error: app/desktop/build/icon.png missing — run 'just icons' first" >&2
  exit 1
fi

pnpm install --frozen-lockfile
pnpm run compile
pnpm exec electron-builder "$PLATFORM_FLAG" --publish never --config.extraMetadata.version="$VERSION"

echo "Built $TARGET packages (version $VERSION) in app/desktop/release/"
