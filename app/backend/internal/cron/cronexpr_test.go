package cron

import (
	"testing"
	"time"
)

// localTime builds a wall-clock time in the daemon's local zone — cron
// occurrences resolve in local time.
func localTime(y int, mo time.Month, d, h, mi, s int) time.Time {
	return time.Date(y, mo, d, h, mi, s, 0, time.Local)
}

// cronEntry builds a cron-kind entry anchored by created_by.at; tests add log
// lines to re-anchor.
func cronEntry(expr, deliver, catchUp string, createdAt time.Time) Entry {
	return Entry{
		ID:        "a3f9",
		Schedule:  Schedule{Kind: ScheduleCron, Expr: expr, CatchUp: catchUp},
		Deliver:   deliver,
		CreatedBy: CreatedBy{At: createdAt.Unix()},
	}
}

// TestCronScheduleDue is the R2 matrix: on-time fire within the grace window,
// stale-occurrence miss past it, the when-idle window extension, catch_up:
// once firing late exactly once with DueAt = now, and the no-occurrence case.
func TestCronScheduleDue(t *testing.T) {
	anchor := localTime(2026, 9, 9, 10, 0, 30)
	log := own(anchor.Unix())
	cases := []struct {
		name      string
		expr      string
		deliver   string
		catchUp   string
		now       time.Time
		wantDue   bool
		wantMiss  bool
		wantDueAt time.Time
	}{
		{
			name:      "on-time fire within grace",
			expr:      "*/5 * * * *",
			now:       localTime(2026, 9, 9, 10, 5, 20),
			wantDue:   true,
			wantDueAt: localTime(2026, 9, 9, 10, 5, 0),
		},
		{
			name:      "beyond grace is missed",
			expr:      "*/5 * * * *",
			now:       localTime(2026, 9, 9, 10, 9, 0),
			wantMiss:  true,
			wantDueAt: localTime(2026, 9, 9, 10, 5, 0),
		},
		{
			name:      "when-idle extends the window to the hold bound",
			expr:      "*/5 * * * *",
			deliver:   DeliverWhenIdle,
			now:       localTime(2026, 9, 9, 10, 9, 0),
			wantDue:   true,
			wantDueAt: localTime(2026, 9, 9, 10, 5, 0),
		},
		{
			name:      "when-idle past the hold bound is missed",
			expr:      "0 9 * * *",
			deliver:   DeliverWhenIdle,
			now:       localTime(2026, 9, 10, 11, 30, 0),
			wantMiss:  true,
			wantDueAt: localTime(2026, 9, 10, 9, 0, 0),
		},
		{
			name:      "catch-up on-time occurrence carries DueAt = O",
			expr:      "*/5 * * * *",
			catchUp:   CatchUpOnce,
			now:       localTime(2026, 9, 9, 10, 5, 20),
			wantDue:   true,
			wantDueAt: localTime(2026, 9, 9, 10, 5, 0),
		},
		{
			name:      "catch-up fires late with DueAt = now",
			expr:      "*/5 * * * *",
			catchUp:   CatchUpOnce,
			now:       localTime(2026, 9, 9, 10, 9, 0),
			wantDue:   true,
			wantDueAt: localTime(2026, 9, 9, 10, 9, 0),
		},
		{
			name:    "no occurrence since the anchor",
			expr:    "*/5 * * * *",
			now:     localTime(2026, 9, 9, 10, 0, 50),
			wantDue: false,
		},
		{
			name:      "daily expression on time",
			expr:      "0 9 * * *",
			now:       localTime(2026, 9, 10, 9, 0, 45),
			wantDue:   true,
			wantDueAt: localTime(2026, 9, 10, 9, 0, 0),
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e := cronEntry(tc.expr, tc.deliver, tc.catchUp, localTime(2026, 9, 8, 0, 0, 0))
			due, missed, dueAt := cronScheduleDue(e, log, tc.now)
			if due != tc.wantDue || missed != tc.wantMiss {
				t.Fatalf("due/missed = %v/%v, want %v/%v", due, missed, tc.wantDue, tc.wantMiss)
			}
			if (due || missed) && !dueAt.Equal(tc.wantDueAt) {
				t.Errorf("dueAt = %v, want %v", dueAt, tc.wantDueAt)
			}
		})
	}
}

