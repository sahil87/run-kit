# Quality Checklist: rk riff — Correctness and Portability Fixes

**Change**: 260423-ba9f-rk-riff-correctness-fixes
**Generated**: 2026-04-23
**Spec**: `spec.md`

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
