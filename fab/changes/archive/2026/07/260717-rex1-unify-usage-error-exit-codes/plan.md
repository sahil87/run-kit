# Plan: Unify Usage-Error Exit Codes

**Change**: 260717-rex1-unify-usage-error-exit-codes
**Intake**: `intake.md`

## Requirements

<!-- Derived from intake.md. RFC 2119 keywords. Every requirement carries a stable
     R# ID and at least one GIVEN/WHEN/THEN scenario. Under-specified points are
     recorded as graded ## Assumptions rows, never as [NEEDS CLARIFICATION] markers. -->

### Exit Codes: Central Usage-Error Classification

#### R1: Central exit-code classification seam
`execute()` (`app/backend/cmd/rk/root.go`) MUST exit with a code derived from a pure
classification function `exitCode(err) int`, instead of the current blanket `os.Exit(1)`.
`exitCode` SHALL resolve a carried `*exitCodeError` code via `errors.As` and default to `1`
for any other non-nil error. The function MUST be pure (no `os.Exit`, no I/O) so it is
unit-testable in-process.

- **GIVEN** `rootCmd.Execute()` returns an error carrying `*exitCodeError{code: 2}`
- **WHEN** `execute()` classifies it
- **THEN** the process exits `2`
- **AND GIVEN** a plain `fmt.Errorf` operational error
- **THEN** the process exits `1`

#### R2: A usage-class error constructor
`exit_code.go` MUST expose a `usageError(err error) error` constructor that wraps any error
into `*exitCodeError{code: 2, msg: err.Error()}`, preserving the original message text
verbatim so cobra's existing stderr output is unchanged (no double-printing, no message
rewrite).

- **GIVEN** an error `err` with message `M`
- **WHEN** `usageError(err)` wraps it
- **THEN** the result's `Error()` returns `M` exactly
- **AND** its carried code is `2`

