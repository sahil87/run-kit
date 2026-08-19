package remote

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"rk/internal/tmux"
)

// sshScript answers ssh invocations by remote-command string; every other
// binary is unexpected. It records the remote commands run, in order.
type sshScript struct {
	responses map[string]execResult
	ran       []string
}

// stubSSH answers ssh invocations by remote-command string; every other
// binary is unexpected. It records the remote commands run, in order. It also
// stubs the local-tmux version probe to unknown (pass-through) so Connect
// tests stay hermetic regardless of the host's tmux.
func stubSSH(t *testing.T, s *sshScript) {
	t.Helper()
	stubTmuxVersionProbe(t, tmux.Version{}, false)
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

// stubTmuxVersionProbe swaps tmuxVersionFn for a stub returning the given
// version/known pair (unknown — the pass-through case — when known is false),
// restoring at cleanup.
func stubTmuxVersionProbe(t *testing.T, v tmux.Version, known bool) {
	t.Helper()
	orig := tmuxVersionFn
	t.Cleanup(func() { tmuxVersionFn = orig })
	tmuxVersionFn = func(context.Context) (tmux.Version, bool) { return v, known }
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
	stubTmuxVersionProbe(t, tmux.Version{}, false)
	path := writeStore(t)
	_, err := Connect(context.Background(), path, "nope", "3.0.0", nil)
	if err == nil || !strings.Contains(err.Error(), "rk remote add") {
		t.Errorf("error = %v, want add hint", err)
	}
}

func TestConnect_BelowFloorRefusesBeforeAnySubprocess(t *testing.T) {
	// The tunnels gate is the one hard floor enforcement: below tmux 3.4 the
	// tunnel's ssh argv would be shell-joined (Constitution §I), so Connect
	// refuses at entry — before the ssh probe, the store read's tmux work,
	// or any tunnel creation.
	stubNoSubprocess(t)
	stubTmuxVersionProbe(t, tmux.Version{Major: 3, Minor: 2, Raw: "3.2a"}, true)
	path := writeStore(t, testRemote)

	_, err := Connect(context.Background(), path, "buildbox", "3.2.0", nil)
	if err == nil {
		t.Fatal("below-floor local tmux must refuse Connect")
	}
	msg := err.Error()
	for _, want := range []string{"3.2a", "3.4", "brew"} {
		if !strings.Contains(msg, want) {
			t.Errorf("error = %q, want it to name the found version, the floor, and the upgrade hint (%q)", msg, want)
		}
	}
	if strings.Contains(msg, "apt") {
		t.Errorf("error = %q — the upgrade hint must never recommend apt", msg)
	}
}

func TestConnect_VersionGatePassThrough(t *testing.T) {
	// Unknown and at-floor local versions both pass the gate and reach the
	// normal flow (here: the ssh probe, which the script answers).
	for name, tc := range map[string]struct {
		v     tmux.Version
		known bool
	}{
		"unknown version proceeds":  {tmux.Version{}, false},
		"exactly at floor proceeds": {tmux.Version{Major: 3, Minor: 4, Raw: "3.4"}, true},
		"above floor proceeds":      {tmux.Version{Major: 3, Minor: 6, Raw: "3.6a"}, true},
	} {
		t.Run(name, func(t *testing.T) {
			path := writeStore(t, testRemote)
			ssh := &sshScript{responses: map[string]execResult{
				remoteVersionCmd:     okVersion("3.2.0"),
				remoteDaemonStartCmd: {},
				remoteURLCmd:         {stdout: "http://127.0.0.1:3000\n"},
			}}
			stubSSH(t, ssh)
			// Re-stub after stubSSH (which defaults the probe to unknown) so
			// the case's version wins.
			stubTmuxVersionProbe(t, tc.v, tc.known)
			stubTmux(t, &tmuxScript{listOut: "buildbox\tssh\n"})
			stubDial(t, func(string) bool { return true })

			if _, err := Connect(context.Background(), path, "buildbox", "3.2.0", nil); err != nil {
				t.Fatalf("Connect error = %v, want the gate to pass through", err)
			}
			if len(ssh.ran) == 0 {
				t.Error("no ssh probe ran — the gate must pass through, not short-circuit")
			}
		})
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
	// The Connect floor gate probes the local tmux version before Load —
	// stub it to unknown so the test stays hermetic on below-floor hosts.
	stubTmuxVersionProbe(t, tmux.Version{}, false)

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
