#!/usr/bin/env bash
set -uo pipefail
pass=0; fail=0; warn=0

ok()   { echo "  ✓ $1"; ((pass++)); }
fail() { echo "  ✗ $1"; ((fail++)); }
warn() { echo "  ! $1"; ((warn++)); }

check_cmd() {
    if command -v "$1" &>/dev/null; then ok "$1 found"; else fail "$1 not found — $2"; fi
}

check_version() {
    local cmd="$1" got="$2" want="$3" label="$4"
    if printf '%s\n%s\n' "$want" "$got" | sort -V | head -n1 | grep -qx "$want"; then
        ok "$label $got (>= $want)"
    else
        fail "$label $got (want >= $want)"
    fi
}

echo "Checking tools..."
check_cmd go "brew install go"
check_cmd node "brew install node"
check_cmd pnpm "brew install pnpm"
check_cmd tmux "brew install tmux"
check_cmd air "go install github.com/air-verse/air@latest"
check_cmd direnv "brew install direnv"

echo ""
echo "Checking versions..."
if command -v go &>/dev/null; then
    go_ver=$(go version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    check_version go "$go_ver" "1.22.0" "go"
fi
if command -v node &>/dev/null; then
    node_ver=$(node -v | sed 's/^v//')
    check_version node "$node_ver" "20.0.0" "node"
fi

echo ""
echo "Checking dependencies..."
if [ -d app/frontend/node_modules ]; then
    ok "frontend node_modules installed"
else
    fail "frontend node_modules missing — run: pnpm install"
fi
if [ -f app/backend/go.sum ]; then
    cd app/backend
    if go mod verify &>/dev/null; then
        ok "go modules verified"
    else
        fail "go modules out of sync — run: cd app/backend && go mod download"
    fi
    cd ../..
else
    fail "go.sum missing — run: cd app/backend && go mod download"
fi

echo ""
echo "Checking config..."
if [ -f .env.local ]; then ok ".env.local exists"; else warn ".env.local missing — run: just setup"; fi
if [ -f Caddyfile ]; then ok "Caddyfile exists"; else warn "Caddyfile missing — run: just setup"; fi

echo ""
echo "────────────────────────────"
echo "  $pass passed, $fail failed, $warn warnings"
if [ "$fail" -gt 0 ]; then echo "  Fix the failures above and re-run: just doctor"; exit 1; fi
echo "  All good!"
