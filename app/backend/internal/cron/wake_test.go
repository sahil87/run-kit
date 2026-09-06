package cron

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFingerprintDeterministic(t *testing.T) {
	a := map[string]string{"%1": "idle", "%2": "active", "%9": "waiting"}
	b := map[string]string{"%9": "waiting", "%1": "idle", "%2": "active"}
	if Fingerprint(a) != Fingerprint(b) {
		t.Errorf("fingerprint depends on map order: %q vs %q", Fingerprint(a), Fingerprint(b))
	}
	c := map[string]string{"%1": "idle", "%2": "active", "%9": "idle"}
	if Fingerprint(a) == Fingerprint(c) {
		t.Error("different states fingerprinted equal")
	}
	// Unknown states are excluded.
	d := map[string]string{"%1": "idle", "%2": "active", "%9": "waiting", "%3": ""}
	if Fingerprint(a) != Fingerprint(d) {
		t.Error("empty state should not affect the fingerprint")
	}
	if Fingerprint(nil) != "" {
		t.Error("nil map should fingerprint empty")
	}
}

func TestWakeEdge(t *testing.T) {
	T := backoffBase
	debounce := 10 * time.Second

	// Cold start: no observation ⇒ no edge, fresh seeded observation.
	edge, next, diag := wakeEdge(debounce, "F2", WakeObservation{}, false, T)
	if edge || diag != "wake-cold-start" {
		t.Errorf("cold start: edge=%v diag=%q", edge, diag)
	}
	if next.Fingerprint != "F2" || next.ObservedAt != T.Unix() {
		t.Errorf("cold start seeded %+v", next)
	}

	// No change ⇒ no edge, observation kept.
	obs := WakeObservation{Fingerprint: "F1", ObservedAt: T.Unix()}
	edge, next, diag = wakeEdge(debounce, "F1", obs, true, T.Add(time.Hour))
	if edge || diag != "" || next != obs {
		t.Errorf("no-change: edge=%v diag=%q next=%+v", edge, diag, next)
	}

	// Change older than the debounce ⇒ edge fires, cursor advances.
	edge, next, diag = wakeEdge(debounce, "F2", obs, true, T.Add(time.Minute))
	if !edge || diag != "" {
		t.Errorf("old change: edge=%v diag=%q, want fire", edge, diag)
	}
	if next.Fingerprint != "F2" || next.ObservedAt != T.Add(time.Minute).Unix() {
		t.Errorf("post-fire observation %+v", next)
	}

	// Change younger than the debounce ⇒ hold: no fire, OLD observation kept
	// so the edge stays pending and fires on a later tick.
	edge, next, diag = wakeEdge(debounce, "F2", obs, true, T.Add(5*time.Second))
	if edge || diag != "wake-debounced" || next != obs {
		t.Errorf("fresh change: edge=%v diag=%q next=%+v, want held", edge, diag, next)
	}
	// A burst while held still coalesces: the same pending check holds for
	// F3, F4… until the observation ages past the debounce — then one fire.
	edge, next, _ = wakeEdge(debounce, "F4", obs, true, T.Add(11*time.Second))
	if !edge || next.Fingerprint != "F4" {
		t.Errorf("burst coalesce: edge=%v next=%+v, want one fire with latest fp", edge, next)
	}

	// Zero debounce fires immediately.
	edge, _, _ = wakeEdge(0, "F2", obs, true, T.Add(time.Nanosecond))
	if !edge {
		t.Error("zero debounce should fire on any edge")
	}
}

func TestWakeCursorRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dev.cursor.yaml")
	if _, ok := ReadWakeCursor(path); ok {
		t.Error("absent cursor should read as cold start")
	}
	in := WakeCursor{Entries: map[string]WakeObservation{
		"a3f9": {Fingerprint: "F1", ObservedAt: 1700000000},
	}}
	if err := WriteWakeCursor(path, in); err != nil {
		t.Fatal(err)
	}
	out, ok := ReadWakeCursor(path)
	if !ok || out.Entries["a3f9"] != in.Entries["a3f9"] {
		t.Errorf("round trip = %+v, %v", out, ok)
	}
	st, _ := os.Stat(path)
	if st.Mode().Perm() != fileMode {
		t.Errorf("mode = %o, want %o", st.Mode().Perm(), fileMode)
	}
}

// TestWakeCursorCorrupt: a corrupt cursor degrades to a cold start, never an
// error (A-018).
func TestWakeCursorCorrupt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dev.cursor.yaml")
	if err := os.WriteFile(path, []byte("{{{{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, ok := ReadWakeCursor(path); ok {
		t.Error("corrupt cursor should read as cold start")
	}
	// An empty/garbage-but-parseable file with no entries is also a cold start.
	if err := os.WriteFile(path, []byte("entries: {}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, ok := ReadWakeCursor(path); ok {
		t.Error("entryless cursor should read as cold start")
	}
}
