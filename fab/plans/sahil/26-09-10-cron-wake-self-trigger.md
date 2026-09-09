# Cron Operator Tick — Wake Self-Trigger Loop + Stuck Backoff Ladder

**Drafted**: 2026-09-10 · against `26937ad7` (branch `boreal-ermine`) · from a `/fab-discuss` diagnosis of "the operator gets two ticks one after the other"
**Shape**: 2 independent changes in `app/backend/internal/cron` — both backend-only, both `just test-backend`-verifiable, no UI, no schema migration
**Status**: Plan only — intakes to be drafted from § Change 1 / § Change 2

## Diagnosis

Server `runKit`, entry `9de2` (`operator tick`, `backoff 1m→30m`, `wake_on: agent-state-change` debounce 10s, `deliver: immediate`). One entry, one clock — the doubles are the wake predicate feeding on itself, and underneath it the backoff ladder is stuck.

### Evidence (2026-09-10, 00:42–01:07)

| Source | What it shows |
|--------|---------------|
| `~/.local/state/run-kit/cron/runKit.log` | Since the operator respawn at 00:42 **every** fire is `reason: wake`; they arrive in 30 s bursts (pairs at 01:00:04/01:00:34, a quadruple at 00:51:04–00:52:34). Before 00:42 every fire is `reason: schedule` and the gaps alternate **120 s / 240 s for five hours** (19:00–00:33) — never 8 m, 16 m, 30 m. |
| Live poll of `@rk_pane_agent_state` on all runKit panes every 3 s, correlated with deliveries at 01:05:34 / 01:06:04 / 01:07:04 | The operator pane `%683` flips `idle → active` 3–7 s after each delivery and back `→ idle` 6–15 s later. Between several consecutive fires the **only** fingerprint change was `%683` itself. Other fires were a new worker pane appearing (`%690`) and a worker flipping `active → idle` (`%685`). |
| `~/.local/state/run-kit/cron/runKit.cursor.yaml` | The stored fingerprint lists `%683=idle` — the entry's own target pane is part of the wake fingerprint. |
| Scratch replay of `JoinAnchor` (test written, run, deleted) | Own-delivery gaps `2m, 4m` reconstruct to `Rung=2, next fire +2m` — the ladder says `Rung=3, next +8m`. Gaps `2m,4m,8m` reconstruct correctly (`Rung=4`). The observed 120/240 alternation is reproduced exactly. |

### Mechanism 1 — wake ping-pong (the pairs)

1. Daemon ticker polls every 30 s (`DefaultTickInterval`), computes a server-wide fingerprint `pane=state` over every pane carrying `@rk_pane_agent_state` (`facts.go` `GatherFacts`), including the operator's own pane.
2. A tick lands (`deliver: immediate` — even into a busy pane; Claude Code queues it). The operator goes `active`, works 6–15 s, goes `idle`.
3. If either flip straddles a poll boundary, the poll sees "agent state changed" → `wakeEdge` fires → another tick. Each tick has a ~30–50 % chance of causing the next one, so chains of 2–4 are the norm.
4. The backoff side has exactly this guard — the **anchor-join rule** ignores idle-epoch resets caused by the entry's own delivery. `wake_on` has no equivalent.

Two aggravators:

- **Dead debounce.** `wakeEdge` holds when `now − obs.ObservedAt < debounce`, where `obs` is the *previous* observation — always ≥ 30 s old under a 30 s poll, so with `debounce: 10s` the hold branch is unreachable. The knob in the entry file does nothing.
- **Every transition fires.** `agent-state-change` fires on `idle → active`, a pane appearing, anything. With five workers active, the operator is ticked every 30 s regardless. fab-operator's stated first-class trigger is the `waiting` flip; the completion signal (`→ idle`) also matters. `→ active` never requires operator action.

### Mechanism 2 — the ladder never climbs (the 120/240 alternation)

`backoff.go` `JoinAnchor` reconstructs the rung from the trailing streak of own deliveries. The seed rung for the newest gap is `smallestRungWithGapAtLeast(min, max, gap − attributionWindow)` with `attributionWindow = 120 s` — the same size as the rung-1 → rung-2 gap. A genuine rung-2 gap of 4 m becomes threshold 2 m, which seeds rung **1**, the walk-back decrements to 0 and breaks, streak = 2, next fire = +2 m. Then a 2 m gap seeds rung 1 again → streak 2 → next +4 m. The ladder oscillates between rungs 2 and 3 forever; an idle operator is ticked 20×/hour all night instead of decaying to 2×/hour. Gaps ≥ 8 m happen to seed correctly (6 m > 4 m), which is why the 4-delivery unit test passes and the 3-delivery shape was never pinned.

