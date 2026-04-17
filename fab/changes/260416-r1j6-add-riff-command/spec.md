# Spec: Add rk riff Command

**Change**: 260416-r1j6-add-riff-command
**Created**: 2026-04-17
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/tmux-sessions.md`, `docs/memory/run-kit/rk-riff.md`

## Non-Goals

- **No `git worktree add` fallback** — `rk riff` hard-requires `wt` on PATH. Reason: aligns with constitution's "Wrap, Don't Reinvent".
- **No auto-start of tmux sessions** — `rk riff` hard-requires `$TMUX` to be set. Reason: matches `fab operator`; keeps the command contract simple.
- **No new config file or config keys** — `rk riff` reuses the existing `agent.spawn_command` from `fab/project/config.yaml`. Reason: Convention Over Configuration.
- **No detached / non-tmux run mode** — the command is inherently "create a tmux window", not a generic launcher.
- **No removal of the existing `riff` / `riffs` shell functions** — users adopt `rk riff` voluntarily; shell functions remain in personal dotfiles until users opt out.
- **No Windows support** — `rk riff` targets Linux/macOS like the rest of run-kit. `runtime.GOOS == "windows"` is not tested for.

## rk: Command Surface

### Requirement: Subcommand registration

The `rk` binary SHALL expose a new subcommand named `riff`, registered through cobra alongside existing subcommands (`serve`, `status`, `doctor`, `init-conf`, `context`, `update`).

Invocation form:
```
rk riff [--cmd <command>] [--split <setup-cmd>] [-- <wt-flags...>]
```

#### Scenario: Help output discoverable
- **GIVEN** a user has built `rk` with the riff subcommand compiled in
- **WHEN** they run `rk --help`
- **THEN** `riff` appears in the Available Commands list with its Short description
- **AND** `rk riff --help` prints cobra-generated usage with all three flags documented

#### Scenario: No-arg invocation uses defaults
- **GIVEN** a user runs `rk riff` inside a tmux session in a git repository where `wt` is on PATH
- **WHEN** no flags or passthrough args are provided
- **THEN** the command SHALL execute `wt create --non-interactive --worktree-open skip`
- **AND** launch the Claude Code session with `/fab-discuss` as the command argument

### Requirement: Flag surface

The `riff` subcommand SHALL accept exactly three user-facing flags plus wt passthrough.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--cmd` | string | `/fab-discuss` | Claude Code command/skill launched in the new window |
| `--split` | string | `""` (unset) | When non-empty, splits the window horizontally and runs this setup command in the right pane |
| `--` | separator | — | Everything after `--` is forwarded verbatim to `wt create` |

No other flags (`--launcher`, `--cwd`, `--no-split`, `--env`, etc.) are introduced.

#### Scenario: Custom cmd flag
- **GIVEN** a user runs `rk riff --cmd "/fab-new add retry logic"`
- **WHEN** the window is created
- **THEN** the tmux window shall launch `<spawn_command> '/fab-new add retry logic'`

#### Scenario: Split flag
- **GIVEN** a user runs `rk riff --split "just dev"`
- **WHEN** the window is created
- **THEN** the main pane runs the launcher with `/fab-discuss`
- **AND** a horizontal split pane runs `just dev; exec zsh` at the worktree path

#### Scenario: wt passthrough
- **GIVEN** a user runs `rk riff -- --worktree-name alpha --base main`
- **WHEN** `rk riff` invokes `wt create`
- **THEN** the resulting command SHALL be `wt create --non-interactive --worktree-open skip --worktree-name alpha --base main`
- **AND** args before `--` (the cobra-recognized flags) are NOT forwarded to wt

#### Scenario: Combined flags
- **GIVEN** a user runs `rk riff --cmd /fab-continue --split "just dev" -- --worktree-name beta`
- **WHEN** the workflow executes
- **THEN** all three pieces are applied: cmd override, split pane, wt arg passthrough

