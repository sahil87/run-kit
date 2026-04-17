# Tasks: Add rk riff Command

**Change**: 260416-r1j6-add-riff-command
**Spec**: `spec.md`
**Intake**: `intake.md`

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
