package cron

import (
	"testing"
	"time"
)

var backoffBase = time.Unix(1_700_000_000, 0) // "T"

func own(ts ...int64) []LogLine {
	lines := make([]LogLine, len(ts))
	for i, t := range ts {
		lines[i] = LogLine{TS: t, Entry: "a3f9"}
	}
	return lines
}

func unix(base time.Time, d time.Duration) int64 {
	return base.Add(d).Unix()
}

func TestGapAfter(t *testing.T) {
	min, max := time.Minute, 30*time.Minute
	want := []time.Duration{time.Minute, 2 * time.Minute, 4 * time.Minute, 8 * time.Minute, 16 * time.Minute, 30 * time.Minute, 30 * time.Minute}
	for rung, w := range want {
		if got := gapAfter(min, max, rung); got != w {
			t.Errorf("gapAfter(rung %d) = %v, want %v", rung, got, w)
		}
	}
	// max < min degenerates to min (validation normally rejects it).
	if got := gapAfter(time.Hour, time.Minute, 3); got != time.Hour {
		t.Errorf("gapAfter(max<min) = %v, want min", got)
	}
}

// TestAnchorJoinWorkedScenario is the intake's worked scenario (A-014) and the
// self-resetting-ladder regression (A-006): deliveries at T+1m and T+3m, raw
// epoch 5s after the T+3m delivery (attributed) ⇒ next fire is T+7m rung 3.
// A raw-epoch-only implementation would answer epoch+60s (T+3m5s+1m) with rung
// 1 — this test makes that implementation impossible.
func TestAnchorJoinWorkedScenario(t *testing.T) {
	T := backoffBase
	min, max := 60*time.Second, 30*time.Minute
	deliveries := own(unix(T, time.Minute), unix(T, 3*time.Minute))
	rawEpoch := unix(T, 3*time.Minute+5*time.Second)

	ladder := JoinAnchor(rawEpoch, deliveries, min, max)
	if !ladder.Anchor.Equal(T) {
		t.Errorf("anchor = %v, want T (%v)", ladder.Anchor, T)
	}
	if ladder.Rung != 2 {
		t.Errorf("rung = %d, want 2 — the ladder did not reset", ladder.Rung)
	}
	next := ladder.NextFire(min, max)
	if want := T.Add(7 * time.Minute); !next.Equal(want) {
		t.Errorf("next fire = %v, want %v (rung 3) — a raw-epoch ladder would say %v",
			next, want, time.Unix(rawEpoch, 0).Add(min))
	}
	if ladder.Due(T.Add(6*time.Minute+59*time.Second), min, max) {
		t.Error("due at T+6m59s, want not due")
	}
	if !ladder.Due(T.Add(7*time.Minute), min, max) {
		t.Error("not due at T+7m, want due")
	}

	// Genuine activity: a raw epoch 10m after the last delivery is NOT
	// attributed — the ladder resets to rung 0 with the epoch as anchor.
	genuine := unix(T, 13*time.Minute)
	ladder = JoinAnchor(genuine, deliveries, min, max)
	if ladder.Rung != 0 || !ladder.Anchor.Equal(time.Unix(genuine, 0)) {
		t.Errorf("reset: anchor=%v rung=%d, want epoch anchor rung 0", ladder.Anchor, ladder.Rung)
	}
	if next := ladder.NextFire(min, max); !next.Equal(T.Add(14 * time.Minute)) {
		t.Errorf("next fire = %v, want epoch+60s (T+14m)", next)
	}
}

// TestAnchorJoinAttributionWindow pins the window boundary.
func TestAnchorJoinAttributionWindow(t *testing.T) {
	T := backoffBase
	min, max := 60*time.Second, 30*time.Minute
	deliveries := own(unix(T, time.Minute))
	last := unix(T, time.Minute)

	atBoundary := JoinAnchor(last+120, deliveries, min, max)
	if atBoundary.Rung != 1 {
		t.Errorf("epoch at last+120s: rung = %d, want 1 (attributed)", atBoundary.Rung)
	}
	pastBoundary := JoinAnchor(last+121, deliveries, min, max)
	if pastBoundary.Rung != 0 {
		t.Errorf("epoch at last+121s: rung = %d, want 0 (genuine activity, reset)", pastBoundary.Rung)
	}
	// Stale-option skew: an epoch still predating the delivery is attributed
	// (the delivery is by definition the latest activity).
	skewed := JoinAnchor(last-30, deliveries, min, max)
	if skewed.Rung != 1 {
		t.Errorf("predating epoch: rung = %d, want 1 (attributed)", skewed.Rung)
	}
}

