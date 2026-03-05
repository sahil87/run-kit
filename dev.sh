#!/usr/bin/env bash
set -euo pipefail

# Read port/host config from run-kit.yaml (optional)
RK_PORT=3000
RK_HOST="127.0.0.1"
if [[ -f run-kit.yaml ]]; then
  _val() { grep "^[[:space:]]\+$1:" run-kit.yaml 2>/dev/null | head -1 | sed 's/^[^:]*: *//' | sed 's/ *#.*//' | tr -d '"'"'" ; }
  _p=$(_val port); [[ "$_p" =~ ^[0-9]+$ ]] && RK_PORT="$_p"
  _h=$(_val host); [[ -n "$_h" ]] && [[ "$_h" =~ ^[a-zA-Z0-9._:-]+$ ]] && RK_HOST="$_h"
  unset _val _p _h
fi

# If TLS certs exist, enable HTTPS for next dev
NEXT_HTTPS=""
if [[ -f certs/localhost.pem && -f certs/localhost-key.pem ]]; then
  NEXT_HTTPS="--experimental-https --experimental-https-cert certs/localhost.pem --experimental-https-key certs/localhost-key.pem"
fi

exec pnpm concurrently -n next,relay -c blue,green \
  "next dev --port $RK_PORT --hostname $RK_HOST $NEXT_HTTPS" \
  "tsx src/terminal-relay/server.ts"