## rk: Preconditions

### Requirement: `wt` must be on PATH

`rk riff` SHALL verify that `wt` is on the `$PATH` before creating a worktree. If `wt` is not resolvable, the command MUST exit with a non-zero status and print a clear error message naming the missing dependency.

#### Scenario: wt missing
- **GIVEN** the user has `rk` installed but `wt` is not on PATH
- **WHEN** they run `rk riff`
- **THEN** the command SHALL exit with code 2 (precondition failure — see Exit Code Discipline)
- **AND** stderr SHALL contain a message like `rk riff: wt not found on PATH (required companion tool — see https://github.com/sahil87/wt)`
- **AND** no tmux window SHALL be created
- **AND** no worktree SHALL be created

### Requirement: `$TMUX` must be set

`rk riff` SHALL verify that the `$TMUX` environment variable is set before creating the tmux window. If `$TMUX` is empty or unset, the command MUST exit non-zero without running `wt create` or any tmux commands.

#### Scenario: Not in tmux
- **GIVEN** the user runs `rk riff` outside any tmux session
- **WHEN** `rk riff` starts
- **THEN** the command SHALL exit with code 2 (precondition failure — see Exit Code Discipline)
- **AND** stderr SHALL contain a message like `rk riff: not inside a tmux session ($TMUX unset) — start tmux first`
- **AND** no worktree SHALL be created

### Requirement: Precondition order

`rk riff` SHALL validate preconditions before performing any external side effect (worktree creation, tmux window creation). Validation order SHALL be: (1) `$TMUX` set, (2) `wt` on PATH. Validation is fast-fail — on the first failure, the command exits immediately without checking subsequent preconditions.

#### Scenario: Both missing, reports $TMUX first
- **GIVEN** `$TMUX` is unset and `wt` is also missing
- **WHEN** the user runs `rk riff`
- **THEN** the command SHALL report the `$TMUX` error and exit
- **AND** SHALL NOT report the `wt` error in the same invocation

## rk: Launcher Resolution

### Requirement: Launcher sourced from `agent.spawn_command`

`rk riff` SHALL resolve the launcher command from the `agent.spawn_command` key of `fab/project/config.yaml` at the repo root. If the key is missing, null, or empty, the launcher SHALL fall back to `claude --dangerously-skip-permissions`. This mirrors the resolution logic used by `fab operator`.

The resolved value is a **shell command string** (not an argv array). It SHALL be appended with a single-quoted `<cmd>` argument when passed to tmux: `<spawn_command> '<cmd>'`.

#### Scenario: Config present with spawn_command
- **GIVEN** `fab/project/config.yaml` contains `agent.spawn_command: claude --dangerously-skip-permissions --effort max -n "$(basename "$(pwd)")"`
- **WHEN** `rk riff` resolves the launcher
- **THEN** the resolved string SHALL equal that value verbatim
- **AND** the final tmux window command SHALL be `claude --dangerously-skip-permissions --effort max -n "$(basename "$(pwd)")" '/fab-discuss'`

#### Scenario: Config missing key
- **GIVEN** `fab/project/config.yaml` exists but has no `agent.spawn_command` key
- **WHEN** `rk riff` resolves the launcher
- **THEN** the resolved string SHALL be `claude --dangerously-skip-permissions`

#### Scenario: Config file absent
- **GIVEN** there is no `fab/project/config.yaml` at the repo root
- **WHEN** `rk riff` resolves the launcher
- **THEN** the resolved string SHALL be `claude --dangerously-skip-permissions`
- **AND** the command SHALL NOT error out — config absence is non-fatal

### Requirement: Repo root discovery

`rk riff` SHALL discover the repo root by walking up from the current working directory looking for a `.git` directory/file, using the same algorithm as the existing `config.FindGitRoot` helper. `fab/project/config.yaml` is resolved relative to that root.

