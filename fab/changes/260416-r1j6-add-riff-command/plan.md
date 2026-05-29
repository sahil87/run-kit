# Plan: Add rk riff Command

**Change**: 260416-r1j6-add-riff-command
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

## Phase 1: Setup

<!-- Scaffolding, dependencies, configuration. No business logic. -->

- [x] T001 Create `app/backend/internal/fabconfig/fabconfig.go` implementing `ReadSpawnCommand(repoRoot string) string` with `gopkg.in/yaml.v3`: reads `<repoRoot>/fab/project/config.yaml`, walks `agent.spawn_command`, returns trimmed string. Returns `""` for missing file, missing key, empty value, or parse error (best-effort — no errors). Also add `app/backend/internal/fabconfig/fabconfig_test.go` with table-driven tests covering: (a) key present → returns value verbatim, (b) key missing under `agent` → returns `""`, (c) `agent` block absent → returns `""`, (d) file absent → returns `""`, (e) empty string value → returns `""`, (f) malformed YAML → returns `""`.

## Phase 2: Core Implementation

<!-- Primary functionality. Order by dependency — earlier tasks are prerequisites for later ones. -->

- [x] T002 Create `app/backend/cmd/rk/riff.go` with the cobra command skeleton: `var riffCmd = &cobra.Command{Use: "riff", Short: "Create a worktree, tmux window, and Claude Code session", ...}`. Define persistent flags `--cmd` (string, default `/fab-discuss`, "Claude Code command/skill to launch") and `--split` (string, default empty, "If non-empty, split the window and run this setup command in the right pane"). Leave `RunE` as a stub (returns nil) for this task. Register via `rootCmd.AddCommand(riffCmd)` in `app/backend/cmd/rk/root.go`'s `init()` (alongside the other AddCommand calls).

- [x] T003 Implement precondition checks in `app/backend/cmd/rk/riff.go` `RunE`. Order: (1) Verify `os.Getenv("TMUX") != ""` — on failure print `rk riff: not inside a tmux session ($TMUX unset) — start tmux first` to stderr and return an error that causes exit code 2. (2) Verify `exec.LookPath("wt")` succeeds — on failure print `rk riff: wt not found on PATH (required companion tool — see https://github.com/sahil87/wt)` to stderr, exit code 2. <!-- clarified: wt error message now matches spec scenario verbatim (includes repo URL) --> Introduce a package-local exit-code type in `riff.go` (e.g., `type exitCodeError struct { code int; msg string }` with `Error() string`) and wire exit-code mapping via a local wrapper: assign `riffCmd.RunE` through a small helper that checks for `*exitCodeError` and calls `os.Exit(code)` after printing to stderr. Do NOT modify `main.execute()` — it is shared with other subcommands and must keep returning exit 1 for generic errors. <!-- clarified: exit-code helper is local to riff.go; do not touch main.execute() --> Existing `rootCmd` uses `SilenceUsage: true`; keep consistent.

- [x] T004 Implement launcher resolution in `app/backend/cmd/rk/riff.go`. Import `rk/internal/config` for `FindGitRoot` and `rk/internal/fabconfig` for `ReadSpawnCommand`. Algorithm: `cwd, _ := os.Getwd(); root := config.FindGitRoot(cwd); launcher := ""; if root != "" { launcher = fabconfig.ReadSpawnCommand(root) }; if launcher == "" { launcher = "claude --dangerously-skip-permissions" }`. Launcher resolution never errors — missing config is a fallback path.

