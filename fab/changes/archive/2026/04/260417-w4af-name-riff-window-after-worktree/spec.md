# Spec: Name the tmux window created by `rk riff` after the worktree

**Change**: 260417-w4af-name-riff-window-after-worktree
**Created**: 2026-04-17
**Affected memory**: `docs/memory/run-kit/rk-riff.md`

## Non-Goals

- Renaming already-open riff windows created before this change — the name is set only at window creation time; retroactive renaming of existing windows is out of scope.
- Making the window name user-configurable (e.g., via a `--window-name` flag) — the name is derived deterministically from the worktree basename.
- Coupling to tmux's `automatic-rename` option — the `-n` flag alone is what pins the name; we do not assert or rely on auto-rename state in tests or spec.
- Changing any other tmux invocation in `rk` (sessions, pane relay) — scope is strictly `rk riff` window creation.

## rk-riff: tmux window naming

### Requirement: Stable window name derived from worktree basename
When `rk riff` creates a tmux window via `tmux new-window`, the invocation SHALL include the flag `-n riff-<basename>` where `<basename>` is `filepath.Base(worktreePath)` and `worktreePath` is the path returned by `parseWorktreePath` from `wt create`'s output. The `-n` flag and its value MUST be passed as distinct argv elements to `exec.CommandContext` — never interpolated into the tmux shell-command string.

#### Scenario: Typical worktree under `.worktrees/` directory
- **GIVEN** `worktreePath = "/home/sahil/code/sahil87/run-kit.worktrees/pacing-canyon"`
- **WHEN** `runTmuxNewWindow` builds the tmux argv
- **THEN** the argv SHALL contain the adjacent elements `"-n"`, `"riff-pacing-canyon"`
- **AND** the argv SHALL contain the adjacent elements `"-c"`, `"/home/sahil/code/sahil87/run-kit.worktrees/pacing-canyon"`
- **AND** the name and cwd flags SHALL precede the shell-command argument