// TestCronScheduleDueAncientAnchor: the occurrence scan stays exact and
// bounded from a months-old anchor — the latest occurrence, not the first one
// past the anchor, decides due-ness (a dense schedule whose latest occurrence
// is in grace fires rather than logging missed).
func TestCronScheduleDueAncientAnchor(t *testing.T) {
	ancient := own(localTime(2026, 3, 1, 0, 0, 0).Unix())

	// Daily 9am: three months of occurrences collapse to the latest.
	now := localTime(2026, 9, 9, 9, 0, 20)
	e := cronEntry("0 9 * * *", "", "", time.Time{})
	due, missed, dueAt := cronScheduleDue(e, ancient, now)
	if !due || !dueAt.Equal(localTime(2026, 9, 9, 9, 0, 0)) {
		t.Errorf("daily from ancient anchor: due=%v dueAt=%v (missed=%v), want due at today 09:00", due, dueAt, missed)
	}

	// Minutely: the latest occurrence is the current minute boundary — in
	// grace, so it fires even with tens of thousands of occurrences behind it.
	e = cronEntry("* * * * *", "", "", time.Time{})
	now = localTime(2026, 9, 9, 10, 0, 20)
	due, missed, dueAt = cronScheduleDue(e, ancient, now)
	if !due || missed || !dueAt.Equal(localTime(2026, 9, 9, 10, 0, 0)) {
		t.Errorf("minutely from ancient anchor: due=%v missed=%v dueAt=%v, want due at 10:00", due, missed, dueAt)
	}
}

// TestCronScheduleDueAnchorFallback: with no log lines the anchor is
// created_by.at (the everyAnchor rule); a logged disposition re-anchors, so a
// delivered entry's next due is the next future occurrence.
func TestCronScheduleDueAnchorFallback(t *testing.T) {
	now := localTime(2026, 9, 9, 9, 1, 0)
	e := cronEntry("0 9 * * *", "", "", localTime(2026, 9, 8, 12, 0, 0))

	due, _, dueAt := cronScheduleDue(e, nil, now)
	if !due || !dueAt.Equal(localTime(2026, 9, 9, 9, 0, 0)) {
		t.Fatalf("pre-delivery: due=%v dueAt=%v, want due at 09:00", due, dueAt)
	}

	// The delivery's log line (at 09:00:30) re-anchors: no occurrence in
	// (09:00:30, 09:01:00] ⇒ not due again.
	e.CreatedBy.At = 0
	due, missed, _ := cronScheduleDue(e, own(localTime(2026, 9, 9, 9, 0, 30).Unix()), now)
	if due || missed {
		t.Errorf("post-delivery: due=%v missed=%v, want neither until tomorrow 09:00", due, missed)
	}
}

// TestCronScheduleDueNeverMatching: an expression with no occurrence inside
// robfig's 5-year horizon (Feb 31) never fires and never misses.
func TestCronScheduleDueNeverMatching(t *testing.T) {
	e := cronEntry("0 0 31 2 *", "", CatchUpOnce, localTime(2026, 1, 1, 0, 0, 0))
	due, missed, _ := cronScheduleDue(e, nil, localTime(2026, 9, 9, 12, 0, 0))
	if due || missed {
		t.Errorf("due=%v missed=%v, want neither for a never-matching expression", due, missed)
	}
}

// TestCronScheduleDueUnparseableDefense: an unparseable expression (gated by
// validate() at load) degrades to silence rather than firing.
func TestCronScheduleDueUnparseableDefense(t *testing.T) {
	e := cronEntry("not an expr", "", CatchUpOnce, localTime(2026, 1, 1, 0, 0, 0))
	due, missed, _ := cronScheduleDue(e, nil, localTime(2026, 9, 9, 12, 0, 0))
	if due || missed {
		t.Errorf("due=%v missed=%v, want neither for an unparseable expression", due, missed)
	}
}

// TestCronScheduleDueLocalWallClock: occurrences land on local wall-clock
// times — 9am local means 9am in time.Local, not UTC.
func TestCronScheduleDueLocalWallClock(t *testing.T) {
	e := cronEntry("30 14 * * *", "", "", time.Time{})
	now := localTime(2026, 9, 9, 14, 30, 30)
	due, _, dueAt := cronScheduleDue(e, nil, now)
	if !due {
		t.Fatal("not due 30s past the 14:30 occurrence")
	}
	h, m, _ := dueAt.Clock()
	if h != 14 || m != 30 || dueAt.Location() != time.Local {
		t.Errorf("dueAt = %v, want 14:30 local", dueAt)
	}
}
