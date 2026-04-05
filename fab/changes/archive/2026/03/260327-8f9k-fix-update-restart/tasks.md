# Tasks: Fix Update Restart

**Change**: 260327-8f9k-fix-update-restart
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Implementation

- [x] T001 Add `StartWithBinary(binPath string) error` to `app/backend/internal/daemon/daemon.go` — resolves `binPath` via `filepath.EvalSymlinks()`, creates tmux session with resolved path + `serve` arg. Same daemon-already-running guard and tmux session creation as `Start()`
- [x] T002 Add `RestartWithBinary(binPath string) error` to `app/backend/internal/daemon/daemon.go` — stops daemon if running, then calls `StartWithBinary(binPath)`

## Phase 2: Integration

- [x] T003 Update `app/backend/cmd/rk/upgrade.go` — change `daemon.Restart()` call to `daemon.RestartWithBinary(exePath)` where `exePath` is the already-captured `os.Executable()` value (line 25)

## Phase 3: Tests

- [x] T004 Add unit test for `StartWithBinary` in `app/backend/internal/daemon/daemon_test.go` — test that calling with a valid binary path starts a tmux session on the test socket

---

## Execution Order

- T001 blocks T002 (RestartWithBinary calls StartWithBinary)
- T002 blocks T003 (upgrade.go uses RestartWithBinary)
- T003 blocks T004 (tests validate the integrated behavior)
