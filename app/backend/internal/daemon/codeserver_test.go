package daemon

import (
	"context"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"rk/internal/codeserver"
	"rk/internal/testutil"
)

// withCodeServerSeams substitutes the session-exists, spawn, home-dir,
// job-spawn, and self-path seams for one test, returning recorders for the
// spawn argv and job argv plus the temp home the profile paths resolve under.
// Stubbing home here — for every test, not only the profile-focused ones —
// guarantees no test can ever write to the real ~/.rk. Restores via
// t.Cleanup.
func withCodeServerSeams(t *testing.T, sessionExists bool) (spawned *[][]string, jobs *[][]string, home string) {
	t.Helper()
	spawned = &[][]string{}
	jobs = &[][]string{}
	home = t.TempDir()

	origExists, origSpawn, origHome := codeServerSessionExists, codeServerSpawn, codeServerUserHomeDir
	origJob, origSelf := codeServerRunJob, codeServerSelfPath
	t.Cleanup(func() {
		codeServerSessionExists, codeServerSpawn, codeServerUserHomeDir = origExists, origSpawn, origHome
		codeServerRunJob, codeServerSelfPath = origJob, origSelf
	})

	codeServerSessionExists = func(context.Context) bool { return sessionExists }
	codeServerSpawn = func(_ context.Context, args ...string) error {
		*spawned = append(*spawned, args)
		return nil
	}
	codeServerUserHomeDir = func() (string, error) { return home, nil }
	codeServerRunJob = func(_ context.Context, window string, argv []string) (JobTarget, bool, error) {
		*jobs = append(*jobs, append([]string{window}, argv...))
		return JobTarget{Session: JobsSessionName, Window: window, WindowID: "@1"}, true, nil
	}
	codeServerSelfPath = func() (string, error) { return "/usr/local/bin/rk", nil }
	return spawned, jobs, home
}

// freeLoopbackPort returns a port that was just free on 127.0.0.1.
func freeLoopbackPort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	return port
}

// seededSettingsPath is the profile settings file under a test home.
func seededSettingsPath(home string) string {
	return filepath.Join(home, ".rk", "code-server-profile", "User", "settings.json")
}

func TestEnsureCodeServerSpawnsSiblingSession(t *testing.T) {
	stubDir := testutil.StubOnPath(t, "code-server", "#!/bin/sh\nexit 0\n")
	port := freeLoopbackPort(t)
	t.Setenv("RK_CODE_SERVER_PORT", fmt.Sprint(port))
	t.Setenv("XDG_DATA_HOME", "") // force the ~/.local/share fallback
	spawned, _, home := withCodeServerSeams(t, false)

	ensureCodeServer()

	if len(*spawned) != 1 {
		t.Fatalf("spawn calls = %d, want 1", len(*spawned))
	}
	got := strings.Join((*spawned)[0], " ")
	want := fmt.Sprintf(
		"new-session -d -s rk-code-server -n code-server env -u VSCODE_IPC_HOOK_CLI %s --bind-addr 127.0.0.1:%d --auth none --disable-telemetry --disable-update-check --disable-workspace-trust --disable-getting-started-override --app-name run-kit --user-data-dir %s --extensions-dir %s",
		filepath.Join(stubDir, "code-server"), // the ladder's PATH rung resolves absolute
		port,
		filepath.Join(home, ".rk", "code-server-profile"),
		filepath.Join(home, ".local", "share", "code-server", "extensions"),
	)
	if got != want {
		t.Errorf("spawn argv =\n%s\nwant:\n%s", got, want)
	}
}

func TestEnsureCodeServerSeedsSettingsWhenAbsent(t *testing.T) {
	testutil.StubOnPath(t, "code-server", "#!/bin/sh\nexit 0\n")
	t.Setenv("RK_CODE_SERVER_PORT", fmt.Sprint(freeLoopbackPort(t)))
	spawned, _, home := withCodeServerSeams(t, false)

	ensureCodeServer()

	if len(*spawned) != 1 {
		t.Fatalf("spawn calls = %d, want 1", len(*spawned))
	}
	got, err := os.ReadFile(seededSettingsPath(home))
	if err != nil {
		t.Fatalf("seeded settings.json unreadable: %v", err)
	}
	if string(got) != codeServerSeedSettings {
		t.Errorf("seeded settings.json =\n%s\nwant:\n%s", got, codeServerSeedSettings)
	}
}

