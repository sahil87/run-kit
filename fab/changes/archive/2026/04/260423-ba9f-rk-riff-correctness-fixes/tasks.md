# Tasks: rk riff — Correctness and Portability Fixes

**Change**: 260423-ba9f-rk-riff-correctness-fixes
**Spec**: `spec.md`
**Intake**: `intake.md`

<!--
  TASK FORMAT: - [ ] {ID} [{markers}] {Description with file paths}

  Markers:
    [P] — Parallelizable (different files, no dependencies on other [P] tasks in same group)

  Memory hydration (docs/memory/run-kit/rk-riff.md updates + Changelog row) happens
  during the hydrate stage, not apply. That is why no apply task touches docs/.
-->

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

<!-- Migrated to plan.md on 2026-05-29 — safe to delete. -->
