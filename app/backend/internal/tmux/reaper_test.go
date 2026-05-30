package tmux

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

func TestClassifyReap(t *testing.T) {
	cases := []struct {
		name       string
		socketName string
		probeAlive bool
		want       ReapAction
	}{
		// (a) Live orphan test servers → kill
		{"live rk-test", "rk-test-29701-1780032043508597000", true, ReapActionKill},
		{"live rk-relay-test", "rk-relay-test-20089-1780031796792405000", true, ReapActionKill},
		{"live rk-verify", "rk-verify-89115", true, ReapActionKill},
		{"live rk-tmuxctl-test fixed name", "rk-tmuxctl-test", true, ReapActionKill},
		{"live rk-daemon-test fixed name", "rk-daemon-test", true, ReapActionKill},

		// (b) Dead test sockets → remove
		{"dead rk-test", "rk-test-29701-1780032043508597000", false, ReapActionRemove},
		{"dead rk-tmuxctl-test fixed name", "rk-tmuxctl-test", false, ReapActionRemove},
		{"dead rk-daemon-test fixed name", "rk-daemon-test", false, ReapActionRemove},

		// (c) .lock sockets → remove regardless of probe / prefix
		{"lock with no test prefix, dead", "somesocket.lock", false, ReapActionRemove},
		{"lock with no test prefix, live", "somesocket.lock", true, ReapActionRemove},
		{"lock with test prefix", "rk-test-1234.lock", false, ReapActionRemove},

		// Live non-test server → skip
		{"live non-test default", "default", true, ReapActionSkip},
		{"live non-test runkit", "runkit", true, ReapActionSkip},
		{"live non-test production", "production", true, ReapActionSkip},
		{"live rk-daemon (not a test server)", "rk-daemon", true, ReapActionSkip},

		// Dead non-test server → skip
		{"dead non-test default", "default", false, ReapActionSkip},
		{"dead non-test runkit", "runkit", false, ReapActionSkip},

		// rk-e2e-* → skip (live or dead); excluded for free by IsGoTestServerName
		{"live rk-e2e", "rk-e2e-coupling-654810", true, ReapActionSkip},
		{"dead rk-e2e", "rk-e2e-multi-632360", false, ReapActionSkip},

		// _rk-ctl control anchor → skip (live or dead)
		{"live anchor", ControlAnchorSessionName, true, ReapActionSkip},
		{"dead anchor", ControlAnchorSessionName, false, ReapActionSkip},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := classifyReap(tc.socketName, tc.probeAlive); got != tc.want {
				t.Errorf("classifyReap(%q, alive=%v) = %v, want %v", tc.socketName, tc.probeAlive, got, tc.want)
			}
		})
	}
}

// fakeProbe returns a prober that reports the named sockets as alive.
func fakeProbe(alive map[string]bool) func(context.Context, string) bool {
	return func(_ context.Context, name string) bool {
		return alive[name]
	}
}

// writeFiles creates empty placeholder files in dir to stand in for sockets.
func writeFiles(t *testing.T, dir string, names ...string) {
	t.Helper()
	for _, n := range names {
		if err := os.WriteFile(filepath.Join(dir, n), nil, 0o600); err != nil {
			t.Fatalf("write %s: %v", n, err)
		}
	}
}

func presentFiles(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read dir: %v", err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	return names
}

func TestReapCandidates_dryRunMutatesNothing(t *testing.T) {
	dir := t.TempDir()
	candidates := []string{
		"rk-test-111-live",  // live test → would kill
		"rk-test-222-dead",  // dead test → would remove
		"stale.lock",        // lock → would remove
		"runkit",            // live non-test → skip
		ControlAnchorSessionName,
	}
	writeFiles(t, dir, candidates...)
	probe := fakeProbe(map[string]bool{"rk-test-111-live": true, "runkit": true, ControlAnchorSessionName: true})

	before := presentFiles(t, dir)

	result, err := reapCandidates(context.Background(), dir, candidates, probe, true)
	if err != nil {
		t.Fatalf("dry-run returned error: %v", err)
	}

	// No mutations: every file still present.
	after := presentFiles(t, dir)
	if len(after) != len(before) {
		t.Errorf("dry-run mutated the dir: before=%v after=%v", before, after)
	}
	if len(result.Killed) != 0 || len(result.RemovedSockets) != 0 {
		t.Errorf("dry-run reported actions: killed=%v removed=%v", result.Killed, result.RemovedSockets)
	}

	// Dry-run plan lists exactly the three actionable candidates.
	wantPlan := map[string]ReapAction{
		"rk-test-111-live": ReapActionKill,
		"rk-test-222-dead": ReapActionRemove,
		"stale.lock":       ReapActionRemove,
	}
	if len(result.DryRunPlan) != len(wantPlan) {
		t.Fatalf("dry-run plan size = %d, want %d (%v)", len(result.DryRunPlan), len(wantPlan), result.DryRunPlan)
	}
	for _, e := range result.DryRunPlan {
		want, ok := wantPlan[e.Name]
		if !ok {
			t.Errorf("unexpected dry-run plan entry %q", e.Name)
			continue
		}
		if e.Action != want {
			t.Errorf("dry-run plan %q action = %v, want %v", e.Name, e.Action, want)
		}
	}
}

