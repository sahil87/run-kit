#!/usr/bin/env bash
set -euo pipefail

# fab/.kit/sync/4-get-fab-binary.sh — Ensure the Go binary is present
#
# Downloads the platform-specific fab binary from GitHub Releases if missing.
# Skipped gracefully when gh CLI is unavailable or the release lacks a binary.
# Idempotent — safe to re-run.

sync_dir="$(cd "$(dirname "$0")" && pwd)"
kit_dir="$(dirname "$sync_dir")"
fab_dir="$(dirname "$kit_dir")"
bin_dir="$kit_dir/bin"

# Already present — nothing to do
if [ -x "$bin_dir/fab-go" ]; then
  echo "fab binary: OK"
  return 0 2>/dev/null || exit 0
fi

# Need gh CLI to download
if ! command -v gh &>/dev/null; then
  echo "fab binary: skipped (gh CLI not found)"
  return 0 2>/dev/null || exit 0
fi

# Read version and repo from kit
version=$(cat "$kit_dir/VERSION" | tr -d '[:space:]')
repo=$(grep -E '^repo=' "$kit_dir/kit.conf" | cut -d= -f2 | tr -d '[:space:]')
tag="v${version}"

# Detect platform
detect_os=$(uname -s | tr '[:upper:]' '[:lower:]')
detect_arch=$(uname -m)
case "$detect_arch" in
  x86_64)  detect_arch="amd64" ;;
  aarch64) detect_arch="arm64" ;;
esac

platform_archive="kit-${detect_os}-${detect_arch}.tar.gz"

# Download to temp
tmp_dir=$(mktemp -d)
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup EXIT

if ! gh release download "$tag" --repo "$repo" --pattern "$platform_archive" --dir "$tmp_dir" 2>/dev/null; then
  echo "fab binary: skipped (no release asset for ${detect_os}/${detect_arch})"
  exit 0
fi

# Extract just the binary
if ! tar xzf "$tmp_dir/$platform_archive" -C "$tmp_dir" .kit/bin/fab-go 2>/dev/null; then
  echo "fab binary: skipped (archive lacks binary)"
  exit 0
fi

# Install
mkdir -p "$bin_dir"
cp "$tmp_dir/.kit/bin/fab-go" "$bin_dir/fab-go"
chmod +x "$bin_dir/fab-go"
echo "fab binary: installed (${detect_os}/${detect_arch})"