#### Scenario: Invoked from subdirectory
- **GIVEN** a user runs `rk riff` from `<repo>/app/frontend/src/`
- **WHEN** the launcher is resolved
- **THEN** `rk riff` SHALL find `.git` by walking up and read `<repo>/fab/project/config.yaml`

#### Scenario: Not in a git repo
- **GIVEN** a user runs `rk riff` from a directory that is not inside any git repo
- **WHEN** launcher resolution runs
- **THEN** resolution SHALL fall back to the hardcoded default (`claude --dangerously-skip-permissions`) without erroring

## rk: Workflow Execution

### Requirement: Workflow step order

`rk riff` SHALL execute the following steps in order. Each step that fails SHALL abort the workflow and propagate an error.

1. Validate `$TMUX` is set.
2. Validate `wt` is on PATH.
3. Resolve launcher from `fab/project/config.yaml`.
4. Run `wt create --non-interactive --worktree-open skip [<wt-flags>...]` via `exec.CommandContext`.
5. Parse the `Path:` line from `wt`'s combined stdout/stderr output.
6. Run `tmux new-window -c <worktree-path> "<spawn_command> '<cmd>'"` via `exec.CommandContext`.
7. If `--split <setup-cmd>` is non-empty, run `tmux split-window -h -c <worktree-path> "<setup-cmd>; exec zsh"` via `exec.CommandContext`.

#### Scenario: Happy path
- **GIVEN** all preconditions pass, wt creates a worktree at `/tmp/myrepo.worktrees/alpha/`, and no split flag is given
- **WHEN** the workflow runs
- **THEN** steps 1-6 complete successfully
- **AND** step 7 is skipped (no split)
- **AND** the command exits 0

### Requirement: wt output parsing

`rk riff` SHALL extract the worktree path from a line of `wt`'s output matching the pattern `^Path: <path>$` (whitespace-trimmed). If no such line exists or the extracted path is not an existing directory, `rk riff` MUST exit non-zero with an error that includes wt's combined output.

#### Scenario: Path line present
- **GIVEN** `wt create` prints (among other lines) `Path: /tmp/myrepo.worktrees/alpha`
- **WHEN** `rk riff` parses the output
- **THEN** the extracted path SHALL be `/tmp/myrepo.worktrees/alpha`

#### Scenario: Path line missing
- **GIVEN** `wt create` succeeds but its output contains no `Path:` line (malformed or empty)
- **WHEN** `rk riff` parses the output
- **THEN** the command SHALL exit non-zero
- **AND** the error SHALL include the full wt output for troubleshooting

#### Scenario: wt exits non-zero
- **GIVEN** `wt create` fails (e.g., branch already checked out)
- **WHEN** `rk riff` invokes wt
- **THEN** the command SHALL exit non-zero
- **AND** the error SHALL include wt's combined stdout+stderr and the wt exit code

### Requirement: Process execution constraints

All subprocess invocations (`wt`, `tmux`) SHALL use `exec.CommandContext` with an explicit timeout-bearing context, per the constitution's Process Execution constraint. Arguments SHALL be passed as explicit argv slices, never as shell strings. The user's `--cmd` value, `--split` value, and wt passthrough args MAY contain shell metacharacters and SHALL be treated as argv elements rather than interpolated into shell strings.

**Exception — tmux window command**: the second argument to `tmux new-window` is itself a shell command string interpreted by tmux's default shell. The `<spawn_command>` + `<cmd>` concatenation happens inside that string, not via Go shell concatenation.

Timeouts:
- `wt create`: 30 seconds (matches build operations — worktree creation is the slowest step).
- `tmux new-window`: 10 seconds.
- `tmux split-window`: 10 seconds.

#### Scenario: `--cmd` contains special characters
- **GIVEN** a user runs `rk riff --cmd "/fab-new fix bug \$foo"`
- **WHEN** the tmux window is created
- **THEN** the `$foo` SHALL reach tmux/the launcher unmodified (not shell-expanded by rk)
- **AND** the command SHALL use single-quote escaping around the cmd arg in the tmux command string

