# Intake: Unify Usage-Error Exit Codes

**Change**: 260717-rex1-unify-usage-error-exit-codes
**Created**: 2026-07-18

## Origin

One-shot invocation: `/fab-new rex1` — backlog item `[rex1]` (2026-07-18), quoted verbatim:

> Toolkit CLI Principle 4 — unify usage-error exit codes to the toolkit convention (exit 2 for usage/flag/unknown-command/arg-count errors; exit 1 reserved for operational failure). DEFERRED from the standards-conformance audit (change c424, shll v0.0.23) as restructural — it is NOT a per-command "missing exit code" but a cross-cutting error-model change. TODAY: `run-kit shell-init` and `run-kit riff` already return 2 for their usage errors (via the local exitCodeError type + os.Exit in their RunE wrappers, app/backend/cmd/rk/exit_code.go / shell_init.go / riff.go), but every other command inherits cobra's default exit 1 for unknown commands (`run-kit bogus` → 1), missing/excess args (`run-kit notify` with no message → 1, cobra.ExactArgs), and unknown flags (`run-kit doctor --nope` → 1) because the shared main.execute() (root.go) does a blanket os.Exit(1) on any non-nil rootCmd.Execute() error. FIX (root cause, not per-command patches): classify usage errors centrally — set rootCmd.SetFlagErrorFunc to tag flag-parse errors, wrap the arg validators / unknown-command path so their errors carry an exit-2 sentinel, and teach execute() to os.Exit(2) on a usage-class error and 1 otherwise (extend the existing exitCodeError plumbing rather than adding a parallel mechanism). VERIFY across the whole tree: unknown command, each Args validator (NoArgs/ExactArgs/MaximumNArgs), and unknown flag all exit 2; genuine operational failures (status against a dead server, doctor FAIL, riff subprocess failure) still exit their documented codes (1, 1, 3). Then re-run the help-dump checklist (no tree change expected, but exit-code docs in -h text may update). SCOPE: app/backend/cmd/rk/root.go (execute + FlagErrorFunc), exit_code.go (may generalize), per-command RunE only where a validator error must be caught before cobra prints. TESTS: table-driven exit-code assertions in root_test.go. STANDARD: https://shll.ai/shll/standards/principles (Principle 4 — "0 success, 1 operational failure, 2 usage error is the toolkit convention").

**Intake-time source verification** corrected one factual claim in the backlog text: riff does NOT "already return 2 for its usage errors". `internal/riff/riff.go:61-63` defines `ExitValidation = 1` (unknown layout, invalid `--count`, unknown/conflicting preset — usage-class), `ExitPrecondition = 2` ($TMUX unset, wt not on PATH — operational), `ExitSubprocess = 3`. Riff's mapping is *inverted* relative to Principle 4, and `1` is absent from riff's own `-h` exit-codes block (which documents only 0/2/3). See Assumption #4 for the scope decision this forced.

## Why

1. **Problem**: `rk` cannot signal "you misused the CLI" distinctly from "the operation failed". `main.execute()` (`app/backend/cmd/rk/root.go:52-56`) does a blanket `os.Exit(1)` on any error `rootCmd.Execute()` returns, so cobra's usage-class errors — unknown command (`run-kit bogus`), arg-count violations (`run-kit notify` with no message, `cobra.ExactArgs(1)`), unknown flags (`run-kit doctor --nope`) — exit 1, indistinguishable from a dead tmux server or a failed dependency check. Only `shell-init` (local `exitCodeError{code: 2}` + RunE wrapper) returns 2 for its RunE-level usage errors today — and even it leaks exit 1 for its cobra-level arg-count path (`cobra.MaximumNArgs(1)` fires before RunE).
2. **Consequence of not fixing**: permanent Principle 4 nonconformance (recorded in the c424 audit, deferred to this backlog item); scripts and CI wrapping `rk` cannot branch on misuse-vs-failure; the sahil87 toolkit's CLI contract stays inconsistent across tools. The constitution (§ Toolkit Standards) makes conformance binding: "Standards added or revised there bind this repo without further amendment."
3. **Why this approach**: central classification at the one choke point every command already flows through (`execute()`), extending the existing `exitCodeError` plumbing — not per-command patches. Fixes the root cause (the blanket `os.Exit(1)`), keeps the mechanism singular, and leaves the never-fail/operational carve-outs intact.

