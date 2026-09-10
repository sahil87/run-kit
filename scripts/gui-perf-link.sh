#!/usr/bin/env bash
# Port-scoped link emulation for the GUI perf spec (tests/e2e/gui-perf.spec.ts).
#
# Adds a Tailscale-shaped round trip to ONE loopback port so a Playwright
# viewer on this host sees the latency a remote laptop or phone would, while
# every other loopback consumer (the live rk daemon on :3000, tmux control
# sockets, code-server) is untouched. Both directions of a loopback flow
# traverse `lo`, so delaying packets whose source OR destination port matches
# yields the full RTT. Delay the Go BACKEND port (E2E_PORT+1): the browser
# talks to Vite, which proxies /ws/gui/host and /api to the backend, so the
# RFB stream and the API pay the round trip while Vite's hundreds of dev
# module requests stay fast (delaying the Vite port stalls page load instead).
#
#   scripts/gui-perf-link.sh on <port> [rtt_ms=260] [mbit=40]   # mbit=0 ⇒ no rate cap
#   scripts/gui-perf-link.sh off
#   scripts/gui-perf-link.sh status
#
# Requires passwordless sudo for `tc` (refuses otherwise). `off` removes the
# whole root qdisc on lo, restoring the kernel default (noqueue).
set -euo pipefail

usage() {
  echo "usage: $0 on <port> [rtt_ms=260] [mbit=40] | off | status" >&2
  exit 2
}

need_sudo() {
  sudo -n true 2>/dev/null || {
    echo "error: passwordless sudo is required for tc on lo" >&2
    exit 1
  }
}

cmd="${1:-}"
case "$cmd" in
  on)
    port="${2:-}"
    [[ "$port" =~ ^[0-9]+$ ]] || usage
    rtt="${3:-260}"
    mbit="${4:-40}"
    [[ "$rtt" =~ ^[0-9]+$ && "$mbit" =~ ^[0-9]+$ ]] || usage
    need_sudo
    half=$(( rtt / 2 ))
    # Idempotent: replace any previous emulation before installing this one.
    sudo tc qdisc del dev lo root 2>/dev/null || true
    # prio with 3 bands: unmatched traffic stays in bands 1-2 (default
    # priomap), matched traffic goes to band 3 where netem lives.
    sudo tc qdisc add dev lo root handle 1: prio bands 3 priomap 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
    if [ "$mbit" -gt 0 ]; then
      sudo tc qdisc add dev lo parent 1:3 handle 30: netem delay "${half}ms" rate "${mbit}mbit"
    else
      sudo tc qdisc add dev lo parent 1:3 handle 30: netem delay "${half}ms"
    fi
    sudo tc filter add dev lo parent 1:0 protocol ip prio 1 u32 match ip dport "$port" 0xffff flowid 1:3
    sudo tc filter add dev lo parent 1:0 protocol ip prio 1 u32 match ip sport "$port" 0xffff flowid 1:3
    if [ "$mbit" -gt 0 ]; then
      echo "link emulation on: port $port, ${rtt}ms RTT (${half}ms each way), ${mbit} Mbit/s"
    else
      echo "link emulation on: port $port, ${rtt}ms RTT (${half}ms each way), no rate cap"
    fi
    ;;
  off)
    need_sudo
    sudo tc qdisc del dev lo root 2>/dev/null || true
    echo "link emulation off (lo back to default qdisc)"
    ;;
  status)
    tc -s qdisc show dev lo
    tc filter show dev lo 2>/dev/null || true
    ;;
  *)
    usage
    ;;
esac
