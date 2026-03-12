#!/usr/bin/env bash
set -euo pipefail

# fab/.kit/sync/4-get-fab-binary.sh — Ensure kit binaries are present and up-to-date
#
# Downloads the platform-specific kit binaries from GitHub Releases if missing
# or if the installed version doesn't match the kit VERSION file.
# Skipped gracefully when gh CLI is unavailable or the release lacks binaries.
# Idempotent — safe to re-run.

sync_dir="$(cd "$(dirname "$0")" && pwd)"
kit_dir="$(dirname "$sync_dir")"
fab_dir="$(dirname "$kit_dir")"
bin_dir="$kit_dir/bin"

# All binaries that ship in the platform archive
kit_binaries=("fab-go" "wt" "idea")

# Read expected version from kit
version=$(cat "$kit_dir/VERSION" | tr -d '[:space:]')

# Determine if we need to download: version mismatch or missing binaries
need_download=false
download_reason=""

if [ -x "$bin_dir/fab-go" ]; then
  # fab-go exists — check its version
  # Parse "fab version X.Y.Z" → "X.Y.Z"; treat failure as outdated
  installed_version=$("$bin_dir/fab-go" -v 2>/dev/null | awk '{print $NF}') || installed_version=""
  if [ "$installed_version" != "$version" ]; then
    need_download=true
    download_reason="outdated (${installed_version:-unknown} → ${version})"
  fi
else
  need_download=true
  download_reason="missing"
fi

# Even if version matches, check for individually missing binaries
if [ "$need_download" = false ]; then
  missing=()
  for bin in "${kit_binaries[@]}"; do
    if [ ! -x "$bin_dir/$bin" ]; then
      missing+=("$bin")
    fi
  done
  if [ ${#missing[@]} -gt 0 ]; then
    need_download=true
    download_reason="missing ${missing[*]}"
  fi
fi

if [ "$need_download" = false ]; then
  echo "kit binaries: OK (${version})"
  return 0 2>/dev/null || exit 0
fi

# Need gh CLI to download
if ! command -v gh &>/dev/null; then
  echo "kit binaries: skipped (gh CLI not found, ${download_reason})"
  return 0 2>/dev/null || exit 0
fi

# Read repo from kit config
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
  echo "kit binaries: skipped (no release asset for ${detect_os}/${detect_arch})"
  exit 0
fi

# Extract all binaries from archive
extract_args=()
for bin in "${kit_binaries[@]}"; do
  extract_args+=(".kit/bin/$bin")
done

if ! tar xzf "$tmp_dir/$platform_archive" -C "$tmp_dir" "${extract_args[@]}" 2>/dev/null; then
  echo "kit binaries: skipped (archive lacks binaries)"
  exit 0
fi

# Install all binaries
mkdir -p "$bin_dir"
for bin in "${kit_binaries[@]}"; do
  cp "$tmp_dir/.kit/bin/$bin" "$bin_dir/$bin"
  chmod +x "$bin_dir/$bin"
done
echo "kit binaries: installed ${kit_binaries[*]} (${version}, ${download_reason})"