func TestEnsureCodeServerPreservesExistingSettings(t *testing.T) {
	testutil.StubOnPath(t, "code-server", "#!/bin/sh\nexit 0\n")
	t.Setenv("RK_CODE_SERVER_PORT", fmt.Sprint(freeLoopbackPort(t)))
	spawned, _, home := withCodeServerSeams(t, false)

	const userContent = `{"workbench.startupEditor": "welcomePage"}`
	path := seededSettingsPath(home)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(userContent), 0o644); err != nil {
		t.Fatal(err)
	}

	ensureCodeServer()

	if len(*spawned) != 1 {
		t.Fatalf("spawn calls = %d, want 1", len(*spawned))
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != userContent {
		t.Errorf("existing settings.json modified:\n%s\nwant untouched:\n%s", got, userContent)
	}
}

func TestEnsureCodeServerExtensionsDirHonorsXDGDataHome(t *testing.T) {
	testutil.StubOnPath(t, "code-server", "#!/bin/sh\nexit 0\n")
	t.Setenv("RK_CODE_SERVER_PORT", fmt.Sprint(freeLoopbackPort(t)))
	t.Setenv("XDG_DATA_HOME", "/custom/data")
	spawned, _, _ := withCodeServerSeams(t, false)

	ensureCodeServer()

	if len(*spawned) != 1 {
		t.Fatalf("spawn calls = %d, want 1", len(*spawned))
	}
	got := strings.Join((*spawned)[0], " ")
	want := "--extensions-dir " + filepath.Join("/custom/data", "code-server", "extensions")
	if !strings.Contains(got, want) {
		t.Errorf("spawn argv = %q, want it to contain %q", got, want)
	}
}

func TestEnsureCodeServerSeedFailureKeepsProfileFlags(t *testing.T) {
	testutil.StubOnPath(t, "code-server", "#!/bin/sh\nexit 0\n")
	t.Setenv("RK_CODE_SERVER_PORT", fmt.Sprint(freeLoopbackPort(t)))
	t.Setenv("XDG_DATA_HOME", "") // deterministic extensions-dir fallback
	spawned, _, home := withCodeServerSeams(t, false)

	// A FILE at ~/.rk makes MkdirAll under it fail — the seed errors, but the
	// spawn must still carry both profile flags (code-server creates its own
	// user-data-dir; the only degradation is an unseeded profile).
	if err := os.WriteFile(filepath.Join(home, ".rk"), []byte("not a dir"), 0o644); err != nil {
		t.Fatal(err)
	}

	ensureCodeServer()

	if len(*spawned) != 1 {
		t.Fatalf("spawn calls = %d, want 1", len(*spawned))
	}
	got := strings.Join((*spawned)[0], " ")
	if !strings.Contains(got, "--user-data-dir "+filepath.Join(home, ".rk", "code-server-profile")) {
		t.Errorf("spawn argv = %q, want --user-data-dir despite the failed seed", got)
	}
	if !strings.Contains(got, "--extensions-dir "+filepath.Join(home, ".local", "share", "code-server", "extensions")) {
		t.Errorf("spawn argv = %q, want --extensions-dir despite the failed seed", got)
	}
}

func TestEnsureCodeServerHomeFailureDropsProfileFlags(t *testing.T) {
	testutil.StubOnPath(t, "code-server", "#!/bin/sh\nexit 0\n")
	t.Setenv("RK_CODE_SERVER_PORT", fmt.Sprint(freeLoopbackPort(t)))
	spawned, _, _ := withCodeServerSeams(t, false)
	codeServerUserHomeDir = func() (string, error) { return "", fmt.Errorf("no home") }

	ensureCodeServer()

	if len(*spawned) != 1 {
		t.Fatalf("spawn calls = %d, want 1", len(*spawned))
	}
	got := strings.Join((*spawned)[0], " ")
	if strings.Contains(got, "--user-data-dir") || strings.Contains(got, "--extensions-dir") {
		t.Errorf("spawn argv = %q, want the pre-profile argv when home is unresolvable", got)
	}
	if !strings.HasSuffix(got, "--app-name run-kit") {
		t.Errorf("spawn argv = %q, want it to end at the curation flags", got)
	}
}

