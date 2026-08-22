# Intake: Operator Auto-Name on Idle

**Change**: 260822-q675-operator-auto-name-idle
**Created**: 2026-08-22

## Origin

> Implement Phase 3 (control-room features) of `fab/plans/sahil/operator-session.md`, item 9, now that Phase 1 (physical promotion, PR #708) and Phase 2 (the operator-request actuation seam + Fix-tab-name, PR #709) are merged to main: **auto-name on idle** — enqueue a rename request on a window's busy-to-idle transition, rate-limited, skipped if the operator is busy.

One-shot `/fab-new` invocation covering plan items 9–15; intake analysis split the scope into four changes along structural seams (the user explicitly authorized splitting "rather than forcing one oversized plan"). This change is item 9 — the plan calls it "the highest-value next slice". Sibling changes: `260822-rfz2-operator-digest-stuck-retire` (items 10/11/13), `260822-wyn3-operator-compose-spawn-search` (items 12/14), `260822-ga8z-sort-tabs-status-date` (item 15). The four are independent of each other.

## Why

Window names go stale the moment an agent's work drifts from whatever the window was named at spawn (`riff-swift-fox`, `zsh`, a long-obsolete task slug). Phase 2 shipped the fix — the `fix-tab-name` operator-request template (`app/backend/api/operator.go`, memory `run-kit/operator-actuation.md`) — but it is manual: the user must notice a stale name and click the flyout action per window. The natural moment a name is wrong is right after a work burst ends: the agent just finished doing something, and what it did is now known (it's in the transcript). Firing the existing template automatically on the busy→idle transition makes tab names track reality with zero user action, which is the whole point of a control room.

If we don't build it: names keep rotting, the manual action stays a novelty, and the operator window sits idle between explicit requests. Why this approach: the plan's actuation-loop razor — run-kit owns the derivable trigger (state transitions are already derived every tick), the operator owns the judgment (what the tab is actually about). The trigger is a thin internal caller of the Phase 2 seam; no new protocol, no queue.

## What Changes

### Backend: busy→idle transition tracker on the derive tick

A new in-memory tracker rides the SSE per-tick assembly seam — the exact precedent is `waitingPushTracker` in `app/backend/api/waiting_push.go` (episode model, per-window map keyed `server + "\x00" + windowID`, own mutex, in-memory only, "no durable store beyond the hub's episode map — Constitution II applies to durable state"; pure decision function unit-tested without full ProjectSessions). The new tracker observes each window's rolled-up `AgentState` per tick and detects the transition **busy → idle**, where busy = `active` or `waiting` and idle = `idle` (empty/unknown state is neither — a window with no agent hooks never triggers).