#### Scenario: wt hangs
- **GIVEN** `wt create` hangs indefinitely
- **WHEN** the 30-second timeout expires
- **THEN** `rk riff` SHALL kill the wt process and exit non-zero with a timeout error

## rk: Tmux Integration

### Requirement: Tmux window creation

`rk riff` SHALL create a new tmux window (in the current tmux server/session) with its working directory set to the worktree path and the launcher command as the window's initial command.

Command shape:
```
tmux new-window -c <worktree-path> "<spawn_command> '<cmd>'"
```

The `<cmd>` value is single-quoted inside the shell string passed to tmux. If the user's `--cmd` value contains a literal single quote, it SHALL be escaped using the canonical shell-safe encoding (`'\''`) before concatenation.

#### Scenario: Window inherits current session
- **GIVEN** the user is attached to tmux session `devshell`
- **WHEN** `rk riff` runs
- **THEN** the new window SHALL be created in `devshell` (tmux's default target — no `-t` flag needed)

#### Scenario: --cmd contains single quote
- **GIVEN** a user runs `rk riff --cmd "say 'hello'"`
- **WHEN** the command string for `tmux new-window` is assembled
- **THEN** the cmd arg SHALL be quoted as `'say '\''hello'\'''` so tmux's shell parses it correctly

### Requirement: Optional split pane

When `--split <setup-cmd>` is non-empty, `rk riff` SHALL create a horizontal split of the new window. The right pane SHALL run the setup command followed by `exec zsh` so the pane stays open after the setup command completes.

Command shape:
```
tmux split-window -h -c <worktree-path> "<setup-cmd>; exec zsh"
```

The split pane SHALL use the same worktree path as the main pane. The split SHALL target the just-created window; tmux's default target after `new-window` is the newly created window, so no explicit `-t` flag is needed.

The split SHALL happen AFTER the main window is created — never before, never concurrently. If `tmux new-window` fails, `tmux split-window` SHALL NOT run.

#### Scenario: Split runs setup then keeps shell
- **GIVEN** a user runs `rk riff --split "just dev"`
- **WHEN** the split pane starts
- **THEN** the pane SHALL run `just dev; exec zsh`
- **AND** after `just dev` exits, the pane SHALL remain open in an interactive zsh

#### Scenario: Split without main window
- **GIVEN** `tmux new-window` fails
- **WHEN** the workflow processes the error
- **THEN** the split-window step SHALL be skipped entirely
- **AND** no partial state (orphan panes) SHALL be left behind

#### Scenario: Split with empty string
- **GIVEN** a user passes `--split ""` (explicit empty)
- **WHEN** the workflow evaluates the split flag
- **THEN** NO split pane SHALL be created (treated identically to the flag being unset)

### Requirement: Shell selection for split pane

The split pane SHALL use `exec zsh` as the keep-alive shell. Users running bash or another shell will still get a zsh interactive shell in the split. This matches the existing `riff`/`riffs` shell function behavior.

#### Scenario: User's default shell is bash
- **GIVEN** the user's `$SHELL` is `/bin/bash`
- **WHEN** `rk riff --split "echo hi"` runs
- **THEN** the split pane SHALL still end in `exec zsh`

## rk: Error Handling and Exit Codes

### Requirement: Exit code discipline

`rk riff` SHALL exit with specific non-zero codes for distinguishable failure classes:

| Exit | Condition |
|------|-----------|
| 0 | Success |
| 1 | Generic/unclassified error |
| 2 | Precondition failure (`$TMUX` unset, `wt` not on PATH) |
| 3 | Subprocess failure (wt or tmux exited non-zero, or output parsing failed) |

