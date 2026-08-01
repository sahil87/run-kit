package remote

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

// tmuxScript stubs both tmux seams: run answers from runErr keyed by the
// first tmux subcommand, output answers listOut/listErr for list-windows.
type tmuxScript struct {
	calls   [][]string
	dirs    []string
	runErr  map[string]error
	listOut string
	listErr error
}

func stubTmux(t *testing.T, s *tmuxScript) {
	t.Helper()
	origRun, origOut := tmuxRunFn, tmuxOutputFn
	tmuxRunFn = func(_ context.Context, dir string, args ...string) error {
		s.calls = append(s.calls, args)
		s.dirs = append(s.dirs, dir)
		if s.runErr != nil {
			if err, ok := s.runErr[args[0]]; ok {
				return err
			}
		}
		return nil
	}
	tmuxOutputFn = func(_ context.Context, args ...string) ([]byte, error) {
		s.calls = append(s.calls, args)
		s.dirs = append(s.dirs, "")
		if s.listErr != nil {
			return nil, s.listErr
		}
		return []byte(s.listOut), nil
	}
	t.Cleanup(func() { tmuxRunFn, tmuxOutputFn = origRun, origOut })
}

func stubDial(t *testing.T, fn func(addr string) bool) {
	t.Helper()
	orig := dialFn
	dialFn = func(addr string, _ time.Duration) bool { return fn(addr) }
	t.Cleanup(func() { dialFn = orig })
}

func TestTunnelArgs_ByteExactCommand(t *testing.T) {
	got := tunnelArgs("sahil@buildbox", 3100, 3000)
	want := []string{
		"ssh", "-N",
		"-o", "BatchMode=yes",
		"-o", "ServerAliveInterval=15",
		"-L", "127.0.0.1:3100:127.0.0.1:3000",
		"sahil@buildbox",
	}
	if strings.Join(got, " ") != strings.Join(want, " ") {
		t.Errorf("tunnelArgs = %q, want %q", got, want)
	}
}

func TestListTunnels_DerivesFromListWindows(t *testing.T) {
	s := &tmuxScript{listOut: "buildbox\tssh\nvm2\tbash\n"}
	stubTmux(t, s)

	tunnels := ListTunnels(context.Background())
	if !tunnels["buildbox"] {
		t.Error("buildbox window running ssh should be up")
	}
	if tunnels["vm2"] {
		t.Error("vm2 window running bash is not a live tunnel")
	}
	if tunnels["absent"] {
		t.Error("absent window should be down")
	}
}

func TestListTunnels_NoServerIsAllDown(t *testing.T) {
	s := &tmuxScript{listErr: errors.New("no server running on /tmp/tmux-501/rk-daemon")}
	stubTmux(t, s)

	tunnels := ListTunnels(context.Background())
	if len(tunnels) != 0 {
		t.Errorf("tunnels = %v, want empty (all down)", tunnels)
	}
}

func TestOpenTunnel_BirthsSessionWithPinnedCWD(t *testing.T) {
	// has-session fails → session absent → new-session with the birth dir.
	s := &tmuxScript{runErr: map[string]error{"has-session": errors.New("no session")}}
	stubTmux(t, s)

	if err := openTunnel(context.Background(), "buildbox", "sahil@buildbox", 3100, 3000); err != nil {
		t.Fatalf("openTunnel error = %v", err)
	}
	last := s.calls[len(s.calls)-1]
	if last[0] != "new-session" {
		t.Fatalf("last tmux call = %v, want new-session", last)
	}
	joined := strings.Join(last, " ")
	if !strings.Contains(joined, "-s "+SessionName+" -n buildbox") {
		t.Errorf("new-session args missing session/window names: %v", last)
	}
	if !strings.HasSuffix(joined, strings.Join(tunnelArgs("sahil@buildbox", 3100, 3000), " ")) {
		t.Errorf("new-session should end with the exact tunnel argv: %v", last)
	}
	if dir := s.dirs[len(s.dirs)-1]; dir == "" {
		t.Error("session birth must pin the CWD (ServerBirthDir), got empty dir")
	}
}

func TestOpenTunnel_AddsWindowToExistingSession(t *testing.T) {
	s := &tmuxScript{} // has-session succeeds
	stubTmux(t, s)

	if err := openTunnel(context.Background(), "vm2", "vm2", 3101, 3000); err != nil {
		t.Fatalf("openTunnel error = %v", err)
	}
	last := s.calls[len(s.calls)-1]
	if last[0] != "new-window" {
		t.Fatalf("last tmux call = %v, want new-window", last)
	}
	joined := strings.Join(last, " ")
	if !strings.Contains(joined, "-t ="+SessionName+" -n vm2") {
		t.Errorf("new-window args missing exact-match target/name: %v", last)
	}
	if dir := s.dirs[len(s.dirs)-1]; dir != "" {
		t.Errorf("new-window must not override CWD, got %q", dir)
	}
}

func TestCloseTunnel_IdempotentAndTargeted(t *testing.T) {
	// Window absent → no kill issued, success.
	s := &tmuxScript{listOut: ""}
	stubTmux(t, s)
	if err := closeTunnel(context.Background(), "buildbox"); err != nil {
		t.Fatalf("closeTunnel(absent) error = %v", err)
	}
	for _, c := range s.calls {
		if c[0] == "kill-window" {
			t.Errorf("no kill-window expected for an absent tunnel: %v", s.calls)
		}
	}

	// Window present → exact-match kill-window on that window only.
	s2 := &tmuxScript{listOut: "buildbox\tssh\n"}
	stubTmux(t, s2)
	if err := closeTunnel(context.Background(), "buildbox"); err != nil {
		t.Fatalf("closeTunnel(present) error = %v", err)
	}
	found := false
	for _, c := range s2.calls {
		if c[0] == "kill-window" {
			found = true
			if c[2] != "="+SessionName+":=buildbox" {
				t.Errorf("kill-window target = %q, want exact-match window target", c[2])
			}
		}
	}
	if !found {
		t.Error("expected a kill-window call")
	}
}

func TestWaitTunnelReady_Branches(t *testing.T) {
	origTimeout, origPoll := tunnelReadyTimeout, tunnelPollInterval
	tunnelReadyTimeout, tunnelPollInterval = 80*time.Millisecond, 5*time.Millisecond
	t.Cleanup(func() { tunnelReadyTimeout, tunnelPollInterval = origTimeout, origPoll })

	// Ready immediately.
	stubTmux(t, &tmuxScript{listOut: "buildbox\tssh\n"})
	stubDial(t, func(string) bool { return true })
	if err := waitTunnelReady(context.Background(), "buildbox", 3100); err != nil {
		t.Errorf("ready branch error = %v", err)
	}

	// Window died → auth-hint error.
	stubTmux(t, &tmuxScript{listOut: ""})
	stubDial(t, func(string) bool { return false })
	err := waitTunnelReady(context.Background(), "buildbox", 3100)
	if err == nil || !strings.Contains(err.Error(), "exited before the forward") {
		t.Errorf("window-died branch error = %v, want exited-before message", err)
	}

	// Window alive but never accepting → timeout error.
	stubTmux(t, &tmuxScript{listOut: "buildbox\tssh\n"})
	stubDial(t, func(string) bool { return false })
	err = waitTunnelReady(context.Background(), "buildbox", 3100)
	if err == nil || !strings.Contains(err.Error(), "did not accept connections") {
		t.Errorf("timeout branch error = %v, want did-not-accept message", err)
	}
}