Lateness only ever *inflates* an observed gap (a late fire, a daemon restart), so subtracting a tolerance the size of a whole rung from the gap before seeding is the wrong direction — the seed should be the **largest** rung whose ladder gap is ≤ observed gap + small skew (tick jitter, ~30 s), not the smallest rung ≥ gap − 2 m.

## Change 1 — Wake self-exclusion, transition filter, honest debounce (MEDIUM, backend)

**Goal**: a `wake_on: agent-state-change` entry never fires because of state changes its own delivery caused, ignores transitions that need no action from the target, and carries a `debounce` that does what its name says.

### Design decisions

- **D1 — exclude the target pane from the entry's fingerprint.** `EvalInput` carries the raw `States map[string]string` (in addition to, or instead of, the pre-rendered `Fingerprint`); `Evaluate` renders a per-entry fingerprint with `facts.PaneID` removed when the target resolved. The cursor is already keyed per entry, so no sidecar change. This is the wake analogue of the anchor-join rule and the load-bearing fix. Unresolved target ⇒ full fingerprint (nothing to exclude).
- **D2 — classify the diff, ignore `→ active`.** `wakeEdge` parses the previous and current fingerprints back into maps (the rendering is `pane=state\n`, lossless) and fires only if some pane's transition is *actionable*: new state `waiting` or `idle`, or the pane disappeared (agent exit / pane death — the tick reports both). A transition to `active` (including a new pane appearing as `active`) advances the cursor **without** firing. Recommended over "fire only on `→ waiting`" because the operator's autopilot depends on noticing completions (`→ idle`) and the backoff anchor is the *operator's* idle epoch, so worker completions would otherwise wait up to 30 m.
- **D3 — debounce = hold-after-delivery.** Replace the unreachable `now − obs.ObservedAt < debounce` with `now − lastOwnDelivery(entry) < debounce` (any reason, from the delivery log the evaluator already has). A held edge keeps the old observation exactly as today, so it is deferred, not dropped. Seed the operator entry at **60 s**: an edge that lands right after a tick waits for the poll after next; nothing is ever lost. Alternative considered: delete the field — rejected, it is in every existing entry file and the hold-after-delivery semantics is genuinely useful once the loop is gone.
- **D4 — one-time upgrade edge is acceptable.** After deploy, each entry's stored fingerprint (which included the target pane) differs from the new rendering → at most one spurious wake per entry, absorbed by tick idempotency. No cursor migration.
- **D5 — `EnsureRoleEntry` learns to refresh the debounce.** Today it only backfills `respawn`. Add the same treatment for `WakeOn.Debounce` when the existing value is below the spec's (so `rk operator` relaunch upgrades `9de2` from 10 s to 60 s without an `rk cron rm`). Keep the rule narrow — it must not clobber a user-tuned entry upward.

### Tasks

1. `evaluate.go` / `facts.go`: carry `States` into `EvalInput`; per-entry fingerprint minus `facts.PaneID` (D1). Keep `Fingerprint(states)` as the renderer; add `withoutPane(states, id)` or render inline.
2. `wake.go`: `wakeEdge(debounce, prevFP, curFP, lastOwnDeliveryTS, now)` — parse both fingerprints, classify transitions per D2, hold per D3. Diagnostic reasons: keep `wake-cold-start`, `wake-debounced`; add `wake-ignored-transition` (debug-level, like the others).
3. `cmd/rk/operator.go` `operatorTickEntrySpec`: `Debounce: 60s`. `store.go` `EnsureRoleEntry`: backfill rule per D5, with a test mirroring the existing respawn-backfill case.
4. Tests (`wake_test.go`, `evaluate_test.go`, `facts_test.go`, `store_test.go`):
   - target pane flips idle↔active, everything else steady ⇒ no fire; cursor advances.
   - worker `idle → active` ⇒ no fire; worker `active → idle` ⇒ fire; worker `→ waiting` ⇒ fire; pane vanishes ⇒ fire; new pane appears `active` ⇒ no fire, appears `idle` ⇒ fire.
   - edge 20 s after an own delivery with debounce 60 s ⇒ `wake-debounced`, old observation kept; same edge 70 s after ⇒ fires. Rewrite `TestEvaluateWakeUnionAndDebounce` to the new semantics.
   - replay: the 01:05–01:07 sequence from § Evidence as a table test — with the fix, only the `%690`-appears-idle / `%685 → idle` polls fire, the `%683` polls do not.
   - `EvaluateDeterministic` stays green (no new package state).
