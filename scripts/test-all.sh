#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Tee the whole run (banners + sub-suite output) into a per-run log so a
# tail -f or a mid-run capture-pane peek sees the same append-only lines the
# terminal does. A single exec redirection wraps no phase command in a
# pipeline, so phase exit codes are never masked by the tee.
LOG="/tmp/rk-test-$(date +%Y%m%d-%H%M%S)-$$.log"
exec > >(tee "$LOG") 2>&1
echo "Log: $LOG"

# Phases invoke the existing just recipes — never their bodies — so each
# phase's own dependencies (e.g. _ensure-tmux-conf before test-backend) are
# preserved and future recipe edits are inherited automatically.
names=(backend frontend e2e)
recipes=(test-backend test-frontend test-e2e)
statuses=("not-run" "not-run" "not-run")
durations=("-" "-" "-")
total=${#names[@]}
overall=0

fmt_duration() {
  printf '%dm%02ds' $(( $1 / 60 )) $(( $1 % 60 ))
}

for i in "${!names[@]}"; do
  n=$(( i + 1 ))
  name=${names[$i]}
  phase_start=$(date +%s)
  echo "[$n/$total] $name — started $(date +%H:%M:%S)"
  rc=0
  just "${recipes[$i]}" || rc=$?
  duration=$(fmt_duration $(( $(date +%s) - phase_start )))
  durations[$i]=$duration
  if [ "$rc" -eq 0 ]; then
    statuses[$i]="ok"
    echo "[$n/$total] $name — ok in $duration"
  else
    statuses[$i]="FAILED (exit $rc)"
    echo "[$n/$total] $name — FAILED in $duration (exit $rc)"
    overall=$rc
    break
  fi
done

echo
echo "Summary:"
for i in "${!names[@]}"; do
  printf '  [%d/%d] %-9s %-16s %s\n' \
    $(( i + 1 )) "$total" "${names[$i]}" "${statuses[$i]}" "${durations[$i]}"
done
exit "$overall"
