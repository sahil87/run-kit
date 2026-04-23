# Spec: rk riff — Correctness and Portability Fixes

**Change**: 260423-ba9f-rk-riff-correctness-fixes
**Created**: 2026-04-23
**Affected memory**: `docs/memory/run-kit/rk-riff.md`

## Non-Goals

- **CLI surface changes** — no new flags, no renames, no help-text rewording. Those ship with a separate CLI-surface change. <!-- clarified: scoped bundling per intake §Origin -->
- **Bug 2 (`/fab-discuss` delivery)** — deferred to the CLI-surface change because the fix likely requires `tmux send-keys`, which is itself a surface change.
- **Exit-code handling** — not preserved, refactored, or otherwise touched. Promotion of `exitCodeError` to a shared helper is explicitly out of scope per user direction during clarify.
- **An `agent.shell_mode` config key** — not added preemptively. Interactive wrap is unconditional; a config escape hatch is only considered if rc-file side effects surface in the field.
- **Automated SIGINT tests** — manual verification only. Automated coverage requires forking a hung child; ROI is low and other bug fixes carry clean unit tests.

## run-kit: Shell Wrap Helper

### Requirement: Unified shell-wrap helper
A pure helper function SHALL exist in `app/backend/cmd/rk/riff.go` that takes a shell command string and returns a new shell command string which (a) runs the original command and then (b) execs `${SHELL:-/bin/sh}` so the containing tmux pane stays interactive after the original command exits. Both `runTmuxNewWindow` and `runTmuxSplitWindow` MUST build their shell command via this helper.

#### Scenario: new-window pane stays alive after launcher exits
- **GIVEN** the user runs `rk riff` with its default launcher (`claude`)
- **WHEN** the launcher process exits (successfully or with error)
- **THEN** the tmux window created by `rk riff` MUST remain open with an interactive shell in the worktree directory
- **AND** the shell MUST be the user's `$SHELL` if set, otherwise `/bin/sh`

#### Scenario: split pane stays alive after setup command exits
- **GIVEN** the user runs `rk riff --split "<setup-cmd>"`
- **WHEN** `<setup-cmd>` finishes
- **THEN** the right pane MUST remain open with an interactive shell rooted at the worktree directory
- **AND** the shell MUST be the user's `$SHELL` if set, otherwise `/bin/sh`

#### Scenario: helper is pure and test-seam-friendly
- **GIVEN** the shell-wrap helper is called with an input command string
- **WHEN** it returns
- **THEN** the return value SHALL be deterministic for a given input (no time, no env reads, no side effects)
- **AND** a unit test SHALL assert the returned string for at least the empty-input, single-command, and single-command-with-quotes cases

### Requirement: Helper replaces the hardcoded `exec zsh` suffix in split pane
The existing split-pane shell string (currently `"%s; exec zsh"`) MUST be replaced with the unified shell-wrap helper so bash, fish, and other non-zsh users receive their own shell. The split pane's `<setup-cmd>` MUST NOT be wrapped in the interactive-launcher form (`$SHELL -i -c ...`) — only the new-window launcher path uses that wrap. The split path applies `shellWrap` directly to the user-provided setup command. <!-- clarified: interactive wrap is scoped to the launcher (Bug 3 target) only; split setup commands are plain shell strings passed through shellWrap for post-exit pane-alive behavior only. Resolved from intake §3. -->

#### Scenario: fish user runs split with setup command
- **GIVEN** the user's `$SHELL` is `/usr/bin/fish`
- **WHEN** the user runs `rk riff --split "just setup"`
- **THEN** after `just setup` finishes, the right pane MUST drop into `fish`, not `zsh`

#### Scenario: `$SHELL` unset falls back to `/bin/sh`
- **GIVEN** the user's `$SHELL` environment variable is empty or unset in the environment inherited by tmux's shell
- **WHEN** the split pane reaches the post-setup state
- **THEN** `/bin/sh` MUST be exec'd as the pane shell (POSIX-safe fallback)

## run-kit: Interactive Launcher Shell (Bug 3)

