package cron

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

// TestParseWatchlist is the tolerant-parse table (R2): the verified fab-kit
// monitoredEntry schema parses fully; unknown top-level and per-entry keys are
// ignored; an entry missing pane is skipped (nothing to join against); a
// non-map monitored shape yields no entries; corrupt YAML fails the parse.
func TestParseWatchlist(t *testing.T) {
	cases := []struct {
		name        string
		body        string
		wantEntries []WatchlistEntry
		wantTickAt  int64
		wantOK      bool
	}{
		{
			name: "populated monitored map (verified fab-kit schema)",
			body: `# fab-owned schema; unknown keys must be tolerated
unrelated_key: 42
last_tick_at: 1700000000
monitored:
  gmcp:
    pane: "%23"
    repo: /home/user/repo
    session: s1
    stage: active
    agent: active
    branch: feat/gmcp
    stop_stage: done
    spawned_by: autopilot
    depends_on: [a, b]
    enrolled_at: "2026-09-07T10:00:00Z"
    last_transition: "2026-09-07T11:00:00Z"
  pending-c5:
    pane: "%31"
    repo: /home/user/other
    session: s2
    branch: main
`,
			wantEntries: []WatchlistEntry{
				{ChangeID: "gmcp", Pane: "%23", Repo: "/home/user/repo", Session: "s1", Stage: "active", Agent: "active", Branch: "feat/gmcp"},
				{ChangeID: "pending-c5", Pane: "%31", Repo: "/home/user/other", Session: "s2", Branch: "main"},
			},
			wantTickAt: 1700000000,
			wantOK:     true,
		},
		{
			name: "entry missing pane is skipped",
			body: `monitored:
  good: {pane: "%7", repo: /r, session: s, branch: b}
  no-pane: {repo: /r2, session: s2, branch: b2}
  scalar-entry: just-a-string
`,
			wantEntries: []WatchlistEntry{{ChangeID: "good", Pane: "%7", Repo: "/r", Session: "s", Branch: "b"}},
			wantOK:      true,
		},
		{
			name:        "empty file parses as present with nothing",
			body:        "",
			wantEntries: nil,
			wantTickAt:  0,
			wantOK:      true,
		},
		{
			name:        "list-shaped monitored yields no entries",
			body:        "monitored:\n  - {change: x, pane: \"%12\"}\n",
			wantEntries: nil,
			wantOK:      true,
		},
		{
			name:       "RFC3339 last_tick_at",
			body:       "last_tick_at: \"2026-09-07T12:00:00Z\"\n",
			wantOK:     true,
			wantTickAt: time.Date(2026, 9, 7, 12, 0, 0, 0, time.UTC).Unix(),
		},
		{
			name:   "corrupt YAML fails the parse",
			body:   "{{{{ not yaml",
			wantOK: false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			entries, tickAt, ok := ParseWatchlist([]byte(tc.body))
			if ok != tc.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tc.wantOK)
			}
			if !ok {
				return
			}
			if !reflect.DeepEqual(entries, tc.wantEntries) {
				t.Errorf("entries = %+v, want %+v", entries, tc.wantEntries)
			}
			if tickAt != tc.wantTickAt {
				t.Errorf("lastTickAt = %d, want %d", tickAt, tc.wantTickAt)
			}
		})
	}
}

// TestReadWatchlistAbsentAndCorrupt: both degrade to (nil, 0, false) — never
// an error, never a panic (A-013).
func TestReadWatchlistAbsentAndCorrupt(t *testing.T) {
	if entries, tickAt, present := ReadWatchlist(filepath.Join(t.TempDir(), "nope.yaml")); entries != nil || tickAt != 0 || present {
		t.Errorf("absent: (%v, %d, %v), want (nil, 0, false)", entries, tickAt, present)
	}
	path := filepath.Join(t.TempDir(), "dev.yaml")
	if err := os.WriteFile(path, []byte("{{{{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if entries, tickAt, present := ReadWatchlist(path); entries != nil || tickAt != 0 || present {
		t.Errorf("corrupt: (%v, %d, %v), want (nil, 0, false)", entries, tickAt, present)
	}
}

// TestReadWatchlistRoundTrip: a populated file reads back present with its
// entries and last_tick_at.
func TestReadWatchlistRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dev.yaml")
	body := "last_tick_at: 1700000000\nmonitored:\n  gmcp: {pane: \"%23\", stage: active}\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	entries, tickAt, present := ReadWatchlist(path)
	if !present || tickAt != 1700000000 {
		t.Fatalf("present=%v tickAt=%d, want true/1700000000", present, tickAt)
	}
	want := []WatchlistEntry{{ChangeID: "gmcp", Pane: "%23", Stage: "active"}}
	if !reflect.DeepEqual(entries, want) {
		t.Errorf("entries = %+v, want %+v", entries, want)
	}
}