Error messages SHALL go to stderr. The command SHALL emit no extra noise on stdout in the success path (tmux's own prints from wt/tmux commands MAY pass through).

#### Scenario: Missing $TMUX exits 2
- **GIVEN** `$TMUX` is unset
- **WHEN** `rk riff` runs
- **THEN** the process exits with code 2

#### Scenario: wt failure exits 3
- **GIVEN** `wt create` returns exit code 5 with a clear error
- **WHEN** `rk riff` invokes wt
- **THEN** the process exits with code 3 and stderr includes wt's output

## rk: Backward Compatibility

### Requirement: Existing shell functions unaffected

Installing this change SHALL NOT disturb any user's existing `riff` / `riffs` shell functions. The two coexist — `rk riff` is a new binary subcommand; the shell functions live in user dotfiles and remain fully functional.

#### Scenario: Shell function still works
- **GIVEN** a user has `riff()` defined in their shell rc and run-kit updated
- **WHEN** they type `riff` in a shell (not `rk riff`)
- **THEN** their shell function runs as before — completely unaffected by the new subcommand

## Design Decisions

1. **Reuse `agent.spawn_command` from `fab/project/config.yaml` for the launcher**
   - *Why*: Convention Over Configuration (constitution §VII). The key already exists for `fab operator`; reusing it means zero new config surface, consistent behavior across tools, and no `clauded` dependency baked into rk.
   - *Rejected*: (a) env vars (`RK_RIFF_LAUNCHER`) — invisible, another documentation burden; (b) new config file — violates Minimal Surface Area; (c) flags-only — worst ergonomics for the common case.

2. **Hard require `wt` on PATH (no `git worktree add` fallback)**
   - *Why*: Wrap, Don't Reinvent (constitution §III). `wt` is the established worktree tool run-kit already documents as a companion; duplicating its logic in Go would create a second path to keep in sync.
   - *Rejected*: graceful fallback to `git worktree add` — forks behavior depending on environment, complicates testing and docs.

3. **Hard require `$TMUX` to be set (no auto-start)**
   - *Why*: Matches `fab operator`'s contract. Users opt into tmux explicitly; `rk riff`'s contract is "create a new window in my current tmux session", which only makes sense inside one.
   - *Rejected*: (a) auto-start a tmux session — muddies the command contract, requires decisions about session name/detach behavior; (b) detached launch — not what the command is for.

4. **Unify `riff` and `riffs` under a single `--split` flag**
   - *Why*: Two subcommands for what is essentially one workflow + one optional step is bad CLI surface. `--split "setup-cmd"` is a self-documenting additive flag.
   - *Rejected*: separate `rk riffs` subcommand — doubles the test surface, surprises users who discover only one.

5. **Keep launcher concatenation inside tmux's shell string (not Go exec args)**
   - *Why*: `agent.spawn_command` is a shell-syntax string that may contain shell subsitutions like `$(basename "$(pwd)")`. Passing it as an argv slice would break those. Concatenating inside tmux's own shell string preserves the user's configured expansion semantics.
   - *Rejected*: splitting `spawn_command` on whitespace and passing as argv — breaks quoted args and shell substitution.

6. **New Go file at `app/backend/cmd/rk/riff.go`; new `internal/fabconfig/` (or similar) helper for reading `fab/project/config.yaml`**
   - *Why*: The existing `internal/config/runkit_yaml.go` handles `run-kit.yaml` at project root and is intentionally minimal (line-based parser for one key). `fab/project/config.yaml` has nested structure (`agent.spawn_command`) and deserves `yaml.v3` parsing in its own tight-scoped helper.
   - *Rejected*: extending `internal/config` with fab-specific keys — muddies the package's purpose (it's for rk config, not fab config).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `rk` is the home for riff (not `fab` or `wt`) | Confirmed from intake #1 — rk owns tmux window lifecycle | S:95 R:85 A:90 D:95 |
