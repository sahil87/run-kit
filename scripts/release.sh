#!/usr/bin/env bash
set -euo pipefail

# scripts/release.sh — Compute the next tag, create it, and push it.
#
# CI takes over from the tag push to cross-compile, package, create
# the GitHub Release, and update the Homebrew tap formula.
# (see .github/workflows/release.yml)
#
# This script is tag-driven: it does NOT modify any tracked files
# (no VERSION file write, no commit). The git tag itself is the
# version source of truth.
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

# ── Parse arguments ──────────────────────────────────────────────────

bump_type=""

for arg in "$@"; do
  case "$arg" in
    patch|minor|major)
      if [ -n "$bump_type" ]; then
        echo "ERROR: Multiple bump types specified: '$bump_type' and '$arg'." >&2
        echo "" >&2
        usage >&2
        exit 1
      fi
      bump_type="$arg"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: Unknown argument '$arg'. Use: patch, minor, or major." >&2
      echo "" >&2
      usage >&2
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

# ── Resolve repo root (only after we know we have real work to do) ───

repo_root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"

# ── Pre-flight ───────────────────────────────────────────────────────

if [ -n "$(git -C "$repo_root" status --porcelain)" ]; then
  echo "ERROR: Working tree not clean. Commit or stash changes first." >&2
  exit 1
fi

branch=$(git -C "$repo_root" branch --show-current)
if [ -z "$branch" ]; then
  echo "ERROR: Not on a branch (detached HEAD). Check out a branch before releasing." >&2
  exit 1
fi

# ── Compute current and next version ─────────────────────────────────

current=$(git -C "$repo_root" tag -l 'v*' --sort=-v:refname | head -n1)
current=${current:-v0.0.0}

current_stripped="${current#v}"
IFS='.' read -r major minor patch <<< "$current_stripped"

case "$bump_type" in
  patch) patch=$((patch + 1)) ;;
  minor) minor=$((minor + 1)); patch=0 ;;
  major) major=$((major + 1)); minor=0; patch=0 ;;
esac

new_version="${major}.${minor}.${patch}"
new_tag="v${new_version}"

echo "Releasing $new_tag ($current → $new_tag)"

# ── Tag and push ─────────────────────────────────────────────────────

git -C "$repo_root" tag "$new_tag"
git -C "$repo_root" push origin "$new_tag"

echo ""
echo "Done — $new_tag pushed. CI will cross-compile, create the GitHub Release, and update the Homebrew tap."
