#!/usr/bin/env bash
set -euo pipefail

# fab/.kit/scripts/fab-upgrade.sh — Update fab/.kit/ from GitHub Releases
#
# Usage: fab-upgrade.sh [<tag>]
#
# Downloads the platform-specific kit archive (or generic kit.tar.gz as fallback)
# from the specified release tag or latest release. Atomically replaces fab/.kit/,
# displays the version change, and re-runs fab-sync.sh to repair directories and agents.
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

# ── Determine repo and platform ─────────────────────────────────────

repo=$(grep -E '^repo=' "$kit_dir/kit.conf" | cut -d= -f2 | tr -d '[:space:]')
tag="${1:-}"

# Detect platform
detect_os=$(uname -s | tr '[:upper:]' '[:lower:]')
detect_arch=$(uname -m)
case "$detect_arch" in
  x86_64)  detect_arch="amd64" ;;
  aarch64) detect_arch="arm64" ;;
  # arm64 stays as-is
esac

platform_archive="kit-${detect_os}-${detect_arch}.tar.gz"
echo "Platform: ${detect_os}/${detect_arch}"

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

download_archive() {
  local pattern="$1"
  local label="$2"
  if [ -n "$tag" ]; then
    echo "Downloading $label ($tag) from $repo..."
    gh release download "$tag" --repo "$repo" --pattern "$pattern" --dir "$tmp_dir" 2>/dev/null
  else
    echo "Downloading $label (latest) from $repo..."
    gh release download --repo "$repo" --pattern "$pattern" --dir "$tmp_dir" 2>/dev/null
  fi
}

# Try platform-specific archive first, fall back to generic
archive_file=""
if download_archive "$platform_archive" "$platform_archive"; then
  archive_file="$tmp_dir/$platform_archive"
elif download_archive "kit.tar.gz" "kit.tar.gz (generic fallback)"; then
  echo "Platform ${detect_os}/${detect_arch} not available, using generic archive"
  archive_file="$tmp_dir/kit.tar.gz"
else
  if [ -n "$tag" ]; then
    echo "ERROR: Failed to download kit archive for tag '$tag' from $repo."
    echo "       Check that the tag exists: gh release view $tag --repo $repo"
  else
    echo "ERROR: Failed to download kit archive from $repo. Check network and repo access."
  fi
  exit 1
fi

# ── Extract to temp ──────────────────────────────────────────────────

echo "Extracting..."

if ! tar xzf "$archive_file" -C "$tmp_dir" 2>/dev/null; then
  echo "ERROR: Failed to extract kit archive."
  exit 1
fi

# ── Verify extraction ────────────────────────────────────────────────

if [ ! -f "$tmp_dir/.kit/VERSION" ]; then
  echo "ERROR: Extraction verification failed. Existing .kit/ unchanged."
  exit 1
fi

new_version=$(cat "$tmp_dir/.kit/VERSION" | tr -d '[:space:]')

# ── Already up to date? ─────────────────────────────────────────────

if [ "$current_version" = "$new_version" ] && [ -x "$kit_dir/bin/fab-go" ]; then
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

# Report if binary is included
if [ -x "$kit_dir/bin/fab-go" ]; then
  echo "Go binary: included (${detect_os}/${detect_arch})"
else
  echo "Go binary: not included (shell scripts only)"
fi

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
