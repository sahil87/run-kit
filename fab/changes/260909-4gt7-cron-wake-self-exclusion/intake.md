# Intake: Cron Wake Self-Exclusion, Transition Filter, Honest Debounce

**Change**: 260909-4gt7-cron-wake-self-exclusion
**Created**: 2026-09-10

## Origin

> Implement Change 1 (Wake self-exclusion, transition filter, honest debounce) from fab/plans/sahil/26-09-10-cron-wake-self-trigger.md -- the MEDIUM backend fix for the operator-tick wake ping-pong loop (own pane included in the wake fingerprint, plus a dead debounce). Independent of Change 2. Then continue the full pipeline.

One-shot `/fab-new` invocation against a fully drafted plan. The plan (`fab/plans/sahil/26-09-10-cron-wake-self-trigger.md`, drafted 2026-09-10 from a `/fab-discuss` diagnosis on branch `boreal-ermine`) carries the evidence, the mechanism analysis, and design decisions D1–D5 for this change. It was untracked in a sibling worktree; this change copies it into the repo at the same path so the intake's references resolve on the branch. § Change 2 (backoff ladder rung seeding, D6) is explicitly out of scope — it is an independent change with its own intake.

## Why

**The pain point.** The operator-tick cron entry (`9de2` on server `runKit`: `schedule: backoff 1m→30m`, `wake_on: {agent-state-change, scope: server, debounce: 10s}`, `deliver: immediate`) fires `reason: wake` in 30 s bursts — pairs, sometimes quadruples — whenever the operator's own processing of a tick straddles the daemon's 30 s poll boundary. Confirmed on 2026-09-10 by polling `@rk_pane_agent_state` on every runKit pane every 3 s and correlating against `~/.local/state/run-kit/cron/runKit.log`: the operator pane `%683` flips `idle → active` 3–7 s after each delivery and `→ idle` 6–15 s later, and between several consecutive fires the **only** fingerprint delta was `%683` itself. The stored cursor (`runKit.cursor.yaml`) lists `%683=idle` — the entry's own target pane is part of its wake fingerprint.

**Three design gaps in `app/backend/internal/cron`**, all in the `wake_on` path:

1. **Self-trigger.** `GatherFacts` (`facts.go`) renders one server-wide fingerprint over every pane carrying `@rk_pane_agent_state`, including the entry's own target. A tick lands → the operator goes `active` → works → goes `idle`. If either flip straddles a poll, `wakeEdge` sees "agent state changed" and fires another tick. Each tick has a ~30–50 % chance of causing the next, so chains of 2–4 are the norm. The backoff side already has exactly this guard — the **anchor-join rule** ignores idle-epoch resets caused by the entry's own delivery — but `wake_on` has no analogue.
2. **Dead debounce.** `wakeEdge` (`wake.go`) holds when `now − obs.ObservedAt < debounce`, where `obs` is the *previous* observation. Under a 30 s poll that age is always ≥ 30 s, so with `debounce: 10s` the hold branch is unreachable. The `debounce` knob in every entry file does nothing.
3. **Every transition fires.** `agent-state-change` fires on `idle → active`, on a new pane appearing, on anything. With five workers active the operator is ticked every 30 s regardless. fab-operator's stated first-class trigger is the `waiting` flip; the completion signal (`→ idle`) also matters for autopilot. A `→ active` transition never requires operator action.

**Consequence of not fixing.** Ticks are idempotent, so this is cost and noise rather than correctness — but it is substantial: 20+ redundant operator turns per hour during active work, each spending tokens and context on "nothing changed," and a `debounce` field that lies in every entry file. It also masks the separate backoff-ladder bug (Change 2) because wake fires dominate the log.

**Why this approach.** The self-exclusion (D1) is the load-bearing fix and is the direct wake analogue of the anchor-join rule the spec already calls load-bearing — same principle, same "ignore state changes our own delivery caused." The transition filter (D2) and the honest debounce (D3) are the two aggravators; fixing them in the same change keeps `wakeEdge`'s contract coherent (one rewrite of the rule, one rewrite of the spec/memory paragraph) instead of three half-rules. Deleting the `debounce` field was considered and rejected: it is in every existing entry file, and hold-after-delivery is genuinely useful once the loop is gone.

## What Changes

All changes are backend-only, in `app/backend/internal/cron` plus one constant in `app/backend/cmd/rk/operator.go`, verifiable with `just test-backend`. No UI, no schema migration, no cursor migration.

### 1. Per-entry fingerprint excludes the entry's own target pane (D1)

`ServerFacts` and `EvalInput` carry the raw agent-state map instead of (not in addition to) a pre-rendered fingerprint:

```go
// facts.go
type ServerFacts struct {
	States  map[string]string // pane id → @rk_pane_agent_state, panes with a state only
	Targets map[string]TargetFacts
	Diags   []Diagnostic
}

// evaluate.go
type EvalInput struct {
	Server  string
	Now     time.Time
	Entries []Entry
	Facts   map[string]TargetFacts
	States  map[string]string // replaces Fingerprint
	Log     []LogLine
	Cursor  WakeCursor
}
```

`Evaluate` renders a **per-entry** fingerprint: `Fingerprint(states)` with `facts.PaneID` removed when the target resolved (`facts.Resolved() && facts.PaneID != ""`). An unresolved target has nothing to exclude, so the full fingerprint is used. `Fingerprint(states map[string]string) string` stays the canonical renderer (sorted `pane=state\n`, empty states skipped); a small helper `fingerprintExcluding(states, paneID)` (or an inline copy-minus-key) produces the per-entry view without mutating the shared map. The cursor is already keyed per entry, so no sidecar change.

The only consumer of `ServerFacts.Fingerprint` outside the package is `api/router.go` wiring `cron.GatherFactsLive` as a function value; it does not read the field. The `tick.go` call site (`Fingerprint: facts.Fingerprint`) becomes `States: facts.States`.

### 2. `wakeEdge` classifies the transition; `→ active` advances without firing (D2)

New signature:

```go
// wakeEdge applies the delta-vs-cursor rule for one wake_on entry.
//   - no prior observation: cold start — no edge, seed the cursor ("wake-cold-start").
//   - fingerprint unchanged: no edge, keep the observation.
//   - changed, no actionable transition: no edge, cursor ADVANCES ("wake-ignored-transition").
//   - changed, actionable, but now − lastOwnDelivery < debounce: HOLD — no edge,
//     keep the OLD observation so the edge stays pending ("wake-debounced").
//   - changed, actionable, past the hold: fire, cursor advances.
func wakeEdge(debounce time.Duration, prevFP, curFP string, hasObs bool,
	lastOwnDelivery time.Time, hasDelivery bool, now time.Time) (edge bool, next WakeObservation, diag string)
```

