package cron

import (
	"testing"
	"time"
)

func everyEntry(createdAt int64) Entry {
	return Entry{
		ID:       "a3f9",
		Schedule: Schedule{Kind: ScheduleEvery, Interval: Duration{time.Hour}},
		Target:   Target{Kind: TargetPane, Pane: "%12"},
		Payload:  "tick",
		CreatedBy: CreatedBy{
			At: createdAt,
		},
	}
}

// TestEveryCreatedByAnchor: an every:1h entry created at T with no deliveries
// is not due at T+59m and due at T+61m (R5).
func TestEveryCreatedByAnchor(t *testing.T) {
	T := backoffBase
	e := everyEntry(T.Unix())

	due, anchor := everyDue(e, nil, T.Add(59*time.Minute))
	if due {
		t.Error("due at T+59m, want not due")
	}
	if !anchor.Equal(T) {
		t.Errorf("anchor = %v, want created_by.at (T)", anchor)
	}
	if due, _ := everyDue(e, nil, T.Add(61*time.Minute)); !due {
		t.Error("not due at T+61m, want due")
	}
	// Boundary: exactly at the interval.
	if due, _ := everyDue(e, nil, T.Add(time.Hour)); !due {
		t.Error("not due at exactly T+1h, want due")
	}
}

// TestEveryLogDerivedAnchor: after a delivery at T+61m the anchor moves to the
// log line — next due at T+2h1m, not T+2h.
func TestEveryLogDerivedAnchor(t *testing.T) {
	T := backoffBase
	e := everyEntry(T.Unix())
	log := own(unix(T, 61*time.Minute))

	if due, _ := everyDue(e, log, T.Add(2*time.Hour)); due {
		t.Error("due at T+2h, want not due (anchor is the T+61m delivery)")
	}
	if due, anchor := everyDue(e, log, T.Add(2*time.Hour+time.Minute)); !due {
		t.Error("not due at T+2h1m, want due")
	} else if !anchor.Equal(T.Add(61 * time.Minute)) {
		t.Errorf("anchor = %v, want the delivery time T+61m", anchor)
	}
}

// TestEveryIgnoresOtherEntries: only the entry's own lines anchor it.
func TestEveryIgnoresOtherEntries(t *testing.T) {
	T := backoffBase
	e := everyEntry(T.Unix())
	log := []LogLine{{TS: unix(T, 90*time.Minute), Entry: "k7q2"}}
	if due, anchor := everyDue(e, log, T.Add(59*time.Minute)); due || !anchor.Equal(T) {
		t.Errorf("due=%v anchor=%v, want not due anchored at T", due, anchor)
	}
}
