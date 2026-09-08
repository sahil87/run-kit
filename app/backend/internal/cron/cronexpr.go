package cron

import (
	"time"

	robfigcron "github.com/robfig/cron/v3"
)

// cronexpr.go — cron-kind (5-field expression) due math: a pure function of
// (entry, delivery log, now) on the everyAnchor rule (newest own log line,
// else created_by.at). robfig/cron/v3 supplies ParseStandard + Schedule.Next
// only — its runtime scheduler is never used; the stateless evaluator remains
// the only clock. Occurrences resolve in the daemon's local time
// (ParseStandard's location).

const (
	// DefaultCronGrace is how long past an occurrence an immediate-deliver
	// cron entry still fires — it covers tick jitter and short daemon
	// restarts (the ticker runs every 30s).
	DefaultCronGrace = 2 * time.Minute
	// DefaultHoldWindow bounds how long a due fire may sit undelivered: it is
	// the due window for when-idle cron entries (a hold is realized as
	// cross-tick re-evaluation, so a when-idle fire must stay due long enough
	// for the pane to idle) and the deliverer's hold bound past which a
	// busy-held fire expires.
	DefaultHoldWindow = 2 * time.Hour
)

// cronScheduleDue evaluates one cron-kind entry at now. A fire is due when the
// latest occurrence in (anchor, now] is within the deliver-dependent window
// (DefaultCronGrace, or DefaultHoldWindow for when-idle), carrying DueAt = the
// occurrence. catch_up: once lifts the lateness bound for a stale occurrence —
// it fires late exactly once per gap with DueAt = now, opting out of the hold
// bound; an occurrence still inside its window is an ordinary on-time fire
// (DueAt = O, hold bound applies) even with catch_up set. A stale occurrence
// past its window (no catch-up) reports missed instead: the tick logs one
// `missed` line, advancing the anchor past the gap.
func cronScheduleDue(e Entry, log []LogLine, now time.Time) (due, missed bool, dueAt time.Time) {
	sched, err := robfigcron.ParseStandard(e.Schedule.Expr)
	if err != nil {
		// validate() gates expressions at load; this is defense in depth.
		return false, false, time.Time{}
	}
	occ, ok := latestOccurrence(sched, everyAnchor(e, log), now)
	if !ok {
		return false, false, time.Time{}
	}
	window := DefaultCronGrace
	if e.Deliver == DeliverWhenIdle {
		window = DefaultHoldWindow
	}
	if now.Sub(occ) <= window {
		return true, false, occ
	}
	if e.Schedule.CatchUp == CatchUpOnce {
		return true, false, now
	}
	return false, true, occ
}

// latestOccurrence returns the latest scheduled occurrence in (after, now].
// P(t) = "an occurrence exists in (t, now]" is one Next call and is monotone
// (true below the latest occurrence, false at/above it), so binary search over
// minute-aligned candidates — ParseStandard occurrences are minute-aligned —
// pinpoints it in ~log2(span-minutes) Next calls no matter how ancient the
// anchor; the missed-line anchor advancement keeps real spans near now. A zero
// Next (robfig's 5-year horizon, e.g. a Feb-31 expression) reads as no
// occurrence.
func latestOccurrence(sched robfigcron.Schedule, after, now time.Time) (time.Time, bool) {
	exists := func(t time.Time) bool {
		next := sched.Next(t)
		return !next.IsZero() && !next.After(now)
	}
	if !exists(after) {
		return time.Time{}, false
	}
	// lo keeps P true, hi keeps P false; both minute-aligned. P is flat across
	// [floor-minute(after), after]: no minute-aligned time sits in between.
	lo := after.Truncate(time.Minute)
	hi := now.Truncate(time.Minute).Add(time.Minute)
	for hi.Sub(lo) > time.Minute {
		mid := lo.Add(hi.Sub(lo) / 2).Truncate(time.Minute)
		if exists(mid) {
			lo = mid
		} else {
			hi = mid
		}
	}
	return sched.Next(lo), true
}