// TestAnchorJoinMultiDeliveryStreak: a full on-time ladder recovers its rung
// from the log alone after a restart.
func TestAnchorJoinMultiDeliveryStreak(t *testing.T) {
	T := backoffBase
	min, max := 60*time.Second, 30*time.Minute
	// On-time rungs 1–4: fires at +1m, +3m, +7m, +15m.
	deliveries := own(unix(T, time.Minute), unix(T, 3*time.Minute), unix(T, 7*time.Minute), unix(T, 15*time.Minute))
	ladder := JoinAnchor(unix(T, 15*time.Minute+3*time.Second), deliveries, min, max)
	if ladder.Rung != 4 || !ladder.Anchor.Equal(T) {
		t.Fatalf("streak: anchor=%v rung=%d, want T rung 4", ladder.Anchor, ladder.Rung)
	}
	if next := ladder.NextFire(min, max); !next.Equal(T.Add(31 * time.Minute)) {
		t.Errorf("next fire = %v, want T+31m (rung 5)", next)
	}
}

// TestAnchorJoinRestartTolerance: the invoker was down between rung 2 (T+3m)
// and rung 3 (fired late at T+10m); the join still recovers the ladder, so a
// restart at worst re-fires one due tick rather than losing the ladder.
func TestAnchorJoinRestartTolerance(t *testing.T) {
	T := backoffBase
	min, max := 60*time.Second, 30*time.Minute
	deliveries := own(unix(T, time.Minute), unix(T, 3*time.Minute), unix(T, 10*time.Minute))
	ladder := JoinAnchor(unix(T, 10*time.Minute+2*time.Second), deliveries, min, max)
	if ladder.Rung != 3 || !ladder.Anchor.Equal(T) {
		t.Fatalf("after late fire: anchor=%v rung=%d, want T rung 3", ladder.Anchor, ladder.Rung)
	}
	if next := ladder.NextFire(min, max); !next.Equal(T.Add(15 * time.Minute)) {
		t.Errorf("next fire = %v, want T+15m (rung 4)", next)
	}
}

// TestAnchorJoinStreakBreak: a gap too small for the seeded rung means the
// older delivery belongs to a previous (reset-ended) ladder — the streak
// breaks there. Pins the maximal-consistent-streak approximation.
func TestAnchorJoinStreakBreak(t *testing.T) {
	T := backoffBase
	min, max := 60*time.Second, 30*time.Minute
	// d1/d2 on an old ladder, then a 18m gap (reset window), d3 late.
	deliveries := own(unix(T, time.Minute), unix(T, 3*time.Minute), unix(T, 21*time.Minute))
	ladder := JoinAnchor(unix(T, 21*time.Minute+time.Second), deliveries, min, max)
	if ladder.Rung < 1 {
		t.Fatalf("rung = %d, want ≥ 1", ladder.Rung)
	}
	next := ladder.NextFire(min, max)
	if !next.After(T.Add(21 * time.Minute)) {
		t.Errorf("next fire = %v, want after the latest delivery (T+21m)", next)
	}
	if next.After(T.Add(36 * time.Minute)) {
		t.Errorf("next fire = %v exceeds even a full reset-to-T+21m ladder (T+22m) plus slack", next)
	}
}