### Requirement: Launcher runs inside an interactive user shell
The `tmux new-window` shell string that launches the Claude Code launcher MUST wrap the launcher invocation in `${SHELL:-/bin/sh} -i -c '<launcher-with-cmd-arg>'` so that `.zshrc`/`.bashrc` aliases, shell functions, and interactive-only PATH additions are available to the launcher. The outer shell-wrap helper from the "Shell Wrap Helper" section MUST then wrap this interactive form, producing the final composition `${SHELL:-/bin/sh} -i -c '<launcher-with-cmd-arg>'; exec "${SHELL:-/bin/sh}"`. <!-- clarified: composition order — interactive-wrap is the inner command, shellWrap is the outer `; exec $SHELL` suffix. Resolved from intake §2 target snippet: `shellCmd := ... -i -c ...; return shellWrap(shellCmd)`. -->

#### Scenario: zsh alias available to launcher
- **GIVEN** the user has `alias claude='/opt/homebrew/bin/claude'` defined in `~/.zshrc` and `$SHELL=/bin/zsh`
- **WHEN** the user runs `rk riff`
- **THEN** the launcher process MUST resolve `claude` via the zsh alias
- **AND** the launcher argv as seen by the OS MUST be the aliased value

#### Scenario: bash user with PATH tweak
- **GIVEN** the user's `~/.bashrc` prepends `/opt/custom/bin` to PATH only under `[[ $- == *i* ]]`
- **WHEN** `rk riff` runs under `$SHELL=/bin/bash`
- **THEN** the launcher MUST find binaries on `/opt/custom/bin` just like an interactive terminal would

#### Scenario: launcher quoting survives interactive wrap
- **GIVEN** the launcher shell string would, in the non-interactive form, be `claude --dangerously-skip-permissions '/fab-discuss'`
- **WHEN** the interactive wrap composes `$SHELL -i -c <quoted-launcher>`
- **THEN** the `'/fab-discuss'` single-quoted argument MUST reach the launcher intact
- **AND** embedded single quotes in `--cmd` MUST remain correctly escaped per the existing `escapeSingleQuotes` contract

### Requirement: `$SHELL` fallback for interactive wrap
If `$SHELL` is unset at the time tmux's shell evaluates the wrap, the interactive wrap MUST fall back to `/bin/sh` (using the `${SHELL:-/bin/sh}` expansion) rather than erroring or producing an empty command.

#### Scenario: cron-like env with no `$SHELL`
- **GIVEN** the user's environment has `$SHELL` unset
- **WHEN** `rk riff` attempts to run the launcher
- **THEN** `/bin/sh -i -c '<launcher-with-cmd-arg>'` MUST be executed

## run-kit: SIGINT Propagation (Bug 10)

### Requirement: `runRiff` wraps its context with a signal handler
`runRiff` MUST wrap its root `context.Context` once via `signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)` and MUST propagate the wrapped context to all subprocess call sites (`runWtCreate`, `runTmuxNewWindow`, `runTmuxSplitWindow`). A `defer stop()` MUST release the signal handler when `runRiff` returns.

#### Scenario: Ctrl-C during `wt create` hang kills the child
- **GIVEN** `wt create` is hung (e.g., prompting on stderr or blocked on network)
- **WHEN** the user presses Ctrl-C inside the `rk` pane
- **THEN** the SIGINT MUST cancel the wrapped context
- **AND** the `wt` subprocess MUST terminate (no zombie / reparented-to-init process)
- **AND** `rk riff` MUST exit with a non-zero status

#### Scenario: Ctrl-C during `tmux new-window` cancels cleanly
- **GIVEN** the `tmux new-window` subprocess is in-flight
- **WHEN** the user presses Ctrl-C
- **THEN** the wrapped context cancellation MUST be observed by that `exec.CommandContext` invocation
- **AND** no orphaned tmux subprocess MUST remain after `rk riff` exits

#### Scenario: signal handler released on normal exit
- **GIVEN** `rk riff` completes normally (no interrupt)
- **WHEN** `runRiff` returns
- **THEN** `stop()` MUST be called (via `defer`) so the SIGINT handler is deregistered for the parent process

