# Intake: Codex Popup Enter Guard

**Change**: 260909-q7mj-codex-popup-enter-guard
**Created**: 2026-09-09

## Origin

Promptless dispatch via `/fab-proceed`, synthesized from a live diagnosis conversation (pane experiment against codex 0.153.4, tmux 3.7c). The conversation is the authoritative problem statement and decided design; no questions were asked (deferred-Unresolved contract applies).

> rk's typed task delivery into codex panes leaves the kickoff text staged in the composer without submitting, and the engine falsely reports success. When the delivered text is exactly a bare skill token (e.g. `$fab-operator` — the operator kickoff, or any bare `--skill` task after codex skill-prefix rendering), the bracketed paste opens codex's skill-autocomplete popup (footer line: "Press enter to insert or esc to close"). The inject engine's probe-gated Enter is consumed by the popup as *insert* — the popup closes, the text stays staged, nothing submits. Because the popup closing changes the captured frame, `verifySubmit` classifies the Enter as having had a visible effect (`observationNoClaim`) and `Engine.Send` returns success — the recovery ladder (`retrySubmit`) never fires, so the failure is silent (matches the field report: operator kickoff typed but never submitted).

Key decisions from the conversation (all live-verified against codex 0.153.4):

- **Decided fix**: an evidence-gated popup guard in `inject.Engine.Send`'s submit path — detect a NEW popup-marker occurrence in the echo-probe's winning capture (`preFrame`) relative to the pre-paste baseline, send one extra Enter to consume the popup, re-capture a fresh `preFrame`, then continue with the existing Enter + `verifySubmit` unchanged.
- **Rejected alternative**: appending a trailing space to bare-skill-shaped tasks at the typed-delivery composition seam — verified to suppress the popup, but must be replicated at every kickoff call site, does not cover operator→codex sends through the agent-send route, and touches composition where the claude byte-identity pins live.
- **Empirical facts** (numbered; referenced below): (1) plain prose at exact engine timing (bracketed paste → 80ms settle → capture → send-keys Enter) submits fine — timing and key encoding are NOT at fault; (2) the popup opens only for a bare skill token — `$fab-fff --light` (token + args) does not trigger it; (3) with the popup open, Enter #1 inserts (popup closes, composer text preserved unchanged), Enter #2 submits; (4) Enter on an empty codex composer is a no-op; (5) C-u clears the codex composer (the retry ladder's `clearComposer` discipline works there); (6) a trailing space after the token suppresses the popup entirely (basis of the rejected alternative).

## Why

1. **Pain point**: every rk surface that types a bare skill token into a codex pane — the `rk operator` / `rk tutorial` kickoffs, riff typed task delivery of a bare `--skill` task, the cron operator respawner, and operator sends to codex worker panes via the agent-send route — stages the text in the codex composer but never submits it, while the engine reports success. The agent never starts its task, and nothing tells the caller.

2. **Consequence if unfixed**: silent delivery failure on a growing class of sends. The failure mode is the worst kind — a false success: `verifySubmit`'s changed-frame no-claim branch (correct by design for spinners/streaming output) is satisfied by the popup *closing*, so the evidence-gated recovery ladder never fires. Operators observe "kickoff typed but never submitted" with no 409, no log, no retry.

3. **Why this approach**: the guard sits in the one shared engine (`internal/inject`), so it fixes every typed-send surface at once — the single-engine invariant (docs/specs/agent-messaging.md: every rk-owned code path that types into a pane goes through `internal/inject`, no exceptions) makes the engine the only place a fix covers all call sites. It is evidence-gated (marker novelty vs baseline, the house strict-increase discipline), adds zero captures/waits when no popup is present, and is benign on false positive (empirical fact 4: the extra Enter submits the staged text and the follow-up Enter no-ops on the now-empty composer) while a false negative degrades to today's behavior. The rejected trailing-space alternative would touch composition at every kickoff call site and still miss the agent-send route.

## What Changes

### 1. Popup-marker table in `internal/inject` (app/backend/internal/inject/inject.go)

A package-level table of known composer-popup markers, initially one codex entry:

```go
// composerPopupMarkers are frames of known agent-TUI popups that consume Enter
// as a popup action (insert/close) instead of submitting the composer. Matched
// stripForProbe-normalized (whitespace removed), same as every other probe term.
// Empirical TUI strings, same class as CollapseMinRunes / imageCollapseRe
// (Claude-empirical precedents): codex 0.153.4's skill-autocomplete footer.
var composerPopupMarkers = []string{"Press enter to insert"}
```

