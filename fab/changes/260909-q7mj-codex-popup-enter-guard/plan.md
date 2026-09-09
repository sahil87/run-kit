# Plan: Codex Popup Enter Guard

**Change**: 260909-q7mj-codex-popup-enter-guard
**Intake**: `intake.md`

## Requirements

### Inject Engine: Composer-Popup Enter Guard

#### R1: Popup-marker table with novelty detection
`internal/inject` SHALL define a package-level table of known composer-popup markers, initially one codex entry (substring `Press enter to insert` — codex 0.153.4's skill-autocomplete footer), plus a pure detection helper that reports whether any marker NEWLY appeared in a post-paste frame relative to a pre-paste floor frame. Detection MUST be strict-increase (`count(frame) > count(floor)`) and MUST run through the existing `CountOccurrences`/`stripForProbe` normalization (exact-substring arms only — `collapsible=false`, `imageish=false`), so a stale marker copy in scrollback is a floor to beat, never a trigger.

- **GIVEN** a pre-paste baseline with zero marker occurrences and an echo-probe frame showing the codex popup footer
- **WHEN** the detection helper compares the two frames
- **THEN** it reports a popup

- **GIVEN** a baseline that already contains the marker text (stale copy in scrollback) and an echo-probe frame with the same count
- **WHEN** the helper compares the two frames
- **THEN** it reports no popup

#### R2: Guard in `Engine.Send`'s submit path
When `submit == true`, between the successful echo probe and the existing submit `SendEnter` in `Engine.Send` (app/backend/internal/inject/inject.go), the engine SHALL run the popup guard: if R1's helper detects a new popup in the probe's winning capture (`preFrame`) vs the pre-paste `baseline`, send one extra Enter (`t.SendEnter`) to consume the popup, wait one `ProbeSettle` (ctx-aware via `sleepCtx`), and re-capture a fresh `preFrame` (`t.CapturePane`, `ProbeCaptureLines`) so `verifySubmit` baselines on the post-popup frame. The no-popup path MUST be byte-identical in call sequence to today (the guard reads two strings already in hand — zero added captures, waits, or sends). The guard MUST NOT run when `submit == false`. Guard-internal failures (a refused popup-consuming `SendEnter`, a failed re-capture, ctx cancellation in the settle) SHALL classify as `StagedSendFailure` — the paste landed, no submit Enter was sent yet, matching the existing post-paste infrastructure-failure discipline.

- **GIVEN** a codex pane where pasting a bare skill token (`$fab-operator`) opened the skill-autocomplete popup, so the probe's `preFrame` shows the popup footer and the baseline does not
- **WHEN** `Send` proceeds past the successful probe with `submit == true`
- **THEN** exactly one extra Enter is sent before the submit Enter, a fresh `preFrame` is captured after one `ProbeSettle`, and `verifySubmit` observes against the fresh frame
- **AND** keystroke ordering guarantees Enter #1 is processed as popup-insert and Enter #2 as submit (live-verified: codex 0.153.4)

- **GIVEN** any send whose probe frame shows no new marker occurrence (every claude send; codex prose or token-with-args sends)
- **WHEN** `Send` proceeds past the probe
- **THEN** the tmux call sequence is byte-identical to the pre-guard engine

- **GIVEN** `submit == false` (insert-without-submit) with the popup open
- **WHEN** the probe succeeds
- **THEN** `Send` returns with the text staged and the popup untouched — no Enter of any kind

- **GIVEN** the marker fires without a real popup (false positive)
- **WHEN** the guard's extra Enter lands on a popup-less composer holding the staged text
- **THEN** that Enter submits, the follow-up submit Enter no-ops on the empty composer (live-verified fact 4), and the outcome is one correct submission

#### R3: Guard on the `retrySubmit` recovery path
`retrySubmit` (app/backend/internal/inject/inject.go) SHALL run the same guard between its re-probe success and its `SendEnter`, using the retry's own `clearedFrame` as the marker floor and the retry's `preFrame` as the post-paste frame, with the same settle + fresh-`preFrame` re-capture before its `verifySubmit` — the recovery re-paste can reopen the popup.

- **GIVEN** a recovery cycle whose re-paste reopens the codex popup (`clearedFrame` has no marker, the retry probe frame does)
- **WHEN** `retrySubmit` proceeds past its probe
- **THEN** the popup is consumed by one extra Enter and the retry's observation baselines on a fresh post-popup frame

### Non-Goals

- No composition changes (`RenderSkillRef`, positional claude task injection, kickoff constants) — the claude path stays provably byte-identical.
- No caller changes (`api/send.go`, `api/operator.go`, `internal/riff`, `internal/cron`) — the guard sits in the one shared engine.
- No fix for the codex hooks-trust wall (screenshot 1 of the field report) — that is designed parked-wall behavior owned by the readiness path.
- No markers for other TUIs (gemini/kimi/opencode popups) — the table is extensible; only the codex entry is live-verified.

### Design Decisions

#### Evidence-gated popup guard over composition-side trailing space
**Decision**: Consume the codex skill-autocomplete popup inside `inject.Engine.Send`'s submit path (and `retrySubmit`), gated on strict-increase novelty of a popup marker in the probe frame vs the pre-paste floor: one extra Enter, one `ProbeSettle`, one fresh `preFrame` re-capture, then the unchanged Enter + `verifySubmit`.
**Why**: The popup falsely satisfies `verifySubmit`'s changed-frame no-claim branch (the popup *closing* is the frame change), so the engine reports success while the text sits staged — the recovery ladder never fires. The engine is the single seam every typed send crosses (riff typed delivery, operator/tutorial kickoffs, cron respawner, agent-send route), detection is free (both frames already in hand — the no-popup path adds zero calls), a false positive is benign (the extra Enter submits; the follow-up Enter no-ops on an empty composer — live-verified), and a false negative degrades to today's behavior.
**Rejected**: Appending a trailing space to bare-skill-shaped tasks at composition (verified to suppress the popup) — must be replicated at every kickoff call site, misses operator→codex sends through the agent-send route, and touches composition where the claude byte-identity pins live.
*Introduced by*: 260909-q7mj-codex-popup-enter-guard

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add `composerPopupMarkers` table (one codex entry, `Press enter to insert`) and the pure strict-increase detection helper (reusing `CountOccurrences` with `collapsible=false, imageish=false`) in app/backend/internal/inject/inject.go <!-- R1 -->
- [x] T002 Wire the guard into `Engine.Send`'s submit path between `probeEcho` success and `SendEnter`: detect via T001's helper against `baseline`, on hit send Enter → `sleepCtx(ctx, ProbeSettle)` → re-capture fresh `preFrame` (`ProbeCaptureLines`); classify guard-internal failures as `StagedSendFailure`; no-popup path byte-identical; `submit == false` untouched (app/backend/internal/inject/inject.go) <!-- R2 -->
- [x] T003 Wire the same guard into `retrySubmit` between its `probeEcho` success and its `SendEnter`, floor = `clearedFrame` (app/backend/internal/inject/inject.go) <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Seamed-Tmux unit tests in app/backend/internal/inject/inject_test.go: popup present → exactly one extra Enter + one fresh re-capture before the submit Enter, observation against the fresh frame; popup absent → call sequence byte-identical to today; marker already in baseline (stale copy) → guard does not fire; `submit=false` with popup → no Enter; retry-path reopened popup → consumed on the retry; then run `cd app/backend && go test ./internal/inject/...` followed by `go test ./...` <!-- R2 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `composerPopupMarkers` exists with the codex entry and the detection helper is strict-increase over `stripForProbe`-normalized frames (stale-copy baseline case covered by a unit test)
- [x] A-002 R2: a popup-present submit send issues exactly one extra Enter and one fresh `preFrame` re-capture (after one `ProbeSettle`) before the submit Enter, and `verifySubmit` observes against the fresh frame
- [x] A-003 R3: a popup reopened by the recovery re-paste is consumed on the retry path with `clearedFrame` as the floor

### Behavioral Correctness

- [x] A-004 R2: the no-popup path's tmux call sequence is byte-identical to the pre-guard engine (unit test asserts the recorded call list), and the guard never runs when `submit == false`
- [x] A-005 R2: guard-internal failures classify as `StagedSendFailure` — the `ProbeFailure` / `StagedSendFailure` / `SubmitUnverified` taxonomy stays distinct

### Scenario Coverage

- [x] A-006 R2: unit tests cover popup-present, popup-absent, stale-marker-in-baseline, and `submit=false` scenarios; R3's retry-reopen scenario has its own test

### Edge Cases & Error Handling

- [x] A-007 R2: ctx cancellation during the guard's settle propagates as the injection error (never a false `ProbeFailure`), riding the existing `sleepCtx` contract

### Code Quality

- [x] A-008 Pattern consistency: the helper and guard follow the engine's house style — single `stripForProbe` normalization site, strict-increase novelty, package-var timing constants, sentinel error types
- [x] A-009 No unnecessary duplication: detection reuses `CountOccurrences`/`stripForProbe`/`sleepCtx`; no parallel normalization or counting path is introduced
- [x] A-010 Tests included: new behavior is covered by unit tests in the existing seamed-Tmux pattern (code-quality principle: new features and bug fixes MUST include tests)
- [x] A-011 Comment discipline: new comments state constraints the code can't show (why the marker is empirical, why strict-increase, why the fresh re-capture) — no narration, no change-ID citations

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | One `ProbeSettle` (80ms, ctx-aware) between the popup-consuming Enter and the fresh re-capture | Keystroke ordering makes correctness capture-independent (pty processes Enter #1 before Enter #2); the settle only improves observation fidelity — intake assumption 6 resolved | S:70 R:90 A:85 D:80 |
| 2 | Confident | Guard-internal failures → `StagedSendFailure` (both the popup Enter and the re-capture; ctx errors propagate via `sleepCtx`) | Matches the existing step-6 submit-`SendEnter` → `StagedSendFailure` mapping and the post-paste infra-failure discipline — intake assumption 7 resolved | S:70 R:85 A:85 D:80 |
| 3 | Certain | Detection reuses `CountOccurrences(frame, marker, false, false)` — exact-substring arms only, marker stored in display form | `CountOccurrences` strips both needle and capture through the one `stripForProbe` site; chip arms are shape-gated signals for pastes, not markers | S:85 R:90 A:95 D:90 |

3 assumptions (1 certain, 2 confident).
