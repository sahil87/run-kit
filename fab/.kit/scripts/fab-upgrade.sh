#!/usr/bin/env bash
set -euo pipefail

# fab/.kit/scripts/fab-upgrade.sh — Update fab/.kit/ from GitHub Releases
#
# Usage: fab-upgrade.sh [<tag>]
#
# Downloads kit.tar.gz from the specified release tag (e.g. v0.24.0) or the
# latest release if no tag is given. Atomically replaces fab/.kit/, displays
# the version change, and re-runs fab-sync.sh to repair directories and agents.
#
# Requires: gh CLI (https://cli.github.com/)
# Safe to re-run. Existing project files (config.yaml, memory/, etc.) are never touched.

scripts_dir="$(cd "$(dirname "$0")" && pwd)"
kit_dir="$(dirname "$scripts_dir")"
fab_dir="$(dirname "$kit_dir")"

# ── Pre-flight ───────────────────────────────────────────────────────

# Check gh CLI
if ! command -v gh &>/dev/null; then
  echo "ERROR: gh CLI not found. Install it from https://cli.github.com/"
  exit 1
fi

# Read current version
if [ ! -f "$kit_dir/VERSION" ]; then
  echo "ERROR: fab/.kit/VERSION not found — kit may be corrupted."
  exit 1
fi

current_version=$(cat "$kit_dir/VERSION" | tr -d '[:space:]')
echo "Current version: $current_version"

# ── Determine repo ───────────────────────────────────────────────────

repo=$(grep -E '^repo=' "$kit_dir/kit.conf" | cut -d= -f2 | tr -d '[:space:]')
tag="${1:-}"

# ── Download ─────────────────────────────────────────────────────────

# Clean up any leftover temp dir from a previous interrupted run
tmp_dir="$fab_dir/.kit-update-tmp"
if [ -d "$tmp_dir" ]; then
  rm -rf "$tmp_dir"
fi
mkdir -p "$tmp_dir"

# Set up cleanup trap
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

if [ -n "$tag" ]; then
  echo "Downloading release $tag from $repo..."
  if ! gh release download "$tag" --repo "$repo" --pattern 'kit.tar.gz' --dir "$tmp_dir" 2>/dev/null; then
    echo "ERROR: Failed to download kit.tar.gz for tag '$tag' from $repo."
    echo "       Check that the tag exists: gh release view $tag --repo $repo"
    exit 1
  fi
else
  echo "Downloading latest release from $repo..."
  if ! gh release download --repo "$repo" --pattern 'kit.tar.gz' --dir "$tmp_dir" 2>/dev/null; then
    echo "ERROR: Failed to download kit.tar.gz from $repo. Check network and repo access."
    exit 1
  fi
fi

# ── Extract to temp ──────────────────────────────────────────────────

echo "Extracting..."

if ! tar xzf "$tmp_dir/kit.tar.gz" -C "$tmp_dir" 2>/dev/null; then
  echo "ERROR: Failed to extract kit.tar.gz."
  exit 1
fi

# ── Verify extraction ────────────────────────────────────────────────

if [ ! -f "$tmp_dir/.kit/VERSION" ]; then
  echo "ERROR: Extraction verification failed. Existing .kit/ unchanged."
  exit 1
fi

new_version=$(cat "$tmp_dir/.kit/VERSION" | tr -d '[:space:]')

# ── Already up to date? ─────────────────────────────────────────────

if [ "$current_version" = "$new_version" ]; then
  if [ -n "$tag" ]; then
    echo "Already on $tag ($current_version). No update needed."
  else
    echo "Already on the latest version ($current_version). No update needed."
  fi
  exit 0
fi

# ── Atomic swap ──────────────────────────────────────────────────────

echo "Updating: $current_version → $new_version"

rm -rf "$kit_dir"
mv "$tmp_dir/.kit" "$kit_dir"

echo "fab/.kit/ updated successfully."

# ── Re-run setup ─────────────────────────────────────────────────────

echo ""
echo "Running fab-sync.sh to repair directories and agents..."
bash "$kit_dir/scripts/fab-sync.sh"

# ── Completion ───────────────────────────────────────────────────────

echo ""
echo "Update complete: $current_version → $new_version"

if [ -f "$fab_dir/.kit-migration-version" ]; then
  local_version=$(cat "$fab_dir/.kit-migration-version" | tr -d '[:space:]')
  if [ "$local_version" != "$new_version" ]; then
    echo ""
    echo "⚠ Run \`/fab-setup migrations\` to update project files ($local_version → $new_version)"
  fi
else
  echo ""
  echo "⚠ Run \`/fab-setup\` to initialize, then \`/fab-setup migrations\`"
fi
