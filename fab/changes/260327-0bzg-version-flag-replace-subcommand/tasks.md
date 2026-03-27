# Tasks: Replace `rk version` Subcommand with `--version` / `-v` Flag

**Change**: 260327-0bzg-version-flag-replace-subcommand
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Implementation

- [x] T001 Set `rootCmd.Version = version` in `app/backend/cmd/rk/root.go` to enable Cobra's built-in `--version`/`-v` flag
- [x] T002 Remove `rootCmd.AddCommand(versionCmd)` from `init()` in `app/backend/cmd/rk/root.go`
- [x] T003 Delete `app/backend/cmd/rk/version.go`

## Phase 2: Tests

- [x] T004 Delete `app/backend/cmd/rk/version_test.go`
- [x] T005 Update `TestRootCmdHasSubcommands` in `app/backend/cmd/rk/root_test.go` — remove `"version"` from expected map
- [x] T006 Add `TestVersionFlag` in `app/backend/cmd/rk/root_test.go` — verify `rk --version` outputs `rk version dev`

## Execution Order

- T001 and T002 are in the same file, execute sequentially
- T003 and T004 are independent deletes, can run after T001-T002
- T005 and T006 are in the same file, execute sequentially after T003-T004