## What Changes

### 1. Generalize the exit-code plumbing (`exit_code.go`, `root.go`)

`execute()` learns to classify. Target shape (exact structure is apply's choice; the contract is binding):

```go
// exit_code.go — add a usage-class constructor
func usageError(err error) error {
    return &exitCodeError{code: 2, msg: err.Error()}
}

// root.go — execute() branches on the carried code instead of blanket 1
func execute() {
    if err := rootCmd.Execute(); err != nil {
        os.Exit(exitCode(err)) // errors.As → *exitCodeError → .code; else 1
    }
}
```

- `exitCode(err) int` is a pure function (`errors.As` on `*exitCodeError`, default 1) so `root_test.go` can table-test classification in-process without `os.Exit`.
- **No double-printing**: cobra already prints `Error: …` + usage for usage-class errors (root sets `SilenceUsage: true` but not `SilenceErrors`). The wrapped error must preserve cobra's existing stderr output exactly — the wrapper changes only the process exit code, never the message text. (`exitCodeError.Error()` returns the original message, so cobra's print path is unchanged.)

### 2. Flag-parse errors → 2 (`rootCmd.SetFlagErrorFunc`)

```go
rootCmd.SetFlagErrorFunc(func(_ *cobra.Command, err error) error {
    return usageError(err)
})
```

- Cobra's `FlagErrorFunc` is inherited: a child uses its own if set, else the parent's. So this covers every subcommand except the two that opt out (next two bullets).
- **`agent-hook` carve-out is preserved automatically**: it sets its own `SetFlagErrorFunc(func(...) error { return nil })` (`agent_hook.go` init), which shadows the root's. Its NEVER-FAIL CONTRACT (every path exits 0) is load-bearing — Claude Code treats hook exit code **2 as blocking** and other non-zero as warnings, so agent-hook must never surface either. Do not touch `agent_hook.go`; add a regression test asserting `run-kit agent-hook --nope`, bad arg counts, and `--agent` with missing value all still exit 0.
- **`riff` bypasses cobra flag parsing** (`DisableFlagParsing: true`; it manually calls `cmd.Flags().Parse(rewritten)` inside `runRiffWithExitCode`, riff.go:170). The root `FlagErrorFunc` never sees riff's flag errors — wrap that manual `Parse` error locally as usage-class (this is exactly the backlog's "per-command RunE only where a validator error must be caught" case): `run-kit riff --nope` → 2.

### 3. Arg-count and unknown-command errors → 2

- Wrap the `Args` validators so their errors carry the usage sentinel. Candidate central form — one loop in `init()`/`execute()` over `rootCmd.Commands()` wrapping each non-nil `c.Args` with `usageArgs(v cobra.PositionalArgs) cobra.PositionalArgs` — or per-command wraps at the six declaration sites; apply picks. Affected validators: `shell_init.go:102` (`MaximumNArgs(1)`), `help_dump.go:93` (`MaximumNArgs(1)`), `agent_setup.go:314` (`NoArgs`), `skill.go:39` (`NoArgs`), `notify.go:29` (`ExactArgs(1)`). `agent_hook.go:91` (`ArbitraryArgs`) and `riff.go:138` (`ArbitraryArgs`) never produce validator errors — wrapping is harmless but unnecessary.
- **Unknown command** (`run-kit bogus`): root has no explicit `Args`, so cobra's `legacyArgs` produces the `unknown command %q` error for a first arg that isn't a registered subcommand. `legacyArgs` is unexported — replicate the check as an explicit `rootCmd.Args` validator (arg present + not a registered command name + not a flag → usage error), or classify at the `execute()` seam. Requirement: `run-kit bogus` → exit 2 with cobra's existing `unknown command` stderr text unchanged; a bare `run-kit` (no args → defaults to serve) is untouched.

### 4. riff exit-class renumbering (Assumption #4 — the one contract change)

Bring `internal/riff` into Principle 4 conformance by swapping the two misassigned classes:

