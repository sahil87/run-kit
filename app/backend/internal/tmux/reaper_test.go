package tmux

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"testing"
)

func TestClassifyReap(t *testing.T) {
	const prefix = "rk-test"
	cases := []struct {
		name       string
		socketName string
		prefix     string
		serverLive bool
		want       ReapAction
	}{
		// Matched live server → kill.
		{"live rk-test unit", "rk-test-unit-29701-178", prefix, true, ReapActionKill},
		{"live rk-test e2e", "rk-test-e2e", prefix, true, ReapActionKill},
		{"live rk-test e2e-multi", "rk-test-e2e-multi-9-8", prefix, true, ReapActionKill},

		// Matched dead socket → remove.
		{"dead rk-test unit", "rk-test-unit-29701-178", prefix, false, ReapActionRemove},

		// Matched .lock file → remove (no inheritance reasoning; probe ignored).
		{"matched lock, dead", "rk-test-unit-1-2.lock", prefix, false, ReapActionRemove},
		{"matched lock, live", "rk-test-unit-1-2.lock", prefix, true, ReapActionRemove},
		{"matched e2e lock", "rk-test-e2e-multi-7.lock", prefix, false, ReapActionRemove},

		// Unmatched (different prefix) → skip regardless of liveness.
		{"unmatched non-test", "runkit", prefix, true, ReapActionSkip},
		{"unmatched non-test dead", "default", prefix, false, ReapActionSkip},
		{"unmatched lock", "kits.lock", prefix, false, ReapActionSkip},
		{"old rk-e2e no longer matched", "rk-e2e-coupling-640069", prefix, true, ReapActionSkip},

		// Unconditional skips even when they match the prefix.
		{"control anchor matches nothing but skip", ControlAnchorSessionName, prefix, true, ReapActionSkip},
		{"rk-daemon under broad rk prefix", productionDaemonServer, "rk", true, ReapActionSkip},
		{"control anchor under broad prefix", ControlAnchorSessionName, "_rk", true, ReapActionSkip},

		// Custom prefix matches its family.
		{"custom prefix match live", "proj-a", "proj", true, ReapActionKill},
		{"custom prefix match dead", "proj-b", "proj", false, ReapActionRemove},
		{"custom prefix non-match", "runkit", "proj", true, ReapActionSkip},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := classifyReap(tc.socketName, tc.prefix, tc.serverLive); got != tc.want {
				t.Errorf("classifyReap(%q, prefix=%q, live=%v) = %v, want %v",
					tc.socketName, tc.prefix, tc.serverLive, got, tc.want)
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

// TestReapCandidates_dryRunDefaultMutatesNothing proves the dry-run default
// (force=false) records the match plan but touches nothing on disk or in tmux.
func TestReapCandidates_dryRunDefaultMutatesNothing(t *testing.T) {
	dir := t.TempDir()
	candidates := []string{
		"rk-test-unit-111-live",      // matched live → would kill
		"rk-test-unit-222-dead",      // matched dead → would remove
		"rk-test-unit-333-dead.lock", // matched lock → would remove
		"runkit",                     // unmatched → skip
		ControlAnchorSessionName,     // unconditional skip
	}
	writeFiles(t, dir, candidates...)
	probe := fakeProbe(map[string]bool{"rk-test-unit-111-live": true, "runkit": true, ControlAnchorSessionName: true})

	before := presentFiles(t, dir)

	result, err := reapCandidates(context.Background(), dir, "rk-test", candidates, probe, false)
	if err != nil {
		t.Fatalf("dry-run returned error: %v", err)
	}

	after := presentFiles(t, dir)
	if len(after) != len(before) {
		t.Errorf("dry-run mutated the dir: before=%v after=%v", before, after)
	}
	if len(result.Killed) != 0 || len(result.RemovedSockets) != 0 {
		t.Errorf("dry-run reported actions: killed=%v removed=%v", result.Killed, result.RemovedSockets)
	}

	wantPlan := map[string]ReapAction{
		"rk-test-unit-111-live":      ReapActionKill,
		"rk-test-unit-222-dead":      ReapActionRemove,
		"rk-test-unit-333-dead.lock": ReapActionRemove,
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

// TestReapCandidates_bruteForceMatchRemovesDeadAndLocks proves the brute-force
// reaper removes matched dead sockets and *.lock files (force=true), while
// unmatched servers and the unconditional skips are preserved.
func TestReapCandidates_bruteForceMatchRemovesDeadAndLocks(t *testing.T) {
	dir := t.TempDir()
	candidates := []string{
		"rk-test-unit-222-dead",      // matched dead → remove
		"rk-test-unit-444-dead.lock", // matched lock → remove
		"rk-test-e2e-9.lock",         // matched lock (e2e is rk-test now) → remove
		"kits.lock",                  // unmatched lock → skip (preserved)
		"runkit",                     // unmatched live → skip (preserved)
		ControlAnchorSessionName,     // unconditional skip (preserved)
	}
	writeFiles(t, dir, candidates...)
	probe := fakeProbe(map[string]bool{"runkit": true, ControlAnchorSessionName: true})

	result, err := reapCandidates(context.Background(), dir, "rk-test", candidates, probe, true)
	if err != nil {
		t.Fatalf("reap returned error: %v", err)
	}

	sort.Strings(result.RemovedSockets)
	wantRemoved := []string{"rk-test-e2e-9.lock", "rk-test-unit-222-dead", "rk-test-unit-444-dead.lock"}
	if !slices.Equal(result.RemovedSockets, wantRemoved) {
		t.Fatalf("removed = %v, want %v", result.RemovedSockets, wantRemoved)
	}
	if len(result.Killed) != 0 {
		t.Errorf("killed = %v, want none", result.Killed)
	}

	after := presentFiles(t, dir)
	wantPresent := []string{ControlAnchorSessionName, "kits.lock", "runkit"}
	sort.Strings(wantPresent)
	if !slices.Equal(after, wantPresent) {
		t.Fatalf("remaining files = %v, want %v", after, wantPresent)
	}
}

// TestReapCandidates_skipsControlAnchorAndDaemon proves the _rk-ctl anchor and
// the live rk-daemon production server are skipped UNCONDITIONALLY even under a
// broad prefix with force=true (the dangerous-prefix guard is bypassed by
// force, but these two must still survive).
func TestReapCandidates_skipsControlAnchorAndDaemon(t *testing.T) {
	dir := t.TempDir()
	candidates := []string{
		ControlAnchorSessionName, // must survive
		productionDaemonServer,   // must survive (rk-daemon)
		"rk-other",               // matched by "rk" → removed/killed
	}
	writeFiles(t, dir, candidates...)
	// Mark the anchor + daemon "live" to prove even live ones are skipped.
	probe := fakeProbe(map[string]bool{
		ControlAnchorSessionName: true,
		productionDaemonServer:   true,
		"rk-other":               false,
	})

	result, err := reapCandidates(context.Background(), dir, "rk", candidates, probe, true)
	if err != nil {
		t.Fatalf("reap returned error: %v", err)
	}

	after := presentFiles(t, dir)
	for _, must := range []string{ControlAnchorSessionName, productionDaemonServer} {
		if !slices.Contains(after, must) {
			t.Errorf("%q was reaped, must be skipped unconditionally (remaining: %v)", must, after)
		}
	}
	if !slices.Contains(result.RemovedSockets, "rk-other") {
		t.Errorf("rk-other should have been removed (matched the rk prefix), got removed=%v", result.RemovedSockets)
	}
}

// TestReapTestServers_dangerousPrefixGuard proves an empty or <=3-char prefix is
// refused (error, nothing reaped) unless --force is supplied. Crucially, --yes
// (act=true) alone does NOT bypass the guard — only --force (force=true) does.
func TestReapTestServers_dangerousPrefixGuard(t *testing.T) {
	cases := []struct {
		name      string
		prefix    string
		act       bool
		force     bool
		wantError bool
	}{
		{"empty prefix refused", "", false, false, true},
		{"3-char prefix refused", "rk-", false, false, true},
		{"3-char prefix refused even with --yes (no --force)", "rk-", true, false, true},
		{"empty prefix permitted with force", "", false, true, false},
		{"3-char prefix permitted with force", "rk-", false, true, false},
		{"safe prefix allowed", "rk-test", false, false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// ScanSocketDir reads the real socket dir; on a clean test host this
			// is empty/absent, so a permitted run is a no-op. We only assert the
			// guard's accept/reject decision here.
			_, err := ReapTestServers(context.Background(), tc.prefix, tc.act, tc.force)
			if tc.wantError && err == nil {
				t.Errorf("ReapTestServers(prefix=%q, act=%v, force=%v) = nil error, want refusal", tc.prefix, tc.act, tc.force)
			}
			if !tc.wantError && err != nil {
				// A real scan/kill error is acceptable for the permitted cases on a
				// noisy host; only a *guard refusal* must not happen. Distinguish by
				// message prefix.
				if strings.Contains(err.Error(), "refusing prefix") {
					t.Errorf("ReapTestServers(prefix=%q, act=%v, force=%v) wrongly refused: %v", tc.prefix, tc.act, tc.force, err)
				}
			}
		})
	}
}

func TestReapCandidates_partialFailureLogsAndContinues(t *testing.T) {
	dir := t.TempDir()
	// "rk-test-missing" is classified remove but never written to disk, so
	// os.Remove fails. The other dead socket + lock must still be removed and
	// an aggregate error returned.
	candidates := []string{
		"rk-test-unit-missing",     // matched dead → remove, but file absent → fails
		"rk-test-unit-present",     // matched dead → remove (succeeds)
		"rk-test-unit-9-dead.lock", // matched lock → remove (succeeds)
	}
	writeFiles(t, dir, "rk-test-unit-present", "rk-test-unit-9-dead.lock")
	probe := fakeProbe(nil) // all dead

	result, err := reapCandidates(context.Background(), dir, "rk-test", candidates, probe, true)
	if err == nil {
		t.Fatal("expected aggregate error from the failed remove, got nil")
	}

	sort.Strings(result.RemovedSockets)
	want := []string{"rk-test-unit-9-dead.lock", "rk-test-unit-present"}
	if !slices.Equal(result.RemovedSockets, want) {
		t.Fatalf("removed = %v, want %v (remaining entries must still process after the failure)", result.RemovedSockets, want)
	}
}

func TestReapCandidates_allSuccessNoAggregateError(t *testing.T) {
	dir := t.TempDir()
	candidates := []string{"rk-test-unit-dead", "rk-test-unit-x.lock", "runkit"}
	writeFiles(t, dir, candidates...)
	probe := fakeProbe(map[string]bool{"runkit": true})

	result, err := reapCandidates(context.Background(), dir, "rk-test", candidates, probe, true)
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