func TestEnsureCodeServerSkipsWhenSessionExists(t *testing.T) {
	spawned, jobs, _ := withCodeServerSeams(t, true)

	ensureCodeServer()

	if len(*spawned) != 0 {
		t.Errorf("spawn calls = %d, want 0 (session already managed)", len(*spawned))
	}
	if len(*jobs) != 0 {
		t.Errorf("job spawns = %d, want 0 (session already managed)", len(*jobs))
	}
}

func TestEnsureCodeServerSkipsWhenPortListening(t *testing.T) {
	// A REAL loopback listener drives the externally-managed-instance branch —
	// no seam needed for the port probe.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	t.Setenv("RK_CODE_SERVER_PORT", fmt.Sprint(ln.Addr().(*net.TCPAddr).Port))
	spawned, jobs, home := withCodeServerSeams(t, false)

	ensureCodeServer()

	if len(*spawned) != 0 {
		t.Errorf("spawn calls = %d, want 0 (port already serving)", len(*spawned))
	}
	if len(*jobs) != 0 {
		t.Errorf("job spawns = %d, want 0 (port already serving)", len(*jobs))
	}
	// The externally managed instance gets no seed either — the seed runs on
	// the spawn branch only.
	if _, err := os.Stat(seededSettingsPath(home)); err == nil {
		t.Error("settings.json seeded for an externally managed instance, want no write")
	}
}

func TestEnsureCodeServerConventionPort(t *testing.T) {
	testutil.StubOnPath(t, "code-server", "#!/bin/sh\nexit 0\n")
	// Convention resolution: no preset, RK_PORT+2 must be free — pick a free
	// port P and set RK_PORT=P-2.
	port := freeLoopbackPort(t)
	t.Setenv("RK_PORT", fmt.Sprint(port-2))
	t.Setenv("RK_CODE_SERVER_PORT", "")
	spawned, _, _ := withCodeServerSeams(t, false)

	ensureCodeServer()

	if len(*spawned) != 1 {
		t.Fatalf("spawn calls = %d, want 1", len(*spawned))
	}
	got := strings.Join((*spawned)[0], " ")
	if !strings.Contains(got, fmt.Sprintf("--bind-addr 127.0.0.1:%d", port)) {
		t.Errorf("spawn argv = %q, want bind to the convention port %d", got, port)
	}
}

func TestEnsureCodeServerSpawnFailureNeverPropagates(t *testing.T) {
	testutil.StubOnPath(t, "code-server", "#!/bin/sh\nexit 0\n")
	t.Setenv("RK_CODE_SERVER_PORT", fmt.Sprint(freeLoopbackPort(t)))
	_, _, _ = withCodeServerSeams(t, false)
	codeServerSpawn = func(context.Context, ...string) error { return fmt.Errorf("tmux exploded") }

	ensureCodeServer() // must not panic; the error is logged and swallowed
}

// --- R6: the two-rung resolution ladder ---

// installManagedBinary materializes a managed install under the test home:
// <home>/.rk/code-server-bin/<version>/bin/code-server (executable) with the
// current symlink flipped to it. Returns the SPAWNED path — the ladder hands
// back the current-symlink path (a flipped symlink + respawn picks up the new
// version), not the version dir.
func installManagedBinary(t *testing.T, home, version string) string {
	t.Helper()
	bin := filepath.Join(codeserver.VersionDir(home, version), "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bin, "code-server"), []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(version, codeserver.CurrentPath(home)); err != nil {
		t.Fatal(err)
	}
	return codeserver.BinaryPath(home)
}

func TestResolveCodeServerBinaryManagedWins(t *testing.T) {
	stubDir := testutil.StubOnPath(t, "code-server", "#!/bin/sh\nexit 0\n")
	_, _, home := withCodeServerSeams(t, false)
	managed := installManagedBinary(t, home, "4.132.0")

	got := resolveCodeServerBinary(home)
	if got != managed {
		t.Errorf("resolveCodeServerBinary = %q, want the managed path %q (rung 1 wins over PATH %q)", got, managed, filepath.Join(stubDir, "code-server"))
	}
}

