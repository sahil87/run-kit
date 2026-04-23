# Tasks: rk riff — CLI Surface Refinement

**Change**: 260423-udhe-rk-riff-cli-surface
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

*(No setup tasks — the change is purely in-place rename + help-text expansion. Change 1's foundations (`shellWrap`, `resolveWindowName`, interactive-launcher wrap) are already merged on main and used as-is.)*

## Phase 2: Core Implementation

- [x] T001 Rename flag `--cmd` to `--skill` in `app/backend/cmd/rk/riff.go`: update the `riffCmd.Flags().StringVar(...)` call at the `init()` in `riff.go`, rename package-level variable `riffCmdFlag` → `riffSkillFlag`, and update the `runTmuxNewWindow(ctx, worktreePath, launcher, riffCmdFlag)` call site in `runRiff` to use `riffSkillFlag`. Update the flag's usage-string description to match the new name (e.g., "Claude Code skill or slash-command to run in the new window"). No deprecated alias.

- [x] T002 Rename flag `--split` to `--setup-pane` in `app/backend/cmd/rk/riff.go`: update the second `StringVar` call in `init()`, rename package-level variable `riffSplitFlag` → `riffSetupPaneFlag`, and update the `if riffSplitFlag != ""` guard + `runTmuxSplitWindow(..., riffSplitFlag)` call site in `runRiff`. Update the flag's usage-string description (e.g., "If non-empty, split the window and run this setup command in the right pane"). No deprecated alias.

- [x] T003 Expand the cobra `Use:` synopsis on `riffCmd` in `app/backend/cmd/rk/riff.go` from `riff [-- wt-flags...]` to `riff [--skill <name>] [--setup-pane <cmd>] [-- <wt-flags>...]` (or an equivalent one-liner naming both primary flags and the passthrough separator).

- [x] T004 Rewrite the cobra `Long:` field on `riffCmd` in `app/backend/cmd/rk/riff.go` to match the `serve.go:25-34` house style. Include, in order: a one-sentence summary; a `Prerequisites:` block listing `$TMUX`, `wt`, and the launcher binary; a paragraph on the `--` separator with a pointer to `wt create --help`; a `Launcher resolution:` block describing `fab/project/config.yaml`'s `agent.spawn_command` → `claude --dangerously-skip-permissions` fallback chain; an `Examples:` block with at least four invocations (bare default, `--skill <name>`, `--setup-pane <cmd>`, wt passthrough via `-- --worktree-name`); an `Exit codes:` block listing 0 (success), 2 (precondition failure), 3 (subprocess failure).

## Phase 3: Integration & Edge Cases

- [x] T005 Update `app/backend/cmd/rk/riff_test.go` in place: rename every occurrence of `riffCmdFlag` → `riffSkillFlag` and `riffSplitFlag` → `riffSetupPaneFlag`. Update any test-case struct fields, variable assignments, and inline comments that reference the old flag/var names or the `--cmd`/`--split` flag strings. Do NOT modify test logic, the signatures of `TestBuildNewWindowArgs`, `TestShellWrap`, or `TestResolveWindowName`, or the other pure-helper test bodies — the rename is mechanical.

- [x] T006 Verify grep cleanliness from the repo root: `grep -rn "riffCmdFlag\|riffSplitFlag\|\"--cmd\"\|\"--split\"" app/backend/` returns zero matches (strings that would indicate a missed rename). If any match is found, update it as part of T001/T002/T005.

- [x] T007 Run the affected Go tests: `go test ./app/backend/cmd/rk/... ./app/backend/internal/fabconfig/...`. All tests MUST pass. If a pre-existing test relied on the old flag name and was missed, update it here.

## Phase 4: Polish

*(Memory hydration lives in the dedicated hydrate stage — not duplicated here.)*

---

## Execution Order

- T001 and T002 both edit `riff.go`'s package-level vars and `init()` — serialize (T001 before T002) to avoid edit conflicts on the same file, even though conceptually they're independent.
- T003 and T004 both edit the `riffCmd` variable declaration in `riff.go` (Use/Long fields) — serialize after T002 for the same reason.
- T005 can run after T001 and T002 finish (depends on the renamed vars existing).
- T006 can run after T001/T002/T005.
- T007 runs last (after all code and test updates).

All tasks serialize in ID order because they all touch one of two files (`riff.go` / `riff_test.go`). No `[P]` markers.
