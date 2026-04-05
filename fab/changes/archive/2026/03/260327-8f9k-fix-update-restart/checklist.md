# Quality Checklist: Fix Update Restart

**Change**: 260327-8f9k-fix-update-restart
**Generated**: 2026-03-27
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 StartWithBinary: Function exists, accepts `binPath string`, returns `error`, resolves symlinks, creates tmux session
- [x] CHK-002 RestartWithBinary: Function exists, stops running daemon, delegates to `StartWithBinary`
- [x] CHK-003 upgrade.go: Calls `daemon.RestartWithBinary(exePath)` instead of `daemon.Restart()`

## Behavioral Correctness
- [x] CHK-004 Start() unchanged: `rk serve -d` still uses `os.Executable()` path
- [x] CHK-005 Restart() unchanged: `rk serve --restart` still uses `os.Executable()` path
- [x] CHK-006 StartWithBinary returns "daemon already running" when session exists

## Scenario Coverage
- [x] CHK-007 Upgrade restart with brew bin symlink: `RestartWithBinary` resolves symlink to new Cellar path
- [x] CHK-008 StartWithBinary with invalid path: Returns error containing "resolving executable symlinks"
- [x] CHK-009 RestartWithBinary with no running daemon: Starts fresh without stop attempt

## Edge Cases & Error Handling
- [x] CHK-010 StartWithBinary error propagation: EvalSymlinks failure wrapped with descriptive message

## Code Quality
- [x] CHK-011 Pattern consistency: New functions follow naming and structural patterns of existing `Start()`/`Restart()`
- [x] CHK-012 No unnecessary duplication: Shared tmux session creation logic between `Start()` and `StartWithBinary()`

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
