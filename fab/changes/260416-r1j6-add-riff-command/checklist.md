# Quality Checklist: Add rk riff Command

**Change**: 260416-r1j6-add-riff-command
**Generated**: 2026-04-17
**Spec**: `spec.md`

## Functional Completeness

- [x] CHK-001 Subcommand registration: `rk --help` lists `riff` with Short description; `rk riff --help` shows `--cmd` and `--split` flags with documented defaults.
- [x] CHK-002 Flag surface: only `--cmd` and `--split` user-facing flags exist; `--` separator forwards verbatim to `wt create`; no extra flags (`--launcher`, `--cwd`, etc.) introduced.
- [x] CHK-003 `$TMUX` precondition: `rk riff` with `TMUX=""` exits 2 with the documented stderr message and runs no wt/tmux commands.
- [x] CHK-004 `wt` precondition: `rk riff` with `wt` absent from PATH exits 2 with the documented stderr message.
- [x] CHK-005 Precondition order: when both `$TMUX` and `wt` are missing, the `$TMUX` error is reported first (fast-fail, no second error printed).
- [x] CHK-006 Launcher resolution: with `agent.spawn_command` set in `fab/project/config.yaml`, the resolved launcher equals that value verbatim and is passed to tmux as `<launcher> '<cmd>'`.
- [x] CHK-007 Launcher fallback: with `fab/project/config.yaml` absent OR missing the key OR value empty, launcher resolves to `claude --dangerously-skip-permissions`.
- [x] CHK-008 Repo root discovery: `rk riff` invoked from a subdirectory locates `fab/project/config.yaml` at the repo root via `config.FindGitRoot`; invocation outside any git repo falls back cleanly to the default launcher.
- [x] CHK-009 wt invocation: argv is exactly `wt create --non-interactive --worktree-open skip [passthrough...]`; passthrough args appear after `--` and in the order the user supplied.
- [x] CHK-010 wt output parsing: `^Path: <path>$` line (after trim) is extracted; missing Path line OR path-does-not-exist results in exit code 3 with full wt output in stderr.
- [x] CHK-011 tmux new-window: runs with `-c <worktree-path>` and shell string `<launcher> '<cmd>'`; single quotes in `--cmd` are escaped as `'\''` before concatenation.
- [x] CHK-012 Optional split pane: when `--split` is non-empty, `tmux split-window -h -c <path> "<setup>; exec zsh"` runs after the main window; when `--split` is empty or absent, no split is created.
- [x] CHK-013 Exit code discipline: 0 success, 2 precondition failure, 3 subprocess failure — verified by inspecting the exit-code wiring in `riff.go`.

## Behavioral Correctness

- [x] CHK-014 Process execution constraints: all subprocess calls use `exec.CommandContext` with a timeout — 30s for wt, 10s for each tmux call. No `exec.Command` (without context), no shell-string invocations.
- [x] CHK-015 Existing shell functions unaffected: the user's personal `riff`/`riffs` shell functions still work independently — no conflict with the new `rk riff` binary subcommand.
- [x] CHK-016 Non-modification of `main.execute`: the exit-code mapping is local to `riff.go`; `cmd/rk/main.go` `execute()` is unchanged so other subcommands retain their exit-1 behavior on generic errors.

## Scenario Coverage

- [x] CHK-017 Scenario "Happy path" (spec § Workflow Execution): all 7 steps complete, exit 0, tmux window created with launcher+cmd.
- [x] CHK-018 Scenario "Custom cmd flag": `rk riff --cmd "/fab-new add retry logic"` launches the quoted cmd verbatim (with shell-safe quoting) in the new window.
- [x] CHK-019 Scenario "Split flag": `rk riff --split "just dev"` produces a horizontal split whose right pane runs `just dev; exec zsh`.
- [x] CHK-020 Scenario "wt passthrough": `rk riff -- --worktree-name alpha --base main` forwards both passthrough flags to `wt create` in order; `--cmd`/`--split` are NOT forwarded.
- [x] CHK-021 Scenario "`--cmd` contains single quote": `rk riff --cmd "say 'hello'"` produces correctly escaped `'say '\''hello'\'''` in the tmux shell string.
- [x] CHK-022 Scenario "Config file absent" and "Config missing key": launcher falls back to `claude --dangerously-skip-permissions` without error.

## Edge Cases & Error Handling

- [x] CHK-023 wt hangs: 30-second `exec.CommandContext` timeout is enforced; process is killed and exit 3 is returned with a timeout-specific error message.
- [x] CHK-024 wt non-zero exit: output (combined stdout+stderr) is included in the returned error; no tmux command runs.
- [x] CHK-025 tmux new-window fails: subsequent split-window is SKIPPED; no orphan panes/worktrees left behind.
- [x] CHK-026 `--split ""` (explicit empty): treated the same as unset; no split pane created; no error.
- [x] CHK-027 Not inside a git repo: `config.FindGitRoot` returns `""`, launcher falls back, workflow proceeds normally (wt/tmux errors are surfaced by those tools as usual).

## Code Quality

- [x] CHK-028 Pattern consistency: `riff.go` mirrors existing cobra subcommand patterns in `cmd/rk/` (variable naming, flag registration via `init()`, `SilenceUsage` consistency).
- [x] CHK-029 No unnecessary duplication: reuses `config.FindGitRoot` instead of reimplementing; reuses `gopkg.in/yaml.v3` (already a dep) instead of writing a line-based parser.
- [x] CHK-030 Go idioms: error wrapping with `%w` where appropriate; explicit `context.WithTimeout` + `defer cancel()`; `strings.TrimSpace` for line parsing; no magic numbers (timeouts/exit codes declared as named constants).
- [x] CHK-031 Test coverage: `fabconfig_test.go` covers all 6 scenarios from T001; `riff_test.go` covers `parseWorktreePath`, `escapeSingleQuotes`, launcher-fallback behavior.

## Security

- [x] CHK-032 No shell injection: user-provided `--cmd`, `--split`, and wt passthrough args are never interpolated into shell strings via Go concatenation — `--cmd` is single-quote-escaped for tmux's shell string only; wt passthrough uses argv; `--split` is passed through to tmux's shell string but is a user-authored shell command by design.
- [x] CHK-033 Constitution §I (Security First): all `exec.*` calls use `exec.CommandContext` with explicit argv slices and timeouts, never `exec.Command` without context and never raw shell strings from Go.

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-NNN **N/A**: {reason}`
