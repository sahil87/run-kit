# Plan: rk riff — CLI Surface Refinement

**Change**: 260423-udhe-rk-riff-cli-surface
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

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

## Acceptance

## Functional Completeness
- [x] CHK-001 Flag `--skill`: cobra flag registered in `init()` at `app/backend/cmd/rk/riff.go`, bound to `riffSkillFlag`, default value `/fab-discuss`.
- [x] CHK-002 Flag `--setup-pane`: cobra flag registered in `init()` at `app/backend/cmd/rk/riff.go`, bound to `riffSetupPaneFlag`, default empty string.
- [x] CHK-003 Internal variable rename: package-level vars are named `riffSkillFlag` and `riffSetupPaneFlag`; `riffCmdFlag` and `riffSplitFlag` no longer exist (verify with grep from repo root).
- [x] CHK-004 `Use:` synopsis names both primary flags and the passthrough separator — visible in `rk riff --help` output.
- [x] CHK-005 `Long:` help includes all five named blocks: one-sentence summary, `Prerequisites:`, `--` passthrough paragraph, `Launcher resolution:`, `Examples:` (≥ 4 entries), `Exit codes:` (0/2/3).

## Behavioral Correctness
- [x] CHK-006 `rk riff` (no flags) behaves identically to pre-change default behavior: creates a worktree, opens a tmux window with the launcher invoking `/fab-discuss`. The rename affects the flag surface, not runtime behavior.
- [x] CHK-007 `rk riff --skill /review` passes `/review` down the same three-layer `buildNewWindowArgs` composition (launcher with cmd-arg, interactive shell wrap, shellWrap suffix) — no change to the composition itself.
- [x] CHK-008 `rk riff --setup-pane "just dev"` still produces the horizontal split via `tmux split-window -h` with `shellWrap("just dev")` — preserves change-1 behavior.
- [x] CHK-009 `rk riff --setup-pane ""` (empty) is treated identically to unset — no split, matching the `if riffSetupPaneFlag != ""` guard.

## Removal Verification
- [x] CHK-010 `--cmd` flag is removed: `rk riff --cmd /review` exits with cobra's "unknown flag" error. No deprecated-alias shim is present (no `pflag.Flag.Deprecated` calls for `--cmd`).
- [x] CHK-011 `--split` flag is removed: `rk riff --split "just dev"` exits with cobra's "unknown flag" error. No deprecated-alias shim for `--split`.
- [x] CHK-012 Grep verification: `grep -rn "riffCmdFlag\|riffSplitFlag\|\"--cmd\"\|\"--split\"" app/backend/` returns zero matches.

## Scenario Coverage
- [x] CHK-013 `--skill` accepted with explicit value — implicitly covered by existing `riff_test.go` tests that construct shell strings via the renamed variable.
- [x] CHK-014 `--skill` absent applies `/fab-discuss` default — covered by existing default-flag tests after the mechanical rename.
- [x] CHK-015 **N/A**: `--cmd` / `--split` rejection is cobra's standard behavior for unknown flags; no new test needed (per checklist guidance).
- [x] CHK-016 Help text blocks visible in `--help` output — manually verified via `rk riff --help` showing Prerequisites, Launcher resolution, Examples (5 entries), and Exit codes blocks.

## Edge Cases & Error Handling
- [x] CHK-017 Exit codes are unchanged (still 0 success, 2 precondition failure, 3 subprocess failure) — the `Long:` documentation accurately reflects runtime behavior. No new exit codes introduced.
- [x] CHK-018 `Use:` synopsis string is syntactically valid for cobra — `rk riff --help` renders it correctly as `rk riff [--skill <name>] [--setup-pane <cmd>] [-- <wt-flags>...] [flags]`.

## Code Quality
- [x] CHK-019 Pattern consistency: flag declarations follow the same `StringVar(&<var>, "<flag>", "<default>", "<usage>")` shape as the existing flags in the file and as `serve.go`/other rk subcommands.
- [x] CHK-020 No unnecessary duplication: no new helper functions added; the change is purely rename + in-place text expansion.
- [x] CHK-021 Readability over cleverness: `Long:` text uses plain prose blocks (matching `serve.go:25-34`), not macros or templated strings.
- [x] CHK-022 **N/A**: No God-function anti-pattern introduced — no new functions added.
- [x] CHK-023 **N/A**: No shell-string subprocess construction introduced — no new subprocess calls; existing tmux/wt calls continue to use `exec.CommandContext` with argv slices (documented tmux-shell exception unchanged).
- [x] CHK-024 **N/A**: No inline tmux command construction outside `internal/tmux/` introduced — no new tmux calls.
- [x] CHK-025 **N/A**: Rename is mechanical (no new behavior); existing tests continue to cover after variable/flag-name substitution. Test-must rule applies to new/changed behavior, not mechanical renames.

## Verification
- [x] CHK-026 `cd app/backend && go test ./cmd/rk/... ./internal/fabconfig/...` passes (full `./...` not run here — scoped to touched modules per _review.md).
- [x] CHK-027 No CI-visible lint warnings introduced (backend-only change; `go build` succeeds cleanly).

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
