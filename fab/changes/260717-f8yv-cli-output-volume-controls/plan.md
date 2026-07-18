# Plan: CLI Output-Volume Controls (Toolkit Principle 9)

**Change**: 260717-f8yv-cli-output-volume-controls
**Intake**: `intake.md`

## Requirements

### Output Convention: Shared `--quiet` Flag + Sink

#### R1: Persistent `--quiet` flag on rootCmd
run-kit SHALL register a single persistent `--quiet` bool flag on `rootCmd` so every subcommand (present and future) accepts it uniformly. It is a no-op on commands not routed through the output sink.

- **GIVEN** the CLI is invoked as `run-kit <any-subcommand> --quiet`
- **WHEN** cobra parses the arguments
- **THEN** the flag is accepted without a "unknown flag" error on any subcommand
- **AND** a command that has not adopted the sink behaves identically with and without `--quiet`

#### R2: Output sink convention (stdout=data, stderr=chatter+errors)
run-kit SHALL provide a small `outputSink` helper in `app/backend/cmd/rk/output.go` (package `main`) built on `cmd.OutOrStdout()` / `cmd.ErrOrStderr()` (never bare `os.Stdout`/`os.Stderr`). The sink SHALL route data to stdout (never gated) and chatter to stderr (routed to `io.Discard` under `--quiet`). Errors always survive (they flow through `RunE` returns and ungated stderr writes). Exit codes SHALL NOT be affected by `--quiet`. A successful run with nothing to report SHALL be silent under `--quiet`.

- **GIVEN** a sink constructed from a command with `--quiet` unset
- **WHEN** `Dataf` and `Notef` are called
- **THEN** `Dataf` writes to stdout and `Notef` writes to stderr
- **AND WHEN** `--quiet` is set, `Notef` writes to `io.Discard` and `Dataf` still writes to stdout

### Command Adoption: update / doctor / agent-setup

#### R3: `run-kit update` quiet gating
`run-kit update` SHALL route its progress/decoration lines (`Current version: v…`, `Updating v… → v…...`, `Restarting run-kit daemon...`, `run-kit daemon started (…)`) and the streamed brew subprocess output through the chatter channel (dropped by `--quiet`), while routing outcome lines (`Already up to date (v…).`, `Updated to v….`, and the not-a-brew-install guidance block) through the data channel (survive `--quiet`). Errors are unchanged (`RunE` returns).

- **GIVEN** `run-kit update --quiet` on a Homebrew install with an available upgrade
- **WHEN** the update completes
- **THEN** stdout carries `Updated to v….` and stderr (chatter) is suppressed
- **AND** under `--quiet` the brew subprocess streams are suppressed
- **AND GIVEN** a non-Homebrew install, the guidance block survives `--quiet` on stdout

#### R4: `run-kit doctor` quiet gating
`run-kit doctor` SHALL drop the `Checking runtime dependencies...` banner, per-check `[ OK ]` rows, and the `All checks passed.` tail under `--quiet` (chatter). `[FAIL]` rows (carrying the remediation hint) and the non-zero exit SHALL survive. The `--json` path SHALL be untouched — `--quiet --json` emits exactly the JSON document to stdout.

- **GIVEN** `run-kit doctor --quiet` with all dependencies present
- **WHEN** the checks pass
- **THEN** stderr is empty and the exit code is 0
- **AND GIVEN** a failing check, the `[FAIL]` row survives on stderr and the exit is non-zero
- **AND GIVEN** `--quiet --json`, stdout carries exactly the JSON report

#### R5: `run-kit agent-setup` quiet gating
`run-kit agent-setup` SHALL drop informational status lines (`…: hooks already installed … — nothing to do.`, `…: wrote ….`, `…: skipped (no changes written).`, and the legacy-skill removal narration) under `--quiet` (chatter). The interactive consent prompt and its settings diff SHALL NEVER be gated (consent context is interaction, not decoration). The non-TTY refusal naming `--yes` SHALL survive (it is an error). A `--dry-run` diff SHALL survive `--quiet` (it is the requested data). Net: `run-kit agent-setup --yes --quiet` is fully silent on success; errors and refusals still print.

