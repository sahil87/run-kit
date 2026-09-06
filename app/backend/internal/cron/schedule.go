package cron

import "time"

// schedule.go — the `every` schedule (R5): fires when now − lastDelivery ≥
// interval, with lastDelivery derived from the entry's newest delivery-log
// line; with no logged delivery the anchor is created_by.at. Pure math — the
// log lines are an input, never read here.

// everyAnchor is the entry's `every` anchor: the newest own delivery, else the
// creation time.
func everyAnchor(e Entry, log []LogLine) time.Time {
	if last, ok := LastDelivery(log, e.ID); ok {
		return time.Unix(last.TS, 0)
	}
	return time.Unix(e.CreatedBy.At, 0)
}

// everyDue reports whether the entry's `every` schedule has come due by now,
// and the anchor it derived from.
func everyDue(e Entry, log []LogLine, now time.Time) (due bool, anchor time.Time) {
	anchor = everyAnchor(e, log)
	return !now.Before(anchor.Add(e.Schedule.Interval.Duration)), anchor
}
