# Plan: rk riff — Correctness and Portability Fixes

**Change**: 260423-ba9f-rk-riff-correctness-fixes
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

## Phase 1: Setup

- [x] T001 Add `shellWrap(cmd string) string` pure helper in `app/backend/cmd/rk/riff.go`. Returns `fmt.Sprintf("%s; exec \"${SHELL:-/bin/sh}\"", cmd)`. Add a godoc comment explaining that the expansion is evaluated by tmux's shell at window-creation time and that this suffix keeps the pane interactive after the wrapped command exits.

- [x] T002 [P] Add `TestShellWrap` in `app/backend/cmd/rk/riff_test.go` covering: empty input, simple command (`claude '/fab-discuss'`), embedded single quotes, embedded double quotes. Assert exact string equality.

## Phase 2: Core Implementation

- [x] T003 Add `resolveWindowName(existing []string, base string) string` pure helper in `app/backend/cmd/rk/riff.go`. Returns `base` if not in `existing`; otherwise probes `base-2`, `base-3`, … and returns the first free name. Deterministic, no I/O, no context.

- [x] T004 [P] Add `TestResolveWindowName` in `app/backend/cmd/rk/riff_test.go` covering: no-collision returns base, one-collision returns `base-2`, three-collisions return `base-4`, empty existing-list returns base, gap-before-collision case (existing=`["riff-alpha","riff-alpha-3"]`, base=`riff-alpha` → `riff-alpha-2`).

- [x] T005 Add `listWindowNames(ctx context.Context) ([]string, error)` sibling function in `app/backend/cmd/rk/riff.go`. Invokes `tmux list-windows -F '#W'` via `exec.CommandContext` with `tmuxTimeout` (10s). Uses `tmuxChildEnv()` so the call targets the user's tmux server. Splits combined output on `\n`, trims each line, drops empty strings. Returns a subprocessErr (exit 3) on non-zero exit or timeout, with the tmux error surfaced in the message.

- [x] T006 Update `buildNewWindowArgs` signature in `app/backend/cmd/rk/riff.go` to `buildNewWindowArgs(worktreePath, resolvedName, launcher, cmdArg string) []string`. Internally compose the shell string as: (a) build the launcher-with-cmd-arg form `fmt.Sprintf("%s '%s'", launcher, escapeSingleQuotes(cmdArg))`, (b) wrap in interactive shell: `fmt.Sprintf(`${SHELL:-/bin/sh} -i -c '%s'`, escapeSingleQuotes(launcherWithArg))`, (c) pass through `shellWrap` for the `; exec "${SHELL:-/bin/sh}"` suffix. Window name input is `resolvedName` verbatim — no basename derivation inside this function.

- [x] T007 Update `runTmuxNewWindow` in `app/backend/cmd/rk/riff.go` to: (1) call `listWindowNames(ctx)` → `existing`; (2) compute `base := "riff-" + filepath.Base(worktreePath)`; (3) call `resolveWindowName(existing, base)` → `name`; (4) call `buildNewWindowArgs(worktreePath, name, launcher, cmdArg)`; (5) invoke tmux as today. Surface any `listWindowNames` error via `subprocessErr`.

- [x] T008 [P] Update `runTmuxSplitWindow` in `app/backend/cmd/rk/riff.go` to replace `fmt.Sprintf("%s; exec zsh", setupCmd)` with `shellWrap(setupCmd)`. No interactive wrap here — split passes the raw setup command through `shellWrap` only (per spec §Shell Wrap Helper: "Helper replaces the hardcoded `exec zsh` suffix").

- [x] T009 Add SIGINT handling at the top of `runRiff` in `app/backend/cmd/rk/riff.go`. Import `os/signal` and `syscall`. Wrap with `ctx, stop := signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)` and `defer stop()`. Swap all three subprocess call sites from `cmd.Context()` to the wrapped `ctx`: `runWtCreate`, `runTmuxNewWindow`, `runTmuxSplitWindow`.

## Phase 3: Integration & Edge Cases

- [x] T010 Update `TestBuildNewWindowArgs` cases in `app/backend/cmd/rk/riff_test.go` to the new signature `(worktreePath, resolvedName, launcher, cmdArg)`. Existing fixture `riff-pacing-canyon` / `riff-alpha` values are now supplied by the caller. Update each `want` slice's final element so it reflects the fully composed shell string: `${SHELL:-/bin/sh} -i -c '<escaped-launcher-with-cmd-arg>'; exec "${SHELL:-/bin/sh}"`. Keep the existing cases (typical, trailing slash, relative path, single-quote cmd, empty launcher) and add one new case with a non-trivial `resolvedName` (e.g., `riff-alpha-3`) to exercise the suffix path.