- **GIVEN** `run-kit agent-setup --yes --quiet` on a fresh machine
- **WHEN** the install succeeds
- **THEN** no status lines are printed (silent success)
- **AND GIVEN** `--dry-run --quiet`, the diff still renders (it is the requested data)
- **AND GIVEN** a non-TTY stdin with neither `--yes` nor `--dry-run`, the refusal error naming `--yes` still surfaces

### Reaper: Default List Cap + `--all`

#### R6: Reaper default 10-entry per-list display cap
`run-kit reaper` SHALL cap each rendered list at **10 entries** by default, applied to both output paths: `renderDryRun` (the candidate list) and `renderReapSummary` (the `killed` and `removed` lists, capped 10 **each**). The cap SHALL be display-only — header counts stay exact (computed from the full result), `--yes`/`--force` reap every match regardless of what was listed, and the dangerous-prefix guard, `_rk-ctl`/`rk-daemon` unconditional skips, and dry-run-by-default behavior are unchanged. Reaper needs no quiet conversion — everything it prints is data.

- **GIVEN** a dry-run with 4485 candidates
- **WHEN** `renderDryRun` renders
- **THEN** at most 10 candidate rows print, the header count is `4485`, and a truncation notice states `… and 4475 more; pass --all to list all`
- **AND GIVEN** an act summary with >10 killed and >10 removed, each list caps at 10 independently with exact header counts

#### R7: Truncation notice stated in output
When a rendered list is truncated, `run-kit reaper` SHALL print an explicit truncation notice naming the number of hidden entries and the `--all` escape hatch (silent truncation reads as completeness).

- **GIVEN** a list of N > 10 entries
- **WHEN** it renders with the default cap
- **THEN** the output contains `… and {N-10} more; pass --all to list all`

#### R8: `--all` display-only escape hatch
`run-kit reaper --all` SHALL restore the full list on either path, changing only what is printed, never what is reaped.

- **GIVEN** `run-kit reaper --all` on a large candidate set
- **WHEN** the dry-run renders
- **THEN** every candidate row prints with no truncation notice
- **AND** `--all` never changes reap semantics (counts/actions identical to without `--all`)

### Design Decisions

1. **Single persistent `--quiet` on rootCmd, not per-command flags**: the backlog asks for the convention decided once; persistent registration means future commands inherit it for free, and it is a harmless no-op on unconverted commands. *Rejected*: per-command registration on the three candidates — the ad-hoc shape the backlog names.
2. **stdout=data / stderr=chatter+errors; sink in `cmd/rk/output.go` (package main)**: Principle 9's survive-rule plus Principle 2 (stdout is data) pin the split; a CLI-only concern needs no `internal/` package. *Rejected*: an `internal/` sink package (over-engineered for a CLI-only concern).
3. **Sink threaded into agent-setup by value, test call sites updated to a same-buffer test sink**: agent-setup's internal helpers currently take a single `out io.Writer`; converting them to take an `outputSink` lets status lines gate while the diff/prompt survive. Existing tests that assert both status and diff content on one buffer keep passing via a test sink whose data and chatter both write to that buffer. *Rejected*: adding a parallel `chatter io.Writer` parameter alongside `out` (two params to thread is noisier than one sink value).
4. **Reaper routes its output through `cmd.OutOrStdout()` (replacing bare `fmt.Println`)**: makes the cap unit-testable via a buffer, matching the `doctor.go`/`agent_setup.go` idiom, without changing that reaper output is all data.

### Non-Goals

- No quiet conversion of `serve`/`daemon`/`status`/`riff`/etc. — they accept the persistent `--quiet` but are not routed through the sink (no audited chatter gap). 
- No API/frontend/daemon changes; no `internal/` changes.
- No change to reap semantics — the cap is display-only.
- No README/docs-site updates — they do not enumerate per-command flags; help-dump regenerates automatically.

## Tasks

### Phase 1: Setup

