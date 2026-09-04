# Plan: Mux Send Delivery Hardening (Agent-Messaging Part A)

**Change**: 260904-kppn-mux-send-delivery-hardening
**Intake**: `intake.md`

## Requirements

### internal/tmux: Pane-mode primitives

#### R1: Pane-mode probe, cancel, and single-decision clear
`internal/tmux` SHALL provide three context-bound, argv-slice primitives
(Constitution §I; 5s-family timeouts via the caller's ctx like the other `*Ctx`
pane primitives): `PaneInModeCtx(ctx, paneID, server) (bool, error)` reading
`#{pane_in_mode}` via `display-message -pt <pane>`; `CancelPaneModeCtx(ctx,
paneID, server) error` issuing `send-keys -t <pane> -X cancel` (`-X` is a
send-keys flag, not a key name — `SendKeysToPane(keys...)` cannot express it);
and `ClearPaneModeCtx(ctx, paneID, server) error` — the **single decision
site**: probe, and cancel only when the pane is in a mode. Every rk consumer
reaches the guard through `ClearPaneModeCtx` (directly or via the `inject.Tmux`
seam) — never a divergent probe+cancel copy.

- **GIVEN** a pane scrolled into copy-mode (`pane_in_mode` = 1)
- **WHEN** `ClearPaneModeCtx` runs
- **THEN** the mode is cancelled (a subsequent probe reads 0) and nil is returned
- **AND GIVEN** a pane not in any mode, **THEN** no `send-keys` subprocess runs
  and nil is returned
- **AND GIVEN** a missing pane, **THEN** the tmux error is returned

### internal/inject: Engine-level guard

#### R2: Every engine delivery path clears pane mode before touching the pane
The `inject.Tmux` interface SHALL gain one method — `ClearPaneMode(ctx, paneID,
server) error` — and `Engine.Send`, `Engine.SendRaw`, and `Engine.PressEnter`
SHALL invoke it as the first pane-touching step **inside the per-pane lock and
BEFORE the baseline capture** (a mode cancel repaints the frame; a baseline
captured before the cancel would be the copy-mode screen, corrupting the echo
probe's floor and recovery's baseline-equality check). A guard failure is a
pre-paste wrapped error (nothing was delivered; the existing plain-error path —
the daemon's 500, the CLI's exit 1). This closes the single-engine invariant's
last gap: the daemon routes (compose-send `submit`/`insert-line`/`raw`/`enter`,
operator actuation, selection broadcast) and `rk mux send` text sends all
inherit the guard through the one engine, and Part B's sentinel probe consumes
the same seam.

- **GIVEN** a copy-mode pane and an `Engine.Send`
- **WHEN** the sequence runs
- **THEN** `ClearPaneMode` executes before the baseline `CapturePane`, the paste
  lands in the live composer, and the probe compares against the post-cancel frame
- **AND GIVEN** a `ClearPaneMode` error, **THEN** the send aborts before
  set-buffer with the wrapped error (no paste, no Enter)
- **AND GIVEN** `Engine.SendRaw` or `Engine.PressEnter` on a copy-mode pane,
  **THEN** the same guard runs first under the same per-pane lock

### cmd/rk: CLI delivery paths

#### R3: `rk mux send --key` runs the same guard
The `--key` branch of `runMuxSend` (a post-gate raw `SendKeysToPane` that
bypasses the engine) SHALL run the pane-mode guard (`tmux.ClearPaneModeCtx`
through a testable seam var) before sending its key names. The text path needs
no CLI-side change beyond the `cliInjectTmux` adapter implementing
`ClearPaneMode` (delegating to `tmux.ClearPaneModeCtx`).

- **GIVEN** `rk mux send %5 --key Enter` against a copy-mode pane
- **WHEN** the send runs
- **THEN** the mode is cancelled before the Enter key is sent (the key reaches
  the foreground process, not copy-mode bindings), and the report stays `sent %5`
- **AND GIVEN** a guard failure, **THEN** exit 1 with the wrapped error and no
  key is sent

#### R4: Unknown-state plain sends name a non-shell foreground
The agent-state gate's read SHALL move from `tmux.PaneAgentState` to the
superset `tmux.PaneFactsCtx` it already delegates to; `PaneFacts` SHALL gain a
`Command` field (the quadruple read already fetches `#{pane_current_command}`
for the reconciler — zero extra round trips), and the shell predicate SHALL be
exported (`tmux.IsShellCommand`, over the existing `shellCommands` set — never a
duplicate list). When the reconciled state is unknown AND the foreground command
is not a plain shell, the warning names it:

