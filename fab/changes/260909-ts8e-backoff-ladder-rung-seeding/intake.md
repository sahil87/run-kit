# Intake: Backoff Ladder Rung Seeding

**Change**: 260909-ts8e-backoff-ladder-rung-seeding
**Created**: 2026-09-10

## Origin

> Implement Change 2 (Backoff ladder rung seeding) from fab/plans/sahil/26-09-10-cron-wake-self-trigger.md -- the SMALL, independent-of-Change-1 backend fix (the operator-tick backoff ladder never climbs, causing 20x/hour ticking overnight). Then continue the full pipeline.

One-shot `/fab-new` invocation against a finished plan. The plan (`fab/plans/sahil/26-09-10-cron-wake-self-trigger.md`, § Change 2 / D6) was drafted from a `/fab-discuss` diagnosis on 2026-09-10 of the `runKit` server's operator-tick entry `9de2`. It was untracked in the `boreal-ermine` worktree when this change was created; it lands in the repo via Change 1's PR (#899, `260909-4gt7-cron-wake-self-exclusion`), so this branch does not carry a copy (a second add of the same path would conflict on merge). Change 1 of the same plan (wake self-exclusion / transition filter / honest debounce) is a separate change and is explicitly **out of scope** here.

The intake author re-traced `JoinAnchor` by hand against the current `backoff.go` and confirmed the plan's mechanism (see § Why) before writing this intake; the numbers below are from that trace, not copied from the plan alone.

## Why

**The pain point.** `internal/cron`'s `backoff` schedule is stateless: the rung is reconstructed on every tick from the entry's own delivery log by `JoinAnchor` (`app/backend/internal/cron/backoff.go`). The reconstruction is a backward streak walk seeded from the newest gap between two own deliveries. The seed is

```go
expectRung = smallestRungWithGapAtLeast(min, max, gap-attributionWindow)
```

with `attributionWindow = 120s` — exactly the size of the rung-1 → rung-2 ladder gap (`2·min` for the operator entry's `min: 60s`). Subtracting it before seeding under-estimates every gap by one whole rung:

| Own deliveries | Newest gap | Seed threshold | Seed rung | Streak | Anchor | Next fire (today) | Next fire (ladder) |
|----------------|-----------|----------------|-----------|--------|--------|-------------------|--------------------|
| T+1m, T+3m, T+7m | 4m | 4m − 2m = 2m | 1 (gapAfter(1)=2m ≥ 2m) | 2 | T+2m | **T+9m** (gap 2m) | T+15m (gap 8m) |
| …, T+9m | 2m | 0 | 1 | 2 | T+2m… | +4m | — |

The ladder therefore oscillates between a 2m and a 4m gap forever. This is exactly the `runKit.log` shape observed for five hours on the night of 2026-09-09/10 (19:00–00:33): every `reason: schedule` fire alternated **120s / 240s** and never reached 8m, 16m, or the 30m cap. An idle operator was ticked ~20×/hour all night instead of decaying to 2×/hour. Gaps ≥ 8m happen to seed correctly (8m − 2m = 6m > 4m ⇒ rung 3), which is why the existing 4-delivery test (`TestAnchorJoinMultiDeliveryStreak`, gaps 2/4/8m) passes and the 3-delivery shape was never pinned.

**The consequence of not fixing it.** Every idle stretch of the operator costs one Claude turn every 2–4 minutes for as long as it lasts — pure token and log noise (ticks are idempotent, so correctness is unaffected). The fab-kit mute-lease follow-up (`qvek`) quiets an operator with *nothing tracked*; it does not help an operator that is tracking work and is simply waiting, which is the case the ladder exists for.

**Why this approach.** Lateness only ever *inflates* an observed gap (a late poll, a daemon restart): a genuine rung-r gap is observed as `gapAfter(r) + [0, jitter]`, never smaller. So the seed should be the **largest** rung whose ladder gap fits inside `gap + small skew`, not the smallest rung whose gap reaches `gap − 2m`. The only skew a normally running invoker introduces is one poll period (`DefaultTickInterval`, 30s). The walk-back's *membership* check (`gap < gapAfter(expectRung) − attributionWindow ⇒ break`) is a different question — whether an older delivery belongs to this ladder at all — and keeps its tolerance; only the seed changes. `attributionWindow` stays what it is: the epoch-attribution window, not a gap tolerance.

Alternatives rejected in the plan: persisting the rung in a sidecar (Constitution II — the ladder must remain a pure function of on-disk inputs); changing `DefaultTickInterval` (the 30s poll is the coalescing window and is fine); touching the wake path (Change 1).

## What Changes

### `app/backend/internal/cron/backoff.go` — the seed

Replace `smallestRungWithGapAtLeast` (single call site, verified by grep — nothing else uses it) with a largest-fitting-rung seed plus a named jitter constant:

```go
// seedSkew is the invoker jitter the seed tolerates: one DefaultTickInterval.
// The daemon polls every 30s, so a due fire is observed at most one poll late.
// Lateness only ever INFLATES an observed gap, so the seed adds the skew to
// the gap and picks the largest rung the inflated gap can hold — it never
// subtracts a tolerance (subtracting attributionWindow, one whole rung-1→2
// gap, under-seeded every three-delivery streak and pinned the ladder at
// rungs 2↔3: the 120s/240s alternation).
const seedSkew = DefaultTickInterval // 30s

// largestRungWithGapAtMost returns the largest rung r ≥ 1 whose gapAfter(r)
// is ≤ threshold, or 0 when even gapAfter(1) exceeds it — the newest gap is
// too small for any rung-to-rung spacing, so the newer delivery is rung 1 of
// a fresh ladder and nothing older can join. Cap-saturated rungs are
// indistinguishable; the smallest saturated rung is returned (an
// under-estimated anchor fires early at most once; the next delivery's gap
// re-bases the ladder, and fires are idempotent by contract).
func largestRungWithGapAtMost(min, max, threshold time.Duration) int {
	r := 0
	for next := 1; ; next++ {
		g := gapAfter(min, max, next)
		if g > threshold {
			return r
		}
		r = next
		if g >= max {
			return r
		}
	}
}
```

`DefaultTickInterval` is declared in `ticker.go` in the same package; if the apply worker finds it is not (it is — verified), fall back to a literal `30 * time.Second` with the same comment.

The walk in `JoinAnchor` changes only at the seed branch:

```go
	for i := n - 1; i > 0; i-- {
		gap := time.Duration(deliveries[i].TS-deliveries[i-1].TS) * time.Second
		if expectRung < 0 {
			expectRung = largestRungWithGapAtMost(min, max, gap+seedSkew)
			if expectRung < 1 {
				break // gap too small for any ladder spacing: streak is the newest delivery alone
			}
			streak++
		} else {
			if gap < gapAfter(min, max, expectRung)-attributionWindow {
				break
			}
			streak++
		}
		expectRung--
		if expectRung < 1 {
			break
		}
	}
```

Everything after the loop (oldest-streak anchor, `Rung: streak`, the consistency floor) is unchanged. The file's header comment ("the rung continues as the trailing streak of own deliveries consistent with the ladder shape") stays true; add one line naming the seed rule.

**Behavior of the new seed on every shape the package already pins** (hand-traced; the apply worker should confirm by running the package tests, not by trusting this table):

| Test | Deliveries | Newest gap → seed | Result | Same as today? |
|------|-----------|-------------------|--------|----------------|
| `TestAnchorJoinWorkedScenario` | +1m, +3m | 2m+30s → rung 1 | streak 2, anchor T, next +7m | yes |
| `TestAnchorJoinMultiDeliveryStreak` | +1m, +3m, +7m, +15m | 8m30s → rung 3 | walk joins 4m, 2m gaps; streak 4, anchor T, next +31m | yes |
| `TestAnchorJoinRestartTolerance` | +1m, +3m, +10m | 7m30s → rung 2 | joins 2m gap; streak 3, anchor T, next +15m | yes |
| `TestAnchorJoinStreakBreak` | +1m, +3m, +21m | 18m30s → rung 4 | 2m < gapAfter(3)−2m=6m ⇒ break; streak 2, anchor T+2m, next T+9m < floor T+22m ⇒ single-delivery fallback, next **+23m** | yes (inside the test's `(T+21m, T+36m]` bounds) |
| `TestAnchorJoinAttributionWindow`, `TestAnchorJoinNoDeliveries` | 1 / 0 deliveries | loop not entered | unchanged | yes |
| `derive_test.go`, `evaluate_test.go` backoff cases | +1m, +3m | as WorkedScenario | unchanged | yes |

**One behavior that does change besides the fix itself.** Two own deliveries closer than `2·min − seedSkew` (e.g. the 30s-apart `wake` deliveries visible in the live log) used to be forced into a rung-1 spacing (`gap − 2m < 0` ⇒ seed 1 ⇒ streak 2, anchor = older − min). They now seed rung 0 ⇒ streak 1 ⇒ anchor = newest − min, rung 1, next fire = newest + `2·min`. This is the honest reading (no ladder produces a sub-`2·min` gap) and coincides with the consistency-floor fallback shape. Under a wake storm the *schedule* leg may therefore fire once at +2m where it used to wait +5m30s; wake storms are Change 1's problem, and this change does not try to paper over them.

### `app/backend/internal/cron/backoff_test.go` — pin the missing shapes

1. **`TestAnchorJoinThreeDeliveryStreak`** — the shape that was never pinned. Deliveries at T+1m, T+3m, T+7m; raw epoch T+7m+5s (attributed). Expect `Anchor == T`, `Rung == 3`, `NextFire == T+15m`. Include in the failure message what today's code answers (`Rung 2`, `T+9m`) so the regression is self-describing — mirror the style of `TestAnchorJoinWorkedScenario`.

2. **`TestAnchorJoinEscapesAlternation`** — the observed pathological log replayed **forward**. Start from own deliveries at `0, 2m, 6m, 8m, 12m, 14m` (the 2m/4m alternation as logged). Loop: derive the ladder with an epoch a few seconds after the newest delivery, take `NextFire`, append it as the next delivery, repeat. Assert the sequence of gaps is `4m` (the newest 2m gap legitimately reads as rung 1, so the first reconstruction still says +4m), then `8m`, `16m`, `30m`, `30m` — the alternation is no longer a fixed point. Today's code produces `4m, 2m, 4m, 2m, …` and must fail this test.

3. **`TestLargestRungWithGapAtMost`** — table test over the helper: threshold below `gapAfter(1)` ⇒ 0; exactly `gapAfter(r)` ⇒ r; between rungs ⇒ the lower rung; at or above `max` ⇒ the smallest saturated rung (with `min=1m, max=30m`: threshold 30m ⇒ 5, threshold 3h ⇒ 5); degenerate `max < min` terminates (gapAfter clamps, so the loop returns at rung 1).

4. Existing `TestAnchorJoin*`, `TestGapAfter`, `TestLadderGapCap` stay green unmodified. Delete nothing but the retired helper (`TestGapAfter` does not reference it).

### `docs/memory/run-kit/cron.md` — memory delta (apply drafts, hydrate finalizes)

In § "`backoff` and the anchor-join rule", second bullet: replace the sentence *"Cap-saturated gaps make deep rungs indistinguishable — the smallest consistent rung is chosen (…)"* with the seed rule — the walk is seeded from the newest gap as the **largest** rung whose ladder gap is ≤ gap + `seedSkew` (named constant, 30s = one `DefaultTickInterval`; lateness only inflates a gap, so the seed adds jitter rather than subtracting a tolerance); a gap below `2·min − seedSkew` seeds no walk (the newest delivery is rung 1 of a fresh ladder); cap-saturated gaps remain indistinguishable and take the smallest saturated rung. Add a `## Design Decisions` entry (four-field shape) *"Seed the streak walk from the largest fitting rung"* whose **Rejected** field records the shipped v1 seed (smallest rung ≥ gap − `attributionWindow`) and the 120s/240s alternation it caused. In the memory's requirements text for `backoff` (the paragraph beginning "A `backoff` entry SHALL fire on the ladder…"), append: *a clean own-delivery streak of any length SHALL reconstruct to its ladder rung*. `docs/specs/cron.md` needs no edit — it states the anchor-join rule without seed-level detail.

## Affected Memory

- `run-kit/cron`: (modify) § backoff / anchor-join — seed rule (largest fitting rung, `seedSkew`), the sub-`2·min` fresh-ladder case, a Design Decisions entry recording the rejected v1 seed, one requirement sentence.

## Impact

- **Code**: `app/backend/internal/cron/backoff.go` (one helper replaced, one constant added, one branch of `JoinAnchor` changed) and `backoff_test.go` (three tests added). No other file. `evaluate.go` and `derive.go` call `JoinAnchor` unchanged and need no edit.
- **Schema / on-disk state**: none. Entry files, the delivery log, and the wake cursor are untouched; no migration. The fix takes effect on the first tick after deploy because the ladder is recomputed from the log every tick.
- **API / UI**: `GET /api/cron`'s `rung` and `nextFire` for `backoff` entries will report the corrected values (via `DeriveEntry` → `JoinAnchor`); the sidebar CLOCK section reads them. No wire-shape change.
- **Verification**: `just test-backend` (the package tests above). Live acceptance — the next quiet operator stretch shows `schedule` gaps of 60, 120, 240, 480, 960, 1800, 1800… in `~/.local/state/run-kit/cron/runKit.log` (allow one poll of lateness each) — happens after ship, outside the pipeline.
- **Interaction with Change 1**: independent. Until Change 1 ships, `wake` fires keep landing on `9de2` in bursts; those deliveries are own deliveries too, so under a wake storm the schedule leg reads rung 1 (see § What Changes). Neither change blocks the other.

## Open Questions

None. The plan fixes the design; the one detail it left implicit (a newest gap too small for any rung) is decided below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is exactly plan § Change 2 / D6: seed replacement in `backoff.go` + tests + memory delta. Change 1 (wake path) is not touched. | User named Change 2 explicitly and called it independent; the plan lists the two as separate fab changes. | S:95 R:90 A:95 D:95 |
| 2 | Certain | `seedSkew` is a named constant equal to `DefaultTickInterval` (30s), declared in `backoff.go` with the reasoning comment. | Plan D6 says "30s — one DefaultTickInterval; state it as a named const with the reasoning"; both live in package `cron`. | S:90 R:90 A:95 D:90 |
| 3 | Certain | The walk-back membership check keeps its `attributionWindow` tolerance; only the seed changes. `attributionWindow` itself is unchanged at 120s. | Plan D6 states this verbatim; the traced existing tests depend on it (`StreakBreak`). | S:95 R:85 A:90 D:90 |
| 4 | Certain | Retire `smallestRungWithGapAtLeast`. | Single call site (grep-verified); the plan says retire if unused. | S:90 R:95 A:100 D:95 |
| 5 | Confident | A newest gap below `2·min − seedSkew` seeds rung 0 ⇒ streak 1 (newest delivery is rung 1 of a fresh ladder), instead of today's forced rung-1 seed (streak 2). | Plan did not address the case; the fresh-ladder reading is the only one consistent with the ladder shape and matches the existing consistency-floor fallback. Changes behavior for 30s-apart wake deliveries (documented in § What Changes). Trivially reversible in one line. | S:60 R:85 A:80 D:70 |
| 6 | Confident | Cap-saturated thresholds return the smallest saturated rung (loop stops at the first rung whose gap reaches `max`). | Preserves the existing "smallest consistent rung" rationale for saturated gaps, which the plan does not revisit; bounds the loop without the old magic `60`. | S:55 R:85 A:85 D:80 |
| 7 | Confident | Do not carry the plan file on this branch; it lands via Change 1's PR #899 (`4gt7`), which committed the same path. | A copy was briefly added here and removed during review-pr once #899 appeared — two PRs adding the same path would add/add-conflict on merge. § Origin's path resolves once #899 merges. | S:70 R:90 A:85 D:80 |
| 8 | Certain | Documentation delta is memory-only (`docs/memory/run-kit/cron.md`); `docs/specs/cron.md` is not edited. | Plan § Change 2 lists only the memory delta; the spec states the anchor-join rule without seed detail. | S:80 R:90 A:85 D:85 |
| 9 | Certain | Pipeline verification gate is `just test-backend`; live log verification is post-ship and out of pipeline scope. | Plan § Acceptance for Change 2 names exactly these two, and the live check needs an hours-long quiet stretch. | S:85 R:90 A:90 D:90 |

9 assumptions (6 certain, 3 confident, 0 tentative, 0 unresolved).
