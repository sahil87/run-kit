package remote

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// sshScript answers ssh invocations by remote-command string; every other
// binary is unexpected. It records the remote commands run, in order.
type sshScript struct {
	responses map[string]execResult
	ran       []string
}

func stubSSH(t *testing.T, s *sshScript) {
	t.Helper()
	orig := runCmdFn
	runCmdFn = func(_ context.Context, name string, args ...string) execResult {
		if name != "ssh" {
			t.Fatalf("unexpected subprocess %q %v", name, args)
		}
		remoteCmd := args[len(args)-1]
		s.ran = append(s.ran, remoteCmd)
		if res, ok := s.responses[remoteCmd]; ok {
			return res
		}
		t.Fatalf("unscripted remote command %q", remoteCmd)
		return execResult{}
	}
	t.Cleanup(func() { runCmdFn = orig })
}

// writeStore persists a single-remote store into a temp dir, returning the path.
func writeStore(t *testing.T, remotes ...Remote) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "remotes.yaml")
	if err := Save(path, File{Version: 1, Remotes: remotes}); err != nil {
		t.Fatal(err)
	}
	return path
}

var testRemote = Remote{Name: "buildbox", Target: "sahil@buildbox", LocalPort: 3100}

func okVersion(v string) execResult {
	return execResult{stdout: "run-kit version v" + v + "\n"}
}

func TestConnect_UnknownRemoteErrors(t *testing.T) {
	path := writeStore(t)
	_, err := Connect(context.Background(), path, "nope", "3.0.0", nil)
	if err == nil || !strings.Contains(err.Error(), "rk remote add") {
		t.Errorf("error = %v, want add hint", err)
	}
}

func TestConnect_HappyPathIdempotent(t *testing.T) {
	// Tunnel already up, versions equal: probe → daemon start → url; no
	// install, no new tunnel window.
	path := writeStore(t, testRemote)
	ssh := &sshScript{responses: map[string]execResult{
		remoteVersionCmd:     okVersion("3.2.0"),
		remoteDaemonStartCmd: {stderr: "Error: daemon already running", exitCode: 1, err: errors.New("exit status 1")},
		remoteURLCmd:         {stdout: "http://127.0.0.1:3000\n"},
	}}
	stubSSH(t, ssh)
	stubTmux(t, &tmuxScript{listOut: "buildbox\tssh\n"})
	stubDial(t, func(string) bool { return true })

	var progress []string
	res, err := Connect(context.Background(), path, "buildbox", "3.2.0", func(f string, a ...any) {
		progress = append(progress, fmt.Sprintf(f, a...))
	})
	if err != nil {
		t.Fatalf("Connect error = %v", err)
	}
	if res.Origin != "http://127.0.0.1:3100" {
		t.Errorf("Origin = %q", res.Origin)
	}
	if res.Installed || res.Updated {
		t.Errorf("no install/update expected, got %+v", res)
	}
	for _, cmd := range ssh.ran {
		if cmd == remoteInstallCmd {
			t.Error("installer must not run on a current remote")
		}
	}
	joined := strings.Join(progress, " | ")
	if !strings.Contains(joined, "connecting to buildbox") || !strings.Contains(joined, "tunnel already up") {
		t.Errorf("progress = %q", joined)
	}
}

func TestConnect_BootstrapsWhenMissing(t *testing.T) {
	path := writeStore(t, testRemote)
	missing := execResult{exitCode: 127, stderr: "sh: rk: command not found", err: errors.New("exit status 127")}
	ssh := &sshScript{responses: map[string]execResult{
		remoteInstallCmd:     {stdout: "installed"},
		remoteDaemonStartCmd: {},
		remoteURLCmd:         {stdout: "http://127.0.0.1:3000\n"},
	}}
	// First version probe: missing; post-install probe: present.
	probes := 0
	ssh.responses[remoteVersionCmd] = missing
	orig := runCmdFn
	stubSSH(t, ssh)
	inner := runCmdFn
	runCmdFn = func(ctx context.Context, name string, args ...string) execResult {
		if args[len(args)-1] == remoteVersionCmd {
			probes++
			if probes > 1 {
				ssh.responses[remoteVersionCmd] = okVersion("3.2.0")
			}
		}
		return inner(ctx, name, args...)
	}
	t.Cleanup(func() { runCmdFn = orig })
	stubTmux(t, &tmuxScript{listOut: "buildbox\tssh\n"})
	stubDial(t, func(string) bool { return true })

	res, err := Connect(context.Background(), path, "buildbox", "3.2.0", nil)
	if err != nil {
		t.Fatalf("Connect error = %v", err)
	}
	if !res.Installed {
		t.Error("Installed = false, want bootstrap")
	}
	if res.RemoteVersion != "3.2.0" {
		t.Errorf("RemoteVersion = %q", res.RemoteVersion)
	}
}

