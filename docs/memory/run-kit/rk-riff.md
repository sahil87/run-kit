# `rk riff`

`rk riff` is the Cobra subcommand that creates a git worktree, opens a new tmux window inside it, and launches a Claude Code session. It is the first-class replacement for the `riff`/`riffs` shell functions — unified under a single command.

Implementation: `app/backend/cmd/rk/riff.go` (registered in `root.go` via `rootCmd.AddCommand(riffCmd)`).

## Purpose

Spin up an isolated AI development workspace in one shot:

1. Create a worktree via `wt create`.
2. Open a tmux window rooted at the new worktree.
3. Run the configured Claude Code launcher with a command/skill.
4. Optionally split the window and run a setup command in the right pane.

## Invocation

```
rk riff [--cmd <command>] [--split <setup-cmd>] [-- <wt-flags...>]
```

## Flag Surface

| Flag | Type | Default | Purpose |
|------|------|---------|---------|
| `--cmd` | string | `/fab-discuss` | Claude Code command/skill launched in the new window |
| `--split` | string | `""` | When non-empty, splits the window horizontally and runs this setup command in the right pane |
| `--` | separator | — | Everything after `--` forwards verbatim to `wt create` (e.g., `--worktree-name`, `--base`, `--reuse`) |

Cobra's `SetInterspersed(false)` is called in `init()` so the `--` terminator routes passthrough args straight through to `RunE`'s `args []string` parameter unmolested (rather than being mis-parsed as flags for `rk riff`). No other user-facing flags exist.

## Precondition Checks

Validated fast-fail in this order, before any external side effect (worktree creation, tmux calls):

1. `$TMUX` must be set. Read via `tmux.OriginalTMUX` because `internal/tmux`'s `init()` calls `os.Unsetenv("TMUX")` on the process env — the original value is captured into that package-level var before stripping.
2. `wt` must be on PATH (`exec.LookPath("wt")`).

Both failures print to stderr and exit with code 2 via the local `exitCodeError` wrapper. Messages:

- `rk riff: not inside a tmux session ($TMUX unset) — start tmux first`
- `rk riff: wt not found on PATH (required companion tool — see https://github.com/sahil87/wt)`

## Launcher Resolution Algorithm

`resolveLauncher()` (in `riff.go`) discovers the launcher without ever erroring:

1. `cwd, _ := os.Getwd()` — any error falls back to the default.
2. `root := config.FindGitRoot(cwd)` — walks up from cwd looking for `.git`. Returns `""` if not found.
3. `v := fabconfig.ReadSpawnCommand(root)` — best-effort `yaml.v3` read of `agent.spawn_command` from `<root>/fab/project/config.yaml`. Returns `""` for any of: empty root, missing file, unreadable file, malformed YAML, missing `agent` block, missing/empty `spawn_command` key (whitespace-trimmed).
4. If `v != ""`, use it; otherwise fall back to the hardcoded default.

**Hardcoded default**: `claude --dangerously-skip-permissions`.

The launcher is treated as a **shell command string** (not an argv slice). It may contain shell syntax like `$(basename "$(pwd)")` — tmux's shell expands it at window-creation time.

## Workflow Step Order

`runRiff` in `riff.go` executes these steps sequentially. Any step returning an error aborts the workflow.

1. Preconditions (`$TMUX`, then `wt`).
2. Launcher resolution.
3. `wt create --non-interactive --worktree-open skip [<passthrough>...]` via `exec.CommandContext` (30s timeout). Captures combined stdout+stderr.
4. Parse the `Path:` line from wt output via `parseWorktreePath` — scans lines, trims whitespace, returns the first non-empty value after `Path:`. Missing/empty `Path:` or non-existent path → subprocess error.
5. `tmux new-window -n riff-<worktree-basename> -c <worktree-path> "<launcher> '<cmd>'"` via `exec.CommandContext` (10s timeout). The `-n` flag pins the window name so it's easy to locate in `tmux list-windows` and signals provenance (the window came from `rk riff`). Passing `-n` also prevents tmux's `automatic-rename` from overwriting the name as processes come and go. Basename is `filepath.Base(worktreePath)` where `worktreePath` is the already-validated output of `parseWorktreePath`. The argv is constructed by the pure helper `buildNewWindowArgs(worktreePath, launcher, cmdArg) []string`. `cmd.Env = tmuxChildEnv()` restores `TMUX=<OriginalTMUX>` so tmux targets the user's server.
6. If `--split` is non-empty: `tmux split-window -h -c <worktree-path> "<setup>; exec zsh"` (10s timeout). Same child-env restore. `--split ""` (empty) is treated identically to unset — the step is skipped entirely.

## Exit Code Discipline

`riff.go` defines `exitCodeError{code, msg}` with a local `runRiffWithExitCode` wrapper that inspects the returned error via `errors.As` and calls `os.Exit(code)` after printing `msg` to stderr. This is deliberate — `main.execute()` is shared with every other subcommand and must keep returning exit 1 for generic errors, so the exit-code mapping stays local to this file.