## run-kit: Window-Name Collision Resolution (Bug 11)

### Requirement: Detect collisions up front via `tmux list-windows`
Before invoking `tmux new-window`, `rk riff` MUST query the current tmux session's window names (via `tmux list-windows -F '#W'`) and auto-suffix the desired window name if a name conflict is detected. The suffix scheme SHALL be `-2`, `-3`, … starting from `-2`, incrementing until a name is free. The first-choice name (no suffix) is preferred.

#### Scenario: no collision — base name used
- **GIVEN** no window in the current session is named `riff-alpha`
- **WHEN** `rk riff` creates a window for worktree basename `alpha`
- **THEN** the window name used in `tmux new-window -n` MUST be `riff-alpha`

#### Scenario: one collision — `-2` suffix
- **GIVEN** a window named `riff-alpha` already exists in the session
- **WHEN** `rk riff` creates a new window for worktree basename `alpha`
- **THEN** the window name MUST be `riff-alpha-2`

#### Scenario: multiple collisions — first free slot wins
- **GIVEN** windows `riff-alpha`, `riff-alpha-2`, and `riff-alpha-3` already exist
- **WHEN** `rk riff` creates a new window for worktree basename `alpha`
- **THEN** the window name MUST be `riff-alpha-4`

#### Scenario: `tmux list-windows` fails — surface as subprocess error
- **GIVEN** the tmux server died between precondition check and window creation (so `tmux list-windows` returns non-zero)
- **WHEN** collision resolution runs
- **THEN** `rk riff` MUST return a subprocess error (exit 3) with a message naming `tmux list-windows`
- **AND** MUST NOT proceed to `tmux new-window`

#### Scenario: empty window list — no collision
- **GIVEN** `tmux list-windows -F '#W'` returns an empty string
- **WHEN** collision resolution runs
- **THEN** the base name MUST be used

#### Scenario: race between list and new-window is acceptable
- **GIVEN** `rk riff` has resolved a non-collision name, and between the list and the `new-window` call, another process creates a window with that same name
- **WHEN** `new-window` proceeds
- **THEN** the behavior is the same as today (silent duplicate, or tmux error if `allow-rename off`) — this race is explicitly accepted and MUST NOT be mitigated via locking or retry in this change

### Requirement: `buildNewWindowArgs` accepts the resolved name as input
The pure helper `buildNewWindowArgs` MUST be updated to take the already-resolved window name as a parameter (instead of deriving it from the worktree path). Name resolution logic moves into a new pure helper (e.g., `resolveWindowName(existing []string, base string) string`) that is independently testable. The I/O boundary (calling `tmux list-windows -F '#W'`) MUST live in a sibling function (e.g., `listWindowNames(ctx context.Context) ([]string, error)`) that `runTmuxNewWindow` invokes before calling `buildNewWindowArgs`; `buildNewWindowArgs` itself MUST remain pure (no context, no I/O). <!-- clarified: separation of pure helper from tmux-I/O helper per Assumption #12 and intake §5 target snippet. -->

#### Scenario: builder uses resolved name verbatim
- **GIVEN** `resolveWindowName` returns `riff-alpha-3`
- **WHEN** `buildNewWindowArgs` is called with that resolved name
- **THEN** the argv's `-n` value MUST be exactly `riff-alpha-3`

#### Scenario: resolveWindowName is a pure function
- **GIVEN** a slice of existing window names and a base name
- **WHEN** `resolveWindowName` is called
- **THEN** it MUST return the same result deterministically with no side effects, I/O, or time dependency
- **AND** it MUST be covered by unit tests for: no-collision, one-collision, multi-collision, empty-existing, and "only distant collisions at base-N but gap at base-2" cases

## run-kit: Security / Trust Boundary Documentation (Bug 9)

