#!/usr/bin/env bash
# Build ad-hoc-signed macOS DMGs for the desktop shell (run on a Mac).
#
# Version comes from the latest git tag (fallback 0.0.0-dev) and is injected
# via electron-builder --config.extraMetadata.version so the packaged
# package.json → app.getVersion() → runkitShell.version all agree. There is
# deliberately NO VERSION file in this repo.
set -euo pipefail

cd "$(dirname "$0")/../app/desktop"

VERSION="$(git describe --tags --abbrev=0 2>/dev/null || true)"
VERSION="${VERSION#v}"
[ -n "$VERSION" ] || VERSION="0.0.0-dev"

if [ ! -f build/icon.png ]; then
  echo "error: app/desktop/build/icon.png missing — run 'just icons' first" >&2
  exit 1
fi

pnpm install --frozen-lockfile
pnpm run compile
pnpm exec electron-builder --mac --publish never --config.extraMetadata.version="$VERSION"

echo "Built DMGs (version $VERSION) in app/desktop/release/"