func TestResolveCodeServerBinaryPathFallback(t *testing.T) {
	stubDir := testutil.StubOnPath(t, "code-server", "#!/bin/sh\nexit 0\n")
	_, _, home := withCodeServerSeams(t, false) // no managed install under home

	got := resolveCodeServerBinary(home)
	want := filepath.Join(stubDir, "code-server")
	if got != want {
		t.Errorf("resolveCodeServerBinary = %q, want the PATH rung %q", got, want)
	}
}

func TestResolveCodeServerBinaryMissing(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PATH", dir) // PATH replacement — code-server must NOT resolve
	_, _, home := withCodeServerSeams(t, false)

	if got := resolveCodeServerBinary(home); got != "" {
		t.Errorf("resolveCodeServerBinary = %q, want \"\" (neither rung resolves)", got)
	}
}

func TestEnsureCodeServerSpawnsManagedAbsolutePath(t *testing.T) {
	testutil.StubOnPath(t, "code-server", "#!/bin/sh\nexit 0\n") // PATH also has one — managed still wins
	t.Setenv("RK_CODE_SERVER_PORT", fmt.Sprint(freeLoopbackPort(t)))
	spawned, _, home := withCodeServerSeams(t, false)
	managed := installManagedBinary(t, home, "4.132.0")

	ensureCodeServer()

	if len(*spawned) != 1 {
		t.Fatalf("spawn calls = %d, want 1", len(*spawned))
	}
	got := strings.Join((*spawned)[0], " ")
	if !strings.Contains(got, " "+managed+" --bind-addr") {
		t.Errorf("spawn argv = %q, want the managed absolute path %q as the binary", got, managed)
	}
}

// --- R7: one-shot profile migration ---

