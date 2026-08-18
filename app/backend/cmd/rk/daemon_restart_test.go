package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"rk/internal/remote"
)

// restartSeams stubs every daemon/remote seam the restart flow reaches and
// records the call order, so tests can assert sequencing without a tmux
// server or ssh. Individual fields can be overridden after the call.
type restartSeams struct {
	calls   []string
	connect []string // remote names passed to remoteConnectFn, in order
}

func stubRestartSeams(t *testing.T, running bool, connectErr error) *restartSeams {
	t.Helper()
	s := &restartSeams{}

	origRunning, origStop, origStart, origKill := daemonIsRunningFn, daemonStopFn, daemonStartFn, daemonKillServerFn
	origTunnels, origConnect, origTMUX := listTunnelsFn, remoteConnectFn, restartOriginalTMUXFn
	t.Cleanup(func() {
		daemonIsRunningFn, daemonStopFn, daemonStartFn, daemonKillServerFn = origRunning, origStop, origStart, origKill
		listTunnelsFn, remoteConnectFn, restartOriginalTMUXFn = origTunnels, origConnect, origTMUX
	})

	daemonIsRunningFn = func() bool { s.calls = append(s.calls, "isRunning"); return running }
	daemonStopFn = func() error { s.calls = append(s.calls, "stop"); return nil }
	daemonStartFn = func() error { s.calls = append(s.calls, "start"); return nil }
	daemonKillServerFn = func() error { s.calls = append(s.calls, "killServer"); return nil }
	listTunnelsFn = func(ctx context.Context) map[string]bool {
		s.calls = append(s.calls, "listTunnels")
		return map[string]bool{"alpha": true, "beta": false}
	}
	remoteConnectFn = func(ctx context.Context, path, name, version string, progress remote.Progress) (remote.ConnectResult, error) {
		s.calls = append(s.calls, "connect:"+name)
		s.connect = append(s.connect, name)
		if connectErr != nil {
			return remote.ConnectResult{}, connectErr
		}
		return remote.ConnectResult{Origin: "http://127.0.0.1:3100"}, nil
	}
	restartOriginalTMUXFn = func() string { return "" } // outside tmux by default
	return s
}

// withRemotesStore points remotesPathFn at a temp remotes.yaml holding the
// given body ("" ⇒ a path whose file does not exist, remote.Load's empty case).
func withRemotesStore(t *testing.T, body string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "remotes.yaml")
	if body != "" {
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatalf("writing temp remotes.yaml: %v", err)
		}
	}
	orig := remotesPathFn
	remotesPathFn = func() (string, error) { return path, nil }
	t.Cleanup(func() { remotesPathFn = orig })
}

const twoRemotesYAML = `version: 1
remotes:
  - name: alpha
    target: user@alpha
    local_port: 3100
  - name: beta
    target: user@beta
    local_port: 3101
`

// execDaemonRestart runs `daemon restart [flags...]` through the root command
// and returns the combined output and error. Bool flag values persist across
// Execute calls on the shared command tree, so both are reset on cleanup.
func execDaemonRestart(t *testing.T, flags ...string) (string, error) {
	t.Helper()
	buf := new(bytes.Buffer)
	rootCmd.SetOut(buf)
	rootCmd.SetErr(buf)
	rootCmd.SetArgs(append([]string{"daemon", "restart"}, flags...))
	t.Cleanup(func() {
		rootCmd.SetArgs(nil)
		_ = daemonRestartCmd.Flags().Set("full", "false")
		_ = daemonRestartCmd.Flags().Set("force", "false")
	})
	err := rootCmd.Execute()
	return buf.String(), err
}

func TestInsideDaemonServer(t *testing.T) {
	cases := []struct {
		tmuxEnv string
		want    bool
	}{
		{"", false},
		{"/tmp/tmux-1001/default,12345,0", false},
		{"/tmp/tmux-1001/rk-daemon,12345,0", true},
		{"/private/tmp/tmux-501/rk-daemon,9,2", true},
		{"/tmp/tmux-1001/rk-daemon-other,1,0", false},
	}
	for _, c := range cases {
		if got := insideDaemonServer(c.tmuxEnv); got != c.want {
			t.Errorf("insideDaemonServer(%q) = %v, want %v", c.tmuxEnv, got, c.want)
		}
	}
}

func TestDaemonRestart_FullRefusesInsideDaemonServer(t *testing.T) {
	s := stubRestartSeams(t, true, nil)
	restartOriginalTMUXFn = func() string { return "/tmp/tmux-1001/rk-daemon,4242,0" }
	withRemotesStore(t, "")

	_, err := execDaemonRestart(t, "--full")
	if err == nil {
		t.Fatal("expected refusal error, got nil")
	}
	if !strings.Contains(err.Error(), "refusing --full") {
		t.Errorf("error = %q; want it to contain 'refusing --full'", err)
	}
	if len(s.calls) != 0 {
		t.Errorf("guard must fire before any action; calls = %v", s.calls)
	}
}

