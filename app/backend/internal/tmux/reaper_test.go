package tmux

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"slices"
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

		// (c) .lock files inherit their OWNING server's fate (base = name
		// without ".lock", classified via IsGoTestServerName). Probe is
		// irrelevant for locks.
		{"lock of Go-test server → remove", "rk-test-1234-abc.lock", false, ReapActionRemove},
		{"lock of Go-test server, probe live → remove", "rk-test-1234-abc.lock", true, ReapActionRemove},
		{"lock of fixed-name test server → remove", "rk-tmuxctl-test.lock", false, ReapActionRemove},
		{"lock of rk-verify test server → remove", "rk-verify-99.lock", false, ReapActionRemove},
		// The bug this fixes: an rk-e2e-*.lock belongs to a (possibly LIVE)
		// Playwright server and MUST be spared — base is not a Go-test name.
		{"lock of rk-e2e server → skip", "rk-e2e-coupling-640069.lock", true, ReapActionSkip},
		{"lock of rk-e2e multi server → skip", "rk-e2e-multi-633536.lock", false, ReapActionSkip},
		// Non-test server lock (production / stale orphan) → spared.
		{"lock of non-test server → skip", "kits.lock", false, ReapActionSkip},
		{"lock of non-test server, probe live → skip", "runkit.lock", true, ReapActionSkip},
		// Control-anchor lock → spared (base is not a Go-test name).
		{"lock of control anchor → skip", ControlAnchorSessionName + ".lock", false, ReapActionSkip},

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
		"rk-test-111-live",      // live test → would kill
		"rk-test-222-dead",      // dead test → would remove
		"rk-test-333-dead.lock", // Go-test server's lock → would remove
		"rk-e2e-multi-7.lock",   // e2e server's lock → skip (protected)
		"kits.lock",             // non-test server's lock → skip
		"runkit",                // live non-test → skip
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

	// Dry-run plan lists exactly the three actionable candidates; the e2e and
	// non-test locks are spared (inherit their owning server's protection).
	wantPlan := map[string]ReapAction{
		"rk-test-111-live":      ReapActionKill,
		"rk-test-222-dead":      ReapActionRemove,
		"rk-test-333-dead.lock": ReapActionRemove,
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
		"rk-test-222-dead",       // dead test → remove
		"rk-test-444-dead.lock",  // Go-test server's lock → remove
		"rk-e2e-foo.lock",        // e2e server's lock → skip (preserved)
		"kits.lock",              // non-test server's lock → skip (preserved)
		"runkit",                 // live non-test → skip (preserved)
		"rk-e2e-foo",             // e2e → skip (preserved)
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
	wantRemoved := []string{"rk-test-222-dead", "rk-test-444-dead.lock"}
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
	wantPresent := []string{ControlAnchorSessionName, "kits.lock", "rk-e2e-foo", "rk-e2e-foo.lock", "runkit"}
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
		"rk-test-missing",     // dead test → remove, but file absent → os.Remove fails
		"rk-test-present",     // dead test → remove (succeeds)
		"rk-test-9-dead.lock", // Go-test server's lock → remove (succeeds)
	}
	writeFiles(t, dir, "rk-test-present", "rk-test-9-dead.lock")
	probe := fakeProbe(nil) // all dead

	result, err := reapCandidates(context.Background(), dir, candidates, probe, false)
	if err == nil {
		t.Fatal("expected aggregate error from the failed remove, got nil")
	}

	sort.Strings(result.RemovedSockets)
	want := []string{"rk-test-9-dead.lock", "rk-test-present"}
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
	candidates := []string{"rk-test-dead", "rk-test-x.lock", "runkit"}
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
	// The reapable candidate set is: unix-socket files PLUS `*.lock` REGULAR
	// files (tmux lock artifacts — not sockets, matched by name). A plain
	// regular file and a subdirectory must be excluded. This drives the real
	// filter end-to-end so the `.lock` branch is exercised through production
	// code, not bypassed by a hand-built candidate list. (Regression: the
	// socket-mode filter alone silently dropped `.lock` files, leaving the
	// spec-mandated `.lock` reap branch dead in real runs.)
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
	sort.Strings(got)
	want := []string{"another.lock", "live-socket"}
	if !slices.Equal(got, want) {
		t.Errorf("filterSocketEntries = %v, want %v (socket + .lock kept; plain regular file + dir excluded)", got, want)
	}
}
