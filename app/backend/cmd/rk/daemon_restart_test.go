package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"rk/internal/daemon"
	"rk/internal/remote"
)

// restartCLISeams stubs the restart wrapper's seams — the single
// daemon.Restart call plus the tunnel capture/reconnect pair — and records the
// call order, so tests assert what stays CLI-owned (flags → options mapping,
// tunnel capture before the restart, reconnect after) without a tmux server or
// ssh. Sequencing internals are tested in internal/daemon.
type restartCLISeams struct {
	calls   []string
	connect []string // remote names passed to remoteConnectFn, in order
	opts    daemon.RestartOptions
}

func stubRestartCLISeams(t *testing.T, connectErr error) *restartCLISeams {
	t.Helper()
	s := &restartCLISeams{}

	origRestart, origTunnels, origConnect := daemonRestartFn, listTunnelsFn, remoteConnectFn
	t.Cleanup(func() {
		daemonRestartFn, listTunnelsFn, remoteConnectFn = origRestart, origTunnels, origConnect
	})

	daemonRestartFn = func(opts daemon.RestartOptions) error {
		s.calls = append(s.calls, "restart")
		s.opts = opts
		return nil
	}
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

func TestDaemonRestart_FlagsBecomeRestartOptions(t *testing.T) {
	s := stubRestartCLISeams(t, nil)
	withRemotesStore(t, twoRemotesYAML)

	if _, err := execDaemonRestart(t, "--full", "--force"); err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if !s.opts.Full || !s.opts.Force {
		t.Errorf("opts = %+v, want {Full:true, Force:true}", s.opts)
	}
}

func TestDaemonRestart_FullCapturesTunnelsBeforeRestartThenReconnects(t *testing.T) {
	s := stubRestartCLISeams(t, nil)
	withRemotesStore(t, twoRemotesYAML)

	out, err := execDaemonRestart(t, "--full")
	if err != nil {
		t.Fatalf("Execute: %v (output: %s)", err, out)
	}

	want := []string{"listTunnels", "restart", "connect:alpha"}
	if strings.Join(s.calls, ",") != strings.Join(want, ",") {
		t.Errorf("call order = %v, want %v (capture before restart, reconnect after)", s.calls, want)
	}
	if len(s.connect) != 1 || s.connect[0] != "alpha" {
		t.Errorf("reconnected %v, want only previously-up [alpha]", s.connect)
	}
	if !strings.Contains(out, "Reconnected remote alpha (http://127.0.0.1:3100)") {
		t.Errorf("output missing reconnect confirmation: %s", out)
	}
}

func TestDaemonRestart_FullReconnectFailureWarnsNotFails(t *testing.T) {
	stubRestartCLISeams(t, context.DeadlineExceeded)
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
	s := stubRestartCLISeams(t, nil)
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

func TestDaemonRestart_PlainNeverTouchesTunnels(t *testing.T) {
	s := stubRestartCLISeams(t, nil)
	withRemotesStore(t, twoRemotesYAML)

	_, err := execDaemonRestart(t)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if s.opts.Full || s.opts.Force {
		t.Errorf("opts = %+v, want the zero value", s.opts)
	}
	for _, call := range s.calls {
		if call == "listTunnels" || strings.HasPrefix(call, "connect:") {
			t.Errorf("plain restart reached --full-only seam %q; calls = %v", call, s.calls)
		}
	}
	want := []string{"restart"}
	if strings.Join(s.calls, ",") != strings.Join(want, ",") {
		t.Errorf("call order = %v, want %v", s.calls, want)
	}
}

func TestDaemonRestart_FullMalformedStoreWarnsAndSkipsReconnect(t *testing.T) {
	s := stubRestartCLISeams(t, nil)
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
	// The restart itself still ran — remote bookkeeping must not gate it.
	if len(s.calls) != 1 || s.calls[0] != "restart" {
		t.Errorf("calls = %v, want [restart]", s.calls)
	}
}

// A restart failure (e.g. the --full inside-server refusal) propagates and
// skips the reconnect.
func TestDaemonRestart_RestartErrorPropagates(t *testing.T) {
	s := stubRestartCLISeams(t, nil)
	withRemotesStore(t, twoRemotesYAML)
	daemonRestartFn = func(opts daemon.RestartOptions) error {
		s.calls = append(s.calls, "restart")
		s.opts = opts
		return os.ErrPermission
	}

	_, err := execDaemonRestart(t, "--full")
	if err == nil {
		t.Fatal("expected the restart error to propagate, got nil")
	}
	for _, call := range s.calls {
		if strings.HasPrefix(call, "connect:") {
			t.Errorf("reconnect ran despite the failed restart; calls = %v", s.calls)
		}
	}
}