// TestAnchorJoinNoDeliveries: with no logged delivery the raw epoch is the anchor.
func TestAnchorJoinNoDeliveries(t *testing.T) {
	T := backoffBase
	ladder := JoinAnchor(unix(T, 0), nil, 60*time.Second, 30*time.Minute)
	if ladder.Rung != 0 || !ladder.Anchor.Equal(T) {
		t.Errorf("anchor=%v rung=%d, want T rung 0", ladder.Anchor, ladder.Rung)
	}
	if next := ladder.NextFire(60*time.Second, 30*time.Minute); !next.Equal(T.Add(60 * time.Second)) {
		t.Errorf("next fire = %v, want T+1m", next)
	}
}

// TestLadderGapCap: gaps never exceed max, so fire times stay bounded.
func TestLadderGapCap(t *testing.T) {
	min, max := time.Minute, 5*time.Minute
	anchor := backoffBase
	ladder := Ladder{Anchor: anchor, Rung: 0}
	wantFires := []time.Duration{time.Minute, 3 * time.Minute, 7 * time.Minute, 12 * time.Minute, 17 * time.Minute}
	for i, w := range wantFires {
		if got := ladder.NextFire(min, max); !got.Equal(anchor.Add(w)) {
			t.Errorf("fire %d = %v, want anchor+%v", i+1, got.Sub(anchor), w)
		}
		ladder.Rung++
	}
}

// TestAnchorJoinThreeDeliveryStreak pins the shape the v1 seed got wrong:
// deliveries at T+1m, T+3m, T+7m (gaps 2m, 4m) are a clean rung-1..3 streak,
// so the next fire is T+15m (rung 4). A seed that subtracts attributionWindow
// from the newest gap reads 4m as a rung-1 gap, reconstructs rung 2 with the
// anchor at T+2m, and answers T+9m — the 2m/4m alternation this test forbids.
func TestAnchorJoinThreeDeliveryStreak(t *testing.T) {
	T := backoffBase
	min, max := 60*time.Second, 30*time.Minute
	deliveries := own(unix(T, time.Minute), unix(T, 3*time.Minute), unix(T, 7*time.Minute))
	ladder := JoinAnchor(unix(T, 7*time.Minute+5*time.Second), deliveries, min, max)
	if ladder.Rung != 3 || !ladder.Anchor.Equal(T) {
		t.Fatalf("streak: anchor=%v rung=%d, want T rung 3 (an under-seeded walk says T+2m rung 2)", ladder.Anchor, ladder.Rung)
	}
	if next := ladder.NextFire(min, max); !next.Equal(T.Add(15 * time.Minute)) {
		t.Errorf("next fire = %v, want T+15m (rung 4) — an under-seeded walk says T+9m", next)
	}
}

// TestAnchorJoinEscapesAlternation replays the observed pathological log
// forward: an operator ticked at 0, 2m, 6m, 8m, 12m, 14m (the 2m/4m
// alternation). The newest 2m gap legitimately reads as a rung-1 gap, so the
// first reconstruction still fires 4m later — but from there the ladder must
// climb 8m, 16m, 30m and then STAY at 30m rather than fall back to 2m. The v1
// seed produced 4m, 2m, 4m, 2m, … forever; a walk that descends a rung on
// every capped gap climbs correctly and then collapses to 2m right after the
// second 30m gap.
func TestAnchorJoinEscapesAlternation(t *testing.T) {
	T := backoffBase
	min, max := 60*time.Second, 30*time.Minute
	deliveries := own(unix(T, 0), unix(T, 2*time.Minute), unix(T, 6*time.Minute),
		unix(T, 8*time.Minute), unix(T, 12*time.Minute), unix(T, 14*time.Minute))
	wantGaps := []time.Duration{4 * time.Minute, 8 * time.Minute, 16 * time.Minute,
		30 * time.Minute, 30 * time.Minute, 30 * time.Minute, 30 * time.Minute, 30 * time.Minute}
	for i, want := range wantGaps {
		last := deliveries[len(deliveries)-1].TS
		ladder := JoinAnchor(last+3, deliveries, min, max)
		next := ladder.NextFire(min, max)
		if got := next.Sub(time.Unix(last, 0)); got != want {
			t.Fatalf("fire %d: gap after last delivery = %v, want %v (gaps so far %v)", i+1, got, want, wantGaps[:i])
		}
		deliveries = append(deliveries, LogLine{TS: next.Unix(), Entry: "a3f9"})
	}
}

