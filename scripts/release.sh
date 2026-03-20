#!/usr/bin/env bash
set -euo pipefail

# scripts/release.sh — Bump VERSION, commit, tag, and push.
#
# CI takes over from the tag push to cross-compile, package, create
# the GitHub Release, and update the Homebrew tap formula.
# (see .github/workflows/release.yml)
#
# Usage: release.sh <patch|minor|major>
#   patch — 0.1.0 → 0.1.1
#   minor — 0.1.0 → 0.2.0
#   major — 0.1.0 → 1.0.0

usage() {
  echo "Usage: release.sh <patch|minor|major>"
  echo ""
  echo "  patch — bump patch version (e.g. 0.1.0 → 0.1.1)"
  echo "  minor — bump minor version (e.g. 0.1.0 → 0.2.0)"
  echo "  major — bump major version (e.g. 0.1.0 → 1.0.0)"
}

repo_root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"

# ── Parse arguments ──────────────────────────────────────────────────

bump_type=""

for arg in "$@"; do
  case "$arg" in
    patch|minor|major)
      if [ -n "$bump_type" ]; then
        echo "ERROR: Multiple bump types specified: '$bump_type' and '$arg'."
        echo ""
        usage
        exit 1
      fi
      bump_type="$arg"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: Unknown argument '$arg'. Use: patch, minor, or major."
      echo ""
      usage
      exit 1
      ;;
  esac
done

if [ -z "$bump_type" ]; then
  usage
  if [ $# -gt 0 ]; then
    exit 1
  fi
  exit 0
fi

# ── Pre-flight ───────────────────────────────────────────────────────

if [ -n "$(git -C "$repo_root" status --porcelain)" ]; then
  echo "ERROR: Working tree not clean. Commit or stash changes first."
  exit 1
fi

branch=$(git -C "$repo_root" branch --show-current)
if [ -z "$branch" ]; then
  echo "ERROR: Not on a branch (detached HEAD). Check out a branch before releasing."
  exit 1
fi

# ── Bump version ─────────────────────────────────────────────────────

version_file="$repo_root/VERSION"
if [ ! -f "$version_file" ]; then
  echo "ERROR: VERSION file not found."
  exit 1
fi

current=$(cat "$version_file" | tr -d '[:space:]')
IFS='.' read -r major minor patch <<< "$current"

case "$bump_type" in
  patch) patch=$((patch + 1)) ;;
  minor) minor=$((minor + 1)); patch=0 ;;
  major) major=$((major + 1)); minor=0; patch=0 ;;
esac

version="${major}.${minor}.${patch}"
tag="v${version}"

echo "Releasing $tag ($current → $version)"

printf '%s' "$version" > "$version_file"

# ── Commit, tag, and push ───────────────────────────────────────────

git -C "$repo_root" add VERSION
git -C "$repo_root" commit -m "$tag"
git -C "$repo_root" tag "$tag"
git -C "$repo_root" push origin HEAD:"$branch" "$tag"

echo ""
echo "Done — $tag pushed"
echo "CI will cross-compile, create the GitHub Release, and update the Homebrew tap."