(Exact parameter packaging is apply's call — e.g. keeping `obs WakeObservation, hasObs bool` and adding `lastDelivery time.Time, hasDelivery bool` is equally fine. The contract below is what matters.)

**Classification.** Both fingerprints are parsed back into `map[pane]state` (the rendering `pane=state\n` is lossless — `parseFingerprint(fp string) map[string]string` is the inverse of `Fingerprint`). Walking the union of pane ids, a transition is **actionable** when:

| Previous | Current | Actionable? |
|----------|---------|-------------|
| any / absent | `waiting` | **yes** |
| any / absent | `idle` | **yes** |
| present | absent (pane vanished / agent exited) | **yes** |
| any / absent | `active` | no |
| unchanged | unchanged | — (not a transition) |

The edge is actionable if **any** pane in the diff has an actionable transition. A diff consisting only of `→ active` transitions (including a new pane appearing as `active`) is ignored: the cursor advances to the current fingerprint so the same transition is never re-evaluated, no fire, `wake-ignored-transition` diagnostic (debug-level, like the existing wake diagnostics). Any other state value (unknown/future) is treated as actionable — fail-open toward firing, never toward silence.

Rationale for firing on `→ idle` and not only `→ waiting`: the operator's autopilot depends on noticing worker completions, and the backoff anchor is the *operator's* idle epoch, so a worker completion would otherwise wait up to the 30 m rung.

### 3. Debounce = hold-after-own-delivery (D3)

Replace the unreachable `now − obs.ObservedAt < debounce` with `now − lastOwnDelivery < debounce`, where `lastOwnDelivery` is the timestamp of the entry's newest own line in the delivery log — `LastDelivery(in.Log, e.ID)` (`log.go`), which the evaluator already has in `EvalInput.Log`. Any reason (`schedule` or `wake`) and any outcome count: every own log line marks a moment the clock acted on this entry, and the hold's job is "do not react to state changes right after we acted." No own line ever ⇒ no hold.

A held edge keeps the old observation exactly as today: it is **deferred, not dropped** — the next poll re-diffs against the same old observation, so the accumulated diff still contains the actionable transition. The debounce check runs **after** classification: an ignored-only diff advances the cursor regardless of the hold window.

**Seed value: 60 s** for the operator entry. An edge that lands right after a tick waits for the poll after next; nothing is ever lost. `wake-debounced` keeps its name.

### 4. Operator entry spec + `EnsureRoleEntry` debounce backfill (D5)

`cmd/rk/operator.go` `operatorTickEntrySpec()`: `Debounce: cron.Duration{Duration: 60 * time.Second}`; update the doc comment ("debounced 10s" → "debounced 60s").

`store.go` `EnsureRoleEntry`: today the only on-hit mutation is the respawn-argv backfill. Add a second narrow upgrade, same shape:

```go
if e.WakeOn != nil && spec.WakeOn != nil &&
	e.WakeOn.Event == spec.WakeOn.Event &&
	e.WakeOn.Debounce.Duration < spec.WakeOn.Debounce.Duration {
	entries[i].WakeOn.Debounce = spec.WakeOn.Debounce
	// save + mirror into the returned e, as the respawn branch does
}
```

The rule is deliberately **below-spec only**: a user who tuned the debounce upward (e.g. 5 m) is never clobbered; a user who tuned it *downward* below the spec's value is raised to it — accepted, because a sub-poll debounce is the dead knob this change retires. Both upgrades (respawn, debounce) may apply in one call; write the file once. Update the function's doc comment to name both narrow upgrades. Effect: an `rk operator` relaunch upgrades `9de2` from 10 s to 60 s with no `rk cron rm`.

### 5. One-time upgrade edge — accepted, no migration (D4)

After deploy, each `wake_on` entry's stored fingerprint (which included its target pane) differs from the new per-entry rendering; classification reads that as "target pane vanished" → at most one spurious wake per entry, absorbed by tick idempotency. No cursor migration, no version field.

### 6. Tests

- `wake_test.go`: rewrite `TestWakeEdge` to the new contract; add `TestParseFingerprintRoundTrip` (`parseFingerprint(Fingerprint(m)) == m` for non-empty states); table test for the classification matrix above; debounce cases: actionable edge 20 s after an own delivery with `debounce: 60s` ⇒ `wake-debounced`, old observation kept; same edge 70 s after ⇒ fires; no own delivery ever ⇒ fires; ignored-only diff inside the hold window ⇒ cursor advances, no fire.
- `evaluate_test.go`: rewrite `TestEvaluateWakeUnionAndDebounce` to `States` + log-based hold; new case: target pane flips `idle↔active`, everything else steady ⇒ no fire, cursor advances; new case: unresolved target ⇒ full fingerprint used (target pane's own flip fires, since nothing is excluded); fix every other test constructing `EvalInput{Fingerprint: …}` to `States`. `TestEvaluateDeterministic` (or its equivalent) stays green — no new package state.
- `facts_test.go`: `GatherFacts` returns `States` (map, not string); existing fingerprint assertions adapt.
- `store_test.go`: `TestEnsureRoleEntryDebounceBackfill` mirroring `TestEnsureRoleEntryNarrowUpgrade` (existing 10 s → spec 60 s ⇒ rewritten, returned entry reflects it); `TestEnsureRoleEntryNoDebounceDowngrade` (existing 5 m stays 5 m); existing `TestEnsureRoleEntryIdempotentAndNeverMutates` continues to pass with the spec's own value.
- **Replay test** (`evaluate_test.go` or `wake_test.go`): the 01:05–01:07 sequence from the plan's § Evidence as a table — polls where the only delta is `%683` (target) do not fire; `%690` appears `idle` fires; `%685 → idle` fires; a poll where a worker goes `→ active` does not fire.
- `cmd/rk` operator tests, if any assert the spec's debounce, update to 60 s.

### 7. Spec and memory deltas

Apply edits the spec at apply-time; hydrate finalizes memory:

- `docs/specs/cron.md` § Cron State / Union predicate `wake_on` bullet (line ~157): add the self-exclusion rule as the wake analogue of the anchor-join paragraph ("the entry's own target pane is excluded from its fingerprint — its own delivery makes the target busy, and that must not read as a wake edge"), the transition filter (`→ waiting`, `→ idle`, pane gone fire; `→ active` does not), and the debounce semantics (hold-after-own-delivery). The example entry (line ~112) reads `debounce: 60s`.
- `docs/memory/run-kit/cron.md` § "`wake_on` poll approximation" (line ~125): rewrite the rule — retire the "observation older than debounce" wording; describe per-entry fingerprint minus target, classification, hold-after-delivery, `wake-ignored-transition`. § Requirement "Wake-on delta with cold-start degradation" (line ~251): restate. § `rk operator` seeding paragraph (line ~97): `debounce: 60s` and the `EnsureRoleEntry` debounce backfill alongside the respawn backfill.

## Affected Memory

- `run-kit/cron`: (modify) § `wake_on` poll approximation — per-entry fingerprint excluding the target pane, transition classification (`→ waiting`/`→ idle`/vanish fire, `→ active` advances silently), debounce as hold-after-own-delivery, new `wake-ignored-transition` diagnostic; § `rk operator` seeding — `debounce: 60s` and the `EnsureRoleEntry` below-spec debounce backfill; § Requirement "Wake-on delta with cold-start degradation" restated.

## Impact

- **Code**: `app/backend/internal/cron/{facts.go, evaluate.go, wake.go, store.go, tick.go}` and their tests; `app/backend/cmd/rk/operator.go` (one constant + comment). `ServerFacts.Fingerprint` → `ServerFacts.States` and `EvalInput.Fingerprint` → `EvalInput.States` are package-internal API changes; the only external touch (`api/router.go`) passes `GatherFactsLive` as a value and is unaffected.
- **Spec**: `docs/specs/cron.md` wake_on paragraph and example.
- **Behavior**: `wake_on` entries fire less often (no self-trigger, no `→ active` fires); the `debounce` field becomes meaningful. One spurious wake per entry on first tick after deploy.
- **Live state**: no cursor or entry-file migration. Existing `9de2` upgrades to `debounce: 60s` on the next `rk operator` invocation.
- **Verification in pipeline**: `just test-backend`. The plan's live acceptance (no `wake` fire whose only delta is the operator pane; no two `wake` fires < 60 s apart; a worker sent to `waiting` still ticks within one poll + hold) needs a running server with workers and is the user's post-merge check, not an apply gate.
- **Not touched**: `DefaultTickInterval` (30 s), `deliver` mode, `backoff.go`/`JoinAnchor` (Change 2), fab-kit `qvek` intake, UI.

## Open Questions

- None blocking. The plan resolved the design; remaining choices (exact `wakeEdge` parameter packaging, helper naming) are apply-time.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Exclude the entry's own resolved target pane from its wake fingerprint; unresolved target ⇒ full fingerprint | Plan D1, the load-bearing fix; direct analogue of the spec's anchor-join rule | S:95 R:85 A:95 D:95 |
| 2 | Confident | Fire on `→ waiting`, `→ idle`, pane vanished; `→ active` (incl. new pane appearing active) advances the cursor without firing; unknown states are actionable | Plan D2 chose this over fire-only-on-`waiting` with stated rationale (autopilot completions); fail-open on unknown values is my addition | S:85 R:80 A:85 D:75 |
| 3 | Confident | Debounce = `now − lastOwnDelivery < debounce`, using `LastDelivery(log, entryID)` (newest own log line, any reason/outcome); no own line ⇒ no hold; held edge keeps the old observation | Plan D3 names "any reason, from the delivery log"; picking the existing `LastDelivery` helper and counting every own line is the simplest reading — a line exists only because the clock acted on the entry | S:85 R:85 A:85 D:70 |
| 4 | Certain | Operator entry `debounce` seeded at 60 s | Plan D3 specifies 60 s with reasoning (edge right after a tick waits for the poll after next) | S:95 R:95 A:95 D:95 |
| 5 | Confident | `EnsureRoleEntry` backfills `WakeOn.Debounce` only when existing < spec (same event); never lowers a user's higher value; both narrow upgrades may apply in one save | Plan D5, "must not clobber a user-tuned entry upward"; the below-spec-only rule is the narrow reading | S:85 R:85 A:85 D:80 |
| 6 | Certain | No cursor migration; one spurious wake per entry after deploy is accepted | Plan D4 explicitly | S:95 R:95 A:95 D:95 |
| 7 | Confident | Replace `Fingerprint string` with `States map[string]string` on both `ServerFacts` and `EvalInput` (not keep both) | Plan says "in addition to, or instead of"; no external consumer reads the field (verified: `api/router.go` only passes `GatherFactsLive` by value), so one representation avoids two sources of truth | S:70 R:85 A:85 D:75 |
| 8 | Confident | Classification runs before the debounce check: an ignored-only diff advances the cursor even inside the hold window | Not stated in the plan; follows from "ignore `→ active`" — holding an ignored diff would re-evaluate it forever | S:65 R:85 A:80 D:75 |
| 9 | Confident | Copy `fab/plans/sahil/26-09-10-cron-wake-self-trigger.md` from the `boreal-ermine` worktree into this branch verbatim | The user's argument references it by repo path; it was untracked in a sibling worktree; making the reference resolvable on the branch is housekeeping | S:80 R:95 A:90 D:85 |
| 10 | Certain | Change type is `fix` (override the inferred `feat`) | The change corrects a diagnosed defect; description says "fix" | S:90 R:95 A:95 D:95 |
| 11 | Confident | Live acceptance (log observation with active workers) is the user's post-merge check; apply's gate is `just test-backend` plus the replay table test | Plan's § Acceptance lists both; a dispatched apply worker has no live server with workers | S:80 R:90 A:85 D:85 |

11 assumptions (4 certain, 7 confident, 0 tentative, 0 unresolved).