5. Spec/memory deltas (apply-time, hydrate finalizes): `docs/specs/cron.md` § Schedules `wake_on` bullet — add the self-exclusion rule next to the anchor-join paragraph and the transition filter; `docs/memory/run-kit/cron.md` § "`wake_on` poll approximation" — rewrite the rule, retire the "observation older than debounce" wording, note the seeded 60 s and the `EnsureRoleEntry` backfill.

### Acceptance

- `just test-backend` green.
- Live: with the operator ticking and ≥ 3 workers steadily `active`, `runKit.log` shows **no** `wake` fire whose only fingerprint delta is the operator pane; no two `wake` fires < 60 s apart; a worker sent to `waiting` still produces a tick within one poll (≤ 30 s) plus at most the 60 s hold.

## Change 2 — Backoff ladder rung seeding (SMALL, backend, independent of Change 1)

**Goal**: a clean own-delivery streak of any length reconstructs to the ladder's rung; an idle operator decays 1 m → 2 m → 4 m → 8 m → 16 m → 30 m.

### Design decision

- **D6 — seed from the largest fitting rung.** Replace `smallestRungWithGapAtLeast(min, max, gap − attributionWindow)` with `largestRungWithGapAtMost(min, max, gap + seedSkew)` where `seedSkew` is the invoker jitter bound (30 s — one `DefaultTickInterval`; state it as a named const with the reasoning). The walk-back's inner check (`gap < gapAfter(expectRung) − attributionWindow ⇒ break`) is about *streak membership* and keeps its tolerance — only the seed changes. `attributionWindow` (120 s) stays what it is: the epoch-attribution window, not a gap tolerance.

### Tasks

1. `backoff.go`: new seed helper; retire `smallestRungWithGapAtLeast` if nothing else uses it.
2. `backoff_test.go`: pin the missing shape — deliveries at `+1m, +3m, +7m` (gaps 2 m, 4 m) ⇒ `Rung=3`, next fire `+15m` (today: `Rung=2`, `+9m`). Add an escape test replaying forward from the observed pathological log (`0, 2m, 6m, 8m, 12m, 14m`): the newest 2 m gap legitimately reads as rung 1 so the first reconstruction still says `+4m`, but the one after (gaps 2 m, 4 m) must say `+8m`, then `+16m`, then `+30m` — the alternation is no longer a fixed point. Existing `TestAnchorJoin*` cases must stay green. Traced by hand against the new seed: `RestartTolerance` (7 m late gap seeds rung 2, the walk-back still recovers streak 3 / anchor T), `StreakBreak` (18 m gap seeds rung 4, the 2 m gap breaks the streak, the consistency floor falls back to the single-delivery ladder ⇒ `+23m`, inside the test's bounds), `MultiDeliveryStreak` unchanged. Note the rung is the *streak length* — the seed only bounds how far the walk-back goes.
3. Memory delta: `docs/memory/run-kit/cron.md` § backoff / anchor-join — one sentence on the seed rule and the jitter const.

### Acceptance

- `just test-backend` green.
- Live, next quiet stretch: `runKit.log` `schedule` gaps for an untouched operator read 60, 120, 240, 480, 960, 1800, 1800… (allow one poll of lateness each).

## Non-Goals

- No change to `DefaultTickInterval`; the 30 s poll is the coalescing window and that is fine.
- No `deliver: when-idle` for the operator entry — a tick queued behind a busy operator is the desired behavior once it stops *causing* the next tick.
- Not touching the fab-kit side (`qvek` mute-lease intake) — that is about an idle operator with nothing tracked, a different silence.
- No UI work; the CLOCK section already renders `last fired` from the log.

## Execution

- Two fab changes, either order, both `light`-lane candidates (each ≤ 5 tasks, one package). Change 2 first if only one ships before the next long idle stretch — it is the smaller diff and stops the all-night 20×/hour ticking; Change 1 stops the daytime pairs.
- Stopgap while neither has shipped: `rk cron mute 9de2 --for 2h`.
- Verification of Change 1 needs a live server with active workers: reuse the 3 s pane-state poll from the diagnosis (scratchpad `poll.sh`: `tmux -L runKit list-panes -a -F '#{pane_id}=#{@rk_pane_agent_state}'`, strip epochs, print on change) side by side with `tail -f runKit.log`.