### Requirement: Memory file documents the `agent.spawn_command` trust boundary
`docs/memory/run-kit/rk-riff.md` MUST include a top-level section titled **Security / Trust Boundary** that names `fab/project/config.yaml` as an executable trust surface equivalent to committed code, clarifies that `escapeSingleQuotes` protects only `--cmd`, and names shell expansion in the launcher (e.g., `$(basename "$(pwd)")`) as the documented intentional exception to the constitution's argv-only rule (§I Security First).

#### Scenario: memory file includes trust-boundary section
- **GIVEN** `docs/memory/run-kit/rk-riff.md` in its post-change state
- **WHEN** a reviewer reads the file
- **THEN** a section titled `## Security / Trust Boundary` MUST exist
- **AND** the section MUST (a) name `fab/project/config.yaml` as a trust surface, (b) clarify the `escapeSingleQuotes` scope, and (c) reference constitution §I as the rule the launcher is the documented exception to

#### Scenario: no code change
- **GIVEN** this change
- **WHEN** code under `app/backend/` is inspected
- **THEN** no defensive escaping, no allow-listing, and no new validation logic MUST be introduced around `agent.spawn_command` on account of this requirement

## run-kit: Updated Tests

### Requirement: `TestBuildNewWindowArgs` reflects the shell-wrap suffix and resolved-name input
Existing test cases MUST be updated to (a) take the resolved window name as input, and (b) assert that the trailing shell-command argv element includes the shell-wrap suffix (`; exec "${SHELL:-/bin/sh}"`) and the interactive launcher wrap (`${SHELL:-/bin/sh} -i -c ...`) consistent with the new helper composition. This implies `buildNewWindowArgs` internally composes the interactive-launcher wrap and the `shellWrap` suffix (rather than receiving a pre-composed shell string). <!-- clarified: composition happens inside buildNewWindowArgs so the pure test seam covers both wraps end-to-end. Inputs remain (resolvedName, launcher, cmdArg, worktreePath); output includes the full composed shell string. -->

#### Scenario: typical case asserts shell-wrap + interactive wrap
- **GIVEN** a `buildNewWindowArgs` case with launcher `claude --dangerously-skip-permissions`, cmd `/fab-discuss`, resolved name `riff-alpha`
- **WHEN** the test runs
- **THEN** the argv's final element MUST contain both (a) `$SHELL -i -c` (or the `${SHELL:-/bin/sh}` fallback form matching the helper) around the launcher invocation and (b) the `; exec "${SHELL:-/bin/sh}"` suffix appended by the shell-wrap helper

### Requirement: New `TestShellWrap` covers the pure helper
A new unit test MUST be added to `riff_test.go` (named `TestShellWrap`) asserting the shell-wrap helper's output for at least: empty input, single simple command, command containing embedded single-quotes, and command containing embedded double-quotes.

#### Scenario: empty input case
- **GIVEN** the shell-wrap helper called with input `""`
- **WHEN** the test asserts the output
- **THEN** the output MUST still contain the `; exec "${SHELL:-/bin/sh}"` suffix

#### Scenario: simple-command case
- **GIVEN** input `claude '/fab-discuss'`
- **WHEN** the helper is called
- **THEN** the output MUST be `claude '/fab-discuss'; exec "${SHELL:-/bin/sh}"`

### Requirement: New `TestResolveWindowName` covers collision resolution
A new pure-function test MUST be added to `riff_test.go` (named `TestResolveWindowName`) asserting: (a) no-collision returns base, (b) one collision returns `base-2`, (c) three collisions return `base-4`, (d) empty existing-list returns base, (e) "gap at base-2 but collision at base-3" returns `base-2`.

#### Scenario: gap-before-collision case
- **GIVEN** existing window names `["riff-alpha", "riff-alpha-3"]` and base `riff-alpha`
- **WHEN** `resolveWindowName` is called
- **THEN** the return value MUST be `riff-alpha-2`

## run-kit: Updated Memory File