- Matching runs in the house `CountOccurrences`/`stripForProbe` style: the marker is compared against `stripForProbe`-normalized captures (so the stored marker string must be matched whitespace-stripped — e.g. `Pressentertoinsert` after normalization; implementation stores/compares whichever form keeps the single-normalization-site rule intact — all probe terms and captures go through the ONE `stripForProbe`).
- Detection is **strict increase**: `count(preFrame, marker) > count(baseline, marker)` — a marker already in the pre-paste baseline (a stale popup copy in scrollback) is a floor to beat, never a trigger. This mirrors the novelty echo probe's stale-chip discipline exactly.

### 2. Evidence-gated popup guard in `Engine.Send`'s submit path

In `Engine.Send` (app/backend/internal/inject/inject.go), between the successful echo probe and the existing `t.SendEnter` (currently ~line 347), when `submit == true`:

1. Compare the probe's winning capture (`preFrame`, already in hand — **no new capture**) against the pre-paste `baseline` capture for a NEW occurrence of any marker in the table.
2. On a new occurrence: send one extra Enter (`t.SendEnter`) to consume the popup, then re-capture a fresh `preFrame` (`t.CapturePane`, `ProbeCaptureLines`) so `verifySubmit`'s frame comparison baselines on the post-popup frame, not the popup frame.
3. Continue unchanged: the existing Enter → `verifySubmit(… preFrame …)` observation.

Behavior requirements:

- **`submit == true` only** — insert-without-submit mode (`submit:false` returns before Enter) leaves the popup for the human; the guard never runs there.
- **Zero added captures/waits when no marker is present** — the guard reads two strings already in hand; the no-popup path is byte-identical in call sequence to today.
- **Failure handling inside the guard** follows the staged-text discipline: the guard's Enter and re-capture happen after the paste landed but around Enter sends — a refused popup-consuming `SendEnter` or a failed re-capture classifies as the existing post-paste failure shapes (`StagedSendFailure` before any submit-Enter was sent), consistent with the current step-6 `SendEnter` error mapping. Exact classification is an apply-time detail bounded by the existing sentinel taxonomy (ProbeFailure / StagedSendFailure / SubmitUnverified stay distinct).
- **False positive benign by design** (fact 4): if the marker novelty fires without a real popup, the extra Enter submits the staged text and the follow-up Enter no-ops on the now-empty composer. **False negative** (popup present, marker missed) degrades to today's behavior — silent no-submit — never worse.
- **Claude-path behavior byte-identical**: the guard is marker-gated and claude frames never contain the codex marker; composition (positional claude task injection, `RenderSkillRef`) is untouched.

### 3. Guard on the `retrySubmit` recovery path

`retrySubmit` (app/backend/internal/inject/inject.go ~line 365) re-pastes after `clearComposer` — the re-paste can reopen the popup, so the same guard runs between its `probeEcho` success and its `SendEnter`, using the retry's own baseline (`clearedFrame`) as the marker floor and the retry's `preFrame` as the post-paste frame, with the same re-capture-fresh-`preFrame` step before its `verifySubmit`.

### 4. Unit tests via the existing seamed-Tmux pattern (app/backend/internal/inject/inject_test.go)

- **Popup present** → guard fires: exactly one extra Enter before the submit Enter, plus one fresh `preFrame` re-capture; `verifySubmit` observes against the fresh frame.
- **Popup absent** → byte-identical call sequence to today (no extra Enter, no extra capture).
- **Marker in baseline (stale copy)** → no strict increase → guard does not fire.
- **Retry-path guard** → a popup reopened by the retry re-paste is consumed on the retry path.

### Coverage (why the engine is the right seam)

The guard sits in the one shared engine, so every typed-send surface is fixed at once:

| Surface | Path |
|---------|------|
| riff typed task delivery | `internal/riff/deliver.go` → `inject.DeliverWhenReady` → `Engine.Send` |
| `rk operator` / `rk tutorial` kickoffs | typed composite through the same `taskEngine` |
| cron operator respawner | `internal/cron` `EngineDeliverer` → same engine |
| agent-send POST route (operator → codex worker panes) | `POST /api/windows/{id}/send` / operator-request routes → `agentSendEngine` |

No caller changes; no composition changes.

## Affected Memory

