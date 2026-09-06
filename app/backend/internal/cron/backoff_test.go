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
