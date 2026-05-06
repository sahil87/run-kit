# Spec: rk riff — `--count` rename and fan-out correctness fixes

**Change**: 260504-lald-rk-riff-count-rename-and-fanout-fixes
**Created**: 2026-05-04
**Affected memory**: `docs/memory/run-kit/rk-riff.md`

## Non-Goals

- **`--fan-out` alias retention** — the previous flag name is removed outright; no hidden alias, no deprecation warning. The flag has been in master for ~11 days with a single known consumer; alias plumbing has a maintenance tax not justified at this scale.
- **Renaming internal helpers** — `runFanOut`, `fanOutResult`, `planFanOutRollback`, `rollbackFanOut`, `rollbackPlan` keep their current names. They describe the parallelism mechanic (parallel goroutine spawn with rollback), which is distinct from the user-facing `--count` flag. Renaming them is churn without value.
- **Changing `split-window` pane targeting** — `split-window` calls continue to target the window by name (not by pane id). Tmux's "new pane is active after split" semantics make sequential splits work correctly today, and that behaviour is unaffected by the bug-fix scope.
- **Tmux version pinning / preflight** — `new-window -P -F '#{pane_id}'` requires tmux ≥ 1.8 (released 2013); the project does not currently pin a minimum tmux version and this change does not introduce one. If a future tmux-version concern surfaces, it will be addressed independently.
- **Embedded `tmux.conf` changes** — the bug fix is in `riff.go`'s assumptions about user tmux config (specifically `pane-base-index`), not in `internal/tmux/tmux.conf`. The embedded conf is unaffected.

## CLI: `--count` / `-N` flag surface

### Requirement: `rk riff` exposes `--count` and `-N` to request N parallel worktree/window pairs

The `rk riff` command MUST register a single integer flag named `--count` with the short form `-N` that determines how many worktree/window pairs are spawned in parallel. Default value SHALL be `1`. Values less than 1 (zero, negative) MUST be rejected before any subprocess invocation with exit code 1 and a stderr message naming the offending flag (e.g., `--count requires a positive integer`). The previous `--fan-out` flag MUST NOT be accepted in any form.

#### Scenario: `--count` with positive integer creates that many worktree/window pairs

- **GIVEN** the user is inside a tmux session with `wt` available on PATH
- **WHEN** the user runs `rk riff --count 2 --cmd "echo hi; sleep 30"`
- **THEN** two worktrees are created via `wt create`
- **AND** two `riff-<basename>` tmux windows are created (one per worktree)
- **AND** the command exits 0 with no error output

#### Scenario: `-N` short form is equivalent to `--count`

- **GIVEN** the user is inside a tmux session with `wt` available on PATH
- **WHEN** the user runs `rk riff -N 3 --cmd "echo hi"`
- **THEN** three worktrees are created
- **AND** three tmux windows are created
- **AND** the result is observably identical to `rk riff --count 3 --cmd "echo hi"`

#### Scenario: `--count 1` (default) takes the single-spawn path

- **GIVEN** the user is inside a tmux session
- **WHEN** the user runs `rk riff --cmd "echo hi"` (no `--count`)
- **THEN** exactly one worktree and one tmux window are created
- **AND** the behaviour is observably identical to `rk riff --count 1 --cmd "echo hi"`

#### Scenario: `--count 0` is rejected before any subprocess call

- **GIVEN** the user is inside a tmux session
- **WHEN** the user runs `rk riff --count 0`
- **THEN** the command exits 1
- **AND** stderr contains `--count requires a positive integer`
- **AND** no `wt` or `tmux` subprocess is invoked

#### Scenario: negative `--count` is rejected