- [x] T001 Register a persistent `--quiet` bool flag on `rootCmd` in `app/backend/cmd/rk/root.go` (bound to a package-level `quiet` var via `rootCmd.PersistentFlags().BoolVar`). <!-- R1 -->
- [x] T002 Create `app/backend/cmd/rk/output.go` (package `main`) with the `outputSink` type (`data`, `chatter io.Writer`), `newSink(cmd *cobra.Command) outputSink` reading the persistent `--quiet` flag (chatter → `io.Discard` when quiet, else `cmd.ErrOrStderr()`; data → `cmd.OutOrStdout()`), a test constructor for explicit writers, and `Dataf`/`Notef` methods. <!-- R2 -->

### Phase 2: Core Implementation

- [x] T003 Convert `run-kit doctor` (`app/backend/cmd/rk/doctor.go`) to the sink: route the banner, `[ OK ]` rows, and `All checks passed.` tail through `Notef` (chatter); keep `[FAIL]` rows on the data/stderr path so they survive `--quiet`; leave the `--json` path untouched. <!-- R4 -->
- [x] T004 Convert `run-kit update` (`app/backend/cmd/rk/upgrade.go`) to the sink: route progress/decoration lines through `Notef`; route outcome lines and the not-brew guidance block through `Dataf`; make `runBrewFn`'s default impl suppress the brew subprocess streams under `--quiet` (thread quiet into the seam without changing the var-seam shape). Under `--quiet`, buffer the brew subprocess stderr instead of discarding it and wrap it into the returned error on failure, so error detail survives (R2's errors-always-survive rule). <!-- R3 --> <!-- rework: cycle 1 should-fix — brewStreams wired stderr to io.Discard under --quiet and cmd.Run() captures nothing, so a failing `rk update --quiet` loses all diagnostic detail; buffer stderr under quiet + surface it in the error -->
- [x] T005 Convert `run-kit agent-setup` (`app/backend/cmd/rk/agent_setup.go`) to the sink: thread an `outputSink` through `runAgentSetup` / `applyAgentConfig` / `applyAgentHooks` / `removeLegacySkill`; route status lines (`nothing to do`, `wrote`, `skipped`, legacy-skill narration) through `Notef`. Route the diff (`renderArtifactDiff`) **per consent mode**: on the interactive-prompt and `--dry-run` paths it is data (survives `--quiet`, per R5's never-gate clauses); on the `--yes` path it is chatter (`Notef` — narration of an already-authorized action), so `--yes --quiet` prints nothing on success while `--yes` non-quiet still shows the diff on stderr. The interactive prompt itself (`authorizeWrite` prompt suffix + dry-run note) stays on the data path; keep the non-TTY refusal error intact. <!-- R5 --> <!-- rework: cycle 1 MUST-FIX — renderArtifactDiff wrote to sink.data unconditionally before authorizeWrite, so `--yes --quiet` printed the full diff to stdout, violating R5's net-effect clause ("--yes --quiet is fully silent on success"); the requirement is correct, the routing was wrong -->

### Phase 3: Integration & Edge Cases

- [x] T006 Add the 10-entry per-list cap + truncation notice + `--all` flag to `run-kit reaper` (`app/backend/cmd/rk/reaper.go`): register a `--all` bool flag; route output through `cmd.OutOrStdout()`; cap `renderDryRun` at 10 with the notice; cap `renderReapSummary`'s `killed` and `removed` lists at 10 each with per-list notices; header counts stay exact; `--all` restores the full list. Add a sentence to the reaper `Long` text describing the cap/`--all`. <!-- R6 R7 R8 -->

### Phase 4: Tests

- [x] T007 [P] Add quiet-gating unit tests for `doctor` in `app/backend/cmd/rk/doctor_test.go`: `--quiet` drops banner/`[ OK ]`/tail on stderr, keeps `[FAIL]` + non-zero exit, `--quiet --json` emits exactly the JSON. <!-- R4 -->
- [x] T008 [P] Add quiet-gating unit tests for `update` in `app/backend/cmd/rk/upgrade_test.go` via the existing seams: outcome line survives on stdout under `--quiet`, progress lines suppressed on stderr, brew streams suppressed, errors + exit unaffected. Cover the buffered-stderr path: a failing brew under `--quiet` surfaces the captured stderr detail in the returned error. <!-- R3 --> <!-- rework: cycle 1 — extend coverage for T004's buffered brew stderr-in-error behavior -->
- [x] T009 [P] Add quiet-gating unit tests for `agent-setup` in `app/backend/cmd/rk/agent_setup_test.go`: `--quiet` drops status lines, `--dry-run --quiet` still renders the diff, non-TTY refusal survives `--quiet`, `--yes --quiet` fully silent on success **including when a write is pending** (assert empty stdout+stderr; replace the current test comment that acknowledges the diff deviation), and `--yes` non-quiet still renders the diff (on stderr). Make `TestAgentSetup_QuietFlagWiredThroughRoot` hermetic: `t.Setenv("HOME", t.TempDir())` so it never reads the invoking user's real `~/.claude`. <!-- R5 --> <!-- rework: cycle 1 — must-fix coverage (silent --yes --quiet with pending write) + should-fix hermeticity (test read real $HOME) -->
- [x] T010 [P] Add `app/backend/cmd/rk/reaper_test.go`: dry-run caps at 10 with exact header count + notice wording, `--all` restores full list, per-list cap on act summary (killed + removed each capped independently), `--all` does not change reap semantics. <!-- R6 R7 R8 -->

## Execution Order

- T001, T002 (Phase 1) block all Phase 2/3 tasks (the flag + sink are prerequisites).
- T003, T004, T005, T006 are independent of each other (different files) but each depends on T001+T002.
- Phase 4 test tasks each depend on their corresponding Phase 2/3 task (T007→T003, T008→T004, T009→T005, T010→T006).

## Acceptance

### Functional Completeness

- [x] A-001 R1: A persistent `--quiet` bool flag is registered on `rootCmd` and accepted by every subcommand without error.
- [x] A-002 R2: `output.go` provides an `outputSink` with `Dataf`/`Notef` built on `cmd.OutOrStdout()`/`cmd.ErrOrStderr()`; chatter routes to `io.Discard` under `--quiet`, data always to stdout.
- [x] A-003 R3: `run-kit update` routes progress + brew streams through chatter (dropped by `--quiet`) and outcome/guidance lines through data (survive `--quiet`).
- [x] A-004 R4: `run-kit doctor` drops banner/`[ OK ]`/tail under `--quiet`, keeps `[FAIL]` + non-zero exit; `--json` untouched.
- [x] A-005 R5: `run-kit agent-setup` drops status lines under `--quiet`; diff, interactive prompt, `--dry-run` diff, and non-TTY refusal are never gated. <!-- re-verified cycle 2: the diff now routes per consent mode (consent.diffWriter, agent_setup.go:286) — interactive/--dry-run diff on the data channel (never gated), --yes diff on chatter — so `--yes --quiet` with a pending write is fully silent on success (net-effect clause met); pinned by TestAgentSetup_QuietYesSilentOnSuccess and TestAgentSetup_InteractiveDryRunDiffOnData -->
- [x] A-006 R6: `run-kit reaper` caps each rendered list at 10 by default on both paths; header counts stay exact; reap semantics unchanged.
- [x] A-007 R7: A truncation notice naming the hidden-entry count and `--all` prints whenever a list is truncated.
- [x] A-008 R8: `run-kit reaper --all` restores the full list on either path and never changes what is reaped.

### Behavioral Correctness

- [x] A-009 R3: Adopting the convention re-routes `update`'s former stdout progress lines onto stderr on non-quiet runs (intentional per "decide the convention once"), while outcome lines stay on stdout.
- [x] A-010 R2: `--quiet` never suppresses errors and never changes exit codes.

### Scenario Coverage

- [x] A-011 R4: A unit test proves `--quiet --json` on `doctor` emits exactly the JSON with empty stderr.
- [x] A-012 R6: A unit test proves the dry-run 10-entry cap with an exact header count and the `… and N more; pass --all to list all` notice.
- [x] A-013 R8: A unit test proves `--all` restores the full list on both dry-run and act-summary paths.

### Edge Cases & Error Handling

- [x] A-014 R5: `agent-setup` non-TTY refusal (naming `--yes`) survives `--quiet` and writes nothing.
- [x] A-015 R6: `renderReapSummary` caps `killed` and `removed` independently (both >10 → 10 each), exact counts in headers.

### Code Quality

- [x] A-016 Pattern consistency: New code follows the `cmd.OutOrStdout()`/`ErrOrStderr()` idiom and the package-level var-seam idiom already used in `doctor.go`/`agent_setup.go`/`upgrade.go`.
- [x] A-017 No unnecessary duplication: The sink is defined once in `output.go` and reused; no per-command ad-hoc quiet gating.
- [x] A-018 Tests: New/changed behavior (quiet gating per command, reaper cap, `--all`, errors/exit unaffected) is covered by Go unit tests in `cmd/rk` per `code-quality.md` test strategy.
- [x] A-019 Constitution §IX / §I: No new HTTP verbs, no shell-string subprocess calls introduced; the change is CLI-only.

### Security

- [x] A-020 R6: Reaper's dangerous-prefix guard, unconditional `_rk-ctl`/`rk-daemon` skips, and dry-run-by-default remain intact — the display cap changes nothing about what is reaped.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- Long help text (`reaper.go` `Long`) gains a cap/`--all` sentence; `help_dump_test.go` asserts structure dynamically (no golden fixture), so no fixture regen is needed.

## Deletion Candidates

- `app/backend/cmd/rk/output.go:38-43` (`newSink`'s `Lookup("quiet")`/`GetBool` branch) — inert in production: the persistent `--quiet` flag is bound via `BoolVar` to the same package-level `quiet` var the fallback reads, so through `rootCmd.Execute()` the flag value and the var cannot diverge; `q := quiet` alone is equivalent on every production path. (The branch is exercised only by `output_test.go`'s bare-command construction, which registers a local unbound `quiet` flag — that test would be deleted with it.)

No pre-existing code became redundant or unused — the change converts existing output call sites in place (no orphaned helpers, flags, or branches remain from the old `fmt.Print*` paths).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `outputSink` is threaded into agent-setup **by value** (single sink param replaces the single `out io.Writer`); test call sites get a same-buffer test sink so existing one-buffer assertions keep passing | Least-noisy way to give status lines a gated channel while diff/prompt survive; a parallel `chatter` param would double the threading. Tests conflate data+chatter on one buffer today, so a same-buffer sink is behavior-preserving | S:65 R:75 A:75 D:60 |
| 2 | Confident | `runBrewFn`'s default impl gains a quiet parameter (or reads the package-level `quiet` var) to suppress brew subprocess streams under `--quiet`, keeping the var-seam shape so tests still observe calls without a real brew | The intake says brew streams are the definitional chatter to drop; the seam must stay a var. Threading quiet via the existing seam is the minimal change that satisfies both | S:65 R:80 A:75 D:60 |
| 3 | Confident | Reaper output moves from bare `fmt.Println`/`Printf` to `cmd.OutOrStdout()` so the cap is buffer-testable, matching the doctor/agent-setup idiom | code-quality mandates tests for changed behavior; the cap is only unit-testable through an injectable writer, and the codebase idiom is `cmd.OutOrStdout()` | S:70 R:85 A:85 D:75 |
| 4 | Confident | Truncation notice wording is `… and {N} more; pass --all to list all` (dry-run) and per-list equivalents on the act summary, matching the intake's example block verbatim | The intake shows the exact dry-run wording; the act-summary lists reuse the same phrasing for consistency | S:70 R:85 A:80 D:70 |
| 5 | Certain | `--quiet` is a persistent bool on `rootCmd`; the sink lives in `cmd/rk/output.go` (package main) built on `cmd.OutOrStdout()`/`ErrOrStderr()` | Stated verbatim in the intake's What-Changes §1 (persistent flag, sink sketch, package main, testable idiom) | S:85 R:85 A:90 D:85 |
| 6 | Certain | Reaper cap = 10 per list, display-only, both paths; header counts exact; `--all` display-only; reaper needs no quiet conversion | Stated verbatim in the intake's What-Changes §5 (10-entry cap, both paths, display-only, `--all`, all-data) | S:85 R:90 A:90 D:85 |

6 assumptions (2 certain, 4 confident, 0 tentative).