func TestConnect_UpdatesOlderNeverNewer(t *testing.T) {
	path := writeStore(t, testRemote)

	run := func(remoteV, localV string) (ConnectResult, []string, error) {
		ssh := &sshScript{responses: map[string]execResult{
			remoteVersionCmd:     okVersion(remoteV),
			remoteInstallCmd:     {stdout: "updated"},
			remoteDaemonStartCmd: {},
			remoteURLCmd:         {stdout: "http://127.0.0.1:3000\n"},
		}}
		stubSSH(t, ssh)
		stubTmux(t, &tmuxScript{listOut: "buildbox\tssh\n"})
		stubDial(t, func(string) bool { return true })
		res, err := Connect(context.Background(), path, "buildbox", localV, nil)
		return res, ssh.ran, err
	}

	// Older remote → installer re-runs.
	res, ran, err := run("3.1.0", "3.2.0")
	if err != nil {
		t.Fatalf("older: error = %v", err)
	}
	if !res.Updated {
		t.Error("older: Updated = false, want auto-update")
	}
	// Newer remote → untouched.
	res, ran, err = run("3.3.0", "3.2.0")
	if err != nil {
		t.Fatalf("newer: error = %v", err)
	}
	if res.Updated {
		t.Error("newer: connect must never downgrade")
	}
	for _, cmd := range ran {
		if cmd == remoteInstallCmd {
			t.Error("newer: installer must not run")
		}
	}
	// Local dev build → skew skipped.
	res, ran, err = run("3.1.0", "dev")
	if err != nil {
		t.Fatalf("dev: error = %v", err)
	}
	if res.Updated {
		t.Error("dev: local dev build cannot anchor an update")
	}
}

func TestConnect_AuthFailureSurfacesTailAndHint(t *testing.T) {
	path := writeStore(t, testRemote)
	ssh := &sshScript{responses: map[string]execResult{
		remoteVersionCmd: {exitCode: 255, stderr: "Permission denied (publickey).", err: errors.New("exit status 255")},
	}}
	stubSSH(t, ssh)

	_, err := Connect(context.Background(), path, "buildbox", "3.2.0", nil)
	if err == nil {
		t.Fatal("want auth failure")
	}
	msg := err.Error()
	if !strings.Contains(msg, "Permission denied") || !strings.Contains(msg, "ssh sahil@buildbox") {
		t.Errorf("error = %q, want stderr tail + interactive-ssh hint", msg)
	}
}

func TestConnect_AuthFailureOnLaterStepsKeepsTheHint(t *testing.T) {
	// Every ssh step must classify exit 255 as unreachable, not as a
	// step-specific failure: a tunnel that drops mid-connect surfaces the
	// actionable BatchMode hint wherever it lands, not a generic message.
	cases := []struct {
		name string
		ssh  *sshScript
	}{
		{
			"auto-update step",
			&sshScript{responses: map[string]execResult{
				remoteVersionCmd: okVersion("3.1.0"), // older than local → update runs
				remoteInstallCmd: {exitCode: 255, stderr: "Permission denied (publickey).", err: errors.New("exit status 255")},
			}},
		},
		{
			"rk url step",
			&sshScript{responses: map[string]execResult{
				remoteVersionCmd:     okVersion("3.2.0"),
				remoteDaemonStartCmd: {},
				remoteURLCmd:         {exitCode: 255, stderr: "Connection closed by remote host.", err: errors.New("exit status 255")},
			}},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := writeStore(t, testRemote)
			stubSSH(t, tc.ssh)

			_, err := Connect(context.Background(), path, "buildbox", "3.2.0", nil)
			if err == nil {
				t.Fatal("want auth failure")
			}
			if msg := err.Error(); !strings.Contains(msg, "ssh sahil@buildbox") {
				t.Errorf("error = %q, want the interactive-ssh hint", msg)
			}
		})
	}
}

func TestConnect_ForeignSquatterErrorsWithoutReassign(t *testing.T) {
	path := writeStore(t, testRemote)
	ssh := &sshScript{responses: map[string]execResult{
		remoteVersionCmd:     okVersion("3.2.0"),
		remoteDaemonStartCmd: {},
		remoteURLCmd:         {stdout: "http://127.0.0.1:3000\n"},
	}}
	stubSSH(t, ssh)
	// Tunnel window down, but the port accepts → foreign squatter.
	s := &tmuxScript{listOut: ""}
	stubTmux(t, s)
	stubDial(t, func(string) bool { return true })

	_, err := Connect(context.Background(), path, "buildbox", "3.2.0", nil)
	if err == nil || !strings.Contains(err.Error(), "port 3100 is in use by another process") {
		t.Fatalf("error = %v, want squatter message", err)
	}
	// No tunnel window was opened, and the store still holds 3100.
	for _, c := range s.calls {
		if c[0] == "new-session" || c[0] == "new-window" {
			t.Errorf("no tunnel creation expected on squatter: %v", c)
		}
	}
	f, _ := Load(path)
	if got := f.FindByName("buildbox").LocalPort; got != 3100 {
		t.Errorf("LocalPort = %d, want immutable 3100", got)
	}
}