#### Scenario: Worktree path with trailing slash
- **GIVEN** `worktreePath = "/tmp/myrepo.worktrees/alpha/"`
- **WHEN** `runTmuxNewWindow` builds the tmux argv
- **THEN** the window name SHALL be `riff-alpha` (Go's `filepath.Base` strips the trailing slash)

#### Scenario: Relative worktree path (no directory component)
- **GIVEN** `worktreePath = "alpha"`
- **WHEN** `runTmuxNewWindow` builds the tmux argv
- **THEN** the window name SHALL be `riff-alpha`

#### Scenario: Security constraint — argv-distinct flag
- **GIVEN** any worktree path accepted by `runWtCreate`'s `os.Stat` validation
- **WHEN** the tmux command is constructed
- **THEN** `-n` and the window name SHALL be separate string elements in the argv slice passed to `exec.CommandContext`
- **AND** the window name SHALL NOT be concatenated into the shell-command string (the argument interpreted by tmux's shell)

### Requirement: Name stability for the window's lifetime
The window name set by `-n` SHALL persist for the lifetime of the window regardless of which processes run inside its pane. The spec SHALL NOT assert the mechanism by which tmux pins the name — only the observable outcome that the name does not change.

#### Scenario: Name persists across process changes in the pane
- **GIVEN** a riff window was created with name `riff-pacing-canyon` running `claude --dangerously-skip-permissions '/fab-discuss'`
- **WHEN** the Claude process exits and a `zsh` replaces it in the pane
- **THEN** `tmux list-windows -F '#{window_name}'` SHALL still report `riff-pacing-canyon` for that window

### Requirement: Backward-compatible invocation surface
The user-facing CLI surface of `rk riff` (its flags, arguments, exit codes, stdout/stderr contract) SHALL NOT change as a result of this spec. Only the tmux window name changes.

#### Scenario: Existing flags unchanged
- **GIVEN** a user invokes `rk riff --cmd /my-skill --split "just dev" -- --worktree-name alpha`
- **WHEN** the command runs
- **THEN** the flag parsing, exit codes (0, 2, 3), and subprocess workflow SHALL be identical to the pre-change behavior
- **AND** the only observable difference SHALL be the new `-n riff-alpha` argument on the underlying `tmux new-window` invocation

### Requirement: Test seam for argv construction
`runTmuxNewWindow`'s argv construction SHOULD be extracted into a pure helper (proposed name `buildNewWindowArgs(worktreePath, launcher, cmdArg string) []string`) so that the naming rule can be asserted by unit tests without invoking real `tmux`. The extraction SHALL preserve the existing byte-for-byte argv passed to `exec.CommandContext` (plus the new `-n <name>` elements) — no behavioral change beyond the name.

#### Scenario: Helper returns expected argv slice
- **GIVEN** `worktreePath = "/tmp/myrepo.worktrees/alpha"`, `launcher = "claude --dangerously-skip-permissions"`, `cmdArg = "/fab-discuss"`
- **WHEN** `buildNewWindowArgs(worktreePath, launcher, cmdArg)` is called
- **THEN** the returned slice SHALL equal `["new-window", "-n", "riff-alpha", "-c", "/tmp/myrepo.worktrees/alpha", "claude --dangerously-skip-permissions '/fab-discuss'"]`

#### Scenario: Helper is called by runTmuxNewWindow
- **GIVEN** `runTmuxNewWindow` is invoked with valid inputs
- **WHEN** it constructs the `exec.CommandContext` call
- **THEN** the argv (after the binary name `"tmux"`) SHALL equal `buildNewWindowArgs(worktreePath, launcher, cmdArg)`

### Requirement: Memory documentation reflects the new invocation
`docs/memory/run-kit/rk-riff.md` SHALL be updated so that the documented `tmux new-window` invocation in the "Workflow Step Order" section (Step 5) includes the `-n riff-<worktree-basename>` flag and explains why the name is pinned (provenance signal, discoverability via `tmux list-windows`, blocks auto-rename drift).

#### Scenario: Step 5 text reflects new flag
- **GIVEN** the hydrate stage runs for this change
- **WHEN** `rk-riff.md` is updated
- **THEN** Step 5's fenced code sample SHALL show `tmux new-window -n riff-<worktree-basename> -c <worktree-path> "<launcher> '<cmd>'"`
- **AND** the accompanying prose SHALL describe the naming rule and its rationale

## Design Decisions

1. **Window name prefix is literal `riff-`**: The window is named `riff-<basename>`, not `<basename>`, not `<repo>-<basename>`.
   - *Why*: The prefix is a fast visual and automation filter — `tmux list-windows | grep riff-` cleanly identifies windows spawned by `rk riff` versus windows from `wt open`, `fab operator`, or manual `tmux new-window` invocations. Worktree basenames alone (e.g., `pacing-canyon`) are not unique across tools.
   - *Rejected*: `<repo>-<basename>` (e.g., `run-kit-pacing-canyon`) matches `wt open`'s own convention but lacks a riff-specific signal, making it indistinguishable from a `wt open` window. Plain `<basename>` has the same problem and additionally collides with arbitrary shell-chosen names.

2. **Naming derivation is `filepath.Base(worktreePath)` in Go, not a regex or sanitizer**: The basename comes straight from Go's stdlib.
   - *Why*: `worktreePath` is the value already validated by `runWtCreate` (`os.Stat` confirms it's an existing directory), so its basename is safe as-is. `filepath.Base` handles edge cases (trailing slashes, `.`, `/`) deterministically. Adding a sanitizer would be defensive programming against an already-validated input.
   - *Rejected*: Regex extraction is more code and has more failure modes; pre-cleaning with `filepath.Clean` is redundant (Go's `Base` implicitly cleans).

3. **Window creation stays inside `rk`; we do NOT delegate to `wt open --app tmux_window`**: `rk riff` continues to call `tmux new-window` directly with `-c <path>` and the launcher shell command.
   - *Why*: `wt`'s `tmux_window` handler (`fab-kit/src/go/wt/internal/worktree/apps.go:253-262`) opens a bare shell in the worktree with no initial command. Running the claude launcher afterward would require `tmux send-keys` into the new window, which is timing-fragile (shell must be ready), requires extra logic to identify the target window, and means the launcher is not the window's initial command — so `exit` behavior and the overall lifecycle diverge from the current design.
   - *Rejected*: `wt create --worktree-open tmux_window` followed by `tmux send-keys` — strictly worse for the reasons above; loses riff's control over what the window runs.

4. **`-n` and its value are passed as distinct argv elements**: Never interpolated into the tmux shell-command string.
   - *Why*: Constitution §I (Security First) requires subprocess calls to use argv slices, never shell strings, for user-derived input. Although the worktree basename is not hostile input, keeping the flag in argv position maintains the invariant across the whole codebase.
   - *Rejected*: Embedding the name into the shell-command argument (e.g., `tmux rename-window` as a chained shell call) — more fragile and violates the argv-first pattern used everywhere else in `rk`.

5. **Argv order is `new-window -n <name> -c <path> <shellCmd>`**: Name first, cwd second, command last.
   - *Why*: tmux accepts either flag order, but this sequence reads left-to-right as "name, dir, command" and matches the tmux(1) man-page example convention. Purely cosmetic.
   - *Rejected*: `-c <path> -n <name> <shellCmd>` — functionally identical; not chosen to keep the intuitive reading order.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Window name pattern is `riff-<basename>` (literal `riff-` prefix + `filepath.Base(worktreePath)`) | Confirmed from intake #1 — user explicitly specified this pattern in the `/fab-new` description; three alternatives rejected with written rationale in Design Decisions | S:95 R:85 A:95 D:95 |
| 2 | Certain | `-n <name>` is passed as distinct argv elements to `exec.CommandContext`, never shell-interpolated | Confirmed from intake #2 — required by constitution §I (Security First) and consistent with the rest of the riff.go invocation pattern (cf. `-c <path>`) | S:95 R:90 A:95 D:95 |
| 3 | Certain | Files touched are exactly three: `app/backend/cmd/rk/riff.go`, `app/backend/cmd/rk/riff_test.go`, `docs/memory/run-kit/rk-riff.md` | Confirmed from intake #3 — grep for `tmux new-window` across the repo surfaces no other invocation site that needs coordinated changes | S:95 R:80 A:90 D:90 |
| 4 | Certain | Change type is `feat` | Confirmed from intake #4 — user-visible behavior change (stable, discoverable window name). No fix/refactor/docs/test/ci/chore keyword in description | S:90 R:100 A:95 D:95 |
| 5 | Certain | `worktreePath` reaching `runTmuxNewWindow` is always a validated existing directory | Confirmed from intake #5 — `runWtCreate` (riff.go:192-194) calls `os.Stat` and returns a subprocess error if the path is missing or not a directory. `runTmuxNewWindow` is unreachable otherwise | S:90 R:80 A:100 D:95 |
| 6 | Certain | Spec and tests SHALL NOT couple to tmux's `automatic-rename` state | Confirmed from intake #6 — the `-n` flag alone is what pins the name (per tmux documentation for explicit naming); coupling to auto-rename would test tmux's behavior instead of ours. Non-Goals section makes this explicit | S:90 R:85 A:90 D:90 |
| 7 | Certain | Test strategy extracts `buildNewWindowArgs` as a pure helper | Upgraded from intake Confident #7 — the helper is now a formal spec requirement (see "Test seam for argv construction"). The rk test pattern (riff_test.go) already has 3 pure-helper tests (`parseWorktreePath`, `escapeSingleQuotes`, `resolveLauncher`) — adding a 4th matches the pattern exactly | S:90 R:80 A:90 D:85 |
| 8 | Certain | Argv order is `new-window -n <name> -c <path> <shellCmd>` | Upgraded from intake Confident #8 — now captured in Design Decisions #5 with explicit rationale. Cosmetic but stable | S:85 R:95 A:85 D:85 |
| 9 | Certain | Derivation is `filepath.Base(worktreePath)` (no pre-`Clean`, no regex) | Upgraded from intake Confident #9 — now captured in Design Decisions #2. Go's `Base` handles trailing slashes and degenerate inputs correctly; `parseWorktreePath` never returns empty (empty paths are rejected as subprocess errors earlier) | S:90 R:85 A:90 D:90 |
| 10 | Certain | Memory file `docs/memory/run-kit/rk-riff.md` is updated in this change (not deferred) | Confirmed from intake #10 — the file explicitly documents the exact tmux invocation string; stale docs contradict the new behavior. Code-quality principle: "New features… MUST include tests covering the added/changed behavior" extends to behavior documentation | S:85 R:90 A:90 D:85 |
| 11 | Confident | No changelog entry needed in `run-kit/tmux-sessions.md` or `run-kit/architecture.md` | Confirmed from intake #11 — those files document system-level tmux interactions (session enumeration, pane relay), not window-name conventions for a single subcommand. Reversible if `/fab-archive` later surfaces a cross-domain impact | S:75 R:95 A:85 D:80 |
| 12 | Confident | Backend tests will run via `just test-backend` (the `build/tmux.conf` copy is part of that recipe) | The raw `go test` fails with a `build/embed.go:14 pattern tmux.conf: no matching files found` error because `configs/tmux/default.conf` is copied into `app/backend/build/tmux.conf` only by `just test-backend`. Not a spec concern per se, but affects the apply/review stages | S:85 R:95 A:90 D:80 |
| 13 | Confident | The existing `runTmuxSplitWindow` (optional `--split` path) does NOT need `-n` | The split pane lives inside the already-named window; tmux's window name is a window-level attribute, not pane-level. The split inherits the window's name automatically. No change needed to `runTmuxSplitWindow` | S:85 R:95 A:90 D:80 |
| 14 | Confident | No CHANGELOG.md / release-notes update is required | The project has no user-facing CHANGELOG.md file in the repo root; release notes (if any) are drafted at release cut, not per-PR. Memory-file changelog row in `rk-riff.md` is the in-repo record of the change | S:75 R:95 A:85 D:75 |

14 assumptions (10 certain, 4 confident, 0 tentative, 0 unresolved).