```
warning: pane %5 has no readable agent state — foreground process `htop` running; sending ungated
```

A shell foreground keeps today's warning verbatim (`warning: pane %5 has no
readable agent state — sending ungated`). Behavior stays warn-and-send — no new
gate state (a non-shell foreground may be a hook-less agent: the documented
`await --ready && send --force` case). `--force` sends remain warning-free (they
skip the state read) but ARE pane-mode-guarded (guard = delivery property, gate
= policy property). Warnings ride stderr via `sink.Notef`; the one-line stdout
report contract and report words are unchanged (frozen per the spec).

- **GIVEN** an uninstrumented pane running `htop` and a plain `rk mux send`
- **WHEN** the gate reads unknown state
- **THEN** stderr carries the foreground-naming warning and the send proceeds
- **AND GIVEN** an uninstrumented `zsh` pane, **THEN** the warning is today's
  text with no foreground clause
- **AND GIVEN** `--force`, **THEN** no state read and no warning, and the
  delivery still runs the pane-mode guard

### api: Daemon adapter parity

#### R5: The daemon's inject seam implements the guard
`agentSendTmux` (api/send.go) SHALL implement `ClearPaneMode` by delegating to a
new `TmuxOps` method (api/router.go), with `prodTmuxOps` backing it via
`tmux.ClearPaneModeCtx` and `mockTmuxOps` extended so the existing 400/404/409/
500/200 matrix tests still drive the handlers against a fake — plus coverage
that the guard is invoked ahead of the baseline capture on the `/send` route.

- **GIVEN** a `POST /api/windows/{id}/send` in any mode
- **WHEN** the injection sequence runs
- **THEN** the guard executes against the resolved pane before the baseline
  capture, through the same engine step as the CLI

### Surface: help, skill page, standards

#### R6: The changed surface is documented and standards-audited
`rk mux send`'s help (Long) SHALL document the pane-mode guard and the
foreground-naming warning. `docs/site/skill/mux.md` (the `rk skill` messaging
topic page) SHALL document both: deliveries clear an active copy-mode first
(callers need no manual `copy-mode -q`/cancel before sending), and the
unknown-state gate row's "warn + send" names a non-shell foreground. The change
SHALL be audited against `shll standards` for the governing standards
(`principles` — stderr/quiet posture of the new warning; `help-dump` — contract
shape) and the `cmd/rk/help_dump_test.go` mux assertions verified (member set
unchanged at 12 — a no-diff outcome is recorded, not forced).

- **GIVEN** the shipped change
- **WHEN** `rk mux send --help` and `rk skill mux` render
- **THEN** both name the pane-mode guard and the foreground-naming warning
- **AND** the standards audit outcome is recorded in this plan's `## Notes`

### Non-Goals

- Gap 2 (`parked` sentinel classification in `AwaitReady`) and gap 3 (`rk mux -h`
  help grouping) — Parts B and C of the spec's execution plan.
- No new gate state, no report-word changes, no auto-answering of walls.
- No re-probe loop after the cancel — a pane re-entering a mode mid-delivery is
  tmux's inherent race, accepted like the cross-process paste race.
- fab-kit's own senders (Part D territory; fab already carries its guard).

### Design Decisions

#### One interface method backed by one tmux decision site
**Decision**: `inject.Tmux` grows exactly one method (`ClearPaneMode`); the
probe-then-cancel decision lives once in `tmux.ClearPaneModeCtx`, which every
implementation (CLI adapter, daemon TmuxOps, the `--key` seam) delegates to.
**Why**: the guard is one decision — "is the pane in a mode? then cancel" —
and the spec's single-engine invariant demands no divergent copies; a
one-method seam keeps both adapters one-liners and gives Part B's sentinel the
same consumable step.
**Rejected**: two primitive methods (probe + cancel) on `inject.Tmux` with the
decision in the engine — widens the interface and forces every mock/adapter to
carry two passthroughs for no added testability; per-call-site probe+cancel
copies — the drift hazard the invariant exists to prevent.
*Introduced by*: 260904-kppn-mux-send-delivery-hardening

#### Guard runs inside the per-pane lock, before the baseline capture
**Decision**: the guard is the first step of each engine sequence, after taking
the pane lock and before the baseline `CapturePane`.
**Why**: cancelling copy-mode repaints the pane — a baseline captured first
would be the scrolled copy-mode frame, poisoning the novelty floor and
recovery's baseline-equality clear; inside the lock, a concurrent send cannot
interleave between cancel and paste.
**Rejected**: guarding outside the lock in each caller (reintroduces the
interleave window and per-caller copies); guarding after baseline (wrong frame).
*Introduced by*: 260904-kppn-mux-send-delivery-hardening