// TestAnchorJoinSubLadderGap: two deliveries closer than any rung-to-rung
// spacing (30s apart — e.g. wake fires) cannot be one ladder; the newest is
// rung 1 of a fresh ladder and the older one does not join.
func TestAnchorJoinSubLadderGap(t *testing.T) {
	T := backoffBase
	min, max := 60*time.Second, 30*time.Minute
	deliveries := own(unix(T, 0), unix(T, 30*time.Second))
	ladder := JoinAnchor(unix(T, 32*time.Second), deliveries, min, max)
	if ladder.Rung != 1 || !ladder.Anchor.Equal(T.Add(30*time.Second-min)) {
		t.Fatalf("anchor=%v rung=%d, want newest−min rung 1", ladder.Anchor, ladder.Rung)
	}
	if next := ladder.NextFire(min, max); !next.Equal(T.Add(2*time.Minute + 30*time.Second)) {
		t.Errorf("next fire = %v, want newest+2m (T+2m30s)", next)
	}
}

func TestLargestRungWithGapAtMost(t *testing.T) {
	min, max := time.Minute, 30*time.Minute
	cases := []struct {
		threshold time.Duration
		want      int
	}{
		{time.Minute, 0},                 // below gapAfter(1)=2m: nothing fits
		{2*time.Minute - time.Second, 0}, // still below rung 1
		{2 * time.Minute, 1},             // exactly rung 1
		{2*time.Minute + 30*time.Second, 1},
		{4 * time.Minute, 2},
		{7 * time.Minute, 2}, // between rungs 2 (4m) and 3 (8m): the lower rung
		{8 * time.Minute, 3},
		{16 * time.Minute, 4},
		{30 * time.Minute, 5}, // first saturated rung
		{3 * time.Hour, 5},    // saturated: deeper rungs are indistinguishable
	}
	for _, c := range cases {
		if got := largestRungWithGapAtMost(min, max, c.threshold); got != c.want {
			t.Errorf("largestRungWithGapAtMost(%v) = %d, want %d", c.threshold, got, c.want)
		}
	}
	// max < min degenerates to a flat ladder at min (gapAfter clamps); the
	// loop must terminate at the first (saturated) rung.
	if got := largestRungWithGapAtMost(time.Hour, time.Minute, 2*time.Hour); got != 1 {
		t.Errorf("largestRungWithGapAtMost(max<min) = %d, want 1", got)
	}
	if got := largestRungWithGapAtMost(time.Hour, time.Minute, time.Minute); got != 0 {
		t.Errorf("largestRungWithGapAtMost(max<min, below min) = %d, want 0", got)
	}
}

// TestGapAfterFlat: a flat ladder (min == max) returns min on every rung —
// the first iteration hits the cap. Pins the `--idle-every` expansion's math.
func TestGapAfterFlat(t *testing.T) {
	const flat = 3 * time.Minute
	for rung := 0; rung < 8; rung++ {
		if got := gapAfter(flat, flat, rung); got != flat {
			t.Errorf("gapAfter(min==max, rung %d) = %v, want %v", rung, got, flat)
		}
	}
}

