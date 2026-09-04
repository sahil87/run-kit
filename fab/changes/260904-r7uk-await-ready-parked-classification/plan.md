# Plan: Await-Ready Parked Classification (Agent-Messaging Part B)

**Change**: 260904-r7uk-await-ready-parked-classification
**Intake**: `intake.md`

## Requirements

### inject: Sentinel echo classification

#### R1: Sentinel echo classifier replaces the settle return
`inject.AwaitReady` SHALL, when no reconciled agent state exists and the capture
settles (non-blank, byte-identical across consecutive polls — today's
`ReadyBySettle` trigger), run a **sentinel echo probe** instead of returning:
paste a harmless sentinel into the pane through the `Tmux` primitives
(`SetBuffer`/`PasteBuffer`, bracketed paste — the engine's canonical typing
path), capture, and test **novelty** (occurrence count strictly above a
pre-probe baseline, the `CountOccurrences` discipline), then clear with `C-u`.
An echo SHALL return a new `Readiness` value (`ReadyByEcho`); the
`ReadyBySettle` value and its `(settled)` surface SHALL be removed (compile-time
break forces consumer updates). The state-present signal (`ReadyByState`)
remains checked first every poll — the sentinel is therefore only ever typed
into a pane with no agent state (the mechanical half of the scope rule).

- **GIVEN** a hook-less pane whose screen settles at a live input box
- **WHEN** `AwaitReady` runs
- **THEN** the sentinel is pasted, its echo detected by novelty counting,
  `C-u` clears it, and the call returns `ReadyByEcho`
- **AND GIVEN** the sentinel text already appears on the settled screen
  (stale occurrence), **THEN** only a count *increase* satisfies the probe —
  a stale occurrence alone never fires it