func TestReapCandidates_removesDeadSocketsAndLocks(t *testing.T) {
	dir := t.TempDir()
	candidates := []string{
		"rk-test-222-dead", // dead test → remove
		"stale.lock",       // lock → remove
		"runkit",           // live non-test → skip (preserved)
		"rk-e2e-foo",       // e2e → skip (preserved)
		ControlAnchorSessionName, // anchor → skip (preserved)
	}
	writeFiles(t, dir, candidates...)
	// Nothing alive that we would kill — avoids spawning a real tmux server.
	probe := fakeProbe(map[string]bool{"runkit": true, "rk-e2e-foo": true, ControlAnchorSessionName: true})

	result, err := reapCandidates(context.Background(), dir, candidates, probe, false)
	if err != nil {
		t.Fatalf("reap returned error: %v", err)
	}

	sort.Strings(result.RemovedSockets)
	wantRemoved := []string{"rk-test-222-dead", "stale.lock"}
	if len(result.RemovedSockets) != len(wantRemoved) {
		t.Fatalf("removed = %v, want %v", result.RemovedSockets, wantRemoved)
	}
	for i := range wantRemoved {
		if result.RemovedSockets[i] != wantRemoved[i] {
			t.Errorf("removed[%d] = %q, want %q", i, result.RemovedSockets[i], wantRemoved[i])
		}
	}
	if len(result.Killed) != 0 {
		t.Errorf("killed = %v, want none", result.Killed)
	}

	// Protected entries must still be present; reaped entries gone.
	after := presentFiles(t, dir)
	wantPresent := []string{ControlAnchorSessionName, "rk-e2e-foo", "runkit"}
	sort.Strings(wantPresent)
	if len(after) != len(wantPresent) {
		t.Fatalf("remaining files = %v, want %v", after, wantPresent)
	}
	for i := range wantPresent {
		if after[i] != wantPresent[i] {
			t.Errorf("remaining[%d] = %q, want %q", i, after[i], wantPresent[i])
		}
	}
}

func TestReapCandidates_partialFailureLogsAndContinues(t *testing.T) {
	dir := t.TempDir()
	// "rk-test-missing" is classified remove but never written to disk, so
	// os.Remove fails. The other dead socket + lock must still be removed and
	// an aggregate error returned.
	candidates := []string{
		"rk-test-missing", // dead test → remove, but file absent → os.Remove fails
		"rk-test-present", // dead test → remove (succeeds)
		"stale.lock",      // lock → remove (succeeds)
	}
	writeFiles(t, dir, "rk-test-present", "stale.lock")
	probe := fakeProbe(nil) // all dead

	result, err := reapCandidates(context.Background(), dir, candidates, probe, false)
	if err == nil {
		t.Fatal("expected aggregate error from the failed remove, got nil")
	}

	sort.Strings(result.RemovedSockets)
	want := []string{"rk-test-present", "stale.lock"}
	if len(result.RemovedSockets) != len(want) {
		t.Fatalf("removed = %v, want %v (remaining entries must still process after the failure)", result.RemovedSockets, want)
	}
	for i := range want {
		if result.RemovedSockets[i] != want[i] {
			t.Errorf("removed[%d] = %q, want %q", i, result.RemovedSockets[i], want[i])
		}
	}
}

func TestReapCandidates_allSuccessNoAggregateError(t *testing.T) {
	dir := t.TempDir()
	candidates := []string{"rk-test-dead", "x.lock", "runkit"}
	writeFiles(t, dir, candidates...)
	probe := fakeProbe(map[string]bool{"runkit": true})

	result, err := reapCandidates(context.Background(), dir, candidates, probe, false)
	if err != nil {
		t.Fatalf("expected nil error on all-success, got %v", err)
	}
	if len(result.RemovedSockets) != 2 {
		t.Errorf("removed = %v, want 2 entries", result.RemovedSockets)
	}
}

func TestFilterSocketEntries(t *testing.T) {
	dir := t.TempDir()
	// Regular files and a subdirectory must be excluded; only socket-mode
	// entries are returned. Create a real unix socket so the os.ModeSocket
	// filter is genuinely exercised.
	writeFiles(t, dir, "regular-file", "another.lock")
	if err := os.Mkdir(filepath.Join(dir, "subdir"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	sockPath := filepath.Join(dir, "live-socket")
	ln, err := net.Listen("unix", sockPath)
	if err != nil {
		t.Skipf("cannot create unix socket on this platform: %v", err)
	}
	defer ln.Close()

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read dir: %v", err)
	}
	got := filterSocketEntries(entries)
	if len(got) != 1 || got[0] != "live-socket" {
		t.Errorf("filterSocketEntries = %v, want [live-socket] (dirs + regular files excluded)", got)
	}
}
