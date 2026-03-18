#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION_FILE="$REPO_ROOT/VERSION"

usage() {
    echo "Usage: $0 <patch|minor|major>"
    exit 1
}

[ $# -eq 1 ] || usage

BUMP="$1"

# Abort if working tree has uncommitted changes
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Error: working tree is not clean. Commit or stash changes before releasing."
    exit 1
fi

CURRENT="$(cat "$VERSION_FILE")"

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

case "$BUMP" in
    patch) PATCH=$((PATCH + 1)) ;;
    minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
    major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
    *) usage ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
TAG="v${NEW_VERSION}"

echo "Bumping version: ${CURRENT} -> ${NEW_VERSION}"
printf '%s' "$NEW_VERSION" > "$VERSION_FILE"

cd "$REPO_ROOT"
git add VERSION
git commit -m "$TAG"
git tag "$TAG"
git push
git push origin "$TAG"

echo "Released ${TAG}"
