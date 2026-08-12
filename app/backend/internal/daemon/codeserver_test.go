package daemon

import (
	"context"
	"fmt"
	"net"
	"strings"
	"testing"

	"rk/internal/testutil"
)

// withCodeServerSeams substitutes the session-exists and spawn seams for one
// test and returns a recorder for the spawn argv. Restores via t.Cleanup.
func withCodeServerSeams(t *testing.T, sessionExists bool) (spawned *[][]string) {
	t.Helper()
	spawned = &[][]string{}

	origExists, origSpawn := codeServerSessionExists, codeServerSpawn
	t.Cleanup(func() { codeServerSessionExists, codeServerSpawn = origExists, origSpawn })

	codeServerSessionExists = func(context.Context) bool { return sessionExists }
	codeServerSpawn = func(_ context.Context, args ...string) error {
		*spawned = append(*spawned, args)
		return nil
	}
	return spawned
}

func TestEnsureCodeServerSpawnsSiblingSession(t *testing.T) {
	testutil.StubOnPath(t, "code-server", "#!/bin/sh\nexit 0\n")
	ln, err := net.Listen("tcp", "127.0.0.1:0") // free port source only
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()

	t.Setenv("RK_CODE_SERVER_PORT", fmt.Sprint(port))
	spawned := withCodeServerSeams(t, false)

	ensureCodeServer()

	if len(*spawned) != 1 {
		t.Fatalf("spawn calls = %d, want 1", len(*spawned))
	}
	got := strings.Join((*spawned)[0], " ")
	want := fmt.Sprintf("new-session -d -s rk-code-server -n code-server env -u VSCODE_IPC_HOOK_CLI code-server --bind-addr 127.0.0.1:%d --auth none --disable-telemetry --disable-update-check --disable-workspace-trust --disable-getting-started-override --app-name run-kit", port)
	if got != want {
		t.Errorf("spawn argv =\n%s\nwant:\n%s", got, want)
	}
}

func TestEnsureCodeServerSkipsWhenSessionExists(t *testing.T) {
	spawned := withCodeServerSeams(t, true)

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
	spawned := withCodeServerSeams(t, false)

	ensureCodeServer()

	if len(*spawned) != 0 {
		t.Errorf("spawn calls = %d, want 0 (port already serving)", len(*spawned))
	}
}

func TestEnsureCodeServerWarnsAndContinuesWhenBinaryMissing(t *testing.T) {
	// PATH replacement (not StubOnPath): code-server must NOT resolve.
	dir := t.TempDir()
	t.Setenv("PATH", dir)
	// A free port so the port-listening branch doesn't preempt the LookPath one.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	t.Setenv("RK_CODE_SERVER_PORT", fmt.Sprint(port))
	spawned := withCodeServerSeams(t, false)

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
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	t.Setenv("RK_PORT", fmt.Sprint(port-2))
	t.Setenv("RK_CODE_SERVER_PORT", "")
	spawned := withCodeServerSeams(t, false)

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
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	t.Setenv("RK_CODE_SERVER_PORT", fmt.Sprint(port))

	origExists, origSpawn := codeServerSessionExists, codeServerSpawn
	t.Cleanup(func() { codeServerSessionExists, codeServerSpawn = origExists, origSpawn })
	codeServerSessionExists = func(context.Context) bool { return false }
	codeServerSpawn = func(context.Context, ...string) error { return fmt.Errorf("tmux exploded") }

	ensureCodeServer() // must not panic; the error is logged and swallowed
}