#### R2: Parked classification with snippet evidence
When the sentinel does **not** echo and the screen still matches the settled
non-blank frame, `AwaitReady` SHALL return a typed sentinel error (`ErrParked`
class carrying the settled screen's trailing snippet, `readySnippet`-bounded) —
**immediately**, not at deadline. Parked is an error, not a `Readiness` value,
so `DeliverWhenReady` and every consumer fails closed (no delivery is attempted
into a wall) with no signature change.

- **GIVEN** a pane settled on a trust dialog (pasted text never echoes)
- **WHEN** the sentinel probe exhausts with the frame unchanged
- **THEN** `AwaitReady` returns the parked error carrying the screen snippet,
  and `DeliverWhenReady` returns it without sending

#### R3: Boot churn, blank screens, and probe infrastructure errors never classify
A still-changing screen, a blank screen, and any probe **infrastructure**
failure (capture/set-buffer/paste error mid-probe, or a frame that changed
without echoing — boot resumed under the probe) SHALL be treated as "not yet":
`AwaitReady` re-enters polling, bounded only by the deadline (`ErrNotReady` at
expiry, unchanged). `booting` therefore never returns; the wait returns only on
ready, parked, gone, or deadline. A sentinel left possibly-staged (the `C-u`
clear cannot restore the settled baseline within the bounded attempts) SHALL
fail closed with an operational error rather than reporting ready over a
polluted composer.

- **GIVEN** a pane whose screen changes between paste and probe capture
  (boot resumed)
- **WHEN** the probe finds no echo
- **THEN** the wait re-enters polling (no parked verdict), and a later settle
  may probe again (each probe `C-u`-cleans after itself)
- **AND GIVEN** persistent churn, **THEN** deadline expiry still yields
  `ErrNotReady`

#### R4: Gone detection via injected predicate
`ReadyOpts` SHALL gain an optional gone-classifier (an injected predicate over
the capture error, e.g. `IsGone func(error) bool` — inject stays
tmux-error-string-agnostic, matching the injected `State` reader pattern). When
a capture error satisfies it, `AwaitReady` SHALL return a gone-class error
instead of tolerating the error until deadline. The CLI supplies the
"can't find pane" predicate `muxReadPaneState` already uses.

- **GIVEN** the target pane is killed mid-wait
- **WHEN** the next readiness capture fails with tmux's can't-find-pane error
- **THEN** `AwaitReady` returns the gone error promptly (no spin until
  deadline)

### rk mux await: --ready report contract

#### R5: Report words, exit codes, stderr snippet, notify
`rk mux await --ready` SHALL map the classifier outcomes to the frozen report
contract (one report line on stdout, report word first; diagnostics on stderr;
toolkit exit codes):

| Outcome | stdout | exit | stderr |
|---------|--------|------|--------|
| state present | `ready %N (state)` | 0 | — |
| sentinel echoed | `ready %N (echo)` | 0 | — |
| parked | `parked %N` | 0 | the screen snippet |
| deadline (`--timeout` expiry) | `running` | 0 | — |
| pane died mid-wait | `gone` | 1 | diagnostics |

`ready %N (settled)` SHALL no longer be printed by any path. The indefinite
(`--timeout 0`) re-arm loop SHALL re-arm on `ErrNotReady` only — parked and
gone break it. `--notify` SHALL fire on every report including `parked` and
`gone` (default message `agent %N is <first report token>`), fail-silent per
the rk notify contract. Sentinel-unclear (R3) and other operational failures
exit 1 with stderr diagnostics and no report line.

- **GIVEN** a settled trust dialog
- **WHEN** `rk mux await --ready %5 --notify` runs
- **THEN** stdout is exactly `parked %5`, the snippet rides stderr, exit is 0,
  and the push says `agent %5 is parked`
- **AND GIVEN** a pane that dies mid-wait, **THEN** stdout is `gone`, exit 1

#### R6: Scope rule — pre-delivery panes only
The sentinel SHALL be typed only into pre-delivery panes (no agent state yet,
nothing delivered) — the same carve-out fab's dispatch gate uses. rk enforces
the state-absence half mechanically (R1's state-first ordering); the
nothing-delivered half SHALL be **documented** caller policy in the command
help and skill page: against a live delivered worker, readiness verbs are
illegal — use `await --until` / `capture`. The documented hook-less composition
stays `rk mux await --ready %5 && rk mux send --force %5 '<prompt>'`, with the
note that `parked` also exits 0, so `&&`-composers must branch on the report
word.

- **GIVEN** a pane whose hooks stamped agent state
- **WHEN** `--ready` runs
- **THEN** the wait returns `ready %N (state)` without ever typing a sentinel

### Surface: docs, help, standards

#### R7: Help text and skill pages updated, embedded copies synced
The `rk mux await` help (`Long`, `--ready` flag help, file-header comment) and
the skill pages (`docs/site/skill/mux.md` await section, `docs/site/skill.md`
report-word summary) SHALL teach the new contract — `(echo)` replacing
`(settled)`, `parked %N` + stderr snippet, the scope rule, the `&&`-composition
caveat — and `scripts/sync-skill.sh` SHALL be re-run so the embedded copies
under `app/backend/cmd/rk/skill/` stay byte-identical (asserted by
`skill_test.go`).

- **GIVEN** the change is complete
- **WHEN** `rk mux await -h` and `rk skill mux` render
- **THEN** both teach echo/parked and neither mentions `(settled)`

#### R8: Standards audit
The change SHALL be checked against the shll toolkit standards
(`shll standards`, per Constitution § Toolkit Standards) for the changed
surface: help-dump (the tree publishes the updated `Long`/usage — no
platform-conditional or hidden churn), Principle 9 (report line = stdout data;
snippet/diagnostics = stderr chatter honoring the sink convention), and the
report-word/exit-code conventions.

- **GIVEN** the audit runs against the HEAD build
- **WHEN** the `mux await` surface is checked
- **THEN** no standard governing help output or report contracts is violated

### Design Decisions

#### Parked is a typed error, not a Readiness value
**Decision**: `AwaitReady` surfaces parked as a typed sentinel error carrying
the snippet (alongside `ErrNotReady`), never as a `Readiness` value.
**Why**: `Readiness` means "safe to type into"; every consumer
(`DeliverWhenReady`, kickoff, riff) branches on error-vs-nil, so an error is
the shape that fails closed everywhere with zero signature churn.
**Rejected**: a `Parked` Readiness value (a naive consumer would deliver into
the wall); a third return value (churns every call site).
*Introduced by*: 260904-r7uk-await-ready-parked-classification

#### Sentinel is a fixed comment-safe constant pasted via the buffer primitives
**Decision**: the sentinel is a short fixed constant with a `#` prefix (e.g.
`#rk-ready-probe`), pasted through `SetBuffer`/`PasteBuffer` under a
caller-supplied buffer name in `ReadyOpts` (CLI passes a per-invocation
`rk-ready-<pid>`-style name), never submitted (no Enter anywhere on the path).
**Why**: `#` makes even a worst-case accidental submit into a cooked-mode shell
a no-op comment; novelty counting (not entropy) provides collision soundness;
the buffer-name parameter mirrors the engine's per-invocation-name lesson so a
probe can never clobber a concurrent daemon/CLI send buffer.
**Rejected**: random per-probe sentinel (novelty counting already handles
stale text; randomness only complicates test assertions); `send-keys -l`
literal typing (a second typing path outside the paste discipline).
*Introduced by*: 260904-r7uk-await-ready-parked-classification

#### Unverified sentinel clear fails closed
**Decision**: when `C-u` cannot restore the settled baseline within bounded
attempts after an echo, `AwaitReady` returns an operational error (not ready,
not parked).
**Why**: reporting ready over a composer still holding the sentinel corrupts
the very next delivery (`#rk-ready-probe<prompt>`); at a genuine live input box
the clear virtually always verifies, so the fail-closed branch is a
should-never-happen guard, matching the engine's `errComposerNotCleared`
posture.
**Rejected**: ready-with-stderr-warning (an automated composer like
`DeliverWhenReady` never reads the warning).
*Introduced by*: 260904-r7uk-await-ready-parked-classification

### Non-Goals

- No pane-mode (`#{pane_in_mode}`) guard on the sentinel path — that is Part A
  (gap 1); rebase before ship if A merges first.
- No new `rk skill` messaging topic page — Part C (gap 3) documents the channel
  matrix and depends on this change.
- No fab-kit changes — gate delegation is Part D, gated on B *releasing*.
- No wall auto-answering, no new send gate mode, no renames of shipped
  `rk mux` members (spec Non-goals).

## Tasks

### Phase 2: Core Implementation

- [x] T001 `app/backend/internal/inject/ready.go`: add `ReadyByEcho` (remove `ReadyBySettle`), the parked typed error with snippet, the gone predicate in `ReadyOpts` (+ sentinel buffer-name option), and the sentinel probe (paste → novelty check → `C-u` clear with baseline verification → echo/parked/not-yet classification per R1–R4); update `AwaitReady`/`DeliverWhenReady` doc comments (the settle caveat is now the mechanism it describes) <!-- R1 R2 R3 R4 --> <!-- rework: capture-depth mismatch (settle 50 vs probe/clear 40) breaks echo/parked in production; sentinel cleanup gap on capture errors; dedupe clearSentinel vs clearComposer -->
- [x] T002 `app/backend/internal/inject/ready_test.go`: cover echo→`ReadyByEcho` with `C-u` cleanup asserted, stale-sentinel novelty floor, parked with snippet, state-present short-circuit (no paste recorded), churn-under-probe re-polls to `ErrNotReady`, blank screens never probe, capture-error tolerance unchanged, gone predicate fires, unverified-clear fails closed, `DeliverWhenReady` parked → no send <!-- R1 R2 R3 R4 --> <!-- rework: capture-depth mismatch (settle 50 vs probe/clear 40) breaks echo/parked in production; sentinel cleanup gap on capture errors; dedupe clearSentinel vs clearComposer -->
- [x] T003 `app/backend/cmd/rk/mux_await.go`: map outcomes per R5 (`(echo)` report, `parked %N` + stderr snippet exit 0, `gone` exit 1, notify on every report), wire the gone predicate + sentinel buffer name into `muxAwaitReadyFn`'s `ReadyOpts`, keep the `--timeout 0` re-arm on `ErrNotReady` only; update `Long`, `--ready` flag help, and the file-header comment per R6 (scope rule, `&&`-composition caveat) <!-- R5 R6 -->
- [x] T004 `app/backend/cmd/rk/mux_await_test.go`: update the `--ready` report table (`(state)`/`(echo)`), add parked (stdout/stderr/exit-0/notify) and gone (exit-1) cases, keep the timeout `running` + notify case green <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T005 Sweep the settle-wording consumers: `app/backend/cmd/rk/agent_kickoff.go`, `tutorial.go`, `operator.go`, `app/backend/internal/riff/deliver.go` — comments/behavior notes that say "settled screen" now describe the echo/parked classifier; verify the kickoff/riff degrade paths compile and their tests pass against the parked error (no behavioral special-casing expected) <!-- R2 -->
- [x] T006 `docs/site/skill/mux.md` + `docs/site/skill.md`: rewrite the `--ready` example line, prose, and report-word summaries per R5–R6; run `scripts/sync-skill.sh`; confirm `skill_test.go` byte-identity <!-- R7 -->

### Phase 4: Polish

- [x] T007 Standards audit: run `shll standards`, review the entries governing help output / report words / CLI surface against the changed `rk mux await` surface; record the result (fix anything it flags) <!-- R8 -->
- [x] T008 Verification gates: `cd app/backend && go test ./internal/inject/... ./cmd/rk/...`, then the full backend `go test ./...` <!-- R1 R5 -->

## Execution Order

- T001 blocks T002–T005 (types/errors referenced everywhere)
- T003 blocks T004
- T006–T007 independent after T003; T008 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: A settled hook-less pane with a live input box classifies `ReadyByEcho` via novelty-counted sentinel echo, and no code path returns `ReadyBySettle` (the identifier is gone) — rework verified: settle, probe, and clear all capture at the one `readyCaptureLines` depth (`ready.go:152,242,252` → `clearToBaseline` at `inject.go:475`), pinned by `TestAwaitReadyDeepScrollbackEchoClassifies` with the depth-aware fake (`inject_test.go` `tailLines`); `ReadyBySettle` has no reference outside hydrate-scope memory
- [x] A-002 R2: A settled non-echoing pane returns the parked typed error carrying a bounded screen snippet, immediately (not at deadline) — rework verified: the post-`C-u` capture compares against the settled frame at the same depth (`ready.go:263-272`), pinned by `TestAwaitReadyDeepScrollbackParked`; immediacy pinned by `TestAwaitReadyParkedCarriesSnippet`'s exact capture count (settle + probe + cleanup, no deadline spin)
- [x] A-003 R4: A killed pane surfaces the gone error through the injected predicate instead of spinning to deadline — `TestAwaitReadyGonePredicateFires` / `TestAwaitReadyGoneMidProbe`; CLI wires the "can't find pane" predicate (`mux_await.go:296`)
- [x] A-004 R5: `rk mux await --ready` prints exactly one of `ready %N (state)` / `ready %N (echo)` / `parked %N` / `running` / `gone` with the R5 exit codes, the parked snippet on stderr, and `--notify` firing on every report — `TestMuxAwaitReadyReports`, `TestMuxAwaitReadyParked` (stdout/stderr/exit-0/notify), `TestMuxAwaitReadyGone` (exit 1), `TestMuxAwaitReadyTimeoutReportsRunning`

### Behavioral Correctness

- [x] A-005 R1: The sentinel is never typed when agent state is present (state checked first each poll), and never submitted (no Enter on any probe path) — state check precedes capture in the poll loop (`ready.go:140-152`); `TestAwaitReadyStateShortCircuitsProbe` asserts zero `set-buffer` calls and tests assert `enterCalled == false` on every probe path
- [x] A-006 R3: Boot churn, blank screens, probe infra errors, and a frame that changed without echo all re-enter polling; deadline expiry still maps to `running` (exit 0), and the `--timeout 0` loop re-arms on `ErrNotReady` only — `TestAwaitReadyChurnUnderProbeRePolls`, `TestAwaitReadyBlankCapturesNeverProbe`, `TestAwaitReadyCaptureErrorsTolerated`, `TestAwaitReadyDeadlineErrNotReady`; re-arm condition at `mux_await.go:302-307` (one gap: a probe whose captures fail AFTER a successful paste returns `probeNotYet` without the cleanup `C-u` — should-fix 1)
- [x] A-007 R2: `DeliverWhenReady` returns the parked error without attempting the send; kickoff (tutorial/operator) and riff degrade paths behave as before on error — `TestDeliverWhenReadyParkedSkipsSend` asserts only the sentinel is ever staged; full `go test ./...` green

### Removal Verification

- [x] A-008 R1: No `(settled)` report remains in code, tests, help text, or skill pages — `grep -rn "ReadyBySettle\|(settled)" app/backend docs/site` returns only mechanism-describing prose ("a settled screen is classified by…") and unrelated matches; remaining `settled` mentions in `docs/memory/` are hydrate-stage scope (should-fix 3)

### Scenario Coverage

- [x] A-009 R1: Tests cover the stale-sentinel novelty floor (pre-existing sentinel text on screen does not satisfy the probe) — `TestAwaitReadyStaleSentinelNeedsNovelty` (count 2 > baseline 1)
- [x] A-010 R3: A test proves the unverified `C-u` clear fails closed (no ready report over a polluted composer) — `TestAwaitReadyUnverifiedClearFailsClosed` asserts `errComposerNotCleared` and exactly `ClearAttempts` `C-u`s

### Edge Cases & Error Handling

- [x] A-011 R5: Operational failures (sentinel-unclear, tmux errors outside the gone class) exit 1 with stderr diagnostics and no stdout report line — `runMuxAwaitReady`'s default branch returns the error before any report print (`mux_await.go:383-385`); gone path verified by `TestMuxAwaitReadyGone`

### Code Quality

- [x] A-012 Pattern consistency: new inject code follows the package's seam conventions (injected readers/predicates, typed sentinel errors, ctx-aware sleeps); CLI code follows the `muxAwaitReadyFn`/sink conventions — `IsGone` mirrors the injected `State` reader; `ParkedError`/`ErrParked`/`ErrGone` follow the `ErrNotReady` sentinel shape; probe pacing uses `sleepCtx`
- [x] A-013 No unnecessary duplication: the probe reuses `CountOccurrences`/`readySnippet`/paste primitives rather than re-implementing them — verified; one partial exception: `clearSentinel` re-implements `clearComposer`'s loop to add the `isGone` classification (should-fix 2)
- [x] A-014 Constitution I: every new subprocess path stays `exec.CommandContext` argv-slice bounded (per-read timeouts via the existing `awaitReadyTmux`/`boundedPaneAgentState` wrappers) — new `awaitReadyTmux.SetBuffer`/`PasteBuffer`/`SendKeys` overrides each wrap the call in `awaitCmdTimeout`
- [x] A-015 Tests: new behavior is covered in both `internal/inject` and `cmd/rk` layers; no e2e surface touched (backend-only change) — `ready_test.go` +10 cases, `mux_await_test.go` +2 cases; `go test ./...` green

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None outstanding — `ReadyBySettle` and the `ready %N (settled)` report word were the redundancy this change created, and apply already removed both in-diff (verified: no `ReadyBySettle` reference remains in `app/backend`; no `(settled)` report word in code, help, or skill pages). No other existing file, function, branch, or config is made unused by this change.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Sentinel constant is `#rk-ready-probe` (comment-safe `#` prefix), fixed not random | Worst-case accidental submit into a shell is a comment; novelty counting already provides collision soundness | S:60 R:85 A:80 D:70 |
| 2 | Confident | Gone detection via an injected `IsGone func(error) bool` predicate in `ReadyOpts` rather than inject learning tmux error strings | Mirrors the injected `State` reader pattern; keeps inject tmux-agnostic and testable | S:65 R:80 A:85 D:75 |
| 3 | Confident | Probe pacing reuses the engine's `ProbeSettle`/`ProbeGap`/`ProbeAttempts` constants; settle trigger stays at 2 identical polls | One tuning vocabulary for all echo probes; each probe cleans up after itself so a re-settle re-probe is bounded by the deadline | S:55 R:80 A:75 D:65 |
| 4 | Confident | `gone` report stays bare (no `%N`) in single-target `--ready`, matching the family's single-target convention; `parked %N` carries the pane per the spec's explicit form | Spec writes `parked %N` explicitly but lists bare `gone`; single-target await prints bare `gone` today | S:60 R:85 A:75 D:70 |

4 assumptions (0 certain, 4 confident, 0 tentative).
