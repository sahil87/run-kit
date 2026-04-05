# Tasks: Multi-file Tmux Config Sourcing

**Change**: 260328-wxrh-source-rk-tmux-configs
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Config Template

- [x] T001 Append `source-file -q ~/.rk/tmux.d/*.conf` directive to `configs/tmux/default.conf`

## Phase 2: Core Implementation

- [x] T002 [P] Update `EnsureConfig()` in `app/backend/internal/tmux/tmux.go` to create `~/.rk/tmux.d/` directory — both when writing a new config AND when the config already exists (skip path)
- [x] T003 [P] Update `ForceWriteConfig()` in `app/backend/internal/tmux/tmux.go` to create `~/.rk/tmux.d/` directory alongside the config write
- [x] T004 [P] Update `rk init-conf` in `app/backend/cmd/rk/initconf.go` to create `~/.rk/tmux.d/` directory after writing the config file

## Phase 3: Tests

- [x] T005 Add tests for `EnsureConfig` tmux.d creation in `app/backend/internal/tmux/tmux_test.go` — cover: fresh install (both created), config exists but no tmux.d (directory created), both exist (no-op)
- [x] T006 Verify embedded default config contains the source-file directive — add a test in `app/backend/internal/tmux/tmux_test.go` that checks `DefaultConfigBytes()` output contains `source-file -q`

---

## Execution Order

- T001 blocks T002, T003, T004 (embedded config must contain the directive before testing)
- T002, T003, T004 are independent ([P])
- T005, T006 depend on T001-T004
