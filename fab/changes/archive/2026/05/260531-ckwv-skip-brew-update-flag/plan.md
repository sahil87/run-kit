# Plan: Add --skip-brew-update flag to update command

**Change**: 260531-ckwv-skip-brew-update-flag
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

<!-- Sequential work items for the apply stage. Checked off [x] as completed. -->

### Phase 1: Setup

- [x] T001 In `app/backend/cmd/rk/upgrade.go`, introduce the three package-level seam vars matching the repo's `…Fn = realImpl` idiom (see `daemon_start.go:17`): (a) `runBrewFn func(ctx, args...) ([]byte, error)` whose default closure reproduces today's exact wiring per subcommand — `update`→Stderr-only stream, `upgrade`→Stdout+Stderr stream, `info`→captured `.Output()` bytes; (b) `restartDaemonFn = daemon.RestartWithBinary`; (c) `resolveExeFn func() (string, error)` wrapping the current `os.Executable()` + `filepath.EvalSymlinks` logic and returning the resolved path. Bind `var skipBrewUpdate bool` as the flag target.

### Phase 2: Core Implementation

- [x] T002 In `app/backend/cmd/rk/upgrade.go`, register the cobra flag in an `init()`: `updateCmd.Flags().BoolVar(&skipBrewUpdate, "skip-brew-update", false, <help text>)`. Local to `updateCmd`, not persistent/root. Do NOT touch `root.go`'s `rootCmd.AddCommand(updateCmd)`.
- [x] T003 In `app/backend/cmd/rk/upgrade.go` `updateCmd.RunE`, route the exe-path resolution through `resolveExeFn()` (preserving the EvalSymlinks-falls-back-to-exePath behavior inside the default impl) so the `/Cellar/rk/` guard is satisfiable in-test.
- [x] T004 In `app/backend/cmd/rk/upgrade.go` `updateCmd.RunE`, gate ONLY the `brew update --quiet` block behind `if !skipBrewUpdate { … }`, keeping the `updateCtx`/`updateCancel` timeout context INSIDE the guard (no orphan defer / unused var when skipped). Route the call through `runBrewFn(ctx, "update", "--quiet")`. Preserve the exact error wrap `could not check for updates (brew update failed): %w`.
- [x] T005 In `app/backend/cmd/rk/upgrade.go` `updateCmd.RunE`, route the `brew info --json=v2 sahil87/tap/rk` call through `runBrewFn` (capturing returned bytes for `parseBrewVersion`) and the `brew upgrade sahil87/tap/rk` call through `runBrewFn`. Keep the `if latest == version` short-circuit, the Cellar→bin derivation, and the daemon restart unchanged in position — replace the direct `daemon.RestartWithBinary(brewBinPath)` call with `restartDaemonFn(brewBinPath)`.

### Phase 3: Integration & Edge Cases

- [x] T006 Create `app/backend/cmd/rk/upgrade_test.go` (package `main`) following `daemon_test.go`/`doctor_test.go` patterns. Add `with…`-style helpers using `t.Cleanup` to swap `resolveExeFn`, `runBrewFn`, `restartDaemonFn`. Tests MUST NOT spawn real brew or restart a real daemon.
- [x] T007 Add `TestUpdate_SkipBrewUpdate_OmitsUpdateButUpgradesAndRestarts`: stub `resolveExeFn`→synthetic `/opt/homebrew/Cellar/rk/9.9.9/bin/rk`; stub `runBrewFn` to record `args[0]` and return canned `--json=v2` JSON with stable `9.9.9` (≠ compiled-in `version` which is `"dev"`); stub `restartDaemonFn` to record call + bin path. Run `update` with `--skip-brew-update`. Assert recorded subcommands contain `upgrade` + `info`, do NOT contain `update`; restart called once with path ending `/bin/rk`. Reset `skipBrewUpdate` between runs (`t.Cleanup` or explicit) since cobra won't.
- [x] T008 Add `TestUpdate_Default_RunsUpdateAndUpgradeAndRestarts`: same stubs, run `update` WITHOUT the flag. Assert recorded subcommands contain BOTH `update` and `upgrade`; restart called. (Regression guard for default = current behavior.)
- [x] T009 Add `TestUpdate_SkipBrewUpdate_ShortCircuitsWhenUpToDate`: `info` returns stable equal to compiled-in `version` (`"dev"`); assert no `upgrade`, restart NOT called.

