package tmux

import (
	"context"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"testing"
	"time"
)

func TestClassifyReap(t *testing.T) {
	const prefix = "rk-test"
	noEphemeral := map[string]bool(nil)
	noProtected := map[string]bool(nil)
	cases := []struct {
		name       string
		socketName string
		prefix     string
		ephemeral  map[string]bool
		protected  map[string]bool
		serverLive bool
		want       ReapAction
	}{
		// Matched live server → kill.
		{"live rk-test unit", "rk-test-unit-29701-178", prefix, noEphemeral, noProtected, true, ReapActionKill},
		{"live rk-test e2e", "rk-test-e2e", prefix, noEphemeral, noProtected, true, ReapActionKill},
		{"live rk-test e2e-multi", "rk-test-e2e-multi-9-8", prefix, noEphemeral, noProtected, true, ReapActionKill},

		// Matched dead socket → remove.
		{"dead rk-test unit", "rk-test-unit-29701-178", prefix, noEphemeral, noProtected, false, ReapActionRemove},

		// Matched .lock file → remove (no inheritance reasoning; probe ignored).
		{"matched lock, dead", "rk-test-unit-1-2.lock", prefix, noEphemeral, noProtected, false, ReapActionRemove},
		{"matched lock, live", "rk-test-unit-1-2.lock", prefix, noEphemeral, noProtected, true, ReapActionRemove},
		{"matched e2e lock", "rk-test-e2e-multi-7.lock", prefix, noEphemeral, noProtected, false, ReapActionRemove},

		// Unmatched (different prefix) → skip regardless of liveness.
		{"unmatched non-test", "runkit", prefix, noEphemeral, noProtected, true, ReapActionSkip},
		{"unmatched non-test dead", "default", prefix, noEphemeral, noProtected, false, ReapActionSkip},
		{"unmatched lock", "kits.lock", prefix, noEphemeral, noProtected, false, ReapActionSkip},
		{"old rk-e2e no longer matched", "rk-e2e-coupling-640069", prefix, noEphemeral, noProtected, true, ReapActionSkip},

		// Unconditional skips even when they match the prefix.
		{"control anchor matches nothing but skip", ControlAnchorSessionName, prefix, noEphemeral, noProtected, true, ReapActionSkip},
		{"rk-daemon under broad rk prefix", productionDaemonServer, "rk", noEphemeral, noProtected, true, ReapActionSkip},
		{"control anchor under broad prefix", ControlAnchorSessionName, "_rk", noEphemeral, noProtected, true, ReapActionSkip},

		// Custom prefix matches its family.
		{"custom prefix match live", "proj-a", "proj", noEphemeral, noProtected, true, ReapActionKill},
		{"custom prefix match dead", "proj-b", "proj", noEphemeral, noProtected, false, ReapActionRemove},
		{"custom prefix non-match", "runkit", "proj", noEphemeral, noProtected, true, ReapActionSkip},

		// Ephemeral dimension: option-marked names match regardless of prefix.
		{"ephemeral live arbitrary name", "echotest", prefix, map[string]bool{"echotest": true}, noProtected, true, ReapActionKill},
		{"ephemeral match is live, classifies kill", "agyprobe", "proj", map[string]bool{"agyprobe": true}, noProtected, true, ReapActionKill},

		// Unconditional skips win over the ephemeral mark too.
		{"control anchor marked ephemeral still skipped", ControlAnchorSessionName, prefix, map[string]bool{ControlAnchorSessionName: true}, noProtected, true, ReapActionSkip},
		{"rk-daemon marked ephemeral still skipped", productionDaemonServer, prefix, map[string]bool{productionDaemonServer: true}, noProtected, true, ReapActionSkip},

		// Protected dimension: a LIVE protected server is skipped
		// unconditionally — under a prefix match, under the ephemeral mark,
		// and under both (protected beats ephemeral). A formerly-protected
		// server's DEAD socket file stays removable (inert).
		{"protected live under prefix match skipped", "rk-test-vault", prefix, noEphemeral, map[string]bool{"rk-test-vault": true}, true, ReapActionSkip},
		{"protected live under ephemeral mark skipped", "vault", prefix, map[string]bool{"vault": true}, map[string]bool{"vault": true}, true, ReapActionSkip},
		{"protected beats ephemeral under prefix", "rk-test-vault", prefix, map[string]bool{"rk-test-vault": true}, map[string]bool{"rk-test-vault": true}, true, ReapActionSkip},
		{"protected dead socket file still removed", "rk-test-vault", prefix, noEphemeral, map[string]bool{"rk-test-vault": true}, false, ReapActionRemove},

		// The operator session is a SESSION name, never a socket — structurally
		// out of the reaper's socket-dir sweep (ReapTestServers enumerates the
		// tmux socket directory, whose entries are SERVER sockets, not session
		// names). It carries no ephemeral mark and matches no test prefix, so it
		// classifies skip.
		{"operator session name matches no test prefix", OperatorSessionName, prefix, noEphemeral, noProtected, false, ReapActionSkip},
		{"operator session name is never ephemeral-marked", OperatorSessionName, prefix, map[string]bool{}, noProtected, true, ReapActionSkip},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := classifyReap(tc.socketName, tc.prefix, tc.ephemeral, tc.protected, tc.serverLive); got != tc.want {
				t.Errorf("classifyReap(%q, prefix=%q, ephemeral=%v, protected=%v, live=%v) = %v, want %v",
					tc.socketName, tc.prefix, tc.ephemeral, tc.protected, tc.serverLive, got, tc.want)
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

	result, err := reapCandidates(context.Background(), dir, "rk-test", candidates, nil, nil, probe, false)
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

	result, err := reapCandidates(context.Background(), dir, "rk-test", candidates, nil, nil, probe, true)
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

	result, err := reapCandidates(context.Background(), dir, "rk", candidates, nil, nil, probe, true)
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
			_, err := ReapTestServers(context.Background(), tc.prefix, tc.act, tc.force, false)
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

	result, err := reapCandidates(context.Background(), dir, "rk-test", candidates, nil, nil, probe, true)
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

	result, err := reapCandidates(context.Background(), dir, "rk-test", candidates, nil, nil, probe, true)
	if err != nil {
		t.Fatalf("expected nil error on all-success, got %v", err)
	}
	if len(result.RemovedSockets) != 2 {
		t.Errorf("removed = %v, want 2 entries", result.RemovedSockets)
	}
}

// TestReapCandidates_killRemovesSocketFile proves the kill arm's file hygiene:
// tmux does not unlink a killed server's socket, so after a successful kill the
// reaper removes the file itself — without double-reporting it in
// RemovedSockets — and tolerates a file that is already gone (ENOENT is
// success: a tmux build that unlinks on exit is fine). KillServer treats a
// nonexistent socket as already-gone (nil error), so a fake-live candidate
// with no real server exercises the kill-SUCCESS path without spawning tmux
// servers.
func TestReapCandidates_killRemovesSocketFile(t *testing.T) {
	dir := t.TempDir()
	candidates := []string{
		"rk-test-unit-1-live",   // file present → killed, then file removed
		"rk-test-unit-2-orphan", // file absent from dir → killed, ENOENT tolerated
	}
	writeFiles(t, dir, "rk-test-unit-1-live")
	probe := fakeProbe(map[string]bool{"rk-test-unit-1-live": true, "rk-test-unit-2-orphan": true})

	result, err := reapCandidates(context.Background(), dir, "rk-test", candidates, nil, nil, probe, true)
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	sort.Strings(result.Killed)
	want := []string{"rk-test-unit-1-live", "rk-test-unit-2-orphan"}
	if !slices.Equal(result.Killed, want) {
		t.Fatalf("killed = %v, want %v", result.Killed, want)
	}
	if len(result.RemovedSockets) != 0 {
		t.Errorf("RemovedSockets = %v, want empty — a killed entry's file removal is implied, never double-reported", result.RemovedSockets)
	}
	if got := presentFiles(t, dir); len(got) != 0 {
		t.Errorf("files left = %v, want none — the kill arm must remove the killed server's socket file", got)
	}
}

// TestReapCandidates_killFailureKeepsSocketFile proves a FAILED kill leaves the
// socket file in place — the server may still be live, and removing a live
// server's socket would orphan it from every -L client. PATH is emptied so
// KillServer's tmux exec fails with a real (non-already-gone) error.
func TestReapCandidates_killFailureKeepsSocketFile(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PATH", "")
	candidates := []string{"rk-test-unit-5-live"}
	writeFiles(t, dir, candidates...)
	probe := fakeProbe(map[string]bool{"rk-test-unit-5-live": true})

	result, err := reapCandidates(context.Background(), dir, "rk-test", candidates, nil, nil, probe, true)
	if err == nil {
		t.Fatal("expected aggregate error from the failed kill, got nil")
	}
	if len(result.Killed) != 0 {
		t.Errorf("killed = %v, want empty after a failed kill", result.Killed)
	}
	if got := presentFiles(t, dir); !slices.Equal(got, []string{"rk-test-unit-5-live"}) {
		t.Errorf("files = %v, want the socket file kept after a failed kill", got)
	}
}

// TestReapCandidates_ephemeralUnionDryRunPlan proves --ephemeral matches the
// UNION of the prefix match and the caller-computed ephemeral set: an
// option-marked live server with an arbitrary name classifies kill via the
// option dimension while the default prefix still matches dead sockets.
func TestReapCandidates_ephemeralUnionDryRunPlan(t *testing.T) {
	dir := t.TempDir()
	candidates := []string{
		"echotest",    // ephemeral-marked live, prefix-unmatched → kill (option dimension)
		"rk-test-old", // prefix-matched dead socket → remove (prefix dimension)
		"runkit",      // matched by NEITHER dimension → skip
		ControlAnchorSessionName,
	}
	writeFiles(t, dir, candidates...)
	ephemeral := map[string]bool{"echotest": true}
	probe := fakeProbe(map[string]bool{"echotest": true, "runkit": true, ControlAnchorSessionName: true})

	result, err := reapCandidates(context.Background(), dir, "rk-test", candidates, ephemeral, nil, probe, false)
	if err != nil {
		t.Fatalf("dry-run returned error: %v", err)
	}
	if len(result.Killed) != 0 || len(result.RemovedSockets) != 0 {
		t.Errorf("dry-run reported actions: killed=%v removed=%v", result.Killed, result.RemovedSockets)
	}
	wantPlan := map[string]ReapAction{
		"echotest":    ReapActionKill,
		"rk-test-old": ReapActionRemove,
	}
	if len(result.DryRunPlan) != len(wantPlan) {
		t.Fatalf("union dry-run plan size = %d, want %d (%v)", len(result.DryRunPlan), len(wantPlan), result.DryRunPlan)
	}
	for _, e := range result.DryRunPlan {
		if want, ok := wantPlan[e.Name]; !ok {
			t.Errorf("unexpected dry-run plan entry %q", e.Name)
		} else if e.Action != want {
			t.Errorf("dry-run plan %q action = %v, want %v", e.Name, e.Action, want)
		}
	}
}

// TestReapCandidates_ephemeralHardSkipsWin proves the unconditional skips
// (_rk-ctl anchor, rk-daemon) survive even when they carry the ephemeral mark.
func TestReapCandidates_ephemeralHardSkipsWin(t *testing.T) {
	dir := t.TempDir()
	candidates := []string{
		ControlAnchorSessionName,
		productionDaemonServer,
		"scratch", // marked, unmatched by prefix → killed via option dimension
	}
	writeFiles(t, dir, candidates...)
	ephemeral := map[string]bool{
		ControlAnchorSessionName: true,
		productionDaemonServer:   true,
		"scratch":                true,
	}
	probe := fakeProbe(map[string]bool{
		ControlAnchorSessionName: true,
		productionDaemonServer:   true,
		"scratch":                true,
	})

	result, err := reapCandidates(context.Background(), dir, "rk-test", candidates, ephemeral, nil, probe, false)
	if err != nil {
		t.Fatalf("dry-run returned error: %v", err)
	}
	if len(result.DryRunPlan) != 1 || result.DryRunPlan[0].Name != "scratch" || result.DryRunPlan[0].Action != ReapActionKill {
		t.Fatalf("dry-run plan = %v, want only scratch → kill (hard skips survive the mark)", result.DryRunPlan)
	}
	for _, must := range []string{ControlAnchorSessionName, productionDaemonServer} {
		for _, e := range result.DryRunPlan {
			if e.Name == must {
				t.Errorf("%q in dry-run plan despite the unconditional skip", must)
			}
		}
	}
}

// TestReapCandidates_protectedSkippedUnconditionally proves the protected
// skip through the I/O core: a live prefix-matched server carrying BOTH marks
// is skipped (protected beats ephemeral — reported nowhere, killed nowhere),
// an unmarked sibling is reaped as before, and a formerly-protected server's
// dead socket file is still removed.
func TestReapCandidates_protectedSkippedUnconditionally(t *testing.T) {
	dir := t.TempDir()
	candidates := []string{
		"rk-test-vault",  // live, prefix-matched, BOTH marks → skip
		"rk-test-old",    // live, prefix-matched, unmarked → kill
		"rk-test-legacy", // dead socket, formerly protected → remove
	}
	writeFiles(t, dir, candidates...)
	ephemeral := map[string]bool{"rk-test-vault": true}
	protected := map[string]bool{"rk-test-vault": true, "rk-test-legacy": true}
	probe := fakeProbe(map[string]bool{"rk-test-vault": true, "rk-test-old": true})

	result, err := reapCandidates(context.Background(), dir, "rk-test", candidates, ephemeral, protected, probe, true)
	if err != nil {
		t.Fatalf("reap returned error: %v", err)
	}

	if slices.Contains(result.Killed, "rk-test-vault") {
		t.Errorf("protected server killed: %v (protected beats ephemeral)", result.Killed)
	}
	if !slices.Contains(result.Killed, "rk-test-old") {
		t.Errorf("unmarked sibling not reaped: killed=%v", result.Killed)
	}
	if !slices.Contains(result.RemovedSockets, "rk-test-legacy") {
		t.Errorf("formerly-protected dead socket not removed: removed=%v", result.RemovedSockets)
	}

	after := presentFiles(t, dir)
	if !slices.Contains(after, "rk-test-vault") {
		t.Errorf("protected server socket touched (remaining: %v)", after)
	}
}

// TestReapTestServers_dangerousPrefixGuardStillAppliesWithEphemeral proves the
// guard scopes to the prefix dimension only: a dangerous prefix is still
// refused with the ephemeral dimension enabled, while a safe prefix passes.
func TestReapTestServers_dangerousPrefixGuardStillAppliesWithEphemeral(t *testing.T) {
	if _, err := ReapTestServers(context.Background(), "rk-", false, false, true); err == nil {
		t.Error("dangerous prefix with --ephemeral should still be refused")
	}
	if _, err := ReapTestServers(context.Background(), "rk-test", false, false, true); err != nil &&
		strings.Contains(err.Error(), "refusing prefix") {
		t.Errorf("safe prefix with --ephemeral wrongly refused: %v", err)
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

// TestEphemeralServers_markedLiveServerListedSorted proves the exported
// wrapper lists exactly the marked live servers, sorted. The test server name
// is rk-test-prefixed, so any other marked servers on the box (e.g. leftovers
// from a concurrent run) are filtered out of the assertion.
func TestEphemeralServers_markedLiveServerListedSorted(t *testing.T) {
	server := withSessionOrderTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	args := append(serverArgs(server), "set-option", "-s", EphemeralOption, "1")
	if out, err := exec.CommandContext(ctx, "tmux", args...).CombinedOutput(); err != nil {
		t.Fatalf("set %s: %v\n%s", EphemeralOption, err, string(out))
	}

	got, err := EphemeralServers(ctx)
	if err != nil {
		t.Fatalf("EphemeralServers: %v", err)
	}
	if !sort.StringsAreSorted(got) {
		t.Errorf("EphemeralServers = %v, want sorted", got)
	}
	if !slices.Contains(got, server) {
		t.Errorf("EphemeralServers = %v, want marked server %q listed", got, server)
	}

	// Un-setting the mark promotes the server back to durable — it drops out.
	unsetArgs := append(serverArgs(server), "set-option", "-s", "-u", EphemeralOption)
	if out, err := exec.CommandContext(ctx, "tmux", unsetArgs...).CombinedOutput(); err != nil {
		t.Fatalf("unset %s: %v\n%s", EphemeralOption, err, string(out))
	}
	got, err = EphemeralServers(ctx)
	if err != nil {
		t.Fatalf("EphemeralServers after unset: %v", err)
	}
	if slices.Contains(got, server) {
		t.Errorf("EphemeralServers = %v, want %q gone after unset", got, server)
	}
}