- `run-kit/agent-send`: (modify) The pane-targeted injection sequence contract and its requirement blocks — add the evidence-gated popup guard step between probe and Enter (initial and recovery paths); reconcile the "no pre-Enter quiescence gate" requirement language with the guard (the guard adds NO waiting and NO captures on the no-popup path, so the no-quiescence-gate property is preserved — the requirement text must say so explicitly); likely a new Design Decisions entry (evidence-gated popup guard over composition-side trailing space, with the rejected alternative and the live-verified facts).
- `run-kit/rk-riff`: (modify) § Task Delivery cross-reference — the typed-delivery contract line references the engine's verified-send sequence; update the cross-reference to reflect the guard.

## Impact

- **Code**: `app/backend/internal/inject/inject.go` (`Engine.Send` submit path, `retrySubmit`, new marker table + comparison helper), `app/backend/internal/inject/inject_test.go` (seamed-Tmux tests). No API surface change, no new tmux primitives (`SendEnter`/`CapturePane` already on the `Tmux` seam), no caller changes in `api/send.go`, `api/operator.go`, `internal/riff`, `internal/cron`.
- **Spec**: check `docs/specs/agent-messaging.md` for whether the injection-sequence contract is restated there (its Mechanism row summarizes "sanitize → named-buffer bracketed paste → novelty echo probe → probe-gated Enter → post-Enter observation → evidence-gated recovery") — amend at hydrate only if the guard changes the stated contract at that granularity.
- **Behavior**: codex bare-skill-token sends now submit; claude-path sends byte-identical; all other TUIs unaffected (marker never matches).
- **Constitution**: I (all sends stay argv-slice `exec.CommandContext` through existing primitives), II (no new state — guard derives from captures in hand), VI (engine still types into the pane; no session ownership).
- **Tests**: `cd app/backend && go test ./internal/inject/...` first, then `go test ./...`.

## Open Questions

- None — the design was fully decided and live-verified in the diagnosis conversation; promptless-defer recorded no would-be questions (every decision point graded Certain/Confident).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Guard lives in `Engine.Send`'s submit path (and `retrySubmit`), evidence-gated on strict-increase of a popup marker in `preFrame` vs the pre-paste baseline, one extra Enter + fresh `preFrame` re-capture, existing Enter + `verifySubmit` unchanged | Discussed — decided design, live-verified against codex 0.153.4 (facts 3–4) | S:95 R:85 A:95 D:95 |
| 2 | Certain | Guard applies only when `submit == true`; insert-without-submit leaves the popup for the human | Discussed — explicit requirement in the decided design | S:95 R:90 A:95 D:95 |
| 3 | Certain | Marker table is a package-level table with one codex entry (substring "Press enter to insert"), matched in the house `CountOccurrences`/`stripForProbe` style | Discussed — decided; in-package precedent for empirical TUI constants (`CollapseMinRunes`, `imageCollapseRe`) | S:90 R:90 A:90 D:90 |
| 4 | Certain | Zero added captures/waits on the no-popup path; claude-path behavior byte-identical (marker-gated; composition untouched) | Discussed — explicit requirement; the guard reads two strings already in hand | S:95 R:85 A:90 D:95 |
| 5 | Certain | False positive benign (extra Enter submits; follow-up Enter no-ops on empty composer — fact 4); false negative degrades to today's behavior | Discussed — live-verified fact 4; asymmetry is the design's safety argument | S:95 R:90 A:90 D:90 |
| 6 | Confident | Micro-timing of the fresh `preFrame` re-capture after the popup-consuming Enter (immediate capture vs a brief settle) is an apply-time detail; a mid-close capture only makes `verifySubmit` take its no-claim branch — benign either way | Unspecified in the design; bounded and reversible, existing primitives suffice | S:60 R:90 A:80 D:70 |
| 7 | Confident | Guard-internal failures (refused popup Enter, failed re-capture) classify within the existing sentinel taxonomy — staged-text discipline pre-submit-Enter, consistent with the current step-6 `SendEnter` → `StagedSendFailure` mapping | Not spelled out in the conversation; the existing taxonomy determines it — apply decides-and-records | S:65 R:85 A:85 D:75 |
| 8 | Confident | `docs/specs/agent-messaging.md` amended at hydrate only if the injection-sequence restatement there changes at its granularity (its Mechanism row is coarse; the guard sits inside "probe-gated Enter") | Description says "check"; hydrate resolves against the actual spec text | S:55 R:95 A:70 D:60 |
| 9 | Certain | Memory updates: `run-kit/agent-send` (sequence contract + reconcile "no pre-Enter quiescence gate" — guard adds no waiting/captures) and `run-kit/rk-riff` § Task Delivery cross-reference | Discussed — explicitly enumerated memory impact | S:90 R:95 A:90 D:90 |

9 assumptions (6 certain, 3 confident, 0 tentative, 0 unresolved).
