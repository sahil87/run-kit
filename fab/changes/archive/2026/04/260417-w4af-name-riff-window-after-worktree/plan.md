# Plan: Name the tmux window created by `rk riff` after the worktree

**Change**: 260417-w4af-name-riff-window-after-worktree
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

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

## Acceptance

## Functional Completeness
- [x] CHK-001 Stable window name derived from worktree basename: `runTmuxNewWindow` (via `buildNewWindowArgs`) emits `-n riff-<filepath.Base(worktreePath)>` as distinct argv elements in the `tmux new-window` invocation
- [x] CHK-002 Name stability for the window's lifetime: `-n <name>` alone is the mechanism; no test or code path couples to tmux's `automatic-rename` option
- [x] CHK-003 Backward-compatible invocation surface: No change to `rk riff` flags, arguments, exit codes (0/2/3), or stdout/stderr — the only observable change is the window name
- [x] CHK-004 Test seam exists: `buildNewWindowArgs(worktreePath, launcher, cmdArg string) []string` is a pure, exported-within-package helper with no side effects, and `runTmuxNewWindow` calls it to produce the argv slice
- [x] CHK-005 Memory documentation reflects the new invocation: `docs/memory/run-kit/rk-riff.md` Step 5 shows `tmux new-window -n riff-<worktree-basename> -c <worktree-path> "<launcher> '<cmd>'"` and explains the rationale (hydrate stage will complete this)

## Behavioral Correctness
- [x] CHK-006 Argv order is `new-window -n <name> -c <path> <shellCmd>`: helper returns slice in that exact order per Design Decision #5
- [x] CHK-007 Name derivation uses `filepath.Base` (no pre-`Clean`, no regex): helper source implements the literal string concat `"riff-" + filepath.Base(worktreePath)`
- [x] CHK-008 Trailing-slash worktree paths yield stripped basenames: `/tmp/myrepo.worktrees/alpha/` → `riff-alpha`
- [x] CHK-009 Relative worktree path with no directory component yields bare basename: `alpha` → `riff-alpha`

## Scenario Coverage
- [x] CHK-010 "Typical worktree under `.worktrees/` directory" scenario exercised by `TestBuildNewWindowArgs` with `/home/sahil/.../run-kit.worktrees/pacing-canyon`
- [x] CHK-011 "Worktree path with trailing slash" scenario exercised by `TestBuildNewWindowArgs` with `/tmp/myrepo.worktrees/alpha/`
- [x] CHK-012 "Relative worktree path" scenario exercised by `TestBuildNewWindowArgs` with `alpha`
- [x] CHK-013 "Security constraint — argv-distinct flag" scenario exercised: the test asserts `-n` and the name are **adjacent separate slice elements**, never a single concatenated string
- [x] CHK-014 "Helper is called by runTmuxNewWindow" scenario: code path verified by reading `runTmuxNewWindow` — the `exec.CommandContext` argv after `"tmux"` equals `buildNewWindowArgs(...)`

## Edge Cases & Error Handling
- [x] CHK-015 `cmdArg` containing single quotes is correctly escaped in the shell-command slice element (e.g., `it's a test` → `'it'\''s a test'`), verified by `TestBuildNewWindowArgs` escape-case row
- [x] CHK-016 Empty launcher tolerated — helper produces a slice even when launcher is `""`; no panic, no error. This is a defensive assertion that the helper is purely compositional and does not pre-validate its inputs
- [x] CHK-017 Split-window path (optional `--split` flag) does NOT receive `-n`: `runTmuxSplitWindow` is unchanged — the split inherits the window's name

## Code Quality
- [x] CHK-018 Pattern consistency: `buildNewWindowArgs` follows the existing riff.go helper pattern (pure functions with short doc comments, e.g., `parseWorktreePath`, `escapeSingleQuotes`, `resolveLauncher`)
- [x] CHK-019 No unnecessary duplication: `buildNewWindowArgs` reuses `escapeSingleQuotes` for the single-quote encoding; does not reimplement it
- [x] CHK-020 Go backend subprocess discipline (code-quality §Principles): `-n` is a distinct argv element to `exec.CommandContext` — no shell-string interpolation for user-derived input
- [x] CHK-021 No god functions (code-quality §Anti-Patterns): `buildNewWindowArgs` is <10 lines; `runTmuxNewWindow` remains short (<30 lines including the new call)
- [x] CHK-022 No magic strings: the `"riff-"` prefix is a module-local literal used in exactly one place (the helper); adding a const is not warranted for a single use site
- [x] CHK-023 New features include tests (code-quality §Principles): `TestBuildNewWindowArgs` covers the added behavior with 5+ cases

## Security
- [x] CHK-024 Constitution §I (Security First) preserved: window-name construction does not shell-escape or interpolate the basename into a shell string — it's an argv slice element, passed verbatim to `exec.CommandContext`
- [x] CHK-025 `worktreePath` is already `os.Stat`-validated by `runWtCreate` before reaching the helper — no additional validation is required in the helper itself

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-nnn **N/A**: {reason}`
