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
rk riff [--skill <skill>] [--setup-pane <setup-cmd>] [-- <wt-flags...>]
```

## Flag Surface

| Flag | Type | Default | Purpose |
|------|------|---------|---------|
| `--skill` | string | `/fab-discuss` | Claude Code skill or slash-command launched in the new window |
| `--setup-pane` | string | `""` | When non-empty, splits the window horizontally and runs this setup command in the right pane |
| `--` | separator | — | Everything after `--` forwards verbatim to `wt create` (e.g., `--worktree-name`, `--base`, `--reuse`) |

Cobra's `SetInterspersed(false)` is called in `init()` so the `--` terminator routes passthrough args straight through to `RunE`'s `args []string` parameter unmolested (rather than being mis-parsed as flags for `rk riff`). No other user-facing flags exist. Internal package-level variables that back the flags are `riffSkillFlag` and `riffSetupPaneFlag` (renamed from `riffCmdFlag` / `riffSplitFlag` in change `260423-udhe-rk-riff-cli-surface`).

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
5. `tmux new-window -n <resolvedName> -c <worktree-path> "<composed-shell-string>"` via `exec.CommandContext` (10s timeout). The `-n` flag pins the window name so it's easy to locate in `tmux list-windows` and signals provenance (the window came from `rk riff`). Passing `-n` also prevents tmux's `automatic-rename` from overwriting the name as processes come and go. The name comes from `resolveWindowName(existing, "riff-"+filepath.Base(worktreePath))` where `existing` is the output of `listWindowNames(ctx)` — the collision check runs just before `new-window` (see **Window-Name Collision Resolution** below). The composed shell string is built by the pure helper `buildNewWindowArgs(worktreePath, resolvedName, launcher, cmdArg)` in three layers:
   1. **Launcher-with-cmd-arg**: `<launcher> '<escapeSingleQuotes(cmdArg)>'`.
   2. **Interactive launcher wrap**: `${SHELL:-/bin/sh} -i -c '<escapeSingleQuotes(layer-1)>'` so `.zshrc` / `.bashrc` aliases, functions, and interactive-only PATH tweaks are available to the launcher (closes the old "works for me, breaks on my teammate's machine" class of bug).
   3. **`shellWrap` suffix**: appends `; exec "${SHELL:-/bin/sh}"` so the pane stays interactive in the user's shell after the launcher exits, rather than dying or showing `[exited]`.

   `cmd.Env = tmuxChildEnv()` restores `TMUX=<OriginalTMUX>` so tmux targets the user's server.
6. If `--setup-pane` is non-empty: `tmux split-window -h -c <worktree-path> "<shellWrap(setupCmd)>"` (10s timeout). Same child-env restore. The literal `"<setup>; exec zsh"` form is gone — `shellWrap` now emits `<setupCmd>; exec "${SHELL:-/bin/sh}"`, so bash/fish users land in their own shell instead of zsh. Only the `shellWrap` suffix is applied here — the interactive-launcher wrap is scoped to step 5. `--setup-pane ""` (empty) is treated identically to unset — the step is skipped entirely.

## Exit Code Discipline

`riff.go` defines `exitCodeError{code, msg}` with a local `runRiffWithExitCode` wrapper that inspects the returned error via `errors.As` and calls `os.Exit(code)` after printing `msg` to stderr. This is deliberate — `main.execute()` is shared with every other subcommand and must keep returning exit 1 for generic errors, so the exit-code mapping stays local to this file.

| Exit | Condition |
|------|-----------|
| 0 | Success |
| 1 | Generic/unclassified error (falls through to `main.execute()`) |
| 2 | Precondition failure (`$TMUX` unset, `wt` not on PATH) |
| 3 | Subprocess failure (wt or tmux non-zero, output parse failure, timeout) |

## Single-Quote Escaping for `--skill`

The second argument to `tmux new-window` is itself a shell command string. The launcher + `--skill` are concatenated as:

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

## SIGINT Propagation

`runRiff` wraps its root `context.Context` once, immediately after precondition checks, with:

```go
ctx, stop := signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)
defer stop()
```

The wrapped `ctx` is then threaded through all three subprocess call sites — `runWtCreate`, `runTmuxNewWindow` (which also uses it for the internal `listWindowNames` probe), and `runTmuxSplitWindow`. `cmd.Context()` is never used directly by any of them.

This means Ctrl-C (or SIGTERM) during a hung `wt create`, a slow `tmux list-windows`, or either of the `tmux new-window`/`split-window` invocations cancels the wrapped context, which `exec.CommandContext` observes and propagates as process kill — no zombie `wt`/`tmux` processes reparent to init after `rk riff` exits. The `defer stop()` deregisters the signal handler when `runRiff` returns normally so the parent process's default signal disposition is restored.

Matches the stdlib idiom for CLI tools (single-site handler, propagate the cancellable context downstream). The SIGINT path is not automated in tests — manual verification via a hung `wt create` is the acceptance check (see Design Decisions in the change spec for the ROI rationale).

## Window-Name Collision Resolution

Before calling `tmux new-window`, `runTmuxNewWindow` queries the user's current tmux server for existing window names and auto-suffixes the desired name on collision:

1. `listWindowNames(ctx)` runs `tmux list-windows -F '#W'` (with `tmuxChildEnv()` so it targets the user's server). Trims each line and drops empties. Non-zero exit / timeout surfaces as a `subprocessErr` (exit 3) with the tmux output embedded in the message. `runTmuxNewWindow` bubbles that up before attempting `new-window`.
2. `resolveWindowName(existing []string, base string) string` is a pure helper — no I/O, no context, deterministic — that returns `base` if free, otherwise probes `base-2`, `base-3`, … and returns the first name not in `existing`. The suffix scheme starts at `-2` (so the bare `base` is always preferred when free) and fills gaps (if `base`, `base-3` are taken but `base-2` is free, it returns `base-2`).

The split between I/O (`listWindowNames`) and pure logic (`resolveWindowName`) keeps the collision algorithm unit-testable without invoking real tmux.

**Accepted TOCTOU race**: another process can create a window with the resolved name between `listWindowNames` and `new-window`. This race is explicitly accepted — the fallback behavior degrades to the pre-change behavior (silent duplicate under default `allow-rename`, or a tmux error if the user has `set-option -g allow-rename off`). No locking, no retry.

## Security / Trust Boundary

`fabconfig.ReadSpawnCommand` returns the `agent.spawn_command` value from `fab/project/config.yaml` **unescaped and verbatim**. It is then concatenated into a shell command string that tmux's shell executes. This means:

- `fab/project/config.yaml` is a **trust boundary equivalent to committed code**. A hostile or careless edit to that file can execute arbitrary shell the moment `rk riff` runs.
- `escapeSingleQuotes` ONLY protects the `--skill` argument. It does **not** protect the launcher string — shell expansion in the launcher is deliberate.
- Shell expansion inside the launcher (e.g., `claude -n "$(basename "$(pwd)")"`) is the documented **intentional exception** to constitution §I (Security First) — the "all process execution MUST use argv slices" rule. Removing that capability would break legitimate launcher patterns, and defensive escaping / allow-listing offers no meaningful protection against a hostile repo (which is an out-of-scope threat model).
- Users who consume third-party repos SHOULD audit `fab/project/config.yaml` before running `rk riff` against them — the same way they would audit a `justfile` or `Makefile` checked into that repo.

No code mitigation is added on account of this posture — the fix for the original concern (Bug 9) is documentation, not validation.

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
  - `TestBuildNewWindowArgs` — updated signature: takes the **resolved window name** as input (not derived from path) and asserts the trailing shell-string argv element contains both the interactive-launcher wrap (`${SHELL:-/bin/sh} -i -c ...`) and the `shellWrap` suffix (`; exec "${SHELL:-/bin/sh}"`).
  - `TestShellWrap` — covers the pure `shellWrap` helper: empty input, single-command, single-quote, and double-quote cases. Asserts the trailing `; exec "${SHELL:-/bin/sh}"` is present in every case.
  - `TestResolveWindowName` — covers the pure collision-resolution helper: no-collision returns base, one-collision returns `base-2`, multi-collision returns `base-4`, empty existing-list returns base, gap-before-collision (`base`, `base-3` taken) returns `base-2`.
- `app/backend/internal/fabconfig/fabconfig_test.go` — 8 `ReadSpawnCommand` cases (key present / key missing / agent absent / file absent / empty value / whitespace-only / malformed YAML / shell-substitution value preserved) plus the empty-root guard.

No integration tests invoke real `wt`/`tmux` — the pure helpers are the unit-test surface. Matches existing rk testing conventions (`doctor.go`, `config_test.go`). SIGINT propagation is deliberately not automated — manual verification against a hung `wt create` is the acceptance check.

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
| 2026-04-23 | Correctness and portability fixes — no CLI surface change. (1) New pure `shellWrap(cmd)` helper appends `; exec "${SHELL:-/bin/sh}"`; used by both new-window and split paths so panes stay interactive after their commands exit. (2) Launcher now runs under an interactive `${SHELL:-/bin/sh} -i -c '...'` wrap inside `buildNewWindowArgs` so `.zshrc`/`.bashrc` aliases, functions, and interactive-only PATH tweaks reach the Claude Code launcher (closes Bug 3). (3) Split pane replaces the hardcoded `exec zsh` with `shellWrap(setupCmd)` — bash/fish users land in their own shell (closes Bug 8). (4) SIGINT/SIGTERM propagation — `runRiff` wraps its root context via `signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)` with `defer stop()`, threaded through all three subprocess call sites; Ctrl-C no longer leaves orphan `wt`/`tmux` children (closes Bug 10). (5) Window-name auto-suffix — `listWindowNames(ctx)` probes `tmux list-windows -F '#W'` and `resolveWindowName(existing, base)` (pure, gap-filling) applies `-2`, `-3`, … on collision; TOCTOU race between list and new-window is accepted (closes Bug 11). (6) Added Security / Trust Boundary section documenting `fab/project/config.yaml` as committed-code-equivalent and naming launcher shell expansion as the intentional exception to constitution §I (addresses Bug 9 via docs only — no code mitigation). `buildNewWindowArgs` signature changed to accept the resolved name; new `TestShellWrap` and `TestResolveWindowName` cover the new pure helpers. | `260423-ba9f-rk-riff-correctness-fixes` |
| 2026-04-23 | CLI surface refinement — hard-rename flags and expand help text, no behavioral change. (1) `--cmd` renamed to `--skill` (hard-rename, no deprecation alias — invocations using `--cmd` fail with cobra's "unknown flag" error). (2) `--split` renamed to `--setup-pane` (hard-rename, no deprecation alias). (3) Package-level Go variables renamed in lockstep: `riffCmdFlag` → `riffSkillFlag`, `riffSplitFlag` → `riffSetupPaneFlag`. (4) `Use:` synopsis expanded from `riff [-- wt-flags...]` to `riff [--skill <name>] [--setup-pane <cmd>] [-- <wt-flags>...]` so both primary flags and the `--` passthrough separator appear in `rk riff --help`'s Usage line. (5) `Long:` help expanded to match `serve.go` house style with `Prerequisites:`, `--` separator / `wt create` passthrough paragraph, `Launcher resolution:`, `Examples:` (at least four invocations covering bare default, `--skill`, `--setup-pane`, and wt passthrough), and `Exit codes:` blocks (0 success / 2 precondition / 3 subprocess). (6) Bug 2 investigation note — verified on 2026-04-23 via live smoke test that positional argv to `claude` (documented as `[prompt]` in `claude --help`) correctly dispatches slash-commands; the current `<launcher> '<escaped-cmd>'` composition in `buildNewWindowArgs` is correct. No delivery-mechanism change, no new test. | `260423-udhe-rk-riff-cli-surface` |