```go
// internal/riff/riff.go — before → after
ExitValidation   = 1  →  2   // usage: unknown layout, invalid --count, unknown/conflicting preset
ExitPrecondition = 2  →  1   // operational: $TMUX unset, wt not on PATH
ExitSubprocess   = 3  →  3   // unchanged (documented operational class)
```

- The HTTP frontend (`POST /api/riff`) maps by **constant identity** (`ExitValidation` → 400), not numeric value — no API change.
- Update riff's `-h` "Exit codes:" block (riff.go:96-99) to document all four: `0` success, `1` precondition failure, `2` validation/usage, `3` subprocess. (Today `1` is undocumented there entirely.)
- Update `riff_test.go` exit-code assertions to match.
- `shell-init`'s existing RunE-level exit-2 usage errors are already conformant; its local `os.Exit` wrapper (shell_init.go:110-113) MAY be collapsed onto the generalized `execute()` handling only if stderr text and codes stay byte-identical — otherwise leave it.

### 5. Documentation

- **Embedded skill bundle** (`app/backend/cmd/rk/skill/skill.md:75`) and its mirror `docs/site/skill.md`: the line "**Other commands exit non-zero (generic `1`) on error**" becomes a statement of the convention — usage/flag/arg errors exit `2`, operational failures exit `1` (riff subprocess `3`; `rk notify` runtime fail-silent `0` unchanged). Both copies updated identically (the bundle is emitted byte-identical by `rk skill`).
- **Re-run the help-dump checklist** (per the toolkit-standards conformance procedure in `docs/memory/run-kit/toolkit-standards.md`): no command-tree change expected, but riff's `-h` exit-code block changes.

### 6. Tests (`root_test.go`, table-driven)

- Usage class → 2: unknown command (`bogus`), each Args validator shape in the tree (`NoArgs`: `skill x`; `ExactArgs(1)`: `notify` with 0 and 2 args; `MaximumNArgs(1)`: `shell-init a b`), unknown flag (`doctor --nope`), riff manual-parse flag error (`riff --nope`).
- Operational class preserved → 1: `status` against a dead/unreachable tmux server, `doctor` with a failing dependency check (both return plain `fmt.Errorf` today — must stay 1). Riff: validation → 2, precondition → 1, subprocess → 3 (update existing `riff_test.go` assertions).
- Never-fail preserved → 0: `agent-hook` with unknown flag / bad args / `--agent` missing value.
- Structure the assertions around the pure `exitCode(err)` seam (mirroring the existing `classifyShellInitArgs` testable-core pattern) so no test needs a subprocess or `os.Exit` interception; a small number of `go run`-style subprocess tests MAY be added only if the in-process seam can't observe a path.

## Affected Memory

- `run-kit/toolkit-standards`: (modify) — flip Principle 4 from "deferred to backlog [rex1]" to conformant; record the central exitCodeError classification model, the riff renumbering, and the agent-hook never-fail carve-out.
- `run-kit/rk-riff`: (modify) — correct the numeric exit-class claim (~line 253) to the renumbered classes: validation=2, precondition=1, subprocess=3. *(Added in rework cycle 1 — review found the stale claim.)*
- `run-kit/architecture`: (modify) — correct the riff exit-code wrapper claim (~line 669) to the renumbered classes. *(Added in rework cycle 1.)*

## Impact

- **Code**: `app/backend/cmd/rk/root.go` (execute + FlagErrorFunc + unknown-command path), `exit_code.go` (generalize), `riff.go` (manual-parse wrap), `internal/riff/riff.go` (constant renumbering + help text), possibly `shell_init.go` (wrapper collapse), the five Args-validator declaration sites only if per-command wrapping is chosen over the central loop.
- **Tests**: `root_test.go` (new table), `riff_test.go` (renumbered assertions), `agent_hook_test.go` (exit-0 regression if not already covered).
- **Docs**: `app/backend/cmd/rk/skill/skill.md` + `docs/site/skill.md` (exit-code contract line), riff `-h` text; help-dump checklist re-run.
- **Externally visible behavior change** (brew-distributed CLI): usage errors move 1→2 across the tree; riff validation 1→2 and precondition 2→1. Unchanged: all exit-0 success paths, `agent-hook` always-0, `notify` runtime fail-silent 0, `status`/`doctor` operational 1, riff subprocess 3, `serve`/`daemon` paths.