// stubNoSubprocess fails the test if ANY subprocess or tmux seam is touched —
// the assertion that a hostile stored entry is rejected before argv exists.
func stubNoSubprocess(t *testing.T) {
	t.Helper()
	origRun, origTmuxRun, origTmuxOut := runCmdFn, tmuxRunFn, tmuxOutputFn
	runCmdFn = func(_ context.Context, name string, args ...string) execResult {
		t.Errorf("subprocess %q %v ran — hostile entry must be rejected first", name, args)
		return execResult{}
	}
	tmuxRunFn = func(_ context.Context, _ string, args ...string) error {
		t.Errorf("tmux run %v ran — hostile entry must be rejected first", args)
		return nil
	}
	tmuxOutputFn = func(_ context.Context, args ...string) ([]byte, error) {
		t.Errorf("tmux output %v ran — hostile entry must be rejected first", args)
		return nil, nil
	}
	t.Cleanup(func() { runCmdFn, tmuxRunFn, tmuxOutputFn = origRun, origTmuxRun, origTmuxOut })
}

func TestHostileStoredTargetRejectedBeforeAnySubprocess(t *testing.T) {
	// Regression for the read-path validation gap: a remotes.yaml hand-edited
	// to carry `-oProxyCommand=…` as the target must be rejected by Load
	// before Connect/Disconnect/RemoveRemote can hand it to ssh/tmux argv
	// (`ssh -oProxyCommand=touch /tmp/pwned` would execute the command).
	path := filepath.Join(t.TempDir(), "remotes.yaml")
	hostile := "version: 1\nremotes:\n  - name: buildbox\n    target: \"-oProxyCommand=touch /tmp/pwned\"\n    local_port: 3100\n"
	if err := os.WriteFile(path, []byte(hostile), 0o644); err != nil {
		t.Fatal(err)
	}
	stubNoSubprocess(t)

	if _, err := Connect(context.Background(), path, "buildbox", "3.2.0", nil); err == nil ||
		!strings.Contains(err.Error(), "invalid target") {
		t.Errorf("Connect error = %v, want invalid-target rejection", err)
	}
	if _, err := Disconnect(context.Background(), path, "buildbox"); err == nil {
		t.Error("Disconnect must reject a hostile stored entry")
	}
	if _, err := RemoveRemote(context.Background(), path, "buildbox"); err == nil {
		t.Error("RemoveRemote must reject a hostile stored entry")
	}
}

func TestDisconnectAndRemove(t *testing.T) {
	path := writeStore(t, testRemote)

	// Disconnect: window up → killed; entry stays.
	s := &tmuxScript{listOut: "buildbox\tssh\n"}
	stubTmux(t, s)
	if _, err := Disconnect(context.Background(), path, "buildbox"); err != nil {
		t.Fatalf("Disconnect error = %v", err)
	}
	f, _ := Load(path)
	if f.FindByName("buildbox") == nil {
		t.Error("disconnect must keep the entry")
	}

	// Remove: entry dropped.
	stubTmux(t, &tmuxScript{listOut: ""})
	if _, err := RemoveRemote(context.Background(), path, "buildbox"); err != nil {
		t.Fatalf("RemoveRemote error = %v", err)
	}
	f, _ = Load(path)
	if f.FindByName("buildbox") != nil {
		t.Error("remove must drop the entry")
	}

	// Unknown names error.
	if _, err := Disconnect(context.Background(), path, "nope"); err == nil {
		t.Error("Disconnect(unknown) should error")
	}
	if _, err := RemoveRemote(context.Background(), path, "nope"); err == nil {
		t.Error("RemoveRemote(unknown) should error")
	}
}

func TestInspect_Classifications(t *testing.T) {
	tunnels := map[string]bool{"buildbox": true}

	cases := []struct {
		name      string
		responses map[string]execResult
		want      string
		wantVer   string
	}{
		{
			"running",
			map[string]execResult{
				remoteVersionCmd:    okVersion("3.2.0"),
				remoteDaemonJSONCmd: {stdout: `{"daemon":{"running":true},"port":{"state":"held-by-daemon"}}`},
			},
			DaemonRunning, "3.2.0",
		},
		{
			"stopped",
			map[string]execResult{
				remoteVersionCmd:    okVersion("3.2.0"),
				remoteDaemonJSONCmd: {stdout: `{"daemon":{"running":false}}`},
			},
			DaemonStopped, "3.2.0",
		},
		{
			"no rk",
			map[string]execResult{
				remoteVersionCmd: {exitCode: 127, stderr: "not found", err: errors.New("exit 127")},
			},
			DaemonNoRK, "",
		},
		{
			"unreachable",
			map[string]execResult{
				remoteVersionCmd: {exitCode: 255, stderr: "timeout", err: errors.New("exit 255")},
			},
			DaemonUnreachable, "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stubSSH(t, &sshScript{responses: tc.responses})
			st := Inspect(context.Background(), testRemote, tunnels)
			if st.Daemon != tc.want {
				t.Errorf("Daemon = %q, want %q", st.Daemon, tc.want)
			}
			if st.RemoteVersion != tc.wantVer {
				t.Errorf("RemoteVersion = %q, want %q", st.RemoteVersion, tc.wantVer)
			}
			if !st.TunnelUp {
				t.Error("TunnelUp should come from the tunnels map")
			}
		})
	}
}