| 2 | Certain | Unify `riff` and `riffs` into single `rk riff` with `--split` flag | Confirmed from intake #2 | S:95 R:85 A:85 D:90 |
| 3 | Certain | Default `--cmd` is `/fab-discuss` (hardcoded, overridable via flag) | Confirmed from intake #3 (user-clarified) | S:95 R:90 A:75 D:70 |
| 4 | Confident | wt passthrough via `--` separator | Confirmed from intake #4 — standard CLI pattern | S:75 R:85 A:80 D:75 |
| 5 | Certain | Launcher resolved from `agent.spawn_command` in `fab/project/config.yaml` (falls back to `claude --dangerously-skip-permissions`) | Confirmed from intake #5 (user-clarified) | S:95 R:70 A:60 D:60 |
| 6 | Certain | No new config keys — flag-only overrides for `--cmd` and `--split` | Confirmed from intake #6 (user-clarified) | S:95 R:60 A:55 D:55 |
| 7 | Certain | Require `wt` on PATH; error out if missing | Confirmed from intake #7 (user-clarified) | S:95 R:80 A:85 D:90 |
| 8 | Certain | Require `$TMUX` set; error out if unset | Confirmed from intake #8 (user-clarified) | S:95 R:85 A:90 D:95 |
| 9 | Certain | Affected memory: modify architecture.md + tmux-sessions.md; new rk-riff.md | Confirmed from intake #9 (user-clarified) | S:95 R:75 A:75 D:80 |
| 10 | Certain | `spawn_command` is treated as a shell string (concatenated inside tmux's shell invocation), not an argv slice | Spec-level analysis — existing `agent.spawn_command` value contains `$(basename "$(pwd)")` which requires shell expansion | S:90 R:70 A:85 D:85 |
| 11 | Certain | All subprocess calls use `exec.CommandContext` with timeouts (wt: 30s, tmux: 10s) | Required by constitution §Process Execution | S:95 R:85 A:95 D:95 |
| 12 | Certain | New file `app/backend/cmd/rk/riff.go`; registered in `root.go` alongside other subcommands | Matches existing cobra subcommand pattern | S:95 R:85 A:90 D:90 |
| 13 | Certain | New package `app/backend/internal/fabconfig/` (or equivalent) parses `fab/project/config.yaml` using `yaml.v3` | yaml.v3 is already a dep (go.mod); existing `internal/config/runkit_yaml.go` handles `run-kit.yaml`, not fab config | S:90 R:75 A:85 D:80 |
| 14 | Certain | Repo root discovery uses existing `config.FindGitRoot` helper | Already implemented and tested in `internal/config/runkit_yaml.go` | S:95 R:90 A:95 D:95 |
| 15 | Certain | Worktree path extracted from `wt` output line matching `^Path: <path>$` | Matches the existing shell function's grep-based extraction (`grep '^Path:' \| cut -d' ' -f2`) | S:90 R:80 A:85 D:90 |
| 16 | Certain | Split pane trailer is `; exec zsh` (not `$SHELL`); matches shell function behavior | Confirmed in intake's reference implementation | S:90 R:85 A:85 D:90 |
| 17 | Confident | Exit codes: 0 success, 1 generic, 2 precondition, 3 subprocess | No existing rk subcommand documents exit code conventions — this is a spec-level addition. Low blast radius; reversible in a later revision | S:60 R:90 A:60 D:70 |
| 18 | Confident | Precondition check order: `$TMUX` then `wt` (fast-fail, no batching) | Simpler implementation; first failure reported is sufficient for troubleshooting | S:55 R:90 A:75 D:75 |
| 19 | Confident | Unit test coverage for: launcher resolution, wt-output parsing, exit-code mapping; no integration test for tmux/wt (hard to fixture reliably) | Matches existing rk test approach — `doctor.go` has no integration tests, `config_test.go` tests pure functions | S:60 R:85 A:80 D:70 |

19 assumptions (15 certain, 4 confident, 0 tentative, 0 unresolved).
<!-- clarified: trailer tally corrected to match row grades (was 16/3, actual 15/4) -->