#### R3: Flag-parse errors exit 2
`rootCmd.SetFlagErrorFunc` MUST tag every flag-parse error produced under the root command
(and inherited by subcommands) as usage-class (code 2), EXCEPT for subcommands that set their
own `FlagErrorFunc` (cobra's own-wins inheritance).

- **GIVEN** `run-kit doctor --nope` (unknown flag on a normal subcommand)
- **WHEN** cobra's flag parser rejects `--nope`
- **THEN** the process exits `2` with cobra's existing `unknown flag` stderr text unchanged

#### R4: agent-hook never-fail contract preserved
`agent-hook`'s own `SetFlagErrorFunc(func(...) error { return nil })` MUST continue to shadow
the root's flag-error func, and its `ArbitraryArgs` + `FParseErrWhitelist.UnknownFlags` MUST be
left untouched, so `agent-hook` ALWAYS exits `0` on every malformed-invocation path. No code in
`agent_hook.go` is modified by this change.

- **GIVEN** `run-kit agent-hook --nope`, `run-kit agent-hook --agent` (missing value), or bad
  arg counts
- **WHEN** any of these run
- **THEN** the process exits `0` (never `1`, never the blocking `2`)

#### R5: Arg-count validator errors exit 2
The `Args` positional validators on `shell-init` (`MaximumNArgs(1)`), `help-dump`
(`MaximumNArgs(1)`), `agent-setup` (`NoArgs`), `skill` (`NoArgs`), and `notify`
(`ExactArgs(1)`) MUST produce exit `2` on violation. Wrapping SHALL be applied centrally over
`rootCmd.Commands()` so a validator error carries the usage sentinel; commands with
`ArbitraryArgs` (`agent-hook`, `riff`) are unaffected (their validators never error).

- **GIVEN** `run-kit skill x` (NoArgs) or `run-kit notify` (ExactArgs(1), 0 args) or
  `run-kit shell-init a b` (MaximumNArgs(1))
- **WHEN** the arg-count validator rejects the input
- **THEN** the process exits `2` with cobra's existing arg-count stderr text unchanged

#### R6: Unknown command exits 2
`run-kit bogus` (a first positional that is neither a registered subcommand nor a flag) MUST
exit `2`, carrying cobra's existing `unknown command "bogus" for "run-kit"` stderr text
unchanged. A bare `run-kit` (no args) MUST remain untouched — it still defaults to `serve`.

- **GIVEN** `run-kit bogus`
- **WHEN** the root resolves the first arg
- **THEN** the process exits `2` with the `unknown command` message unchanged
- **AND GIVEN** a bare `run-kit`
- **THEN** the serve default runs (no usage error)

#### R7: riff flag-parse errors exit 2 (DisableFlagParsing bypass)
Because `riff` sets `DisableFlagParsing: true` and manually calls `cmd.Flags().Parse(rewritten)`
inside `runRiffWithExitCode` (`riff.go`), the root `FlagErrorFunc` never sees riff's flag
errors. That manual `Parse` error MUST be wrapped locally as usage-class → exit `2`.

- **GIVEN** `run-kit riff --nope`
- **WHEN** riff's manual `Flags().Parse` rejects `--nope`
- **THEN** the process exits `2`

### Exit Codes: riff Exit-Class Conformance

#### R8: riff exit-class renumbering
`internal/riff` exit-class constants MUST be renumbered to conform to Principle 4:
`ExitValidation` 1 → 2 (usage), `ExitPrecondition` 2 → 1 (operational), `ExitSubprocess`
unchanged at 3. The HTTP frontend maps by constant identity (`ExitValidation`), so the numeric
change MUST NOT require any api-layer change.

- **GIVEN** `run-kit riff --count 0` (validation-class: invalid count)
- **WHEN** the engine returns `ExitCodeError{Code: ExitValidation}`
- **THEN** the process exits `2`
- **AND GIVEN** `run-kit riff` outside tmux ($TMUX unset — precondition-class)
- **THEN** the process exits `1`
- **AND GIVEN** a wt/tmux subprocess failure
- **THEN** the process exits `3`
- **AND GIVEN** `POST /api/riff` with an unknown preset (`ExitValidation`)
- **THEN** the HTTP status is still `400` (constant-keyed mapping, no value dependency)

#### R9: riff -h exit-codes block documents 0/1/2/3
The `Exit codes:` block in riff's `Long` help text (`riff.go`) MUST document all four classes:
`0` success, `1` precondition failure, `2` validation/usage, `3` subprocess. Today `1` is
absent and `2` is mislabeled as precondition.

- **GIVEN** `run-kit riff -h`
- **WHEN** the help text renders
- **THEN** the Exit codes block lists 0 (success), 1 (precondition), 2 (validation/usage), 3
  (subprocess)

### Exit Codes: Operational & Fail-Silent Carve-Outs

#### R10: Operational failures stay 1
`status` (against a dead/unreachable tmux server) and `doctor` (failing dependency check) MUST
continue to exit `1` — they return plain `fmt.Errorf` errors, which `exitCode` defaults to `1`.

- **GIVEN** a `status` or `doctor` operational failure (plain error, no `exitCodeError`)
- **WHEN** `execute()` classifies it
- **THEN** the process exits `1`

#### R11: notify fail-silent runtime, arg-count usage
`notify`'s runtime fail-silent contract (server unreachable / non-2xx → exit `0`, RunE returns
nil) MUST be preserved. Its `ExactArgs(1)` misuse MUST become exit `2` (arg-count is a
usage error, caught before RunE, not covered by fail-silent).

- **GIVEN** `run-kit notify "msg"` with an unreachable server
- **THEN** the process exits `0`
- **AND GIVEN** `run-kit notify` with 0 args (or 2 args)
- **THEN** the process exits `2`

### Documentation

