# Tasks: Daemon Lifecycle for `run-kit serve`

**Change**: 260320-hkm8-daemon-lifecycle-serve
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Create `app/backend/internal/daemon/` package with daemon constants (server socket `rk-daemon`, session `rk`, window `serve`) and helpers: `IsRunning() bool`, `Start() error`, `Stop() error`, `Restart() error`

## Phase 2: Core Implementation

- [x] T002 Implement `internal/daemon/daemon.go` — `IsRunning()` calls `tmux -L rk-daemon has-session -t rk`, `Start()` creates session and sends `run-kit serve`, `Stop()` sends `C-c` and waits up to 5s, `Restart()` calls Stop+Start (or just Start if not running)
- [x] T003 Add `-d`/`--daemon`, `--restart`, `--stop` flags to `app/backend/cmd/run-kit/serve.go` — mutual exclusivity check, dispatch to `internal/daemon` helpers. Foreground serve unchanged when no flags
- [x] T004 Update `app/backend/cmd/run-kit/upgrade.go` — after successful `brew upgrade`, call `daemon.Restart()` to bounce the daemon. Skip restart when already up to date

## Phase 3: Integration & Edge Cases

- [x] T005 [P] Write tests for `internal/daemon/` — test `IsRunning`, `Start`, `Stop`, `Restart` with mock exec (or integration tests gated behind tmux availability)
- [x] T006 [P] Delete `scripts/supervisor.sh` and update `justfile` recipes: `up` → `run-kit serve -d`, `down` → `run-kit serve --stop`, `restart` → `run-kit serve --restart`
- [x] T007 [P] Update `fab/project/constitution.md` Self-Improvement Safety section — replace `.restart-requested` / signal-based restart with tmux-based kill-and-restart description

---

## Execution Order

- T001 blocks T002 (package must exist before implementation)
- T002 blocks T003, T004 (helpers must exist before CLI wiring)
- T005, T006, T007 are independent of each other, can run after T004
