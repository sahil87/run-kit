#!/usr/bin/env bash
set -euo pipefail

# fab/.kit/scripts/fab-doctor.sh — Validate fab-kit prerequisites
#
# Checks all required tools are installed and properly configured.
# Accumulates all failures before reporting. Exit code = failure count.
#
# Usage: fab/.kit/scripts/fab-doctor.sh [--porcelain]
#
# --porcelain   Quiet mode: only print errors, suppress passes/hints/summary.
#               Useful for scripted callers (e.g., worktree creation).
#
# Run standalone: fab/.kit/scripts/fab-doctor.sh
# Also called by: sync/1-prerequisites.sh (exec delegate), /fab-setup (early gate)

porcelain=false
if [[ "${1:-}" == "--porcelain" ]]; then
  porcelain=true
fi

failures=0
total=8

if [[ "$porcelain" == false ]]; then
  echo "fab-doctor: checking prerequisites..."
fi

# ── Helper ──────────────────────────────────────────────────────────

pass() {
  if [[ "$porcelain" == false ]]; then
    echo "  ✓ $1"
  fi
}

fail() {
  if [[ "$porcelain" == true ]]; then
    echo "$1"
  else
    echo "  ✗ $1"
  fi
  ((failures++)) || true
}

hint() {
  if [[ "$porcelain" == false ]]; then
    echo "    $1"
  fi
}

# ── 1. git ──────────────────────────────────────────────────────────

if command -v git &>/dev/null; then
  ver=$(git --version | sed 's/git version //')
  pass "git $ver"
else
  fail "git — not found"
  hint "Install: brew install git"
fi

# ── 2. bash ─────────────────────────────────────────────────────────

if command -v bash &>/dev/null; then
  ver=$(bash --version | head -1 | sed 's/.*version \([^ (]*\).*/\1/')
  pass "bash $ver"
else
  fail "bash — not found"
  hint "Install: brew install bash"
fi

# ── 3. yq ───────────────────────────────────────────────────────────

if command -v yq &>/dev/null; then
  yq_ver_raw=$(yq --version 2>&1)
  yq_ver=$(echo "$yq_ver_raw" | sed 's/.*version v\{0,1\}//' | sed 's/ .*//')
  yq_major=$(echo "$yq_ver" | cut -d. -f1)
  if ! [[ "$yq_major" =~ ^[0-9]+$ ]]; then
    fail "yq — could not parse version from: $yq_ver_raw"
    hint "Expected yq v4+ (Mike Farah). Install: brew install yq"
  elif [ "$yq_major" -ge 4 ]; then
    pass "yq $yq_ver"
  else
    fail "yq $yq_ver — version 4+ required (you have the Python version)"
    hint "Install the Go version: brew install yq"
  fi
else
  fail "yq — not found"
  hint "Install: brew install yq"
fi

# ── 4. jq ───────────────────────────────────────────────────────────

if command -v jq &>/dev/null; then
  ver=$(jq --version | sed 's/^jq-//')
  pass "jq $ver"
else
  fail "jq — not found"
  hint "Install: brew install jq"
fi

# ── 5. gh ───────────────────────────────────────────────────────────

if command -v gh &>/dev/null; then
  ver=$(gh --version | head -1 | sed 's/.*version //' | sed 's/ .*//')
  pass "gh $ver"
else
  fail "gh — not found"
  hint "Install: brew install gh"
fi

# ── 6. bats ─────────────────────────────────────────────────────────

if command -v bats &>/dev/null; then
  ver=$(bats --version | sed 's/.*Bats //' | sed 's/ .*//')
  pass "bats $ver"
else
  fail "bats — not found"
  hint "Install: brew install bats-core"
fi

# ── 7. parallel ────────────────────────────────────────────────────

if command -v parallel &>/dev/null; then
  ver=$(parallel --version | head -1 | sed 's/.*parallel //' | sed 's/ .*//')
  pass "parallel $ver"
else
  fail "parallel — not found"
  hint "Install: brew install parallel"
fi

# ── 8. direnv ───────────────────────────────────────────────────────

if command -v direnv &>/dev/null; then
  ver=$(direnv version)
  shell_name=$(basename "${SHELL:-bash}")

  hook_checked=true
  hook_active=false
  case "$shell_name" in
    zsh)
      if zsh -i -c 'typeset -f _direnv_hook' &>/dev/null; then
        hook_active=true
      fi
      ;;
    bash)
      if bash -i -c '[[ "${PROMPT_COMMAND:-}" == *direnv* ]]' &>/dev/null; then
        hook_active=true
      fi
      ;;
    *)
      # Unknown shell — can't verify hook, pass without hook claim
      hook_checked=false
      pass "direnv $ver (hook check skipped — $shell_name not supported)"
      ;;
  esac

  if [ "$hook_checked" = true ]; then
    if [ "$hook_active" = true ]; then
      pass "direnv $ver ($shell_name hook active)"
    else
      fail "direnv shell hook not detected for $shell_name"
      hint "Add the following to your ~/.${shell_name}rc (or equivalent):"
      hint "  eval \"\$(direnv hook $shell_name)\""
    fi
  fi
else
  fail "direnv — not found"
  hint "Install: brew install direnv"
fi

# ── Summary ─────────────────────────────────────────────────────────

if [[ "$porcelain" == false ]]; then
  passed=$((total - failures))
  echo ""
  if [ "$failures" -eq 0 ]; then
    echo "$passed/$total checks passed."
  else
    if [ "$failures" -eq 1 ]; then
      echo "$passed/$total checks passed. $failures issue found."
    else
      echo "$passed/$total checks passed. $failures issues found."
    fi
  fi
fi

exit "$failures"