#### R12: skill bundle exit-code contract line updated
The exit-code contract line in `app/backend/cmd/rk/skill/skill.md` (~line 75) AND its
byte-identical mirror `docs/site/skill.md` MUST be updated identically: usage/flag/arg errors
exit `2`, operational failures exit `1` (riff subprocess `3`; `notify` runtime fail-silent `0`
unchanged). The bundle MUST stay ≤ 150 lines and the two files MUST remain byte-identical.

- **GIVEN** `rk skill` emits the bundle
- **WHEN** the exit-code contract line is read
- **THEN** it documents 0/1/2/3 per the convention, and `diff` of the two files is empty, and
  the bundle is ≤ 150 lines

#### R13: workflows.md exit-codes table mirrors the new riff classes
The `## Exit codes` table in `docs/site/workflows.md` (~lines 103-109) MUST be updated to mirror
riff's new classes — `0` success, `1` precondition failure, `2` validation/usage, `3` subprocess
— matching the riff `-h` block (R9). This is a published standards-bound surface (constitution
§ Toolkit Standards; readme-extraction covers `docs/site/**`), currently documenting the OLD
inverted codes. *(Added in rework cycle 1 — review must-fix: the original plan scoped only
skill.md under R12.)*

- **GIVEN** the rendered `docs/site/workflows.md`
- **WHEN** the Exit codes table is read
- **THEN** it lists 0 success / 1 precondition / 2 validation-usage / 3 subprocess, consistent
  with `run-kit riff -h`

### Non-Goals

- No change to `agent_hook.go` (its never-fail carve-out is preserved by cobra inheritance).
- No change to the `POST /api/riff` HTTP mapping code (constant-keyed, value-agnostic).
- No change to any exit-`0` success path, `serve`/`daemon` paths, or the `@rk_agent_state` value
  schema.
- Re-running the full help-dump checklist tooling is out of scope for code apply; the command
  tree is unchanged (no flags added/removed), only riff's `-h` prose changes — verified by the
  help-dump test staying green.

### Design Decisions

