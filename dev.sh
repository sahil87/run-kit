#!/usr/bin/env bash
set -euo pipefail

# Read port/host/tls config from run-kit.yaml (optional)
RK_PORT=3000
RK_HOST="127.0.0.1"
RK_TLS_CERT="certs/localhost.pem"
RK_TLS_KEY="certs/localhost-key.pem"
if [[ -f run-kit.yaml ]]; then
  _val() { grep "^[[:space:]]\+$1:" run-kit.yaml 2>/dev/null | head -1 | sed 's/^[^:]*: *//' | sed 's/ *#.*//' | tr -d '"'"'" ; }
  _p=$(_val port); [[ "$_p" =~ ^[0-9]+$ ]] && RK_PORT="$_p"
  _h=$(_val host); [[ -n "$_h" ]] && [[ "$_h" =~ ^[a-zA-Z0-9._:-]+$ ]] && RK_HOST="$_h"
  _tc=$(_val cert); [[ -n "$_tc" ]] && RK_TLS_CERT="$_tc"
  _tk=$(_val key);  [[ -n "$_tk" ]] && RK_TLS_KEY="$_tk"
  unset _val _p _h _tc _tk
fi

# If TLS certs exist (at resolved paths), enable HTTPS for next dev
NEXT_HTTPS=""
if [[ -f "$RK_TLS_CERT" && -f "$RK_TLS_KEY" ]]; then
  NEXT_HTTPS="--experimental-https --experimental-https-cert $RK_TLS_CERT --experimental-https-key $RK_TLS_KEY"
fi

exec pnpm concurrently -n next,relay -c blue,green \
  "next dev --port $RK_PORT --hostname $RK_HOST $NEXT_HTTPS" \
  "tsx src/terminal-relay/server.ts"
