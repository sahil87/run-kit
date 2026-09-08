package cron

import (
	"testing"
	"time"
)

// orphanLine builds one a3f9 log line; sibling for mixing in another entry.
func orphanLine(ts int64, outcome string) LogLine {
	return LogLine{TS: ts, Entry: "a3f9", Outcome: outcome}
}

// TestOrphanedSince pins the trailing-run derivation: the run is every own
// line after the newest resolved-class line; absent-class and neutral lines
// never terminate it.
func TestOrphanedSince(t *testing.T) {
	T := backoffBase
	entry := Entry{ID: "a3f9", CreatedBy: CreatedBy{At: unix(T, -time.Hour)}}

	tests := []struct {
		name string
		log  []LogLine
		want int64
	}{
		{
			name: "run starts at the oldest line after the newest resolved line",
			log: []LogLine{
				orphanLine(unix(T, 0), "delivered"),
				orphanLine(unix(T, time.Minute), "skipped-absent"),
				orphanLine(unix(T, 2*time.Minute), "rate-capped"),
				orphanLine(unix(T, 3*time.Minute), "skipped-absent"),
			},
			want: unix(T, time.Minute),
		},
		{
			name: "no log lines falls back to created_by.at",
			log:  nil,
			want: unix(T, -time.Hour),
		},
		{
			name: "rate-capped inside the streak is neutral, not a terminator",
			log: []LogLine{
				orphanLine(unix(T, 0), "delivered"),
				orphanLine(unix(T, time.Minute), "rate-capped"),
				orphanLine(unix(T, 2*time.Minute), "skipped-absent"),
			},
			want: unix(T, time.Minute),
		},
		{
			name: "failed delivery is neutral, not a terminator",
			log: []LogLine{
				orphanLine(unix(T, 0), "delivered"),
				orphanLine(unix(T, time.Minute), "failed: pane gone"),
				orphanLine(unix(T, 2*time.Minute), "skipped-absent"),
			},
			want: unix(T, time.Minute),
		},
		{
			name: "respawned terminates the run",
			log: []LogLine{
				orphanLine(unix(T, 0), "delivered"),
				orphanLine(unix(T, time.Minute), "skipped-absent"),
				orphanLine(unix(T, 2*time.Minute), "respawned"),
				orphanLine(unix(T, 3*time.Minute), "skipped-absent"),
			},
			want: unix(T, 3*time.Minute),
		},
		{
			name: "respawn-failed is absent-class, not resolved evidence",
			log: []LogLine{
				orphanLine(unix(T, 0), "respawned"),
				orphanLine(unix(T, time.Minute), "respawn-failed: no record"),
				orphanLine(unix(T, 2*time.Minute), "notified-absent"),
			},
			want: unix(T, time.Minute),
		},
		{
			name: "no resolved line at all: the run is the whole log",
			log: []LogLine{
				orphanLine(unix(T, 0), "skipped-absent"),
				orphanLine(unix(T, time.Minute), "notified-absent"),
			},
			want: unix(T, 0),
		},
		{
			name: "newest own line resolved: no unresolved evidence, zero",
			log: []LogLine{
				orphanLine(unix(T, 0), "skipped-absent"),
				orphanLine(unix(T, time.Minute), "delivered"),
			},
			want: 0,
		},
		{
			name: "other entries' resolved lines do not terminate the run",
			log: []LogLine{
				orphanLine(unix(T, 0), "delivered"),
				orphanLine(unix(T, time.Minute), "skipped-absent"),
				{TS: unix(T, 2*time.Minute), Entry: "k7q2", Outcome: "delivered"},
				orphanLine(unix(T, 3*time.Minute), "skipped-absent"),
			},
			want: unix(T, time.Minute),
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := OrphanedSince(tc.log, entry); got != tc.want {
				t.Errorf("OrphanedSince = %d, want %d", got, tc.want)
			}
		})
	}
}

// TestOrphanedSinceTrimDegradesYounger: log-cap trimming drops the OLDEST
// lines, so the derived orphan age can only move younger — expiry degrades
// later, never premature.
func TestOrphanedSinceTrimDegradesYounger(t *testing.T) {
	T := backoffBase
	entry := Entry{ID: "a3f9", CreatedBy: CreatedBy{At: unix(T, -24*time.Hour)}}
	full := []LogLine{
		orphanLine(unix(T, 0), "delivered"),
		orphanLine(unix(T, time.Hour), "skipped-absent"),
		orphanLine(unix(T, 2*time.Hour), "rate-capped"),
		orphanLine(unix(T, 3*time.Hour), "skipped-absent"),
	}
	fullSince := OrphanedSince(full, entry)
	if want := unix(T, time.Hour); fullSince != want {
		t.Fatalf("full log OrphanedSince = %d, want %d", fullSince, want)
	}

	// Dropping the oldest absent lines moves orphaned-since FORWARD.
	truncSince := OrphanedSince(full[2:], entry)
	if want := unix(T, 2*time.Hour); truncSince != want {
		t.Errorf("truncated log OrphanedSince = %d, want %d", truncSince, want)
	}
	if truncSince < fullSince {
		t.Errorf("truncated log OrphanedSince %d < full %d — trim must never age the streak", truncSince, fullSince)
	}

	// Trimming away every absent line leaves a resolved-only tail: zero
	// (no unresolved evidence) sorts as never-expiring, still never premature.
	if got := OrphanedSince(full[:1], entry); got != 0 {
		t.Errorf("resolved-only tail OrphanedSince = %d, want 0 (no evidence)", got)
	}
	if got := OrphanExpiresAt(0, false); got != 0 {
		t.Errorf("OrphanExpiresAt(0) = %d, want 0 (never expires)", got)
	}
}

func TestOrphanExpiresAt(t *testing.T) {
	T := backoffBase
	since := unix(T, 0)
	if want := since + int64(OrphanTTL/time.Second); OrphanExpiresAt(since, false) != want {
		t.Errorf("OrphanExpiresAt(%d, false) = %d, want %d", since, OrphanExpiresAt(since, false), want)
	}
	if got := OrphanExpiresAt(since, true); got != 0 {
		t.Errorf("OrphanExpiresAt(%d, pinned) = %d, want 0 (pinned never expires)", since, got)
	}
	if OrphanTTL != 7*24*time.Hour {
		t.Errorf("OrphanTTL = %v, want 168h", OrphanTTL)
	}
}