1. **Central Args-validator wrapping over per-command wraps** — one loop in `init()` wraps each
   non-nil `c.Args` on `rootCmd.Commands()` with a usage-tagging adapter. *Why*: fixes the root
   cause in one place (matches the intake's "root cause, not per-command patches" ethos), avoids
   touching six declaration sites, and is inert for `ArbitraryArgs` commands. *Rejected*:
   per-command wraps at each of the five sites (more edits, more drift surface).
2. **Unknown-command classification at the `execute()` seam** *(REVISED in rework cycle 1)* —
   keep root `Args: nil` so cobra's native Find/legacyArgs path prints everything exactly as
   before (the `unknown command` line, the Levenshtein "Did you mean this?" suggestions, the
   trailing `Run 'run-kit --help' for usage.` hint, and `run-kit help bogus` topic detection),
   and classify at the `execute()` seam: an error whose message has the stable
   `unknown command ` prefix is usage-class → exit 2. Fails safe (2→1, never wrong output) if
   cobra's wording ever changes. *Why*: the explicit-validator approach was empirically proven
   (review, old-vs-new binary diff) to regress stderr — it relocated detection from Find-time to
   ValidateArgs-time, dropping the help hint, disabling suggestions (SuggestionsMinimumDistance
   never bumped 0→2), and silently breaking `help bogus`. Byte-identity of user-facing output
   outranks string-coupling elegance here. *Rejected*: explicit `rootCmd.Args` validator
   replicating legacyArgs (the cycle-1 implementation — three distinct stderr regressions);
   patching each regression individually inside the validator approach (replicates ever more
   cobra internals to reproduce what `Args: nil` gives for free).
3. **shell-init wrapper left as-is** — its local `os.Exit` wrapper already emits exit 2 with the
   correct stderr; collapsing it onto `execute()` is permitted only if byte-identical, and the
   risk/benefit does not favor the collapse. *Why*: behavior-preservation is the binding
   constraint (Assumption #8); leaving it avoids any stderr-text drift. *Rejected*: collapsing
   the wrapper (no functional gain, non-zero drift risk).

## Tasks

### Phase 1: Core Classification Plumbing

- [x] T001 Add `usageError(err error) error` constructor and pure `exitCode(err error) int` classifier to `app/backend/cmd/rk/exit_code.go` (`errors.As` on `*exitCodeError`; default 1) <!-- R1 R2 -->
- [x] T002 Change `execute()` in `app/backend/cmd/rk/root.go` to `os.Exit(exitCode(err))` instead of blanket `os.Exit(1)` <!-- R1 -->

### Phase 2: Usage-Class Tagging

- [x] T003 Add `rootCmd.SetFlagErrorFunc` in `app/backend/cmd/rk/root.go` `init()` tagging flag-parse errors as `usageError` (agent-hook's own func shadows it via cobra inheritance) <!-- R3 R4 -->
- [x] T004 Add a central Args-validator wrap loop in `app/backend/cmd/rk/root.go` `init()`: for each `rootCmd.Commands()` with non-nil `Args`, wrap so a validator error is returned as `usageError` (inert for `ArbitraryArgs`) <!-- R5 -->
- [x] T005 Classify unknown command at the `execute()` seam: restore root `Args: nil` (delete `rootUsageArgs` + `rootFindSuggestions`, ~30 lines, per Deletion Candidates item 3), and make `exitCode(err)` return 2 when the error message carries the stable `unknown command ` prefix; verify old-vs-new binary stderr is byte-identical (`run-kit bogus` prints the help hint again, `run-kit servee` prints "Did you mean this?", `run-kit help bogus` prints "Unknown help topic"), and revert the `TestVersionSubcommandRemoved` version-flag-reset hygiene if no longer needed <!-- R6 --> <!-- rework: review must-fix 1+2 — explicit validator dropped the `Run 'run-kit --help' for usage.` hint and killed Levenshtein suggestions (SuggestionsMinimumDistance never bumped), and broke `help bogus` (should-fix); adopt the seam classification per revised Design Decision 2 --> <!-- done: deleted rootUsageArgs+rootFindSuggestions, restored Args: nil, added unknownCommandPrefix classification in exitCode; TestVersionSubcommandRemoved reset KEPT (cobra's version short-circuit still runs before ValidateArgs, so the hygiene is still load-bearing — verified in cobra 1.10.2 execute() ordering). Old-vs-new stderr byte-identical on bogus/servee/help bogus + every usage path (diff empty), exit 1→2 (help bogus stays 0) -->
- [x] T006 Wrap the manual `cmd.Flags().Parse(rewritten)` error in `runRiffWithExitCode` (`app/backend/cmd/rk/riff.go`) as `usageError(parseErr)` (the CLI-local type) so cobra prints `Error: unknown flag: --nope` exactly as before and the central `execute()` seam exits 2 — do NOT route it through riff's bare `riff.ExitCodeError` print path <!-- R7 --> <!-- rework: review should-fix — the riff.ExitCodeError wrap dropped cobra's `Error: ` stderr prefix; usageError preserves stderr byte-identically with less code --> <!-- done: parse error now `return usageError(parseErr)` (cobra prints via SilenceErrors=false); riff-engine ExitCodeError path unchanged. re-exec TestRiffFlagParseExitsTwo now runs execute() + asserts exit 2 AND stderr contains `Error: unknown flag: --nope`; old-vs-new stderr byte-identical (exit 1→2) -->

### Phase 3: riff Exit-Class Renumbering & Docs

- [x] T007 Renumber `internal/riff` constants in `app/backend/internal/riff/riff.go`: `ExitValidation` 1→2, `ExitPrecondition` 2→1, `ExitSubprocess` 3 unchanged; update the constant comments <!-- R8 -->
- [x] T008 Update riff's `Long` help text `Exit codes:` block in `app/backend/cmd/rk/riff.go` to document 0 success / 1 precondition / 2 validation-usage / 3 subprocess <!-- R9 -->
- [x] T009 [P] Update the exit-code contract line in `app/backend/cmd/rk/skill/skill.md` (~line 75) to state the 0/1/2/3 convention; keep bundle ≤150 lines <!-- R12 -->
- [x] T010 [P] Apply the identical edit to the mirror `docs/site/skill.md` so the two files stay byte-identical <!-- R12 -->

### Phase 4: Tests

- [x] T011 Add table-driven exit-code classification tests in `app/backend/cmd/rk/root_test.go` around the pure `exitCode(err)` seam: usage class → 2 (unknown command, each Args validator shape, unknown flag, riff manual-parse error via a re-exec subprocess test), operational → 1 (plain error), and assert `run-kit bogus` / `run-kit doctor --nope` / `run-kit skill x` / `run-kit notify` (0 & 2 args) / `run-kit shell-init a b` classify to 2 via the seam <!-- R1 R2 R3 R5 R6 R7 R10 -->
- [x] T012 [P] Verify/extend `agent_hook_test.go` never-fail regression coverage (`--nope`, bad arg counts, `--agent` missing value all exit 0 — added explicit `exitCode == 0` assertion) still holds after root's FlagErrorFunc is added <!-- R4 -->
- [x] T013 [P] Update `internal/riff/riff_test.go` + `cmd/rk` riff exit-code assertions if any assert numeric values; confirm constant-keyed HTTP mapping test (api/riff) unaffected — verified both use the constant symbolically / by identity, so no churn needed; added `TestRiffExitClassMapping` locking the numeric classes <!-- R8 -->

### Phase 5: Rework Cycle 1 Additions

- [x] T014 Update the `## Exit codes` table in `docs/site/workflows.md` (~lines 103-109) to the new riff classes: 0 success / 1 precondition failure / 2 validation-usage / 3 subprocess, wording consistent with the riff `-h` block <!-- R13 --> <!-- rework: review must-fix 3 — published docs/site table still documents the old inverted codes; original plan never scoped this file --> <!-- done: table now 0 success / 1 precondition / 2 validation-usage / 3 subprocess; wording matches riff -h block verbatim (added the missing code-1 row + code-2 validation/usage row, fixing the old 0/2/3-inverted table) -->

## Execution Order

- T001 blocks T002 (execute uses exitCode) and T004/T005 (validators use usageError)
- T007 (renumber) blocks T006/T008 semantically (riff wrap + help text reflect the new classes) — but they touch different files and can be edited in any order since the constant names are stable
- Phase 4 tests run after Phases 1–3 land

## Acceptance

### Functional Completeness

- [x] A-001 R1: `execute()` exits with `exitCode(err)`; `exitCode` is pure, `errors.As`-based, defaults to 1
- [x] A-002 R2: `usageError(err)` returns `*exitCodeError{code:2}` with `Error()` == the original message verbatim
- [x] A-003 R3: `run-kit doctor --nope` exits 2 with cobra's unknown-flag stderr text unchanged (verified old-vs-new binary: byte-identical stderr)
- [x] A-004 R4: `run-kit agent-hook` with `--nope` / missing `--agent` value / bad arg counts all exit 0; `agent_hook.go` unmodified (verified empirically + git diff shows only agent_hook_test.go touched)
- [x] A-005 R5: `run-kit skill x`, `run-kit notify` (0 args), `run-kit shell-init a b` all exit 2 with cobra's arg-count text unchanged (notify/shell-init are SilenceErrors — silent before and after)
- [x] A-006 R6: `run-kit bogus` exits 2 with `unknown command "bogus"` text; bare `run-kit` still runs serve (A-018 byte-identity now verified — trailing help hint present)
- [x] A-007 R7: `run-kit riff --nope` exits 2 (manual-parse error wrapped locally; verified empirically + re-exec subprocess test)
- [x] A-008 R8: riff constants are ExitValidation=2, ExitPrecondition=1, ExitSubprocess=3
- [x] A-009 R9: `run-kit riff -h` Exit codes block documents 0/1/2/3 (verified in built binary)
- [x] A-010 R12: skill.md bundle exit-code line states the 0/1/2/3 convention; bundle ≤150 lines (83)

### Behavioral Correctness

- [x] A-011 R6: bare `run-kit` (no args) is unaffected — defaults to serve (no usage error emitted; TestRootCmdDefaultsToServe green)
- [x] A-012 R8: `POST /api/riff` unknown-preset still returns HTTP 400 (riffStatusForError keys on `riff.ExitValidation` constant, api/riff.go:296; api tests green)
- [x] A-013 R11: `notify` runtime fail-silent (unreachable/non-2xx) still exits 0 (RunE always returns nil); `notify` arg-count misuse exits 2 (verified empirically)
- [x] A-014 R12: `app/backend/cmd/rk/skill/skill.md` and `docs/site/skill.md` are byte-identical (empty diff; `rk skill` output matches both)

### Scenario Coverage

- [x] A-015 R1 R2 R3 R5 R6 R7 R10: `root_test.go` table-driven classification tests cover usage→2 (unknown command, NoArgs/ExactArgs/MaximumNArgs, unknown flag, riff manual-parse) and operational→1
- [x] A-016 R4: `agent_hook_test.go` asserts every malformed-invocation path returns nil AND exitCode(err)==0 after root FlagErrorFunc added
- [x] A-017 R8: riff exit-class tests (validation→2, precondition→1, subprocess→3) pass (TestRiffExitClassMapping)

### Edge Cases & Error Handling

- [x] A-018 R3 R5 R6 R7: stderr byte-identity on every usage-error path vs the pre-change binary: unknown command prints the `unknown command` line + Levenshtein "Did you mean this?" suggestions (`run-kit servee`) + the trailing `Run 'run-kit --help' for usage.` hint; `run-kit riff --nope` keeps its `Error: ` prefix; `run-kit help bogus` still prints "Unknown help topic"; flag/arg-count paths unchanged; nothing double-prints (review cycle 2: 22-case old-vs-new binary matrix — all outputs byte-identical, only exit codes flip per contract)
- [x] A-019 R4: agent-hook exit-2-as-blocking hazard averted — its own FlagErrorFunc still shadows root's (verified empirically: exit 0)

### Code Quality

- [x] A-020 Pattern consistency: new code follows the existing `exitCodeError` / `classifyShellInitArgs` testable-core idiom in cmd/rk
- [x] A-021 No unnecessary duplication: extends the existing `exitCodeError` plumbing rather than adding a parallel mechanism; reuses `errors.As`
- [x] A-022 Anti-pattern (magic numbers): exit codes 1/2/3 are named/commented where introduced (`exitUsage` const; riff constants commented)
- [x] A-023 Test coverage: added/changed behavior is covered by tests (constitution Test Integrity — tests conform to the spec)
- [x] A-024 R13: `docs/site/workflows.md` Exit codes table documents 0/1/2/3 consistent with `run-kit riff -h` (review cycle 2: table verified — 0 success / 1 precondition / 2 validation-usage / 3 subprocess, wording matches the riff `-h` block)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- **Hydrate scope addition** (review should-fix, rework cycle 1): beyond
  `run-kit/toolkit-standards`, hydrate MUST also correct the now-inverted numeric exit-class
  claims in `docs/memory/run-kit/rk-riff.md` (~line 253: "ExitValidation=1, ExitPrecondition=2,
  ExitSubprocess=3") and `docs/memory/run-kit/architecture.md` (~line 669: "exit-code wrapper
  returns 2 (precondition) / 3 (subprocess)") to the new classes (validation=2, precondition=1,
  subprocess=3). The intake's Affected Memory has been updated to match.

## Deletion Candidates

- `app/backend/cmd/rk/shell_init.go:105-113` (RunE `*exitCodeError` print + `os.Exit` wrapper in `newShellInitCmd`) — partially redundant: the central `execute()` seam now exits with any carried `*exitCodeError` code, so the wrapper's `os.Exit(2)` duplicates the new mechanism. Retained deliberately per Design Decision 3: the command sets `SilenceErrors`, so the wrapper is what prints the bare message — collapsing it would change stderr (cobra would print nothing, or an `Error: `-prefixed line if SilenceErrors were dropped).
- `app/backend/cmd/rk/riff.go:192-195` (runRiffWithExitCode's `*riff.ExitCodeError` print + `os.Exit`) — same-class candidate the change created: translating `riff.ExitCodeError` → the CLI `*exitCodeError` at the RunE boundary would let `execute()` own all riff exit codes and delete both `os.Exit` sites in cmd/rk. Blocked today only by stderr byte-identity (cobra's print path would prefix `Error: ` to riff's `run-kit riff: …` messages).

*(Cycle-1 candidate executed: `rootUsageArgs` + `rootFindSuggestions` were deleted during rework cycle 1 when unknown-command classification moved to the `execute()` seam — root `Args` is nil again; grep confirms both symbols gone.)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Central classification by extending `exitCodeError`: `execute()` → `os.Exit(exitCode(err))`, pure `exitCode` via `errors.As` (default 1) | Intake FIX + Assumption #1 verbatim; matches existing plumbing | S:95 R:85 A:95 D:95 |
| 2 | Confident | Args validators wrapped via a central loop over `rootCmd.Commands()` (not per-command wraps) | Intake offers both; central loop is the "root cause, not per-command patch" choice and inert for ArbitraryArgs cmds | S:70 R:80 A:85 D:70 |
| 3 | Confident | Unknown command classified at the `execute()` seam via the stable `unknown command ` message prefix, root `Args: nil` restored (rework cycle 1 flip) | Review proved the explicit-validator approach regresses stderr three ways (help hint, suggestions, `help bogus`); seam classification fails safe (2→1) if cobra's wording changes | S:65 R:80 A:85 D:70 |
| 4 | Certain | agent-hook untouched; its own SetFlagErrorFunc shadows root's (cobra own-wins); existing never-fail regression test asserts exit 0 | Intake Assumption #3; agent_hook.go NEVER-FAIL comment; existing TestAgentHookCmdNeverErrorsOnMalformedInvocation already covers the paths | S:85 R:80 A:95 D:90 |
| 5 | Confident | riff renumber ExitValidation 1→2 / ExitPrecondition 2→1 / ExitSubprocess 3; HTTP mapping constant-keyed (api/riff.go:296) → no api change; internal tests use the constant symbolically → no numeric-assertion churn | Intake Assumption #4; source-verified the HTTP map keys on ExitValidation identity and riff_test uses ExitSubprocess symbolically | S:60 R:65 A:80 D:70 |
| 6 | Certain | riff manual Flags().Parse error wrapped locally as ExitCodeError{ExitValidation} (DisableFlagParsing bypasses root FlagErrorFunc) → exit 2 | Intake Assumption #5; source-confirmed the manual Parse at riff.go:170 | S:80 R:85 A:90 D:85 |
| 7 | Certain | shell-init's local os.Exit wrapper left as-is (already exit 2, byte-identical stderr); not collapsed onto execute() | Intake Assumption #8; behavior-preservation is the binding constraint, collapse offers no functional gain | S:70 R:85 A:90 D:80 |
| 8 | Certain | Docs: identical edit to skill/skill.md + docs/site/skill.md; verify byte-identical + ≤150 lines post-edit | Intake §5 + Assumption #6; the two files are currently byte-identical (verified, 83 lines) | S:85 R:90 A:90 D:90 |
| 9 | Confident | Tests structured around the pure exitCode(err) seam in root_test.go (no os.Exit interception), mirroring classifyShellInitArgs | Intake Assumption #10; the testable-core pattern is the established local idiom | S:70 R:85 A:90 D:80 |

9 assumptions (5 certain, 4 confident, 0 tentative).
