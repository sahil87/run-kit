package cron

import (
	"errors"
	"time"
)

// edit.go — the shared edit helper behind `rk cron edit` and
// POST /api/cron/edit: the tick-flock hold, the validated merge (Update), and
// the conditional `rescheduled` log append, factored into one function so the
// two surfaces cannot drift. The other mutation verbs stay lock-free; the lock
// here orders the anchor reset relative to a tick's read-evaluate-append
// (AppendLog is O_APPEND, so byte safety never depended on it).

// ErrEditContention is the sentinel returned when the tick flock stays held
// past the retry budget — a tick is mid-flight. CLI/API callers map it to
// their "cron tick in progress — retry" surface.
var ErrEditContention = errors.New("cron tick in progress — retry")

const (
	// editLockRetryInterval is the pause between flock attempts; a tick is
	// sub-second, so a short poll resolves ordinary contention quickly.
	editLockRetryInterval = 100 * time.Millisecond
	// editLockRetryBudget is how long Edit waits for the flock before
	// reporting contention.
	editLockRetryBudget = 2 * time.Second
)

// Edit applies a field merge to the entry with the given id and, when the
// merge changed the entry's Schedule or Deliver, appends one schedule-history
// line {TS: now, Entry: id, Reason: "edit", Outcome: "rescheduled"} (no
// Target) to <slug>.log — the anchor reset point that makes every/cron count
// from the edit and cuts a backoff streak (ScheduleHistory). Name-,
// if_absent-, and respawn-only edits, and merges that leave schedule and
// deliver equal to the stored values, append nothing. Unknown id returns
// (Entry{}, false, nil) with no log line.
func Edit(dir, slug, id string, now time.Time, apply func(*Entry)) (Entry, bool, error) {
	if err := EnsureDir(dir); err != nil {
		return Entry{}, false, err
	}
	release, err := acquireEditLock(dir)
	if err != nil {
		return Entry{}, false, err
	}
	defer release()

	// The closure captures the stored entry before apply runs, so the
	// schedule/deliver comparison costs no second load and Update stays the
	// single mutation write.
	var stored Entry
	merged, found, err := Update(dir, slug, id, func(e *Entry) {
		stored = *e
		apply(e)
	})
	if err != nil || !found {
		return merged, found, err
	}
	if merged.Schedule == stored.Schedule && merged.Deliver == stored.Deliver {
		return merged, true, nil
	}
	logPath, err := LogPath(dir, slug)
	if err != nil {
		return merged, true, err
	}
	if err := AppendLog(logPath, LogLine{TS: now.Unix(), Entry: id, Reason: "edit", Outcome: "rescheduled"}); err != nil {
		return merged, true, err
	}
	return merged, true, nil
}

// acquireEditLock takes the tick flock, retrying contention every
// editLockRetryInterval for up to editLockRetryBudget; persistent contention
// yields ErrEditContention.
func acquireEditLock(dir string) (func(), error) {
	deadline := time.Now().Add(editLockRetryBudget)
	for {
		release, err := acquireLock(LockPath(dir))
		if err == nil {
			return release, nil
		}
		if !errors.Is(err, ErrTickHeld) {
			return nil, err
		}
		if !time.Now().Before(deadline) {
			return nil, ErrEditContention
		}
		time.Sleep(editLockRetryInterval)
	}
}
