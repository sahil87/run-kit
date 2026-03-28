# Intake: Fix Update Restart

**Change**: 260327-8f9k-fix-update-restart
**Created**: 2026-03-27
**Status**: Draft

## Origin

> Fix rk update daemon restart failure after brew upgrade. Error: "restarting daemon after upgrade: resolving executable symlinks: lstat /home/linuxbrew/.linuxbrew/Cellar/rk/0.5.0: no such file or directory". After brew upgrade from 0.5.0 to 0.5.3, brew cleanup removes the old Cellar path, but the restart logic in rk update still resolves symlinks against the old (now deleted) path. The executable symlink resolution needs to happen AFTER the brew upgrade completes, not before, or it should re-resolve the symlink to find the new Cellar path.

## Why

When a user runs `rk update`, the command successfully upgrades the Homebrew formula (e.g., 0.5.0 → 0.5.3) but then fails to restart the daemon. The error occurs because `daemon.Start()` calls `os.Executable()` which returns the path of the *currently running* binary — the old Cellar path (e.g., `/home/linuxbrew/.linuxbrew/Cellar/rk/0.5.0/bin/rk`). After `brew upgrade` completes, `brew cleanup` removes the old version directory, so `filepath.EvalSymlinks()` fails with an `lstat` error on the now-deleted path.

If unfixed, every `rk update` that involves a version change will fail to restart the daemon, requiring the user to manually run `rk serve --daemon` or restart their terminal. This undermines the seamless update experience.

The fix is to resolve the new binary path *after* `brew upgrade` completes rather than relying on the stale `os.Executable()` path of the currently running process. The Homebrew bin symlink (e.g., `…/.linuxbrew/bin/rk`) already points to the new version after upgrade, so the restart should use that.

## What Changes

### `daemon.Start()` accepts an optional explicit binary path

Currently `Start()` unconditionally uses `os.Executable()` + `filepath.EvalSymlinks()`. Add a `StartWithBinary(binPath string)` function (or modify `Restart` to accept a path) so callers can provide the correct binary path when they know the running executable's path is stale.

When a binary path is provided:
- Skip `os.Executable()` entirely
- Resolve the provided path's symlinks (the brew bin symlink now points to the new Cellar version)
- Use the resolved path for the tmux new-session command

When no binary path is provided (normal `Start()`), behavior is unchanged — `os.Executable()` + `EvalSymlinks()` as today.

### `upgrade.go` passes the brew bin path to restart

After `brew upgrade` succeeds, the update command resolves the Homebrew bin symlink path for `rk` and passes it to the daemon restart. This symlink now points to the new Cellar version, so `EvalSymlinks()` succeeds.

The brew bin path can be derived from the original `exePath` (which was already resolved at the top of the function on line 25 via `os.Executable()`), or by using the symlink in the Homebrew prefix bin directory.

## Affected Memory

- `run-kit/architecture`: (modify) Document daemon restart binary resolution strategy

## Impact

- `app/backend/internal/daemon/daemon.go` — new function or modified signature to accept binary path
- `app/backend/cmd/rk/upgrade.go` — pass brew bin path to restart
- `app/backend/internal/daemon/daemon_test.go` — test the new code path

## Open Questions

None — the root cause and fix approach are clear from the error message and code inspection.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `StartWithBinary(path)` pattern rather than modifying `Start()` signature | Constitution §III (Wrap, Don't Reinvent) — existing `Start()` callers (e.g., `rk serve --daemon`) should not need to change; adding a new function is additive and non-breaking | S:90 R:95 A:90 D:90 |
| 2 | Certain | Derive new binary path from `os.Executable()` pre-upgrade (the symlink, not the resolved Cellar path) | `upgrade.go` already captures `exePath` before resolving — this is the Homebrew bin symlink that points to the current (post-upgrade: new) Cellar version | S:85 R:90 A:95 D:90 |
| 3 | Certain | `Restart()` behavior unchanged for non-upgrade callers | Only the upgrade code path needs the explicit binary — `rk serve --restart` and other callers continue using `os.Executable()` | S:90 R:95 A:90 D:95 |
| 4 | Confident | The brew bin symlink updates atomically during `brew upgrade` | Standard Homebrew behavior — the symlink in the prefix bin directory is updated as part of the `brew upgrade` transaction before cleanup runs | S:70 R:85 A:75 D:80 |

4 assumptions (3 certain, 1 confident, 0 tentative, 0 unresolved).
