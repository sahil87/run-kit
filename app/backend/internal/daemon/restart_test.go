package daemon

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"rk/internal/ports"
)

// restartSeams stubs every sequencing-step seam Restart reaches and records
// the call order, so tests assert sequencing without a tmux server or lsof/ss.
// Individual fields can be overridden after the call.
type restartSeams struct {
	calls      []string
	binary     string // Binary paths passed to the start-with-binary step
	owner      *ports.PortOwner
	lookupErr  error
	terminated []int // PIDs passed to the terminate step
}

func stubRestartSeams(t *testing.T, running bool) *restartSeams {
	t.Helper()
	s := &restartSeams{}

	origRunning, origStop, origStart := restartIsRunningFn, restartStopFn, restartStartFn
	origStartBin, origKill := restartStartWithBinaryFn, restartKillServerFn
	origFind, origTerm, origTMUX := restartFindPortOwnerFn, restartTerminateOwnerFn, restartOriginalTMUXFn
	origPID := innerServePIDFn
	t.Cleanup(func() {
		restartIsRunningFn, restartStopFn, restartStartFn = origRunning, origStop, origStart
		restartStartWithBinaryFn, restartKillServerFn = origStartBin, origKill
		restartFindPortOwnerFn, restartTerminateOwnerFn, restartOriginalTMUXFn = origFind, origTerm, origTMUX
		innerServePIDFn = origPID
	})

	restartIsRunningFn = func() bool { s.calls = append(s.calls, "isRunning"); return running }
	restartStopFn = func() error { s.calls = append(s.calls, "stop"); return nil }
	restartStartFn = func() error { s.calls = append(s.calls, "start"); return nil }
	restartStartWithBinaryFn = func(binPath string) error {
		s.calls = append(s.calls, "startBinary")
		s.binary = binPath
		return nil
	}
	restartKillServerFn = func() error { s.calls = append(s.calls, "killServer"); return nil }
	restartFindPortOwnerFn = func(ctx context.Context, host string, port int) (*ports.PortOwner, error) {
		s.calls = append(s.calls, "portOwner")
		return s.owner, s.lookupErr
	}
	restartTerminateOwnerFn = func(ctx context.Context, owner *ports.PortOwner) error {
		s.calls = append(s.calls, "terminate")
		s.terminated = append(s.terminated, owner.PID)
		return nil
	}
	restartOriginalTMUXFn = func() string { return "" } // outside tmux by default
	innerServePIDFn = func() (int, error) { return 0, fmt.Errorf("no daemon pane") }
	return s
}

func assertOrder(t *testing.T, got []string, want ...string) {
	t.Helper()
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("call order = %v, want %v", got, want)
	}
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

func TestRestart_FullRefusesInsideDaemonServer(t *testing.T) {
	s := stubRestartSeams(t, true)
	restartOriginalTMUXFn = func() string { return "/tmp/tmux-1001/rk-daemon,4242,0" }

	err := Restart(RestartOptions{Full: true})
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

func TestRestart_PlainSequence(t *testing.T) {
	s := stubRestartSeams(t, true)

	if err := Restart(RestartOptions{}); err != nil {
		t.Fatalf("Restart: %v", err)
	}
	assertOrder(t, s.calls, "isRunning", "stop", "start")
}

func TestRestart_NotRunningJustStarts(t *testing.T) {
	s := stubRestartSeams(t, false)

	if err := Restart(RestartOptions{}); err != nil {
		t.Fatalf("Restart: %v", err)
	}
	assertOrder(t, s.calls, "isRunning", "start")
}

func TestRestart_FullSequence(t *testing.T) {
	s := stubRestartSeams(t, true)

	if err := Restart(RestartOptions{Full: true}); err != nil {
		t.Fatalf("Restart: %v", err)
	}
	assertOrder(t, s.calls, "isRunning", "stop", "killServer", "start")
}

func TestRestart_FullForceSequence(t *testing.T) {
	s := stubRestartSeams(t, true)

	if err := Restart(RestartOptions{Full: true, Force: true}); err != nil {
		t.Fatalf("Restart: %v", err)
	}
	// Port free (owner nil) — the force step probes between kill and start.
	assertOrder(t, s.calls, "isRunning", "stop", "killServer", "portOwner", "start")
}

func TestRestart_ForceTerminatesNonDaemonHolder(t *testing.T) {
	s := stubRestartSeams(t, true)
	s.owner = &ports.PortOwner{PID: 7777, Command: "node", Source: "test"}

	if err := Restart(RestartOptions{Force: true}); err != nil {
		t.Fatalf("Restart: %v", err)
	}
	assertOrder(t, s.calls, "isRunning", "stop", "portOwner", "terminate", "start")
	if len(s.terminated) != 1 || s.terminated[0] != 7777 {
		t.Errorf("terminated = %v, want [7777]", s.terminated)
	}
}

// A holder identified as the daemon itself is never signaled.
func TestRestart_ForceNeverSignalsSelf(t *testing.T) {
	s := stubRestartSeams(t, true)
	s.owner = &ports.PortOwner{PID: 42424, Command: "rk", Source: "test"}
	innerServePIDFn = func() (int, error) { return 42424, nil }

	if err := Restart(RestartOptions{Force: true}); err != nil {
		t.Fatalf("Restart: %v", err)
	}
	assertOrder(t, s.calls, "isRunning", "stop", "portOwner", "start")
	if len(s.terminated) != 0 {
		t.Errorf("terminated = %v, want none — the daemon itself is never signaled", s.terminated)
	}
}

// Lookup errors are surfaced, not swallowed: silently proceeding would leave
// --force failing with an opaque bind error instead of the real cause.
func TestRestart_ForceLookupErrorSurfaced(t *testing.T) {
	s := stubRestartSeams(t, true)
	s.lookupErr = fmt.Errorf("lsof: not on PATH; ss: not on PATH")

	err := Restart(RestartOptions{Force: true})
	if err == nil {
		t.Fatal("expected the lookup error, got nil")
	}
	if !strings.Contains(err.Error(), "port-owner lookup failed during --force") {
		t.Errorf("error = %q, want the --force lookup wrap", err)
	}
	assertOrder(t, s.calls, "isRunning", "stop", "portOwner")
}

func TestRestart_BinaryPathStartsWithBinary(t *testing.T) {
	s := stubRestartSeams(t, true)

	if err := Restart(RestartOptions{Binary: "/opt/homebrew/bin/run-kit"}); err != nil {
		t.Fatalf("Restart: %v", err)
	}
	assertOrder(t, s.calls, "isRunning", "stop", "startBinary")
	if s.binary != "/opt/homebrew/bin/run-kit" {
		t.Errorf("binary = %q, want the upgrade path", s.binary)
	}
}

func TestRestart_StopErrorAborts(t *testing.T) {
	s := stubRestartSeams(t, true)
	restartStopFn = func() error { s.calls = append(s.calls, "stop"); return fmt.Errorf("boom") }

	err := Restart(RestartOptions{Full: true, Force: true})
	if err == nil || !strings.Contains(err.Error(), "stopping daemon") {
		t.Fatalf("err = %v, want the wrapped stop failure", err)
	}
	assertOrder(t, s.calls, "isRunning", "stop")
}