func TestDaemonRestart_FullSequence(t *testing.T) {
	s := stubRestartSeams(t, true, nil)
	withRemotesStore(t, twoRemotesYAML)

	out, err := execDaemonRestart(t, "--full")
	if err != nil {
		t.Fatalf("Execute: %v (output: %s)", err, out)
	}

	want := []string{"listTunnels", "isRunning", "stop", "killServer", "start", "connect:alpha"}
	if strings.Join(s.calls, ",") != strings.Join(want, ",") {
		t.Errorf("call order = %v, want %v", s.calls, want)
	}
	if len(s.connect) != 1 || s.connect[0] != "alpha" {
		t.Errorf("reconnected %v, want only previously-up [alpha]", s.connect)
	}
	if !strings.Contains(out, "Reconnected remote alpha (http://127.0.0.1:3100)") {
		t.Errorf("output missing reconnect confirmation: %s", out)
	}
}

func TestDaemonRestart_FullReconnectFailureWarnsNotFails(t *testing.T) {
	stubRestartSeams(t, false, context.DeadlineExceeded)
	withRemotesStore(t, twoRemotesYAML)

	out, err := execDaemonRestart(t, "--full")
	if err != nil {
		t.Fatalf("reconnect failure must not fail the command; got %v", err)
	}
	if !strings.Contains(out, "warning: reconnecting remote alpha failed") {
		t.Errorf("output missing reconnect warning: %s", out)
	}
	if !strings.Contains(out, "rk remote connect alpha") {
		t.Errorf("warning must carry the recovery command: %s", out)
	}
}

func TestDaemonRestart_FullNoRemotesIsSilentNoOp(t *testing.T) {
	s := stubRestartSeams(t, false, nil)
	withRemotesStore(t, "") // missing file ⇒ remote.Load's empty v1 case

	out, err := execDaemonRestart(t, "--full")
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	for _, call := range s.calls {
		if strings.HasPrefix(call, "connect:") {
			t.Errorf("no remotes registered but connect ran: %v", s.calls)
		}
	}
	if strings.Contains(out, "Reconnecting") || strings.Contains(out, "warning:") {
		t.Errorf("empty store must be silent, got: %s", out)
	}
}

func TestDaemonRestart_PlainNeverTouchesServerOrRemotes(t *testing.T) {
	s := stubRestartSeams(t, true, nil)
	withRemotesStore(t, twoRemotesYAML)

	_, err := execDaemonRestart(t)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	for _, call := range s.calls {
		if call == "killServer" || call == "listTunnels" || strings.HasPrefix(call, "connect:") {
			t.Errorf("plain restart reached --full-only seam %q; calls = %v", call, s.calls)
		}
	}
	want := []string{"isRunning", "stop", "start"}
	if strings.Join(s.calls, ",") != strings.Join(want, ",") {
		t.Errorf("call order = %v, want %v", s.calls, want)
	}
}

func TestDaemonRestart_FullForceCombination(t *testing.T) {
	s := stubRestartSeams(t, true, nil)
	withRemotesStore(t, twoRemotesYAML)
	pinFreePort(t)
	withPortOwnerStub(t, func(ctx context.Context, host string, port int) (*PortOwner, error) {
		s.calls = append(s.calls, "portOwner")
		return nil, nil // port free — force step probes and moves on
	})

	_, err := execDaemonRestart(t, "--full", "--force")
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	want := []string{"listTunnels", "isRunning", "stop", "killServer", "portOwner", "start", "connect:alpha"}
	if strings.Join(s.calls, ",") != strings.Join(want, ",") {
		t.Errorf("call order = %v, want %v (force probe between kill and start)", s.calls, want)
	}
}

func TestDaemonRestart_FullMalformedStoreWarnsAndSkipsReconnect(t *testing.T) {
	s := stubRestartSeams(t, false, nil)
	withRemotesStore(t, "version: 99\nnot yaml: [\n")

	out, err := execDaemonRestart(t, "--full")
	if err != nil {
		t.Fatalf("store-load error must degrade to a warning, got: %v", err)
	}
	if !strings.Contains(out, "warning: skipping remote-tunnel reconnect") {
		t.Errorf("output missing store-load warning: %s", out)
	}
	for _, call := range s.calls {
		if call == "listTunnels" || strings.HasPrefix(call, "connect:") {
			t.Errorf("malformed store must skip derivation and reconnect; calls = %v", s.calls)
		}
	}
}