### Requirement: Memory file reflects the new behavior
`docs/memory/run-kit/rk-riff.md` MUST be updated during hydrate to: (a) describe the unified shell-wrap helper in the Workflow Step Order section, (b) replace the mention of `"<setup>; exec zsh"` with the `${SHELL:-/bin/sh}` form in the split step, (c) document the interactive-launcher wrap and its accepted risks, (d) document SIGINT propagation, (e) document the window-name auto-suffix behavior, (f) add the Security / Trust Boundary section, and (g) add a new Changelog row for this change.

#### Scenario: changelog entry is added
- **GIVEN** the post-hydrate state of `docs/memory/run-kit/rk-riff.md`
- **WHEN** the Changelog table is inspected
- **THEN** a new row dated `2026-04-23` MUST exist, referencing `260423-ba9f-rk-riff-correctness-fixes`, summarizing the six items in this change

## Deprecated Requirements

### Requirement: Non-interactive launcher shell
**Reason**: Users with `.zshrc`/`.bashrc` aliases, shell functions, or interactive-only PATH additions could not use them from `rk riff`'s Claude Code session (Bug 3). The non-interactive `sh -c` wrap is replaced with `$SHELL -i -c`.
**Migration**: Automatic. No user action is required. If rc-file side effects degrade the experience in the field, an `agent.shell_mode: non-interactive` config key MAY be added in a follow-up change — it is not provided here.

### Requirement: Hardcoded `exec zsh` in split pane
**Reason**: The literal `exec zsh` suffix in the split-pane shell string broke bash and fish users, who had their post-setup pane dropped into a shell they did not use (Bug 8).
**Migration**: Automatic. The pane now execs `${SHELL:-/bin/sh}` via the unified shell-wrap helper.

### Requirement: Window-name silent collision
**Reason**: Creating a second `rk riff` targeting a worktree whose basename matched an existing `riff-<basename>` window produced a silent duplicate name, making it impossible to tell windows apart in `tmux list-windows` (Bug 11).
**Migration**: Automatic. Collisions now resolve via `-2`, `-3`, … suffixing. First-choice names without collision are unaffected.

### Requirement: Pane death on launcher exit
**Reason**: When the Claude Code launcher exited (normally or via error), the `tmux new-window` pane died (or displayed `[exited]` depending on `remain-on-exit`), dropping the user out of the workspace (Bug 1).
**Migration**: Automatic. The pane now execs the user's shell after the launcher exits, mirroring the `--split` behavior.

## Design Decisions

1. **Interactive wrap via `$SHELL -i -c`**: apply unconditionally.
   - *Why*: Closes Bug 3 for real (aliases, functions, and interactive PATH now work) rather than documenting around it. Escape hatch is configurable later via `agent.shell_mode` if rc-file side effects bite; adding the config preemptively would be YAGNI.
   - *Rejected*: non-interactive wrap + documentation of the limitation. This relabels Bug 3 rather than fixing it, and punishes alias-heavy users.

2. **`${SHELL:-/bin/sh}` over bare `$SHELL`**: POSIX-safe fallback.
   - *Why*: Zero downside; matches conservative stdlib patterns elsewhere in rk.
   - *Rejected*: bare `$SHELL`. Fails silently (or execs an empty string) when `$SHELL` is unset — rare but non-zero probability in CI-like environments.

3. **Auto-suffix `-2`, `-3`, … on window-name collision**: non-destructive, cheapest option.
   - *Why*: User-preferred in the plan discussion. Preserves visibility of every riff without destroying the original.
   - *Rejected*: (a) error on collision — forces the user to name-wrangle; (b) reuse the existing window — destroys prior context; (c) append a PID or timestamp — uglier and less predictable.

4. **Query `tmux list-windows` up front to detect collisions**: explicit over catching tmux's duplicate-name error.
   - *Why*: One extra fast call (~5ms). Logic is easier to reason about and test. Error path from tmux is server-state-dependent (duplicates are silent with default `allow-rename`).
   - *Rejected*: catch-and-retry on `new-window` error. Surfaces a TOCTOU race that `list-windows`-then-`new-window` also has, but with worse failure modes.