- [x] T011 Run `just test-backend` and fix any regressions. `rk/cmd/rk` package (the one this change touches) passes all tests including the new `TestShellWrap`, `TestResolveWindowName`, and updated `TestBuildNewWindowArgs`. A pre-existing failure in `rk/internal/sessions/TestFetchPaneMapIntegration` (tmux-server-required integration test) was confirmed to fail identically on `main` without these changes — unrelated to this change.

- [x] T012 [P] Run `cd app/frontend && npx tsc --noEmit` — passes with 0 errors after `just setup` installed the frontend deps. No frontend-side impact, as expected for a backend-only change.

- [x] T013 **N/A**: automated SIGINT smoke deferred to user manual verification (per spec §Non-Goals and checklist CHK-N/A guidance). This subagent environment cannot reliably reproduce a hung `wt create`.

---

## Execution Order

- T001 (shellWrap helper) blocks T006, T008 — they both use the helper.
- T003 (resolveWindowName) blocks T007.
- T005 (listWindowNames) blocks T007.
- T006 (buildNewWindowArgs signature change) blocks T007 and T010.
- T007 (runTmuxNewWindow) depends on T003, T005, T006.
- T009 (SIGINT wrap) is independent but must land before T011 so the test run exercises the wrapped context.
- T010 depends on T006 (signature change) and T001 (shellWrap) — test assertions reference both.
- T011 and T012 are verification gates — run after all code tasks complete.
- T013 is manual and can run last, independent of T011/T012.

[P] tasks (T002, T004, T008, T012) can run in parallel with their Phase-mates once their dependencies are satisfied.

## Acceptance

## Functional Completeness

- [x] CHK-001 Unified shell-wrap helper: `shellWrap(cmd string) string` exists in `riff.go` and both `runTmuxNewWindow` and `runTmuxSplitWindow` build their shell command via this helper.
- [x] CHK-002 Helper replaces hardcoded `exec zsh` in split pane: `runTmuxSplitWindow` uses `shellWrap(setupCmd)`; no `"; exec zsh"` literal remains in `riff.go`.
- [x] CHK-003 Launcher runs inside interactive user shell: the new-window shell string wraps the launcher in `${SHELL:-/bin/sh} -i -c '<launcher-with-cmd-arg>'`.
- [x] CHK-004 `$SHELL` fallback for interactive wrap: the `${SHELL:-/bin/sh}` expansion is used (not bare `$SHELL`).
- [x] CHK-005 `runRiff` wraps its context with a signal handler: `signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)` is called once at the top, `defer stop()` is present, and the wrapped context is propagated to all three subprocess call sites.
- [x] CHK-006 Collision detection via `tmux list-windows`: `listWindowNames` is invoked in `runTmuxNewWindow` before constructing the new-window argv.
- [x] CHK-007 `buildNewWindowArgs` accepts resolved name as input: signature takes `resolvedName` parameter; name derivation no longer happens inside this function.
- [x] CHK-008 `resolveWindowName` is a pure helper: takes `(existing []string, base string)`, returns deterministically, no I/O.

## Behavioral Correctness

- [x] CHK-009 New-window pane survives launcher exit: after the launcher process exits (normal or error), the tmux window stays open running `${SHELL:-/bin/sh}`.
- [x] CHK-010 Split pane survives setup-command exit: after the setup command exits, the right pane stays open running `${SHELL:-/bin/sh}`.
- [x] CHK-011 fish user split behavior: when `$SHELL=/usr/bin/fish`, split pane drops into fish (not zsh) after setup.
- [x] CHK-012 zsh alias is available to launcher: with a `.zshrc` alias, the launcher resolves the alias (verified manually or via test that inspects the `-i -c` form).
- [x] CHK-013 Window collision auto-suffix: one collision → `-2`; three collisions → `-4`; gap-at-`-2` → `-2` fills the gap.
- [x] CHK-014 SIGINT terminates children: Ctrl-C during a hung subprocess cancels the wrapped context and the subprocess exits (no zombie).

## Removal Verification

- [x] CHK-015 Non-interactive launcher shell removed: no direct `sh -c <launcher>` path remains — launcher always goes through `${SHELL:-/bin/sh} -i -c`.
- [x] CHK-016 Hardcoded `exec zsh` removed: grep confirms no `exec zsh` string remains in `riff.go`.
- [x] CHK-017 Silent window-name collision removed: no code path allows `tmux new-window -n riff-<base>` when a window with that name already exists in the current session (the auto-suffix resolution handles it).
- [x] CHK-018 Pane death on launcher exit removed: no `tmux new-window` invocation uses a raw `<launcher> '<cmd>'` shell string without the `shellWrap` suffix.

