package cron

import "time"

// backoff.go — the `backoff` ladder math and the anchor-join rule (R6).
//
// Ladder: fire times are anchor + min·(2ⁿ − 1) — gaps min, 2·min, 4·min, …
// with each gap capped at max.
//
// Anchor-join (load-bearing): the effective anchor is the last activity NOT
// caused by the clock. The raw idle epoch (from @rk_pane_agent_state) is joined
// against the entry's own delivery log: a raw epoch within attributionWindow
// after the entry's own latest delivery was caused by that delivery and does
// NOT reset the ladder — the rung continues as the trailing streak of own
// deliveries consistent with the ladder shape, seeded from the newest gap as
// the largest rung that gap can hold (lateness only inflates a gap, never
// shrinks it). A non-attributed epoch is genuine activity: the ladder resets
// to rung 0 with the epoch as anchor. Both inputs (pane option, log) live on
// disk, so the schedule stays a pure function and a restart at worst re-fires
// one due tick.

// attributionWindow is how long after one of the entry's own deliveries a raw
// idle epoch is attributed to that delivery (the agent going busy/idle because
// the payload landed) rather than counted as genuine activity.
const attributionWindow = 120 * time.Second

// gapAfter returns the gap between rung n and rung n+1 fires: min·2ⁿ capped at
// max. gapAfter(0) = min (anchor → rung-1 fire).
func gapAfter(min, max time.Duration, rung int) time.Duration {
	if max < min {
		max = min
	}
	g := min
	for i := 0; i < rung; i++ {
		if g >= max || g > max-g {
			return max
		}
		g *= 2
	}
	return g
}

// Ladder is a derived backoff state: the effective anchor and how many rungs
// have already fired on it.
type Ladder struct {
	Anchor time.Time
	Rung   int
}

// NextFire is when rung Rung+1 comes due.
func (l Ladder) NextFire(min, max time.Duration) time.Time {
	t := l.Anchor
	for n := 1; n <= l.Rung+1; n++ {
		t = t.Add(gapAfter(min, max, n-1))
	}
	return t
}

// Due reports whether the next rung has come due by now.
func (l Ladder) Due(now time.Time, min, max time.Duration) bool {
	return !now.Before(l.NextFire(min, max))
}

// attributed reports whether the raw epoch falls within the attribution window
// of the entry's latest delivery (including the stale-option skew case where
// the epoch still predates the delivery — the delivery is then by definition
// the latest activity).
func attributed(rawEpoch int64, lastDeliveryTS int64) bool {
	return rawEpoch <= lastDeliveryTS+int64(attributionWindow/time.Second)
}

// seedSkew is the invoker jitter the streak-walk seed tolerates: one
// DefaultTickInterval, because a due fire is observed at most one poll late.
// Lateness only ever INFLATES an observed gap, so the seed adds the skew to
// the gap and takes the largest rung the inflated gap can hold. It must never
// subtract a tolerance: subtracting attributionWindow (one whole rung-1→2 gap
// at the default min) under-seeds every three-delivery streak and pins the
// ladder at rungs 2↔3 — a 2·min / 4·min alternation that never decays.
const seedSkew = DefaultTickInterval

// largestRungWithGapAtMost returns the largest rung r ≥ 1 whose gapAfter(r)
// is ≤ threshold. Used to seed the backward streak walk: a gap of size g
// between the two newest streak deliveries means the newer one fired at rung
// r+1 where r is the largest rung whose gap fits inside g. Returns 0 when even
// gapAfter(1) exceeds threshold — no rung-to-rung spacing fits, so the newer
// delivery is rung 1 of a fresh ladder and nothing older can join it.
// Cap-saturated rungs are indistinguishable; the smallest saturated rung is
// returned (an under-estimated anchor fires early at most once; the next
// delivery's gap re-bases the ladder, and fires are idempotent by contract).
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

// JoinAnchor derives the effective ladder from the raw idle epoch joined
// against the entry's own delivery log (chronological). This is THE
// anchor-join: an implementation that ladders off the raw epoch alone resets
// after every delivery — the self-resetting-ladder bug this function exists to
// prevent.
func JoinAnchor(rawEpoch int64, deliveries []LogLine, min, max time.Duration) Ladder {
	n := len(deliveries)
	if n == 0 || !attributed(rawEpoch, deliveries[n-1].TS) {
		// No deliveries, or genuine activity after the last one: reset.
		return Ladder{Anchor: time.Unix(rawEpoch, 0), Rung: 0}
	}
	// The raw epoch was clock-caused. Recover the streak: walk the log
	// backward from the newest delivery, keeping deliveries whose spacing fits
	// the ladder shape (gaps must not be SMALLER than the ladder gap at their
	// rung, minus the attribution tolerance — a smaller gap means the older
	// delivery belongs to a previous ladder that a genuine-activity reset
	// ended; larger gaps are invoker lateness, which idempotent ticks absorb).
	streak := 1
	expectRung := -1 // gap rung expected between the next older pair; -1: seed from first gap
	for i := n - 1; i > 0; i-- {
		gap := time.Duration(deliveries[i].TS-deliveries[i-1].TS) * time.Second
		if expectRung < 0 {
			expectRung = largestRungWithGapAtMost(min, max, gap+seedSkew)
			if expectRung < 1 {
				break // no ladder spacing fits: the streak is the newest delivery alone
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
			break // the oldest streak delivery fired at rung 1; nothing older can join
		}
	}
	oldest := deliveries[n-streak]
	anchor := time.Unix(oldest.TS, 0).Add(-min) // rung-1 fire = anchor + min
	ladder := Ladder{Anchor: anchor, Rung: streak}
	// Consistency floor: on a continuing ladder the next fire is never earlier
	// than last-delivery + min. An ambiguous history (late fire vs. reset is
	// not always distinguishable from the log alone) can reconstruct a ladder
	// whose next fire predates that floor — fall back to the conservative
	// single-delivery streak (the newest delivery as rung 1 of a fresh ladder).
	floor := time.Unix(deliveries[n-1].TS, 0).Add(min)
	if ladder.NextFire(min, max).Before(floor) {
		ladder = Ladder{Anchor: time.Unix(deliveries[n-1].TS, 0).Add(-min), Rung: 1}
	}
	return ladder
}
