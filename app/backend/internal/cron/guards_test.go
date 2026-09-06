package cron

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

var guardNow = backoffBase

// opStateYAML builds a fab operator state file body. tickAt: "fresh", "stale",
// or "" (no last_tick_at). tracked: empty or non-empty sets.
func opStateYAML(tickAt string, tracked bool) string {
	body := "# fab-owned schema; unknown keys must be tolerated\nunrelated_key: 42\n"
	if tickAt != "" {
		var ts int64
		if tickAt == "fresh" {
			ts = guardNow.Add(-30 * time.Second).Unix()
		} else {
			ts = guardNow.Add(-time.Hour).Unix()
		}
		body += "last_tick_at: " + time.Unix(ts, 0).Format(time.RFC3339) + "\n"
	}
	if tracked {
		body += "monitored:\n  - {change: x, pane: \"%12\"}\nwatches:\n  - w1\nautopilot:\n  - a1\n"
	} else {
		body += "monitored: []\nwatches: []\nautopilot: []\n"
	}
	return body
}

// TestGuardTruthTable is the full A-015 truth table: file {fresh, stale,
// absent, corrupt} × tracked {empty, non-empty} × both shipped guards, plus
// the unknown-guard cell.
func TestGuardTruthTable(t *testing.T) {
	threshold := DefaultOperatorLoopFreshThreshold
	cases := []struct {
		name string
		file string // "", "corrupt", or a YAML body
		// want: operator-loop-fresh, nothing-tracked
		fresh, nothing bool
	}{
		{"fresh + empty", opStateYAML("fresh", false), true, true},
		{"fresh + tracked", opStateYAML("fresh", true), true, false},
		{"stale + empty", opStateYAML("stale", false), false, true},
		{"stale + tracked", opStateYAML("stale", true), false, false},
		{"absent", "", false, true}, // absent ⇒ fresh NO, nothing-tracked YES
		{"corrupt", "{{{{ not yaml", false, true},
		{"present but no last_tick_at + empty", opStateYAML("", false), false, true},
		{"present but no last_tick_at + tracked", opStateYAML("", true), false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var st OperatorState
			if tc.file == "" {
				st = ReadOperatorState(filepath.Join(t.TempDir(), "absent.yaml"))
			} else {
				parsed, ok := ParseOperatorState([]byte(tc.file))
				if tc.name == "corrupt" {
					if ok {
						t.Fatal("corrupt file parsed ok")
					}
				} else {
					if !ok {
						t.Fatalf("file failed to parse")
					}
					st = parsed
				}
			}
			fresh, known := guardHolds(GuardOperatorLoopFresh, st, guardNow, threshold)
			if !known || fresh != tc.fresh {
				t.Errorf("operator-loop-fresh = %v (known %v), want %v", fresh, known, tc.fresh)
			}
			nothing, known := guardHolds(GuardNothingTracked, st, guardNow, threshold)
			if !known || nothing != tc.nothing {
				t.Errorf("nothing-tracked = %v (known %v), want %v", nothing, known, tc.nothing)
			}
			// Unknown guard: never holds, flagged unknown.
			holds, known := guardHolds("bogus-guard", st, guardNow, threshold)
			if known || holds {
				t.Errorf("unknown guard: holds=%v known=%v, want false/false", holds, known)
			}
		})
	}
}

// TestGuardFreshnessBoundary pins the threshold edge.
func TestGuardFreshnessBoundary(t *testing.T) {
	threshold := DefaultOperatorLoopFreshThreshold
	at := guardNow.Add(-threshold).Unix()
	st := OperatorState{Present: true, LastTickAt: at}
	if holds, _ := guardHolds(GuardOperatorLoopFresh, st, guardNow, threshold); !holds {
		t.Error("exactly at the threshold should still hold")
	}
	st.LastTickAt = at - 1
	if holds, _ := guardHolds(GuardOperatorLoopFresh, st, guardNow, threshold); holds {
		t.Error("one second past the threshold should not hold")
	}
	// A future stamp (clock skew) holds.
	st.LastTickAt = guardNow.Add(time.Minute).Unix()
	if holds, _ := guardHolds(GuardOperatorLoopFresh, st, guardNow, threshold); !holds {
		t.Error("future stamp should hold")
	}
	// The comparison honors the full Duration — a stamp a fraction of a
	// second past the threshold does not hold.
	st.LastTickAt = guardNow.Add(-threshold).Unix()
	late := guardNow.Add(400 * time.Millisecond)
	if holds, _ := guardHolds(GuardOperatorLoopFresh, st, late, threshold); holds {
		t.Error("400ms past the threshold should not hold")
	}
}

// TestOperatorStateTolerantShapes: unix timestamps, list/map/scalar tracked
// sets, unknown keys — all tolerated.
func TestOperatorStateTolerantShapes(t *testing.T) {
	st, ok := ParseOperatorState([]byte("last_tick_at: 1700000000\nmonitored: {a: 1, b: 2}\n"))
	if !ok || st.LastTickAt != 1700000000 || st.TrackedCount != 2 {
		t.Errorf("map tracked set: %+v ok=%v", st, ok)
	}
	st, ok = ParseOperatorState([]byte("monitored: just-a-scalar\n"))
	if !ok || st.TrackedCount != 1 {
		t.Errorf("scalar tracked set: %+v ok=%v (unknown shape ⇒ conservatively tracked)", st, ok)
	}
	st, ok = ParseOperatorState([]byte("watches: [1, 2, 3]\nautopilot: [1]\n"))
	if !ok || st.TrackedCount != 4 {
		t.Errorf("list tracked sets: %+v ok=%v", st, ok)
	}
	st, ok = ParseOperatorState([]byte(""))
	if !ok || !st.Present || st.TrackedCount != 0 || st.LastTickAt != 0 {
		t.Errorf("empty file: %+v ok=%v", st, ok)
	}
}

// TestReadOperatorStateAbsentAndCorrupt: both degrade to the zero state.
func TestReadOperatorStateAbsentAndCorrupt(t *testing.T) {
	if st := ReadOperatorState(filepath.Join(t.TempDir(), "nope.yaml")); st != (OperatorState{}) {
		t.Errorf("absent: %+v, want zero", st)
	}
	path := filepath.Join(t.TempDir(), "dev.yaml")
	if err := os.WriteFile(path, []byte("{{{{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if st := ReadOperatorState(path); st != (OperatorState{}) {
		t.Errorf("corrupt: %+v, want zero", st)
	}
}
