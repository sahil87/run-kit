package cron

import (
	"strings"
	"time"
)

// orphan.go — derived orphan age for TTL expiry. Orphaned-since is never an
// entry-file field: it derives from the entry's trailing run of log lines.
// Log trimming can only drop the run's OLDEST lines, so a trimmed log moves
// the derived age younger (expiry later), never older.

// OrphanTTL is how long a session/pane entry's target may stay continuously
// unresolved before the tick expires the entry.
const OrphanTTL = 7 * 24 * time.Hour

// OrphanedSince derives the start of the entry's continuous-unresolved
// streak: the timestamp of the oldest line in the trailing run — every own
// line back from the newest until the newest resolved-class line (outcome
// prefix delivered or respawned, the only evidence the target resolved).
// Absent-class and neutral lines (skipped-absent, notified-absent,
// respawn-failed, rate-capped, failed…) never terminate the run. An entry
// with no log lines at all falls back to created_by.at. Zero means the log
// holds no unresolved evidence (the trailing run is empty — the newest own
// line resolved); consumers MUST treat zero as never-expiring, never as a
// streak that started at the unix epoch. log is the server's full delivery
// log; the entry's own lines are filtered internally.
func OrphanedSince(log []LogLine, e Entry) int64 {
	lines := OwnDeliveries(log, e.ID)
	if len(lines) == 0 {
		return e.CreatedBy.At
	}
	run := lines
	for i := len(lines) - 1; i >= 0; i-- {
		if resolvedOutcome(lines[i].Outcome) {
			run = lines[i+1:]
			break
		}
	}
	if len(run) == 0 {
		return 0
	}
	return run[0].TS
}

// OrphanExpiresAt is the unix-second expiry time for an orphan streak
// (orphanedSince + OrphanTTL). Zero for pinned entries and for a zero
// orphanedSince — a non-time is truthier than a time that will never fire.
func OrphanExpiresAt(orphanedSince int64, pinned bool) int64 {
	if pinned || orphanedSince <= 0 {
		return 0
	}
	return orphanedSince + int64(OrphanTTL/time.Second)
}

// resolvedOutcome classifies resolution-evidence outcomes: delivered* and
// respawned* only. respawn-failed is absent-class — it is not a "respawned"
// prefix match.
func resolvedOutcome(outcome string) bool {
	return strings.HasPrefix(outcome, "delivered") || strings.HasPrefix(outcome, "respawned")
}