### Phase 4: Polish

- [x] T010 From `app/backend/`, run `go build ./...` and `go test ./cmd/rk/ -run Update -v` (and the full `./cmd/rk/` package). Both MUST pass. Fix any compile/behavior failures at the source. Mark plan tasks `[x]`.

## Execution Order

- T001 blocks T002–T005 (vars must exist before flag registration and RunE rewiring).
- T002–T005 all edit the same `RunE`/file; execute sequentially in that order.
- T006 blocks T007–T009 (helpers/scaffold before test cases).
- T010 runs last (gate).

## Acceptance

### Functional Completeness

- [x] A-001 `--skip-brew-update` flag exists: a real cobra bool flag named exactly `skip-brew-update`, default `false`, registered via `updateCmd.Flags().BoolVar` (local, not persistent/root), with help text conveying it skips the internal `brew update` refresh while still doing version check / upgrade / daemon restart.
- [x] A-002 Flag gates ONLY `brew update`: when set, only the `brew update --quiet` invocation is skipped; `brew info`, the `if latest == version` short-circuit, `brew upgrade`, the Cellar→bin derivation, and `restartDaemonFn` all still execute.
- [x] A-003 Default behavior preserved: when the flag is absent, `brew update --quiet` runs before the version check and on failure returns the existing wrap `could not check for updates (brew update failed): %w`. Stdout/Stderr wiring per subcommand is byte-for-byte identical to today (update→Stderr, upgrade→Stdout+Stderr, info→captured).
- [x] A-004 Test file `app/backend/cmd/rk/upgrade_test.go` exists, package `main`, uses package-var stubs swapped via `t.Cleanup`, and does not spawn real brew or restart a real daemon.

### Behavioral Correctness

- [x] A-005 Daemon restart still runs with flag set: `restartDaemonFn` is invoked exactly once with the derived `{prefix}/bin/rk` path when `--skip-brew-update` is passed and `brew upgrade` succeeds.
- [x] A-006 Up-to-date short-circuit honored regardless of flag: when `brew info` reports the running version, `brew upgrade` and the daemon restart are NOT invoked.

### Scenario Coverage

- [x] A-007 Flag-set scenario covered: a test asserts recorded brew subcommands contain `upgrade` (+ `info`) and do NOT contain `update`, and the restart stub was called once.
- [x] A-008 Default regression scenario covered: a test asserts recorded brew subcommands contain BOTH `update` and `upgrade`, and the restart stub was called.
- [x] A-009 Short-circuit scenario covered: a test asserts no `upgrade` and no restart when info reports the running version.

### Edge Cases & Error Handling

- [x] A-010 No orphan defer / unused var: the `updateCtx`/`updateCancel` context lives entirely inside the `if !skipBrewUpdate` guard; `go build` and `go vet` produce no unused-variable warnings when the flag is set.

### Code Quality

- [x] A-011 Pattern consistency: new seam vars follow the `daemon_start.go` `…Fn = realImpl` idiom; test helpers follow `daemon_test.go` `with…(t, …)` + `t.Cleanup` style.
- [x] A-012 No unnecessary duplication: the three brew call sites route through the single `runBrewFn` rather than duplicating exec wiring; `parseBrewVersion` is reused unchanged.
- [x] A-013 Subprocess convention preserved: the default `runBrewFn` still uses `exec.CommandContext("brew", args...)` with a context/timeout — no shell strings, no `exec.Command` without context (constitution I / code-quality anti-pattern).
- [x] A-014 No refactor beyond the seam: `updateCmd` is not restructured, no DI framework introduced, and `rootCmd.AddCommand(updateCmd)` in `root.go` is untouched.

### Security

- [x] A-015 No injection surface added: brew args remain an explicit argument slice passed through `exec.CommandContext`; the new flag introduces no user-controlled string interpolation into a subprocess.

## Notes

- Compiled-in `version` is `"dev"` (`root.go:11`, set via ldflags). Canned info JSON uses `9.9.9` for the upgrade-reached cases and `dev` for the short-circuit case.
- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
