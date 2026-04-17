# Tasks: Name the tmux window created by `rk riff` after the worktree

**Change**: 260417-w4af-name-riff-window-after-worktree
**Spec**: `spec.md`
**Intake**: `intake.md`

<!--
  The code change to riff.go (adding -n <name>) is ALREADY APPLIED on this branch
  from the pre-intake ad-hoc edit. The apply stage still runs these tasks to:
    - refactor the argv-construction into the `buildNewWindowArgs` test seam
      required by the spec (see "Test seam for argv construction")
    - add test coverage (riff_test.go) for the new naming rule
    - ensure hydrate-stage memory updates are queued

  Apply will detect that the naming logic already emits -n riff-<basename> and
  will focus on the refactor + tests. Review will validate spec conformance
  and hydrate will do the memory-file update.
-->

## Phase 1: Setup

<!-- No setup required — dependencies and toolchain are unchanged. path/filepath
     is stdlib and is already imported in riff.go on this branch. -->

## Phase 2: Core Implementation

- [x] T001 Extract `buildNewWindowArgs(worktreePath, launcher, cmdArg string) []string` as a pure helper in `app/backend/cmd/rk/riff.go`. The helper MUST return `[]string{"new-window", "-n", "riff-" + filepath.Base(worktreePath), "-c", worktreePath, fmt.Sprintf("%s '%s'", launcher, escapeSingleQuotes(cmdArg))}`. Place it immediately above `runTmuxNewWindow` with a short doc comment explaining it's the test seam. Update `runTmuxNewWindow` to call it: `cmd := exec.CommandContext(ctx, "tmux", buildNewWindowArgs(worktreePath, launcher, cmdArg)...)`. Preserve the existing doc comment on `runTmuxNewWindow` that was updated when the naming rule was applied.

- [x] T002 Add `TestBuildNewWindowArgs` to `app/backend/cmd/rk/riff_test.go`. Table-driven test with these cases:
  | Name | worktreePath | launcher | cmdArg | Expected argv |
  |------|-------------|----------|--------|---------------|
  | typical `.worktrees/` path | `/home/sahil/code/sahil87/run-kit.worktrees/pacing-canyon` | `claude --dangerously-skip-permissions` | `/fab-discuss` | `[new-window, -n, riff-pacing-canyon, -c, /home/sahil/code/sahil87/run-kit.worktrees/pacing-canyon, claude --dangerously-skip-permissions '/fab-discuss']` |
  | trailing slash stripped | `/tmp/myrepo.worktrees/alpha/` | `claude` | `/x` | name must be `riff-alpha`; cwd preserves the exact input |
  | relative path no dir | `alpha` | `claude` | `/x` | name must be `riff-alpha` |
  | cmdArg with single quote | `/tmp/myrepo.worktrees/alpha` | `claude` | `it's a test` | shellCmd element must equal `claude 'it'\''s a test'` |
  | empty launcher tolerated | `/tmp/myrepo.worktrees/alpha` | `` | `/x` | shellCmd element must equal ` '/x'` — leading space is acceptable; we only assert the naming rule, not launcher sanity |

  Assert equality with `reflect.DeepEqual` on the full slice. Use `t.Run(tc.name, …)` subtests. This test MUST NOT invoke real `tmux` or `exec.CommandContext`.

- [x] T003 [P] Update the doc comment block for `runTmuxNewWindow` in `app/backend/cmd/rk/riff.go` (already partially updated from the ad-hoc edit) to reference the `buildNewWindowArgs` helper and to state the naming contract: "The window is named `riff-<worktree-basename>` via `-n`; the exact argv is constructed by `buildNewWindowArgs`." Keep the existing exception-to-argv-only-rule note about the shell-command string.

## Phase 3: Integration & Edge Cases

- [x] T004 Run `just test-backend` and confirm:
  - All existing tests in `app/backend/cmd/rk/` still pass (no regression from the helper extraction)
  - The new `TestBuildNewWindowArgs` subtests all pass
  - The existing unrelated failure `TestFetchPaneMapIntegration` in `rk/internal/sessions` may still fail (it requires a live tmux server and is a known pre-existing integration test failure unrelated to this change) — if it fails, confirm it's the same failure mode (`tmux list-sessions: exit status 1`) and proceed. Do NOT attempt to fix that test in this change.

- [x] T005 Manual smoke: in a tmux session, run `rk riff -- --worktree-name spec-smoke-w4af` (or use an existing test worktree path). After the window opens, verify via `tmux list-windows -F '#{window_name}'` that a window named `riff-spec-smoke-w4af` is present. Confirm the name does NOT change when the agent launches subprocesses or exits. Clean up the smoke worktree with `wt delete` when done. *(This is a developer-level verification; the automated test in T002 is the authoritative check. Record outcome in the PR description but do not block the pipeline on it.)* **Skipped — non-interactive apply; verified by T002 unit tests covering the full argv including `-n riff-<basename>`.**

## Phase 4: Polish

<!-- Memory doc update is handled by the hydrate stage (Step 7 of /fab-fff), not here.
     No other polish tasks — the change is small and self-contained. -->

---

## Execution Order

- T001 blocks T002 (tests import `buildNewWindowArgs`)
- T001 blocks T004 (build must succeed for tests to run)
- T003 is independent of T001/T002 (doc comment edit); can run in parallel with T002
- T004 depends on T001, T002, T003
- T005 depends on T004 (smoke-test the built binary only after unit tests pass)