- **GIVEN** the user is inside a tmux session
- **WHEN** the user runs `rk riff --count -2`
- **THEN** the command exits 1 (either via the rk-level validation message naming `--count`, or via cobra/pflag's own integer-parse error if `-2` is consumed differently)
- **AND** no worktrees are created

#### Scenario: `--fan-out` is rejected as an unknown flag

- **GIVEN** the user is inside a tmux session
- **WHEN** the user runs `rk riff --fan-out 2`
- **THEN** the command exits non-zero
- **AND** stderr contains an "unknown flag" diagnostic (cobra/pflag default) referencing `fan-out`
- **AND** no worktrees or tmux windows are created

### Requirement: `rk riff -h` documents `--count` / `-N` (not `--fan-out`)

The cobra `Use:` synopsis, `Long:` description, and inline examples for `rk riff` MUST reference `--count <N>` (with `-N` as the short form). All `--fan-out` references in help output, examples, and section headings MUST be replaced. The example previously reading `rk riff ship --fan-out 3` SHALL be updated to use the new flag.

#### Scenario: help text contains `--count` and `-N`, not `--fan-out`

- **GIVEN** an installed `rk` binary built from this change
- **WHEN** the user runs `rk riff -h`
- **THEN** the output contains `--count` and `-N`
- **AND** the output does NOT contain `--fan-out` anywhere
- **AND** at least one example demonstrates the renamed flag (e.g., `rk riff ship --count 3`)

### Requirement: internal flag and effective-spec field names track the user-facing rename

The package-level Go variable previously named `riffFanOutFlag` SHALL be renamed to `riffCountFlag`. The `effectiveSpec.FanOut` field SHALL be renamed to `effectiveSpec.Count`. The orchestrator function previously named `runFanOut` SHALL be renamed to `runCount`. Internal helpers describing the parallelism mechanic (`fanOutResult`, `planFanOutRollback`, `rollbackFanOut`, `rollbackPlan`) keep their existing names — they describe the mechanic, not the flag.

#### Scenario: code references compile after rename

- **GIVEN** the codebase after the rename is applied
- **WHEN** `go build ./...` runs in `app/backend/`
- **THEN** the build succeeds with no references to `riffFanOutFlag`, `effectiveSpec.FanOut`, or `runFanOut`
- **AND** all call sites use the new names

### Requirement: tests cover `--count` parsing and explicit rejection of `--fan-out`

The Go tests for `rk riff` MUST include at least one positive case asserting that `-N <int>` parses into the same effective spec as `--count <int>`. The tests MUST also include an explicit assertion that `--fan-out` produces an unknown-flag error after the rename. Test names that previously referenced "fan-out" as a flag SHALL be updated; tests of internal mechanics (e.g., `TestPlanFanOutRollback`) MAY retain their existing names because they describe the mechanic, not the flag.

#### Scenario: short-form parse test asserts `-N 3` populates count

- **GIVEN** a fresh pflag set with `--count`/`-N` registered as on `riffCmd`
- **WHEN** argv `["-N", "3"]` is parsed
- **THEN** the resulting integer value is `3`

#### Scenario: post-rename rejection test fails-fast on `--fan-out`

- **GIVEN** the cobra `riffCmd` after the rename
- **WHEN** argv `["--fan-out", "2"]` is parsed
- **THEN** parsing returns a non-nil error referencing `fan-out`
- **AND** `runRiff` is not invoked

## Tmux pane targeting (Bug A)

### Requirement: `select-pane` targets the new window's first pane by pane id, not by hardcoded index

When spawning a riff window, the implementation MUST capture the pane id of the first pane created by `tmux new-window` and MUST use that pane id as the target of the subsequent `tmux select-pane` invocation. The implementation MUST NOT hardcode a pane index suffix (such as `.0` or `.1`) on `select-pane` targets, because user tmux configurations vary in `pane-base-index` (commonly `0` or `1`). Pane-id capture SHALL use `tmux new-window -P -F '#{pane_id}'`, parsing a single trimmed line of stdout as the pane id (e.g., `%87`).

#### Scenario: single-pane riff on `pane-base-index 1` produces no `select-pane` error

- **GIVEN** the user is inside a tmux session whose server has `pane-base-index 1` set
- **WHEN** the user runs `rk riff --cmd "echo single-pane-test; sleep 30"`
- **THEN** the new tmux window is created with one pane running the command
- **AND** stderr contains no `can't find pane: 0` message
- **AND** the command exits 0

#### Scenario: single-pane riff on `pane-base-index 0` continues to work

- **GIVEN** the user is inside a tmux session whose server has `pane-base-index 0` (default)
- **WHEN** the user runs `rk riff --cmd "echo zero-base-test"`
- **THEN** the new tmux window is created and pane 0 receives focus
- **AND** the command exits 0 with no error output

#### Scenario: multi-pane riff focuses the window's first pane

- **GIVEN** the user is inside a tmux session
- **WHEN** the user runs `rk riff --skill /a --cmd "htop"` (two panes)
- **THEN** after `select-layout` runs, the active pane is the one created by `new-window` (the first pane, regardless of base index)
- **AND** stderr contains no `can't find pane` message

#### Scenario: pane-id capture parses a single trimmed line

- **GIVEN** `tmux new-window -P -F '#{pane_id}'` writes `%87\n` to stdout
- **WHEN** the implementation parses the captured stdout
- **THEN** the resulting pane id is `%87` (no leading/trailing whitespace, no embedded newline)

### Requirement: `new-window` invocation that captures pane id uses `exec.CommandContext` with timeout

The new pane-id-capturing `tmux new-window -P -F '#{pane_id}' …` subprocess MUST be invoked via `exec.CommandContext` with a derived context bounded by `tmuxTimeout` (10 seconds) and MUST propagate the parent context for SIGINT/SIGTERM cancellation. The captured stdout MUST be read via the standard `cmd.CombinedOutput` (or equivalent) — no shell-string construction, no template-string interpolation, and no `exec.Command` without a context. Tmux child env (`tmuxChildEnv()`) MUST be set on the subprocess so it targets the user's current tmux server. On non-zero exit or timeout, the failure SHALL surface as a `subprocessErr` (exit code 3), matching the rest of the riff path.

#### Scenario: pane-id capture inherits tmux child env

- **GIVEN** the user has `$TMUX` set (restored from `tmux.OriginalTMUX`)
- **WHEN** the implementation runs `tmux new-window -P -F '#{pane_id}' …`
- **THEN** the subprocess env contains `TMUX=<user's original value>` so the call targets the user's server, not the internal `runkit`/`default` socket

#### Scenario: pane-id capture honours timeout and parent context cancellation

- **GIVEN** the parent context is cancelled (e.g., user pressed Ctrl-C) before `new-window` returns
- **WHEN** the pane-id capture subprocess is in flight
- **THEN** `exec.CommandContext` cancels the child process
- **AND** the function returns a non-nil error rather than blocking past `tmuxTimeout`

#### Scenario: pane-id capture failure surfaces as subprocessErr (exit 3)

- **GIVEN** `tmux new-window` returns non-zero (e.g., the worktree path no longer exists)
- **WHEN** `spawnRiff` runs
- **THEN** the returned error is a `*exitCodeError` with `code == 3`
- **AND** the user sees `rk riff: tmux new-window failed: …` on stderr

### Requirement: `buildSpawnArgvs` no longer emits the trailing `select-pane` argv

Because pane id is a runtime value not knowable until `new-window` returns, the pure helper `buildSpawnArgvs` SHALL no longer return the trailing `select-pane` argv. The orchestrator (`spawnRiff` / `spawnRiffReturningName`) SHALL run the captured `new-window`, the `split-window` argvs, the optional `select-layout`, and finally a runtime-constructed `select-pane -t <pane-id>`. The pure helpers `buildNewWindowArgs`, `buildSkillShellString`, `buildCmdShellString`, and the `split-window` portion of `buildSpawnArgvs` retain their pure shape — they still construct argv slices without I/O.

#### Scenario: `buildSpawnArgvs` for a 1-pane window returns no `select-pane` row

- **GIVEN** an `effectiveSpec` with one skill pane and empty `Layout`
- **WHEN** `buildSpawnArgvs(worktree, name, spec)` is called
- **THEN** the returned slice contains the `new-window` argv
- **AND** the slice does NOT contain a `select-pane` argv (that step is now constructed at runtime by the orchestrator)

#### Scenario: `buildSpawnArgvs` for a 2-pane window returns new-window + split-window + select-layout

- **GIVEN** an `effectiveSpec` with two panes and `Layout == "even-horizontal"`
- **WHEN** `buildSpawnArgvs(worktree, name, spec)` is called
- **THEN** the returned slice contains exactly: `new-window`, one `split-window`, and `select-layout` (no `select-pane`)

## `wt` rollback correctness (Bug B)

### Requirement: `runWtDelete` invokes `wt delete` with positional name and `--non-interactive`

The `runWtDelete` rollback helper MUST invoke `wt delete --non-interactive <name>` — passing the worktree basename as a positional argument and including `--non-interactive` so the wrapped `wt` does not prompt on stdin. The deprecated `--worktree-name <name>` flag form MUST NOT be used. The subprocess MUST continue to use `exec.CommandContext` with `wtTimeout` (30 seconds).

#### Scenario: rollback after partial fan-out failure deletes worktrees without prompting

- **GIVEN** a fan-out invocation (e.g., `--count 2`) where one goroutine has succeeded (worktree + window created) and another has failed
- **WHEN** the rollback path calls `runWtDelete` for the successful goroutine's worktree
- **THEN** `wt delete --non-interactive <basename>` is invoked with no `--worktree-name` flag
- **AND** the subprocess does not block waiting for stdin
- **AND** the worktree is removed and the orphan tmux window is killed by the subsequent `kill-window`

#### Scenario: rollback errors are logged but do not mask the primary error

- **GIVEN** the rollback path is running and `wt delete` returns a non-zero exit
- **WHEN** `rollbackFanOut` continues the loop
- **THEN** the failure is written to stderr as `rk riff: rollback warning: wt delete <name> failed: …`
- **AND** the original (first-recorded) goroutine error is still the value returned from `runFanOut` / `runCount`

### Requirement: tests cover the `wt delete` argv shape

The Go tests MUST include a unit-level assertion of the argv passed to `wt delete` from `runWtDelete` (or an equivalent extracted pure helper), covering both: (a) `--non-interactive` is present, and (b) the positional argument carries the worktree basename. The argv MUST NOT contain `--worktree-name`.

#### Scenario: argv assertion catches a regression to `--worktree-name`

- **GIVEN** the Go test suite after this change
- **WHEN** a developer reverts `runWtDelete` to the previous `wt delete --worktree-name <name>` form
- **THEN** the dedicated unit test fails with a message identifying the missing `--non-interactive` flag and/or the unwanted `--worktree-name` flag

## Acceptance verification

### Requirement: end-to-end repro on `pane-base-index 1` succeeds across single, multi, and rollback paths

The change MUST be acceptance-verified against a live tmux server with `pane-base-index 1` set. The following live invocations SHALL succeed without spurious stderr noise and without orphaned worktrees or windows.

#### Scenario: single-pane riff is silent on stderr

- **GIVEN** a tmux server with `pane-base-index 1`
- **WHEN** the user runs `rk riff --cmd "echo hi; sleep 30"`
- **THEN** the new window is created and runs the command
- **AND** stderr contains no `can't find pane: 0` and no other tmux/wt error

#### Scenario: multi-count riff creates N worktrees + N windows

- **GIVEN** a tmux server with `pane-base-index 1`
- **WHEN** the user runs `rk riff --count 2 --cmd "echo hi; sleep 30"`
- **THEN** two worktrees exist on disk
- **AND** two `riff-<basename>` tmux windows exist
- **AND** the command exits 0

#### Scenario: forced partial failure rolls back cleanly

- **GIVEN** a tmux server with `pane-base-index 1` and a deliberately-induced failure path (e.g., a deliberately-invalid layout, or `wt` made temporarily unavailable mid-run)
- **WHEN** one fan-out goroutine fails after another has created its worktree + window
- **THEN** the surviving worktree is removed by `wt delete --non-interactive <name>`
- **AND** the surviving tmux window is killed by `tmux kill-window -t <name>`
- **AND** no `Delete this worktree?` prompt appears in any output stream
- **AND** `rk riff` exits non-zero with the original failure surfaced on stderr

## Design Decisions

1. **Pane-id capture via `new-window -P -F '#{pane_id}'` rather than reading `pane-base-index`.**
   - *Why*: Pane id is the canonical tmux primitive — index is a UI convenience that varies by config. Capturing the id directly works regardless of server-vs-window option scoping, costs no extra subprocess roundtrip per spawn, and aligns with how the rest of the codebase will need to target panes if more pane-targeted operations are added later. `-P -F '#{pane_id}'` has been a stable tmux idiom since 1.8 (2013), well below any plausible minimum version for this project.
   - *Rejected*: `tmux show-options -gv pane-base-index` once at command startup, then hardcode `.<base>` on every `select-pane`. Adds a roundtrip every invocation, misses the (rare) server-vs-window option scoping case, and continues to target by index when id is the canonical primitive.

2. **Short form is `-N` (uppercase), not `-n`.**
   - *Why*: Lowercase `-n` is more conventional (e.g., `xargs -n`) but visually conflates with the common `--name`-style short forms (`tmux new-window -n <name>`, etc.) that operators see in adjacent contexts. Uppercase `-N` reads unambiguously as "count" and `riff` has no other count-like flag to cause confusion. The user explicitly chose `-N` after weighing this tradeoff in the originating discuss session.
   - *Rejected*: `-n`. Convention-conformant, but less self-explanatory in `rk riff`'s flag neighbourhood and risks future collision with a hypothetical `--name` flag.

## Deprecated Requirements

### `--fan-out` flag

**Reason**: The flag was renamed to `--count` (short form `-N`) for clearer ergonomics. The previous name described the parallelism mechanic ("fan-out"), not the user's actual ask ("how many of these"). The flag had been in master for ~11 days with one known consumer; a clean hard rename was preferred over carrying a deprecation alias.

**Migration**: Replace `--fan-out N` with `--count N` (or `-N N`). Examples:

- `rk riff ship --fan-out 3` → `rk riff ship --count 3` (or `rk riff ship -N 3`)
- `rk riff --fan-out 2 --cmd "echo hi"` → `rk riff --count 2 --cmd "echo hi"` (or `rk riff -N 2 --cmd "echo hi"`)

Invocations using `--fan-out` after this change will fail with cobra's standard "unknown flag" error. There is no hidden alias and no deprecation warning period.

### `select-pane -t <window>.0` (hardcoded pane-index targeting)

**Reason**: Pane index `0` is wrong for tmux configurations with `pane-base-index 1` (a common setup, including the project's own embedded `tmux.conf`). The previous implementation printed `can't find pane: 0` on stderr after every riff invocation on such configurations, even when the window was otherwise built correctly. Pane id is the canonical tmux primitive and is unaffected by index configuration.

**Migration**: N/A (internal implementation detail — no user-facing migration). The pane-id capture pattern (`tmux new-window -P -F '#{pane_id}'`) replaces it transparently.

### `wt delete --worktree-name <name>` (deprecated wt invocation)

**Reason**: `wt` deprecated `--worktree-name` in favour of a positional argument and now requires `--non-interactive` for non-tty contexts (rollback runs without stdin attached, so the interactive prompt reads EOF and exits 1, silently failing rollback).

**Migration**: N/A (internal implementation detail). Rollback now invokes `wt delete --non-interactive <name>` directly. Users who never see rollback output are unaffected; users who previously saw silent rollback failures will now see successful cleanup.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Hard rename `--fan-out` → `--count` with short form `-N`; no alias, no deprecation warning | Confirmed from intake #1. Single known consumer; clean rename matches the project's prior `--cmd` → `--skill` and `--split` → `--setup-pane` hard renames (changes `260423-udhe` and `260423-jmwu`); alias plumbing has documented maintenance tax | S:95 R:60 A:90 D:95 |
| 2 | Certain | Short form is `-N` (uppercase) | Confirmed from intake #2. Spec-level review confirms no other rk-riff flag uses `-N`; `-N` registered via `IntVarP(..., "count", "N", 1, …)` is unambiguous | S:95 R:80 A:85 D:90 |
| 3 | Certain | Ship rename + both bug fixes in one change | Confirmed from intake #3. Rename cannot be acceptance-tested without the bug fixes (every multi-pane riff fails at `select-pane` on `pane-base-index 1`); splitting would yield a bug-fix PR that's hard to verify and a rename PR that's "rename + smoke test" — single PR is shorter and has tighter scope | S:95 R:65 A:90 D:95 |
| 4 | Certain | Bug A fix uses tmux pane-id capture (`new-window -P -F '#{pane_id}'`), not `pane-base-index` lookup | Confirmed from intake #4. Pane id is the canonical tmux primitive; works regardless of server-vs-window scoping; no extra roundtrip per spawn; aligns with codebase's existing security posture (no shell-string construction). Spec-level requirement specifies the exact `-P -F '#{pane_id}'` invocation and stdout-parsing rule. | S:85 R:60 A:90 D:85 |
| 5 | Certain | Bug B fix uses positional + `--non-interactive` for `wt delete` | Confirmed from intake #5. Verified live against `wt delete --help` (commit `ab92fd4`). `--non-interactive` is documented and necessary because rollback runs from a non-tty context (no stdin). | S:95 R:90 A:95 D:95 |
| 6 | Certain | Bug A applies to single-pane riffs too — fix removes the cosmetic stderr error in that path as well | Confirmed from intake #9. Reproduced live: single-pane `rk riff --cmd "echo single-pane-test"` printed `can't find pane: 0` on a tmux with `pane-base-index 1`. Observed fact, not design assumption. | S:95 R:85 A:95 D:90 |
| 7 | Certain | Use `tmux new-window -P -F '#{pane_id}'` and parse a single trimmed line of stdout | Confirmed from intake #11. Documented tmux API contract since 1.8 (2013); always emits exactly one pane id per new-window invocation. Spec requirement formalises the trimmed-single-line parse rule. | S:90 R:80 A:95 D:90 |
| 8 | Certain | Pane-id-capturing subprocess uses `exec.CommandContext` with `tmuxTimeout` (10s), tmux child env, and parent-context propagation for SIGINT/SIGTERM | New at spec stage — derived from constitution §I (Security First) and §Process Execution. Every new subprocess in this codebase MUST follow this pattern; the requirement is non-negotiable per the constitution and code-review rules. | S:95 R:85 A:95 D:90 |
| 9 | Certain | Pane-id capture failure surfaces as `subprocessErr` (exit code 3) | Upgraded from intake (implicit) — spec made the choice concrete. `runTmuxArgv` already maps tmux failures to `subprocessErr`; the pane-id-capturing variant follows the same convention so exit-code discipline (`exitCodeError{code:3}` for subprocess failure) is preserved. | S:90 R:85 A:90 D:90 |
| 10 | Confident | Internal helpers `runFanOut` → `runCount` are renamed (orchestrator function tracks the user-facing flag); but `fanOutResult`, `planFanOutRollback`, `rollbackFanOut`, `rollbackPlan` keep their existing names | Spec resolution of intake #6 question. The orchestrator function dispatches off `spec.Count`, so its name should match the user-facing concept. The rollback/result types describe the parallelism mechanic, distinct from the flag — renaming them would be churn. Test names referring to the mechanic (`TestPlanFanOutRollback`) likewise keep their names. | S:80 R:70 A:80 D:80 |
| 11 | Confident | `buildSpawnArgvs` no longer returns the trailing `select-pane` argv — pane-id capture and `select-pane` happen in the orchestrator | Confirmed from intake #7. Pure-builder pattern can't carry runtime values (the captured pane id). Cleanest refactor scopes the runtime step to the orchestrator; the pure helper retains its test seam for the deterministic prefix. | S:80 R:60 A:80 D:75 |
| 12 | Confident | An explicit positive test asserts `--fan-out` is rejected post-rename | Confirmed from intake #8. Hard-rename regressions are easy to introduce via revert; an explicit "unknown flag" assertion costs ~5 lines and makes the contract testable. | S:75 R:80 A:85 D:80 |
| 13 | Confident | The `split-window` calls do not need pane-id targeting — they target the window by name and rely on tmux's "new pane is active after split" semantics | Confirmed from intake #12. Documented tmux behaviour; existing code has worked correctly for split sequencing since the change shipped 11 days ago — the bug is exclusively in the trailing `select-pane`, not in the splits. Out of scope per Non-Goals. | S:85 R:75 A:85 D:85 |
| 14 | Confident | Memory file `docs/memory/run-kit/rk-riff.md` is the only docs file requiring edits in this change | Confirmed from intake #10. Index file (`docs/memory/run-kit/index.md`) one-line summary of `rk-riff.md` is unaffected by the rename. Specs (`docs/specs/*`) do not name `--fan-out` as a flag-level surface (per intake's repro grep, to be re-confirmed during apply). | S:75 R:90 A:85 D:80 |
| 15 | Confident | `--count 1` (default) continues to take the inline single-spawn path (`runWtCreate` + `spawnRiff`); only `Count >= 2` enters `runCount` (renamed `runFanOut`) | Spec-level confirmation of existing dispatch in `runRiff`. Avoids goroutine scheduling overhead for the common single case; behaviour is observable as identical externally per Acceptance scenarios. | S:85 R:80 A:85 D:85 |
| 16 | Confident | Tests for the `wt delete` argv shape are added at the unit level (asserting the argv slice constructed by `runWtDelete` or an extracted pure helper), not via subprocess invocation | Project convention (per `riff_test.go`): tmux/wt argv shapes are tested by pure helpers; integration is manual. Constitution §Test Integrity reinforces "tests conform to spec" — adding a unit-level argv assertion matches the existing pattern. | S:85 R:80 A:85 D:80 |

16 assumptions (9 certain, 7 confident, 0 tentative, 0 unresolved).
