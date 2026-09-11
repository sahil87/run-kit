package cron

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

// TestParseWatchlist is the tolerant-parse table over both file shapes: the
// fab-kit ≥ 2.25 tracked: list (pane-bearing, not-done items become entries;
// pane-less, done, and malformed items are skipped; paused items stay; kind is
// not a filter; a non-list value yields nothing; tracked wins over a residual
// monitored: map by key presence) and the legacy monitored: map (parsed only
// when tracked is absent). Unknown keys are ignored; corrupt YAML fails.
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
		// --- fab-kit ≥ 2.25 tracked: list ---
		{
			name: "tracked list mirroring a live 2.25 state file",
			body: `branch_map:
    pa9n:
        branch: 260911-pa9n-gk-cleanup-10-cursio-owns-cursor
        repo: /home/sahil/code/wvrdz/loom
last_full_at: "2026-09-11T13:38:24Z"
last_tick_at: "2026-09-11T13:38:24Z"
tick_count: 2816
tracked:
    - id: pa9n
      kind: fab-change
      probe:
        mode: pane
      check_every: null
      done_when: null
      then: null
      depends_on: []
      scope:
        agent: idle
        branch: 260911-pa9n-gk-cleanup-10-cursio-owns-cursor
        merge_mode: null
        pane: '%180'
        repo: /home/sahil/code/wvrdz/loom
        session: loom
        spawned_by: null
        stage: apply
        stop_stage: null
      last: {}
      checked_at: null
      unchanged: 0
      failures: 0
      paused: false
      done_at: null
      added_at: "2026-09-11T13:20:14Z"
      updated_at: "2026-09-11T13:20:14Z"
`,
			wantEntries: []WatchlistEntry{{
				ChangeID: "pa9n", Pane: "%180", Repo: "/home/sahil/code/wvrdz/loom", Session: "loom",
				Stage: "apply", Agent: "idle", Branch: "260911-pa9n-gk-cleanup-10-cursio-owns-cursor", Kind: "fab-change",
			}},
			wantTickAt: time.Date(2026, 9, 11, 13, 38, 24, 0, time.UTC).Unix(),
			wantOK:     true,
		},
		{
			name: "tracked: pane-less items are skipped, null scope fields read as empty",
			body: `tracked:
  - {id: queued, kind: fab-change, scope: {pane: null, repo: /r, branch: b}}
  - {id: pr77, kind: github-pr, scope: {repo: /r, pr: 77}}
  - {id: live, kind: fab-change, scope: {pane: "%5", repo: /r, session: s, stage: null, agent: null, branch: b}}
`,
			wantEntries: []WatchlistEntry{{ChangeID: "live", Pane: "%5", Repo: "/r", Session: "s", Branch: "b", Kind: "fab-change"}},
			wantOK:      true,
		},
		{
			name: "tracked: done items are skipped, paused items are included",
			body: `tracked:
  - {id: finished, kind: fab-change, scope: {pane: "%1"}, done_at: "2026-09-11T12:00:00Z"}
  - {id: napping, kind: fab-change, scope: {pane: "%2"}, paused: true, failures: 3, done_at: null}
`,
			wantEntries: []WatchlistEntry{{ChangeID: "napping", Pane: "%2", Kind: "fab-change"}},
			wantOK:      true,
		},
		{
			name:        "tracked: kind is not a filter — any item with a pane is watched",
			body:        "tracked:\n  - {id: probe, kind: shell, scope: {pane: \"%9\", repo: /r}}\n",
			wantEntries: []WatchlistEntry{{ChangeID: "probe", Pane: "%9", Repo: "/r", Kind: "shell"}},
			wantOK:      true,
		},
		{
			name: "tracked: malformed items are skipped, the well-formed sibling parses",
			body: `tracked:
  - just-a-string
  - {kind: fab-change, scope: {pane: "%3"}}
  - {id: badscope, kind: fab-change, scope: "not-a-map"}
  - {id: good, kind: fab-change, scope: {pane: "%4"}}
`,
			wantEntries: []WatchlistEntry{{ChangeID: "good", Pane: "%4", Kind: "fab-change"}},
			wantOK:      true,
		},
		{
			name:        "tracked: a map-shaped value yields no entries",
			body:        "tracked:\n  pa9n: {id: pa9n, scope: {pane: \"%1\"}}\n",
			wantEntries: nil,
			wantOK:      true,
		},
		{
			name:        "tracked: a scalar value yields no entries",
			body:        "tracked: 3\n",
			wantEntries: nil,
			wantOK:      true,
		},
		{
			name: "both present: tracked wins, the legacy map is ignored",
			body: `monitored:
  legacy: {pane: "%1", repo: /old}
tracked:
  - {id: new, kind: fab-change, scope: {pane: "%2"}}
`,
			wantEntries: []WatchlistEntry{{ChangeID: "new", Pane: "%2", Kind: "fab-change"}},
			wantOK:      true,
		},
		{
			name:        "both present: an empty tracked list still wins by key presence",
			body:        "monitored:\n  legacy: {pane: \"%1\"}\ntracked: []\n",
			wantEntries: nil,
			wantOK:      true,
		},
		{
			name: "tracked: entries sort by id, not list order",
			body: `tracked:
  - {id: zz, kind: fab-change, scope: {pane: "%2"}}
  - {id: aa, kind: fab-change, scope: {pane: "%1"}}
`,
			wantEntries: []WatchlistEntry{{ChangeID: "aa", Pane: "%1", Kind: "fab-change"}, {ChangeID: "zz", Pane: "%2", Kind: "fab-change"}},
			wantOK:      true,
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

// TestReadWatchlistTrackedRoundTrip: a 2.25 tracked:-shaped file reads back
// present with its pane-bearing items and last_tick_at through the file path.
func TestReadWatchlistTrackedRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dev.yaml")
	body := "last_tick_at: 1700000000\ntracked:\n  - {id: pa9n, kind: fab-change, scope: {pane: \"%180\", stage: apply}}\n  - {id: queued, kind: fab-change, scope: {pane: null}}\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	entries, tickAt, present := ReadWatchlist(path)
	if !present || tickAt != 1700000000 {
		t.Fatalf("present=%v tickAt=%d, want true/1700000000", present, tickAt)
	}
	want := []WatchlistEntry{{ChangeID: "pa9n", Pane: "%180", Stage: "apply", Kind: "fab-change"}}
	if !reflect.DeepEqual(entries, want) {
		t.Errorf("entries = %+v, want %+v", entries, want)
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