## Open Questions

None — the backlog entry carries a complete design (fix shape, verification matrix, scope, tests, standard link). The one ambiguity discovered during source verification (riff's inverted validation/precondition codes contradicting the backlog's "riff already returns 2" claim) is resolved as Confident Assumption #4 rather than asked, since the constitution's binding standards clause gives a clear front-runner.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Central classification by extending the existing `exitCodeError` plumbing — `execute()` exits with the carried code (usage → 2, default 1); no per-command patches | Backlog FIX section specifies this verbatim ("extend the existing exitCodeError plumbing rather than adding a parallel mechanism") | S:95 R:85 A:95 D:95 |
| 2 | Certain | Class boundaries: unknown command / arg-count / unknown-flag → 2; `status`/`doctor` operational failures stay 1; riff subprocess stays 3 | Backlog VERIFY matrix verbatim; matches Principle 4's published definition | S:95 R:90 A:95 D:95 |
| 3 | Certain | `agent-hook` never-fail contract preserved untouched — its own `SetFlagErrorFunc` shadows the root's (cobra inheritance: own-wins), plus regression tests | Grounded in agent_hook.go's NEVER-FAIL comment: Claude Code treats hook exit 2 as *blocking*, so this carve-out is safety-critical | S:80 R:75 A:95 D:90 |
| 4 | Confident | Renumber riff's exit classes to conform: `ExitValidation` 1→2 (usage), `ExitPrecondition` 2→1 (operational); update `-h` block + riff_test; HTTP mapping (constant-keyed) unaffected | Backlog claims riff "already returns 2 for usage errors" — source shows the inverse (riff.go:61-63), so strict-backlog-scope and strict-conformance diverge; constitution § Toolkit Standards binds Principle 4, and the author's claim reveals intent that riff be conformant. Externally-visible contract change — flagged for review | S:35 R:60 A:65 D:55 |
| 5 | Certain | riff's flag-parse errors wrapped locally in `runRiffWithExitCode` (DisableFlagParsing bypasses the root FlagErrorFunc) → `riff --nope` exits 2 | Backlog explicitly reserves "per-command RunE only where a validator error must be caught before cobra prints" — this is that case, discovered by source reading | S:70 R:85 A:90 D:85 |
| 6 | Confident | Update the documented exit-code contract line in the embedded skill bundle (skill/skill.md:75) + docs/site/skill.md mirror | Not in the backlog SCOPE list, but the line becomes false once usage errors exit 2; readme-extraction/skill standards require docs match behavior | S:55 R:90 A:85 D:80 |
| 7 | Confident | `notify` fail-silent contract scoped to runtime errors only: server unreachable stays exit 0; its `ExactArgs(1)` misuse becomes 2 (today 1) | Misuse already isn't silent today (exits 1 with cobra error), so fail-silent never covered it; backlog VERIFY lists notify's arg-count among usage errors | S:60 R:80 A:80 D:70 |
| 8 | Confident | `shell-init`'s local `os.Exit` wrapper collapses onto generalized `execute()` handling only if stderr + codes stay byte-identical; otherwise untouched | Backlog: "exit_code.go (may generalize)" — permissive, not mandated; behavior-preservation is the constraint that decides | S:65 R:85 A:85 D:75 |
| 9 | Confident | `change_type` pinned explicitly as `fix` (behavior-visible conformance correction, not a chore/refactor) | Exit codes are observable CLI behavior being corrected to spec; explicit pin prevents keyword re-inference flips at refresh seams | S:50 R:90 A:75 D:60 |
| 10 | Certain | Tests are table-driven in root_test.go around a pure `exitCode(err)` classification seam (no os.Exit interception), mirroring the classifyShellInitArgs pattern | Backlog TESTS line names root_test.go table-driven; the testable-core pattern is the established local idiom | S:85 R:90 A:90 D:85 |

10 assumptions (5 certain, 5 confident, 0 tentative, 0 unresolved).