func TestMigrateCodeServerProfileRenames(t *testing.T) {
	_, _, home := withCodeServerSeams(t, false)
	oldDir := codeServerLegacyProfileDir(home)
	marker := filepath.Join(oldDir, "User", "settings.json")
	if err := os.MkdirAll(filepath.Dir(marker), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(marker, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := migrateCodeServerProfile(home); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(oldDir); !os.IsNotExist(err) {
		t.Error("legacy dir still present after migration")
	}
	if _, err := os.Stat(filepath.Join(codeServerProfileDir(home), "User", "settings.json")); err != nil {
		t.Errorf("settings.json did not survive the rename: %v", err)
	}
}

func TestMigrateCodeServerProfileBothExistLeavesBoth(t *testing.T) {
	_, _, home := withCodeServerSeams(t, false)
	for _, dir := range []string{codeServerLegacyProfileDir(home), codeServerProfileDir(home)} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}

	if err := migrateCodeServerProfile(home); err != nil {
		t.Fatal(err)
	}

	// New wins; the legacy dir is left untouched (never destroyed).
	for _, dir := range []string{codeServerLegacyProfileDir(home), codeServerProfileDir(home)} {
		if _, err := os.Stat(dir); err != nil {
			t.Errorf("%s missing after the both-exist no-op: %v", dir, err)
		}
	}
}

func TestMigrateCodeServerProfileFreshHostNoOp(t *testing.T) {
	_, _, home := withCodeServerSeams(t, false)

	if err := migrateCodeServerProfile(home); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(codeServerProfileDir(home)); !os.IsNotExist(err) {
		t.Error("profile dir created by migration — the seed owns creation on a fresh host")
	}
}

// --- R8: missing binary spawns the install job ---

func TestEnsureCodeServerSpawnsInstallJobWhenBinaryMissing(t *testing.T) {
	// PATH replacement (not StubOnPath): code-server must NOT resolve.
	dir := t.TempDir()
	t.Setenv("PATH", dir)
	t.Setenv("RK_CODE_SERVER_PORT", fmt.Sprint(freeLoopbackPort(t)))
	spawned, jobs, _ := withCodeServerSeams(t, false)

	// Must not panic or error-propagate — the caller (startSession) still
	// brings up rk serve — and must return WITHOUT blocking on the download.
	ensureCodeServer()

	if len(*spawned) != 0 {
		t.Errorf("spawn calls = %d, want 0 (binary absent)", len(*spawned))
	}
	if len(*jobs) != 1 {
		t.Fatalf("job spawns = %d, want 1 (the install-then-start job)", len(*jobs))
	}
	job := (*jobs)[0]
	if job[0] != "code-server-install" {
		t.Errorf("job window = %q, want code-server-install", job[0])
	}
	want := `'/usr/local/bin/rk' code-server install && '/usr/local/bin/rk' code-server start`
	if len(job) != 2 || job[1] != want {
		t.Errorf("job argv = %q, want the single-element quoted chain %q", job[1:], want)
	}
}

func TestEnsureCodeServerInstallJobQuotesExePath(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PATH", dir)
	t.Setenv("RK_CODE_SERVER_PORT", fmt.Sprint(freeLoopbackPort(t)))
	_, jobs, _ := withCodeServerSeams(t, false)
	codeServerSelfPath = func() (string, error) { return "/Users/Jane Doe/bin/rk", nil }

	ensureCodeServer()

	if len(*jobs) != 1 {
		t.Fatalf("job spawns = %d, want 1", len(*jobs))
	}
	want := `'/Users/Jane Doe/bin/rk' code-server install && '/Users/Jane Doe/bin/rk' code-server start`
	if got := (*jobs)[0][1]; got != want {
		t.Errorf("job argv = %q, want the shell-quoted chain %q", got, want)
	}
}

func TestEnsureCodeServerInstallJobDedupLeavesLiveWindow(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PATH", dir)
	t.Setenv("RK_CODE_SERVER_PORT", fmt.Sprint(freeLoopbackPort(t)))
	spawned, _, _ := withCodeServerSeams(t, false)
	codeServerRunJob = func(_ context.Context, window string, argv []string) (JobTarget, bool, error) {
		return JobTarget{Session: JobsSessionName, Window: window, WindowID: "@9"}, false, nil // live ⇒ in-flight
	}

	ensureCodeServer() // started=false must stay a quiet no-op, not a second spawn

	if len(*spawned) != 0 {
		t.Errorf("spawn calls = %d, want 0", len(*spawned))
	}
}

// --- R10: the exported CLI start path ---

// withDaemonGate substitutes the daemon-liveness seam (jobs.go's
// jobDaemonRunning) for one test. Restores via t.Cleanup.
func withDaemonGate(t *testing.T, running bool) {
	t.Helper()
	orig := jobDaemonRunning
	t.Cleanup(func() { jobDaemonRunning = orig })
	jobDaemonRunning = func(context.Context) bool { return running }
}

func TestStartCodeServerDaemonDown(t *testing.T) {
	withDaemonGate(t, false)

	_, err := StartCodeServer()
	if err == nil || !strings.Contains(err.Error(), "rk serve -d") {
		t.Errorf("err = %v, want an operational error naming `rk serve -d`", err)
	}
}

func TestStartCodeServerAlreadyRunning(t *testing.T) {
	withDaemonGate(t, true)
	spawned, _, _ := withCodeServerSeams(t, true)

	outcome, err := StartCodeServer()
	if err != nil {
		t.Fatal(err)
	}
	if outcome != EnsureAlreadyRunning {
		t.Errorf("outcome = %v, want EnsureAlreadyRunning", outcome)
	}
	if len(*spawned) != 0 {
		t.Errorf("spawn calls = %d, want 0 (session already managed)", len(*spawned))
	}
}

func TestStartCodeServerMissingBinaryIsOperationalError(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PATH", dir)
	t.Setenv("RK_CODE_SERVER_PORT", fmt.Sprint(freeLoopbackPort(t)))
	withDaemonGate(t, true)
	_, jobs, _ := withCodeServerSeams(t, false)

	_, err := StartCodeServer()
	if err == nil || !strings.Contains(err.Error(), "rk code-server install") {
		t.Errorf("err = %v, want an operational error naming `rk code-server install`", err)
	}
	if len(*jobs) != 0 {
		t.Errorf("job spawns = %d, want 0 — the CLI posture never spawns the job", len(*jobs))
	}
}

func TestStartCodeServerSpawns(t *testing.T) {
	testutil.StubOnPath(t, "code-server", "#!/bin/sh\nexit 0\n")
	t.Setenv("RK_CODE_SERVER_PORT", fmt.Sprint(freeLoopbackPort(t)))
	withDaemonGate(t, true)
	spawned, _, _ := withCodeServerSeams(t, false)

	outcome, err := StartCodeServer()
	if err != nil {
		t.Fatal(err)
	}
	if outcome != EnsureStarted {
		t.Errorf("outcome = %v, want EnsureStarted", outcome)
	}
	if len(*spawned) != 1 {
		t.Fatalf("spawn calls = %d, want 1", len(*spawned))
	}
}

// --- KillCodeServerSession (R11's respawn half) ---

func TestKillCodeServerSessionAbsentIsNoop(t *testing.T) {
	// Absence short-circuits before any tmux call, so no runTmux seam is
	// needed — a live tmux server would still see no kill-session.
	_, _, _ = withCodeServerSeams(t, false)
	killed, err := KillCodeServerSession()
	if err != nil {
		t.Fatalf("absent session must be a no-op, got %v", err)
	}
	if killed {
		t.Error("killed = true, want false — nothing existed to kill")
	}
}

func TestKillCodeServerSessionPresentKillsAndReports(t *testing.T) {
	withCodeServerSeams(t, true)
	origKill := codeServerKillRun
	t.Cleanup(func() { codeServerKillRun = origKill })
	var gotArgs []string
	codeServerKillRun = func(_ context.Context, args ...string) error {
		gotArgs = args
		return nil
	}

	killed, err := KillCodeServerSession()
	if err != nil {
		t.Fatal(err)
	}
	if !killed {
		t.Error("killed = false, want true — the session existed and the kill succeeded")
	}
	want := []string{"kill-session", "-t", "=" + CodeServerSessionName}
	if len(gotArgs) != len(want) {
		t.Fatalf("kill argv = %v, want %v", gotArgs, want)
	}
	for i := range want {
		if gotArgs[i] != want[i] {
			t.Fatalf("kill argv = %v, want the exact-match %v", gotArgs, want)
		}
	}
}

func TestKillCodeServerSessionKillErrorReportsNotKilled(t *testing.T) {
	withCodeServerSeams(t, true)
	origKill := codeServerKillRun
	t.Cleanup(func() { codeServerKillRun = origKill })
	codeServerKillRun = func(context.Context, ...string) error {
		return fmt.Errorf("tmux exited 1")
	}

	killed, err := KillCodeServerSession()
	if err == nil {
		t.Fatal("err = nil, want the wrapped kill failure")
	}
	if killed {
		t.Error("killed = true, want false on a failed kill")
	}
}

// --- CodeServerSessionCommand (260813-2s4u) ---

func TestCodeServerSessionCommandAbsent(t *testing.T) {
	withCodeServerSeams(t, false)
	cmd, exists, err := CodeServerSessionCommand()
	if cmd != "" || exists || err != nil {
		t.Fatalf("got (%q, %v, %v), want (\"\", false, nil) for an absent session", cmd, exists, err)
	}
}

func TestCodeServerSessionCommandReadsFirstLine(t *testing.T) {
	withCodeServerSeams(t, true)
	origPane := codeServerPaneCommand
	t.Cleanup(func() { codeServerPaneCommand = origPane })
	var gotTarget string
	codeServerPaneCommand = func(_ context.Context, target string) ([]byte, error) {
		gotTarget = target
		// Two lines: a manual split adds a second pane — the first line wins.
		return []byte("env -u VSCODE_IPC_HOOK_CLI /x/bin/code-server --auth none\nzsh\n"), nil
	}

	cmd, exists, err := CodeServerSessionCommand()
	if err != nil || !exists {
		t.Fatalf("got (exists=%v, err=%v), want an inspectable session", exists, err)
	}
	if want := "=" + CodeServerSessionName + ":=" + CodeServerWindowName; gotTarget != want {
		t.Errorf("target = %q, want the exact-match %q", gotTarget, want)
	}
	if want := "env -u VSCODE_IPC_HOOK_CLI /x/bin/code-server --auth none"; cmd != want {
		t.Errorf("cmd = %q, want the first line %q", cmd, want)
	}
}

func TestCodeServerSessionCommandQueryErrorIsUncertain(t *testing.T) {
	withCodeServerSeams(t, true)
	origPane := codeServerPaneCommand
	t.Cleanup(func() { codeServerPaneCommand = origPane })
	codeServerPaneCommand = func(context.Context, string) ([]byte, error) {
		return nil, fmt.Errorf("no such window")
	}

	_, exists, err := CodeServerSessionCommand()
	if !exists || err == nil {
		t.Fatalf("got (exists=%v, err=%v), want (true, non-nil) — existing but uninspectable is uncertain evidence", exists, err)
	}
}
