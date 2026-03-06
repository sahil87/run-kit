#!/usr/bin/env bash
set -euo pipefail

# Check that all required system dependencies are installed.

ok=0
warn=0

check() {
  if command -v "$1" &>/dev/null; then
    printf "  ✓ %s\n" "$1"
  else
    printf "  ✗ %s — %s\n" "$1" "$2"
    (( "$3" )) && ok=1 || warn=1
  fi
}

echo "Required:"
check node    "https://nodejs.org/"         1
check pnpm    "https://pnpm.io/"            1
check tmux    "https://github.com/tmux/tmux" 1
check just    "https://github.com/casey/just" 1

echo ""
echo "Optional (HTTPS):"
check caddy   "brew install caddy"          0

echo ""
if (( ok )); then
  echo "Some required dependencies are missing."
  echo "Install all at once:  brew install node pnpm tmux just caddy"
  exit 1
elif (( warn )); then
  echo "All required dependencies found. Some optional ones are missing."
  exit 0
else
  echo "All dependencies found."
  exit 0
fi