5. **Wrap root context once via `signal.NotifyContext`**: single-site handler, propagate downstream.
   - *Why*: Matches stdlib idiom for CLI tools. Simpler than per-subprocess wrapping or signal channels.
   - *Rejected*: per-subprocess signal channels — more code, no benefit.

6. **Skip automated SIGINT test — verify manually**:
   - *Why*: Unit-testing signal handling here requires forking a hung child process; ROI is low. Other bug fixes have clean unit tests.
   - *Rejected*: goroutine-based fake child with signal assertion — flaky on CI, not worth the maintenance burden for a one-liner fix.

7. **Trust boundary as documentation, not code mitigation**:
   - *Why*: The existing design intentionally treats `agent.spawn_command` as trusted because `fab/project/config.yaml` is committed-code-equivalent. Adding defensive escaping or allow-listing would break shell expansion (`$(basename ...)`) that is a legitimate use of the launcher string.
   - *Rejected*: defensive escaping / allow-listing. Both would break the existing expansion pattern and none of them would meaningfully improve security against a hostile repo (which is an out-of-scope threat model).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Bundle five mechanical fixes + one doc-only fix in a single change, defer Bug 2 to the CLI-surface change | Confirmed from intake #1 — user-specified grouping | S:95 R:70 A:80 D:90 |
| 2 | Certain | Factor a shared shell-wrap helper used by both new-window and split-window paths | Confirmed from intake #2 — simple DRY factoring | S:95 R:85 A:90 D:95 |
| 3 | Certain | Use `${SHELL:-/bin/sh}` form over bare `$SHELL` | Confirmed from intake #3 clarify — user confirmed | S:95 R:90 A:85 D:80 |
| 4 | Certain | Auto-suffix `-2`, `-3`, … on window-name collision | Confirmed from intake #4 clarify — user confirmed | S:95 R:75 A:75 D:70 |
| 5 | Certain | Query `tmux list-windows` up front to detect collisions | Confirmed from intake #5 clarify — user confirmed | S:95 R:80 A:80 D:70 |
| 6 | Certain | Wrap `runRiff`'s root context once via `signal.NotifyContext`, propagate to all three subprocess calls | Confirmed from intake #6 clarify — user confirmed | S:95 R:85 A:85 D:85 |
| 7 | Certain | Skip automated SIGINT test — verify manually | Confirmed from intake #7 clarify — user confirmed | S:95 R:85 A:70 D:80 |
| 8 | Certain | Add Security / Trust Boundary section to `rk-riff.md` — no code change | Confirmed from intake #8 clarify — user confirmed | S:95 R:90 A:85 D:85 |
| 9 | Certain | Use Option A (`$SHELL -i -c`) over Option B (non-interactive) for Bug 3 | Upgraded from intake Tentative — user confirmed in clarify | S:95 R:55 A:55 D:45 |
| 10 | Certain | Exit-code handling is out of scope — do not preserve, refactor, or otherwise touch it | Upgraded from intake Tentative — user: "we don't need to preserve exit code in riff" | S:95 R:75 A:75 D:65 |
| 11 | Certain | Suffix scheme starts at `-2` and fills first gap (not append-after-max) | New in spec — minimal, predictable, matches the "fill gaps" convention | S:85 R:80 A:85 D:80 |
| 12 | Certain | `resolveWindowName` is a pure function taking `(existing []string, base string)` — I/O (the `tmux list-windows` call) is a sibling function | New in spec — separates testable logic from the tmux boundary | S:90 R:85 A:90 D:85 |
| 13 | Certain | `tmux list-windows` failure bubbles as a subprocess error (exit 3), matching existing `rk riff` subprocess-error discipline | New in spec — consistent with current wt/tmux error handling in `riff.go` | S:90 R:80 A:90 D:85 |
| 14 | Certain | Memory file update (Changelog, trust boundary, shell-wrap, SIGINT, suffix behavior) happens during the hydrate stage, not apply | New in spec — matches `_preamble.md` hydrate convention; apply touches code + tests, hydrate touches memory | S:95 R:85 A:90 D:90 |

14 assumptions (14 certain, 0 confident, 0 tentative, 0 unresolved).
