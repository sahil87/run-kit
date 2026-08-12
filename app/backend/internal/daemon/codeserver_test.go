package daemon

import (
	"context"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"rk/internal/testutil"
)

// withCodeServerSeams substitutes the session-exists, spawn, and home-dir
// seams for one test, returning a recorder for the spawn argv and the temp
// home the profile paths resolve under. Stubbing home here — for every test,
// not only the profile-focused ones — guarantees no test can ever write to
// the real ~/.rk. Restores via t.Cleanup.
func withCodeServerSeams(t *testing.T, sessionExists bool) (spawned *[][]string, home string) {
	t.Helper()
	spawned = &[][]string{}
	home = t.TempDir()

	origExists, origSpawn, origHome := codeServerSessionExists, codeServerSpawn, codeServerUserHomeDir
	t.Cleanup(func() {
		codeServerSessionExists, codeServerSpawn, codeServerUserHomeDir = origExists, origSpawn, origHome
	})

	codeServerSessionExists = func(context.Context) bool { return sessionExists }
	codeServerSpawn = func(_ context.Context, args ...string) error {
		*spawned = append(*spawned, args)
		return nil
	}
	codeServerUserHomeDir = func() (string, error) { return home, nil }
	return spawned, home
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
	return filepath.Join(home, ".rk", "code-server", "User", "settings.json")
}

func TestEnsureCodeServerSpawnsSiblingSession(t *testing.T) {
	testutil.StubOnPath(t, "code-server", "#!/bin/sh\nexit 0\n")
	port := freeLoopbackPort(t)
	t.Setenv("RK_CODE_SERVER_PORT", fmt.Sprint(port))
	t.Setenv("XDG_DATA_HOME", "") // force the ~/.local/share fallback
	spawned, home := withCodeServerSeams(t, false)

	ensureCodeServer()

	if len(*spawned) != 1 {
		t.Fatalf("spawn calls = %d, want 1", len(*spawned))
	}
	got := strings.Join((*spawned)[0], " ")
	want := fmt.Sprintf(
		"new-session -d -s rk-code-server -n code-server env -u VSCODE_IPC_HOOK_CLI code-server --bind-addr 127.0.0.1:%d --auth none --disable-telemetry --disable-update-check --disable-workspace-trust --disable-getting-started-override --app-name run-kit --user-data-dir %s --extensions-dir %s",
		port,
		filepath.Join(home, ".rk", "code-server"),
		filepath.Join(home, ".local", "share", "code-server", "extensions"),
	)
	if got != want {
		t.Errorf("spawn argv =\n%s\nwant:\n%s", got, want)
	}
}

func TestEnsureCodeServerSeedsSettingsWhenAbsent(t *testing.T) {
	testutil.StubOnPath(t, "code-server", "#!/bin/sh\nexit 0\n")
	t.Setenv("RK_CODE_SERVER_PORT", fmt.Sprint(freeLoopbackPort(t)))
	spawned, home := withCodeServerSeams(t, false)

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
	spawned, home := withCodeServerSeams(t, false)

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
	spawned, _ := withCodeServerSeams(t, false)

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
	spawned, home := withCodeServerSeams(t, false)

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
	if !strings.Contains(got, "--user-data-dir "+filepath.Join(home, ".rk", "code-server")) {
		t.Errorf("spawn argv = %q, want --user-data-dir despite the failed seed", got)
	}
	if !strings.Contains(got, "--extensions-dir "+filepath.Join(home, ".local", "share", "code-server", "extensions")) {
		t.Errorf("spawn argv = %q, want --extensions-dir despite the failed seed", got)
	}
}

func TestEnsureCodeServerHomeFailureDropsProfileFlags(t *testing.T) {
	testutil.StubOnPath(t, "code-server", "#!/bin/sh\nexit 0\n")
	t.Setenv("RK_CODE_SERVER_PORT", fmt.Sprint(freeLoopbackPort(t)))
	spawned, _ := withCodeServerSeams(t, false)
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
	spawned, _ := withCodeServerSeams(t, true)

	ensureCodeServer()

	if len(*spawned) != 0 {
		t.Errorf("spawn calls = %d, want 0 (session already managed)", len(*spawned))
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
	spawned, home := withCodeServerSeams(t, false)

	ensureCodeServer()

	if len(*spawned) != 0 {
		t.Errorf("spawn calls = %d, want 0 (port already serving)", len(*spawned))
	}
	// The externally managed instance gets no seed either — the seed runs on
	// the spawn branch only.
	if _, err := os.Stat(seededSettingsPath(home)); err == nil {
		t.Error("settings.json seeded for an externally managed instance, want no write")
	}
}

func TestEnsureCodeServerWarnsAndContinuesWhenBinaryMissing(t *testing.T) {
	// PATH replacement (not StubOnPath): code-server must NOT resolve.
	dir := t.TempDir()
	t.Setenv("PATH", dir)
	t.Setenv("RK_CODE_SERVER_PORT", fmt.Sprint(freeLoopbackPort(t)))
	spawned, _ := withCodeServerSeams(t, false)

	// Must not panic or error-propagate — the caller (startSession) still
	// brings up rk serve.
	ensureCodeServer()

	if len(*spawned) != 0 {
		t.Errorf("spawn calls = %d, want 0 (binary absent)", len(*spawned))
	}
}

func TestEnsureCodeServerConventionPort(t *testing.T) {
	testutil.StubOnPath(t, "code-server", "#!/bin/sh\nexit 0\n")
	// Convention resolution: no preset, RK_PORT+2 must be free — pick a free
	// port P and set RK_PORT=P-2.
	port := freeLoopbackPort(t)
	t.Setenv("RK_PORT", fmt.Sprint(port-2))
	t.Setenv("RK_CODE_SERVER_PORT", "")
	spawned, _ := withCodeServerSeams(t, false)

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
	_, _ = withCodeServerSeams(t, false)
	codeServerSpawn = func(context.Context, ...string) error { return fmt.Errorf("tmux exploded") }

	ensureCodeServer() // must not panic; the error is logged and swallowed
}