#### Guard failure fails the send; cancel is unconditional-once
**Decision**: a probe/cancel tmux failure aborts the delivery as a pre-paste
operational error; an in-mode pane gets exactly one cancel, no re-probe loop.
**Why**: consistent with every other pre-paste failure (nothing was delivered,
retry is safe); fail-open would silently restore the eaten-keys hazard the
guard exists to close.
**Rejected**: warn-and-proceed on probe failure (silent hazard); cancel-verify
loops (tmux's mode re-entry race is inherent and already accepted).
*Introduced by*: 260904-kppn-mux-send-delivery-hardening

## Tasks

### Phase 1: Substrate primitives

- [x] T001 Add `PaneInModeCtx`, `CancelPaneModeCtx`, `ClearPaneModeCtx` to `app/backend/internal/tmux/pane_target.go` (+ tests in `pane_target_test.go` against the isolated test server: enter copy-mode, probe true, clear cancels, no-mode no-op, missing-pane error) <!-- R1 -->
- [x] T002 [P] Add `Command` to `PaneFacts` (populate from the existing quadruple read in `parsePaneFacts`) and export `IsShellCommand` over `shellCommands` in `app/backend/internal/tmux/tmux.go` (+ tests) <!-- R4 -->

### Phase 2: Engine guard

- [x] T003 Add `ClearPaneMode` to the `inject.Tmux` interface and call it first inside the per-pane lock in `Engine.Send`, `Engine.SendRaw`, `Engine.PressEnter` (`app/backend/internal/inject/inject.go`); extend the test mock and add order/error-propagation tests (guard before baseline capture; guard error aborts pre-paste) in `inject_test.go` <!-- R2 -->

### Phase 3: Consumers

- [x] T004 Implement `cliInjectTmux.ClearPaneMode` and guard the `--key` branch via a `muxSendClearModeFn` seam in `app/backend/cmd/rk/mux_send.go` (+ tests: key send after cancel, guard-failure exit 1) <!-- R3 -->
- [x] T005 Switch the gate read to `PaneFactsCtx` and add the foreground-naming warning (shell vs non-shell vs instrumented cases) in `app/backend/cmd/rk/mux_send.go` (+ warning-text tests in `mux_send_test.go`) <!-- R4 -->
- [x] T006 Add `ClearPaneMode` to `TmuxOps` (`app/backend/api/router.go`), implement in `prodTmuxOps` and `agentSendTmux` (`app/backend/api/send.go`), extend `mockTmuxOps` + handler tests (guard invoked before baseline on `/send`) <!-- R5 -->

### Phase 4: Surface & audit

- [x] T007 Update `rk mux send` help text (Long) for the guard + warning; run `go test ./cmd/rk/` and confirm the help-dump mux assertions (12 members) — record the outcome <!-- R6 -->
- [x] T008 [P] Update `docs/site/skill/mux.md`: delivery hardening note (pane-mode guard on send/--key; no manual copy-mode cancel needed) + gate-matrix unknown-row foreground naming <!-- R6 -->
- [x] T009 Audit the changed surface against `shll standards principles` and `shll standards help-dump`; record PASS/actions in `## Notes` <!-- R6 -->

## Execution Order

- T001, T002 unblock everything; T003 needs T001; T004/T005/T006 need T003 (and T005 needs T002); Phase 4 last. T002∥T001, T008∥T007.

## Acceptance

### Functional Completeness

- [x] A-001 R1: The three pane-mode primitives exist, are context-bound argv slices, and `ClearPaneModeCtx` cancels only when `pane_in_mode` reads 1
- [x] A-002 R2: `Engine.Send`/`SendRaw`/`PressEnter` each run `ClearPaneMode` first, inside the per-pane lock, before any capture/paste/Enter
- [x] A-003 R3: The `--key` branch runs the guard before `SendKeysToPane`
- [x] A-004 R4: Unknown-state plain sends name a non-shell foreground; shell foregrounds keep today's warning; `--force` skips the warning but not the guard
- [x] A-005 R5: `TmuxOps`/`prodTmuxOps`/`agentSendTmux`/`mockTmuxOps` all carry the guard method; daemon routes inherit it

### Behavioral Correctness

- [x] A-006 R2: A copy-mode pane's baseline capture happens AFTER the cancel (probe floor and recovery baseline reflect the live frame)
- [x] A-007 R2: Guard tmux failure aborts pre-paste with a wrapped error (CLI exit 1 / daemon 500) — never a blind delivery
- [x] A-008 R4: The stdout report words and one-line contract are byte-unchanged; warnings ride stderr only

### Scenario Coverage

- [x] A-009 R1: tmux-backed test proves copy-mode entry → clear → probe reads 0
- [x] A-010 R2: Engine test asserts call order (ClearPaneMode < baseline CapturePane) and error propagation on all three engine paths
- [x] A-011 R4: Warning-text tests cover non-shell (`htop`), shell (`zsh`), and instrumented (no warning) cases

### Edge Cases & Error Handling

- [x] A-012 R1: `ClearPaneModeCtx` on a pane not in a mode issues no cancel subprocess; a missing pane returns the tmux error
- [x] A-013 R4: An empty `pane_current_command` (unparseable facts) degrades to today's plain warning — never a panic or an empty-name clause

### Code Quality

- [x] A-014 Pattern consistency: primitives follow the `*Ctx` naming/timeout conventions; seams follow the `muxSend*Fn` var pattern; comments state constraints, never narration or change IDs
- [x] A-015 No unnecessary duplication: `shellCommands` reused via one exported predicate; no second probe+cancel copy anywhere
- [x] A-016 Tests cover the added behavior (new-feature test requirement); all subprocess calls are `exec.CommandContext` argv slices with timeouts

### Security

- [x] A-017 R1: No shell strings — `-X cancel` and the probe are discrete argv elements; pane IDs pass through the existing validated target resolution

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- **Help-dump check (T007, apply-time)**: `go test ./cmd/rk/` green incl. the
  help-dump assertions; the mux member set is unchanged at 12
  (adopt/await/capture/guard/init-conf/kill/new/panes/process/reap/send/snapshot).
  The dump captures `cmd.UsageString()` (usage + flags), not `Long` — usage and
  flags are untouched, so the mux subtree's dump is byte-unchanged. No
  help-dump diff was needed (the recorded no-diff outcome per assumption 5).
- **Standards audit (T009, apply-time, against `shll standards` HEAD text)**:
  - `principles` — PASS. P2 (stdout=data/stderr=diagnostics): the new
    foreground-naming warning rides stderr via `sink.Notef`; the one-line stdout
    report contract and report words are byte-unchanged (pinned by
    `TestMuxSendGateMatrix`/`TestMuxSendUnknownStateWarning`). P9 (bounded,
    high-signal): the warning is one bounded line, suppressible by `--quiet`
    exactly as today's unknown-state warning (`TestMuxSendQuietKeepsReport`).
    P4: a guard failure exits 1 naming what failed (`clear pane mode: …`).
  - `help-dump` — PASS. `rk help-dump` (HEAD build) exits 0, valid JSON,
    stderr empty, no `captured_at`; the mux subtree keeps its 12 members and
    unchanged usage/flags — the contract surface is untouched.

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. The replaced gate seam (`muxSendAgentStateFn`) was removed in the same diff, and `tmux.PaneAgentState` retains live callers (`mux_kill.go`, `mux_await.go`, `operator.go`, `tutorial.go`, `internal/riff`).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | One `ClearPaneMode` interface method (decision in `tmux.ClearPaneModeCtx`) rather than probe+cancel as separate interface methods | Single decision site per the single-engine invariant; adapters stay one-liners | S:80 R:75 A:85 D:75 |
| 2 | Confident | Guard placement: inside per-pane lock, before baseline capture, on all three engine paths | Baseline poisoning otherwise (cancel repaints); lock prevents interleave | S:75 R:75 A:85 D:80 |
| 3 | Confident | Primitives live in `pane_target.go` beside the other pane-scoped reads; predicate export named `IsShellCommand` | File already owns pane-scoped fact reads; export mirrors the unexported name | S:65 R:90 A:80 D:75 |
| 4 | Confident | `--key` guard via a new `muxSendClearModeFn` seam var (test-mockable), delegating to `tmux.ClearPaneModeCtx` | The `muxSend*Fn` seam pattern is the file's established test convention | S:70 R:90 A:85 D:80 |
| 5 | Certain | Help-dump structural assertions unchanged (no new mux member); outcome recorded, no golden edit forced | `help_dump_test.go` pins names/counts only (verified in-session) | S:85 R:90 A:90 D:90 |

5 assumptions (1 certain, 4 confident, 0 tentative).