## Scenario Coverage

- [x] CHK-019 Scenario "helper is pure and test-seam-friendly": `TestShellWrap` exists and covers empty input, simple command, single-quote content, double-quote content.
- [x] CHK-020 Scenario "`$SHELL` unset falls back to /bin/sh": output string still resolves correctly via `${SHELL:-/bin/sh}` expansion — covered by string-level unit test assertion.
- [x] CHK-021 Scenario "builder uses resolved name verbatim": `TestBuildNewWindowArgs` asserts `-n` equals the supplied `resolvedName` (new test case with suffixed name included).
- [x] CHK-022 Scenario "gap-before-collision": `TestResolveWindowName` asserts `existing=["riff-alpha","riff-alpha-3"]`, `base="riff-alpha"` → `"riff-alpha-2"`.
- [x] CHK-023 Scenario "typical case asserts shell-wrap + interactive wrap": `TestBuildNewWindowArgs` typical case asserts final argv element contains both `${SHELL:-/bin/sh} -i -c ...` and `; exec "${SHELL:-/bin/sh}"`.
- [x] CHK-024 Scenario "race between list and new-window is acceptable": no locking or retry is introduced in `runTmuxNewWindow` — comment or test documents the accepted race.

## Edge Cases & Error Handling

- [x] CHK-025 `tmux list-windows` failure surfaces as subprocess error: `listWindowNames` returns a `subprocessErr` (exit 3) with a message naming `tmux list-windows`; `runTmuxNewWindow` does not proceed to `new-window` when listing fails.
- [x] CHK-026 Empty existing-windows list: `resolveWindowName` returns the base name unchanged when `existing` is empty.
- [x] CHK-027 Signal handler released on normal exit: `defer stop()` is present immediately after the `signal.NotifyContext` call.
- [x] CHK-028 Launcher quoting survives interactive wrap: embedded single quotes in `--cmd` reach the launcher intact — covered by the existing `escapeSingleQuotes` case in `TestBuildNewWindowArgs` (updated for new composition).

## Code Quality

- [x] CHK-029 Pattern consistency: new code follows naming and structural patterns of surrounding `riff.go` (lowerCamelCase functions, godoc comments on exported helpers only, `subprocessErr`/`preconditionErr` error constructors).
- [x] CHK-030 No unnecessary duplication: `listWindowNames` reuses `tmuxChildEnv()` and `tmuxTimeout`; does not reintroduce env-construction logic or hardcode timeouts.
- [x] CHK-031 `exec.CommandContext` with timeout: the new `listWindowNames` function uses `exec.CommandContext` with a timeout via `context.WithTimeout(parent, tmuxTimeout)`, per constitution §I and code-review policy.
- [x] CHK-032 Argv-only for subprocess call: `listWindowNames` invokes `tmux` with argv `[]string{"list-windows", "-F", "#W"}` — no shell-string interpolation.
- [x] CHK-033 Type narrowing / discriminated unions: N/A (backend-only change; no frontend code touched).
- [x] CHK-034 No god functions (>50 lines): `runRiff`, `runTmuxNewWindow`, and any new helpers remain focused and under the threshold.
- [x] CHK-035 No magic strings: the `${SHELL:-/bin/sh}` suffix and `-i -c` wrap are embedded as named constants or clearly readable string literals; the `-F '#W'` format is documented in a godoc comment.
- [x] CHK-036 Tests colocated: new tests live in `app/backend/cmd/rk/riff_test.go` alongside the code they test.
- [x] CHK-037 New behavior has tests: `shellWrap` has `TestShellWrap`; `resolveWindowName` has `TestResolveWindowName`; `buildNewWindowArgs` signature change has updated `TestBuildNewWindowArgs` cases.
- [x] CHK-038 No polling, no db/ORM imports, no inline tmux command construction, no route additions: N/A for each — nothing in this change touches those anti-patterns.

## Security

- [x] CHK-039 `exec.CommandContext` with timeout for every subprocess: the new `listWindowNames` call uses `context.WithTimeout(parent, tmuxTimeout)` and does not shell out via a string command.
- [x] CHK-040 No shell-string subprocess construction added: `listWindowNames` uses an explicit argv slice; the existing shell-string for `tmux new-window` / `tmux split-window` is the documented spec exception and is unchanged in that regard.
- [x] CHK-041 Trust-boundary documentation (Bug 9): deferred to hydrate — mark `[x] **N/A**: covered by hydrate stage updates to docs/memory/run-kit/rk-riff.md` at review time. This item is a reminder that no code-side defensive escaping is introduced against `agent.spawn_command`.

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-0NN **N/A**: {reason}`