- [x] T005 Implement `wt create` invocation in `app/backend/cmd/rk/riff.go`. Build argv: `["create", "--non-interactive", "--worktree-open", "skip"]` plus any passthrough args (cobra's `args []string` after cobra has processed its own flags — configure `riffCmd.DisableFlagParsing = false` and ensure `cmd.Flags().SetInterspersed(false)` so `--` terminates cobra parsing). Run via `exec.CommandContext` with a 30-second timeout; capture combined stdout+stderr. On non-zero exit, return exit-code-3 error with wt's output included in the message. Parse the output line-by-line for `^Path: <path>$` (after `strings.TrimSpace`); if no such line found, or the path doesn't exist per `os.Stat`, return exit-code-3 error that includes the full wt output for troubleshooting.

- [x] T006 Implement `tmux new-window` invocation in `app/backend/cmd/rk/riff.go`. Add a small `escapeSingleQuotes(s string) string` helper that replaces `'` with `'\''`. Assemble the tmux shell string: `fmt.Sprintf("%s '%s'", launcher, escapeSingleQuotes(cmdFlag))`. Run `exec.CommandContext` with 10-second timeout: `tmux new-window -c <worktree-path> <shell-string>`. On non-zero exit or timeout, return exit-code-3 error with tmux's combined output.

- [x] T007 Implement optional `--split` handling in `app/backend/cmd/rk/riff.go`. After a successful `tmux new-window` (T006), if `splitFlag != ""`, run: `tmux split-window -h -c <worktree-path> <split-shell-string>` where `<split-shell-string>` = `fmt.Sprintf("%s; exec zsh", splitFlag)`. Use `exec.CommandContext` with 10-second timeout. On failure, return exit-code-3 error with tmux's output. Empty `splitFlag` means no split — skip this step entirely (no error).

## Phase 3: Integration & Edge Cases

<!-- Wire components together. Handle error states, edge cases, validation. -->

- [x] T008 [P] Unit tests in `app/backend/cmd/rk/riff_test.go`. Table-driven tests for the pure helpers: (a) `parseWorktreePath` — happy path, whitespace trimming, Path line among other lines, missing Path line returns error, Path: with empty value returns error; (b) `escapeSingleQuotes` — no quotes, one quote, multiple quotes, only quotes; (c) `resolveLauncher` signature if extracted as a testable function (with injected `ReadSpawnCommand` or a root-path param) — config-present returns value, config-missing returns fallback, empty value returns fallback. Do NOT write integration tests that invoke real `wt` or `tmux`; those are out of scope per spec Assumption #19.

- [x] T009 Integration smoke: run `just build` (or `go build -o ../../bin/rk ./cmd/rk` from `app/backend/`). Confirm build succeeds with no new warnings. Run `./bin/rk --help` — verify `riff` appears in Available Commands with the Short description. Run `./bin/rk riff --help` — verify flag surface matches spec (`--cmd` default `/fab-discuss`, `--split` default empty). Inside a tmux session in a repo with `wt` installed, run a sanity `rk riff --cmd /fab-discuss` against a throwaway branch and confirm it creates a worktree, opens a tmux window, and launches the configured spawn_command. Record what was smoke-tested in the PR description.

## Phase 4: Polish

<!-- Documentation, cleanup. Only include if warranted by the change scope. -->

- [x] T010 Run `just test-backend` and confirm all Go tests pass (including T001 fabconfig tests and T008 riff tests). Run `just test` if full suite is meaningful. Address any lint/formatter feedback (`gofmt`, `go vet`).

---

## Execution Order

<!-- Summary of dependencies between tasks. Only include non-obvious dependencies. -->

- T001 blocks T004 (riff.go imports `internal/fabconfig`).
- T002 blocks T003, T004, T005, T006, T007 (they all edit `RunE` in the file T002 creates).
- T003 → T004 → T005 → T006 → T007 are sequential — each extends the `RunE` implementation on top of the previous task's work.
- T008 can run in parallel with T003–T007 once T002 lands. The pure helpers it tests (`parseWorktreePath`, `escapeSingleQuotes`) may be sketched early and refined as T005/T006 finalize their shape.
- T009 and T010 run after all implementation tasks complete. T009 is a manual smoke; T010 is the automated test run.

## Acceptance

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
