# Quality Checklist: Daemon Lifecycle for `run-kit serve`

**Change**: 260320-hkm8-daemon-lifecycle-serve
**Generated**: 2026-03-20
**Spec**: `spec.md`

## Functional Completeness
- [ ] CHK-001 Daemon flag: `run-kit serve -d` creates tmux session on `rk-daemon` server and exits
- [ ] CHK-002 Restart flag: `run-kit serve --restart` stops existing daemon (if any) and starts new one
- [ ] CHK-003 Stop flag: `run-kit serve --stop` sends C-c to daemon pane
- [ ] CHK-004 Daemon detection: uses `tmux -L rk-daemon has-session -t rk`
- [ ] CHK-005 Flag mutual exclusivity: combining `-d`/`--restart`/`--stop` produces an error
- [ ] CHK-006 Auto-restart after update: `upgrade.go` calls daemon restart after successful brew upgrade
- [ ] CHK-007 Internal daemon package: shared helpers in `internal/daemon/` used by both serve.go and upgrade.go

## Behavioral Correctness
- [ ] CHK-008 Foreground serve unchanged: `run-kit serve` (no flags) still runs HTTP server in foreground
- [ ] CHK-009 `-d` errors when daemon already running (exit 1, not silent success)
- [ ] CHK-010 `--restart` is idempotent: works whether daemon is running or not
- [ ] CHK-011 `--stop` on no daemon: prints message, exits 0 (not error)
- [ ] CHK-012 Update skips restart when already up to date

## Removal Verification
- [ ] CHK-013 `scripts/supervisor.sh` deleted
- [ ] CHK-014 No references to `.restart-requested` signal file in codebase
- [ ] CHK-015 Constitution updated: no `.restart-requested` reference, describes tmux-based restart

## Scenario Coverage
- [ ] CHK-016 Start daemon when none exists
- [ ] CHK-017 Start daemon when one already running (error case)
- [ ] CHK-018 Restart running daemon
- [ ] CHK-019 Restart with no daemon (starts new one)
- [ ] CHK-020 Stop running daemon
- [ ] CHK-021 Stop with no daemon running

## Edge Cases & Error Handling
- [ ] CHK-022 Multiple daemon flags: error message and exit 1
- [ ] CHK-023 5-second timeout on C-c wait during stop/restart

## Code Quality
- [ ] CHK-024 Pattern consistency: daemon tmux calls use `exec.CommandContext` with timeouts (matches constitution)
- [ ] CHK-025 No unnecessary duplication: serve.go and upgrade.go share `internal/daemon` helpers
- [ ] CHK-026 No shell string construction: all tmux commands use argument slices

## Security
- [ ] CHK-027 All subprocess calls use `exec.CommandContext` with explicit argument slices and timeouts

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