// TestAnchorJoinFlatLadder: on a min == max ladder the streak walk's
// cap-saturated branch counts each 3m gap as one more rung at the cap — own
// lines at T+3m/T+6m/T+9m with an attributed epoch give rung 3 anchored at T,
// next fire T+12m. A non-attributed epoch resets to rung 0 at the epoch.
func TestAnchorJoinFlatLadder(t *testing.T) {
	T := backoffBase
	const flat = 3 * time.Minute
	deliveries := own(unix(T, 3*time.Minute), unix(T, 6*time.Minute), unix(T, 9*time.Minute))

	ladder := JoinAnchor(unix(T, 9*time.Minute+5*time.Second), deliveries, flat, flat)
	if !ladder.Anchor.Equal(T) || ladder.Rung != 3 {
		t.Fatalf("attributed: anchor=%v rung=%d, want T rung 3", ladder.Anchor, ladder.Rung)
	}
	if next := ladder.NextFire(flat, flat); !next.Equal(T.Add(12 * time.Minute)) {
		t.Errorf("next fire = %v, want T+12m", next)
	}

	genuine := unix(T, 14*time.Minute)
	ladder = JoinAnchor(genuine, deliveries, flat, flat)
	if ladder.Rung != 0 || !ladder.Anchor.Equal(time.Unix(genuine, 0)) {
		t.Errorf("reset: anchor=%v rung=%d, want epoch anchor rung 0", ladder.Anchor, ladder.Rung)
	}
	if next := ladder.NextFire(flat, flat); !next.Equal(time.Unix(genuine, 0).Add(flat)) {
		t.Errorf("next fire = %v, want epoch+3m", next)
	}
}

// TestJoinAnchorAfterReschedule: the `rescheduled` line cuts the streak —
// deliveries logged under the old schedule (T+1m, T+3m, T+7m) never become
// rungs of the new flat ladder, so the anchor restarts from the raw idle
// epoch T+2m and the next fire (T+5m) is already due at the edit time T+8m.
func TestJoinAnchorAfterReschedule(t *testing.T) {
	T := backoffBase
	const flat = 3 * time.Minute
	log := []LogLine{
		{TS: unix(T, time.Minute), Entry: "a3f9", Outcome: "delivered"},
		{TS: unix(T, 3*time.Minute), Entry: "a3f9", Outcome: "delivered"},
		{TS: unix(T, 7*time.Minute), Entry: "a3f9", Outcome: "delivered"},
		{TS: unix(T, 8*time.Minute), Entry: "a3f9", Reason: "edit", Outcome: "rescheduled"},
	}
	epoch := unix(T, 2*time.Minute) // idle since before the edit

	history := ScheduleHistory(log, "a3f9")
	if len(history) != 0 {
		t.Fatalf("ScheduleHistory = %+v, want nothing newer than the boundary", history)
	}
	ladder := JoinAnchor(epoch, history, flat, flat)
	if ladder.Rung != 0 || !ladder.Anchor.Equal(time.Unix(epoch, 0)) {
		t.Errorf("ladder = anchor %v rung %d, want epoch anchor rung 0", ladder.Anchor, ladder.Rung)
	}
	next := ladder.NextFire(flat, flat)
	if !next.Equal(T.Add(5 * time.Minute)) {
		t.Errorf("next fire = %v, want T+5m", next)
	}
	if !ladder.Due(T.Add(8*time.Minute), flat, flat) {
		t.Error("not due at the edit time T+8m — the agent has been quiet longer than min")
	}
}

// TestAnchorJoinCappedStreak: a streak that has reached the gap cap keeps its
// full rung count. Deliveries at +1,+3,+7,+15,+31,+61,+91 are rungs 1–7 (the
// last two gaps capped at 30m); the next fire is +121m. A walk that descends a
// rung on every capped gap joins only six deliveries, anchors at +2m, and
// answers +93m — a 2m gap right after reaching the cap.
func TestAnchorJoinCappedStreak(t *testing.T) {
	T := backoffBase
	min, max := 60*time.Second, 30*time.Minute
	deliveries := own(unix(T, time.Minute), unix(T, 3*time.Minute), unix(T, 7*time.Minute), unix(T, 15*time.Minute),
		unix(T, 31*time.Minute), unix(T, 61*time.Minute), unix(T, 91*time.Minute))
	ladder := JoinAnchor(unix(T, 91*time.Minute+4*time.Second), deliveries, min, max)
	if ladder.Rung != 7 || !ladder.Anchor.Equal(T) {
		t.Fatalf("capped streak: anchor=%v rung=%d, want T rung 7", ladder.Anchor, ladder.Rung)
	}
	if next := ladder.NextFire(min, max); !next.Equal(T.Add(121 * time.Minute)) {
		t.Errorf("next fire = %v, want T+121m (one more capped gap) — a rung-descending walk says T+93m", next)
	}
}