| Exit | Condition |
|------|-----------|
| 0 | Success |
| 1 | Generic/unclassified error (falls through to `main.execute()`) |
| 2 | Precondition failure (`$TMUX` unset, `wt` not on PATH) |
| 3 | Subprocess failure (wt or tmux non-zero, output parse failure, timeout) |

## Single-Quote Escaping for `--cmd`

The second argument to `tmux new-window` is itself a shell command string. The launcher + `--cmd` are concatenated as:

```
<launcher> '<escaped-cmd>'
```

`escapeSingleQuotes(s)` replaces every `'` with `'\''` (canonical POSIX shell-safe encoding). Examples:

| Input | Output |
|-------|--------|
| `/fab-discuss` | `/fab-discuss` |
| `say 'hi'` | `say '\''hi'\''` |
| `it's a "test"` | `it'\''s a "test"` |

This is the spec's documented **exception** to the constitution's argv-only rule (§Process Execution). The shell-string concatenation happens inside tmux's own shell invocation, not via Go shell interpolation.

## `internal/fabconfig/` Package

Best-effort `yaml.v3` reader for `fab/project/config.yaml`. Single public function:

```go
fabconfig.ReadSpawnCommand(repoRoot string) string
```

Returns `""` for any failure path (missing file, malformed YAML, missing key, empty value, whitespace-only value). Callers apply their own fallback. Never returns an error — mirrors the pattern used by `internal/config/runkit_yaml.go`.

The subset of `fab/project/config.yaml` that rk models:

```go
type fabConfig struct {
    Agent struct {
        SpawnCommand string `yaml:"spawn_command"`
    } `yaml:"agent"`
}
```

Additional top-level keys in the file are ignored.

## `tmux.OriginalTMUX` Usage

`internal/tmux`'s `init()` strips `$TMUX` from the process env so that bare `tmux` subprocess calls target managed servers (via `-L <server>`) rather than inheriting the parent's pane-local socket. `rk riff` needs the opposite — it wants to create a window on the user's current server — so:

- `checkPreconditions()` reads `tmux.OriginalTMUX` (not `os.Getenv("TMUX")`) to detect the tmux session.
- `tmuxChildEnv()` returns `os.Environ()` with `TMUX=<OriginalTMUX>` appended, so spawned `tmux` processes see the original socket.

This mirrors the pattern in `cmd/rk/context.go`.

## Tests

- `app/backend/cmd/rk/riff_test.go` — 8 `parseWorktreePath` cases, 6 `escapeSingleQuotes` cases, 5 `resolveLauncher` cases (config present / key missing / empty value / no git repo / file absent), subdir-walk case, fabconfig integration smoke.
- `app/backend/internal/fabconfig/fabconfig_test.go` — 8 `ReadSpawnCommand` cases (key present / key missing / agent absent / file absent / empty value / whitespace-only / malformed YAML / shell-substitution value preserved) plus the empty-root guard.

No integration tests invoke real `wt`/`tmux` — the pure helpers are the unit-test surface. Matches existing rk testing conventions (`doctor.go`, `config_test.go`).

## Related Files

- `app/backend/cmd/rk/riff.go` — command implementation
- `app/backend/cmd/rk/riff_test.go` — pure-helper unit tests
- `app/backend/cmd/rk/root.go` — registration via `rootCmd.AddCommand(riffCmd)`
- `app/backend/cmd/rk/context.go` — lists `rk riff` under **Workflow** in the CLI Commands section
- `app/backend/internal/fabconfig/fabconfig.go` — `ReadSpawnCommand(repoRoot)`
- `app/backend/internal/fabconfig/fabconfig_test.go` — fabconfig unit tests
- `app/backend/internal/config/runkit_yaml.go` — `FindGitRoot(dir)` walk-up helper reused by launcher resolution
- `app/backend/internal/tmux/tmux.go` — `OriginalTMUX` package-level var (captured before init strips `$TMUX`)

## Changelog

| Date | Change | Reference |
|------|--------|-----------|
| 2026-04-17 | Initial `rk riff` subcommand — worktree + tmux window + Claude launcher. Unifies the personal-dotfile `riff`/`riffs` shell functions into a first-class `rk` command. `--cmd` (default `/fab-discuss`), `--split <setup-cmd>` (optional horizontal split), `-- <wt-flags>` passthrough to `wt create`. Preconditions: `$TMUX` set + `wt` on PATH (exit 2). Launcher from `agent.spawn_command` in `fab/project/config.yaml` via new `internal/fabconfig/` (falls back to `claude --dangerously-skip-permissions`). Local `exitCodeError` wrapper maps exit codes (2 precondition, 3 subprocess) without touching `main.execute()`. `exec.CommandContext` with 30s/10s timeouts. `tmux.OriginalTMUX` restored in child env so tmux targets the user's current server. | `260416-r1j6-add-riff-command` |
| 2026-04-17 | Name the tmux window `riff-<worktree-basename>` via the `-n` flag, and document via the pure helper `buildNewWindowArgs`. | `260417-w4af-name-riff-window-after-worktree` |