On a detected transition, subject-side eligibility (all derivable from the same tick's sessions snapshot):

- the subject window has a non-empty `ChatSessionRef` (the template's `requiresChatRef` — no transcript, no rename material)
- the subject is NOT the operator window itself (`Role != "operator"`)
- the server HAS an operator window (no operator ⇒ the feature degrades to absent — nothing fires, nothing logs at error level)
- per-window rate limit: a cooldown since that window's last auto-request (suggested 15 minutes) — an agent that flaps busy/idle in a work loop does not spam rename requests
- global (per-server) min-gap: a short spacing between consecutive auto-deliveries (suggested 60 seconds), because the operator's `AgentState` lags delivery by a hook round-trip — immediately after one injection the rollup may still read `idle` for a tick or two, and without the gap two idle transitions in one tick would double-deliver. At most one auto-request is delivered per tick per server.

### Backend: internal delivery reuse of the Phase 2 seam

`handleOperatorRequest` (`api/operator.go`) currently does resolution + facts + busy gate + injection inline. Extract the post-parse core into an internal function (e.g. `deliverOperatorRequest(ctx, server, subject, operator *tmux.WindowInfo, tmpl operatorTemplate) error` — exact shape is plan-stage) so the HTTP handler and the auto-namer share fact derivation, the busy gate, and injection. The auto-namer already holds the tick's sessions snapshot, so it passes the already-resolved windows — no second `FetchSessions`. The busy-gate semantics are unchanged and shared: operator `active`/`waiting` ⇒ the auto-request is **skipped** (not queued, not retried — Constitution II; the transition is consumed, and the window's cooldown still stamps so a busy operator doesn't convert into a burst later). The novelty echo probe remains the final fail-closed guard exactly as for the HTTP path.

### Template amendment: idempotent rename judgment

`renderFixTabName` gains one clause: if the current name already accurately describes the work, do nothing (keep the do-not-reply bound). Auto-invocations will frequently hit windows whose names are already right; the no-op judgment belongs to the operator, not to run-kit (the inside/outside razor). The clause applies to the manual path too — same template, one registry entry.

### Explicitly NOT in this change

- No new HTTP endpoint, no request body change, no new template id.
- ~~No config toggle / env var: the feature is armed exactly when an operator window exists on a server (degrade-to-absent razor). If field use shows it needs a switch, that's a follow-up.~~ **Revised 2026-08-22 (user directive at review-pr)**: the trigger is strictly opt-in behind `RK_AUTO_NAME` (env var per Constitution IV, default off); the operator-window requirement still applies on top when enabled. See plan.md R7.
- No queue, no persistence of any kind; the tracker map is process-lifetime only (a daemon restart forgets cooldowns — acceptable, mirrors waiting-push episodes).
- No UI surface: results arrive as renames via the normal derive tick, indistinguishable from the manual action.

### Tests

- Pure decision-function unit tests mirroring `TestRollupAgentState` / waiting-push tracker tests: transition detection (active→idle fires, waiting→idle fires, idle→idle doesn't, empty→idle doesn't), cooldown suppression, global min-gap, one-per-tick cap, no-operator/no-chatref/operator-subject skips.
- Handler-level test that the extracted `deliverOperatorRequest` keeps the HTTP path's behavior byte-identical (existing `operator_test.go` stays green).

## Affected Memory

- `run-kit/operator-actuation`: (modify) add the system-initiated caller — the auto-name tracker, its eligibility/rate-limit rules, the shared internal delivery function, and the template's no-op clause
- `run-kit/architecture`: (modify) the SSE per-tick assembly seam gains a second push-style consumer beside waiting-push (only if that seam's consumer list is documented there — verify at hydrate)

## Impact

- `app/backend/api/operator.go` (extract internal delivery core; template clause), `app/backend/api/operator_test.go`
- `app/backend/api/waiting_push.go` as the pattern reference; new sibling file (e.g. `api/auto_name.go` + test) wired where waiting-push is wired into the tick
- No frontend changes. No API surface changes. No new subprocess patterns (injection engine reused as-is, Constitution I untouched).

## Open Questions

- Should waiting→idle count as a trigger, or only active→idle? (waiting→idle means a human just answered — the agent usually resumes active immediately, so the transition may be noise. Current decision: both count, rate limit absorbs the noise — see Assumptions #3.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Reuse the Phase 2 seam + `fix-tab-name` template via an extracted internal delivery function; no new endpoint or template id | The plan says items "ride the Phase 2 seam"; the seam exists and the memory documents its exact contract | S:90 R:85 A:95 D:90 |
| 2 | Certain | Tracker is in-memory on the SSE tick, modeled on `waitingPushTracker`; busy operator ⇒ skip, never queue | Plan + Constitution II are explicit ("Rate-limited; skip if the operator is busy"); waiting-push is the blessed precedent | S:90 R:80 A:95 D:90 |
| 3 | Confident | Busy = `active` OR `waiting`; the transition fires on either →`idle`; empty/unknown never triggers | Matches the seam's existing busy vocabulary; rate limiting absorbs waiting→idle noise; easily narrowed later | S:70 R:80 A:75 D:60 |
| 4 | Confident | Rate limits: 15-min per-window cooldown + 60-s per-server min-gap + one delivery per tick; cooldown stamps even on busy-skip | Plan says "rate-limited" without numbers; values are tunable constants, trivially reversible | S:55 R:90 A:75 D:65 |
| 5 | Confident | No config toggle — armed exactly when an operator window exists | SUPERSEDED 2026-08-22 by user directive at review-pr: gated behind `RK_AUTO_NAME`, default off (plan.md R7, assumption #8) | S:60 R:85 A:75 D:60 |
| 6 | Confident | Template gains an "if the current name is already accurate, do nothing" clause, shared by manual and auto paths | Prevents auto-churn; judgment-delegation fits the razor; slight behavior change to the manual action | S:45 R:85 A:70 D:50 |

6 assumptions (2 certain, 4 confident, 0 tentative, 0 unresolved).
