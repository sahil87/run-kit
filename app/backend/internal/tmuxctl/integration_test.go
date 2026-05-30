package tmuxctl

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// testSocketName builds a unified test socket name: rk-test-<role>-<pid>-<ns>.
// Local copy of the helper in internal/tmux/main_test.go (Go _test.go symbols
// are package-private and cannot be shared across packages). PID-stamping the
// former fixed name rk-tmuxctl-test makes the socket parseable by the automatic
// post-sweep instead of relying on t.Cleanup alone.
func testSocketName(role string) string {
	return fmt.Sprintf("rk-test-%s-%d-%d", role, os.Getpid(), time.Now().UnixNano())
}

// TestIntegration_TmuxControlMode_LatencyTarget exercises the real tmux
// control-mode connection by spinning up an isolated server, opening a
// Client, then triggering a window switch and asserting the generation
// counter advances within the spec's 500ms hard upper bound.
//
// Target: 200ms. Hard upper bound: 500ms. CI flake budget may relax the
// bound up to 500ms; if CI proves flaky, raise the assertion below.
//
// Skipped when tmux is not present on the host.
func TestIntegration_TmuxControlMode_LatencyTarget(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available — skipping integration test")
	}

	socket := testSocketName("tmuxctl")

	// Pre-cleanup in case a prior aborted run left the server alive.
	_ = exec.Command("tmux", "-L", socket, "kill-server").Run()

	// Spin up an isolated tmux server with one session.
	out, err := exec.Command("tmux", "-L", socket, "new-session", "-d", "-s", "main").CombinedOutput()
	if err != nil {
		t.Skipf("could not create tmux session (likely no PTY): %v\n%s", err, string(out))
	}
	t.Cleanup(func() {
		_ = exec.Command("tmux", "-L", socket, "kill-server").Run()
	})

	// Add a second window so select-window has somewhere to go.
	if out, err := exec.Command("tmux", "-L", socket, "new-window", "-d", "-t", "main").CombinedOutput(); err != nil {
		t.Fatalf("new-window: %v\n%s", err, string(out))
	}

	sink := &recordingSink{}
	c, err := Open(context.Background(), socket, sink)
	if err != nil {
		if strings.Contains(err.Error(), "PTY") || strings.Contains(err.Error(), "pty") {
			t.Skipf("PTY unavailable: %v", err)
		}
		t.Fatalf("Open: %v", err)
	}
	defer c.Close()

	// Wait for the connection to establish.
	deadline := time.Now().Add(2 * time.Second)
	for {
		sink.mu.Lock()
		est := sink.established
		sink.mu.Unlock()
		if est >= 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("did not see OnConnectionEstablished within 2s")
		}
		time.Sleep(10 * time.Millisecond)
	}

	// Trigger a select-window. Generation must advance within 500ms.
	prev := c.Generation()
	start := time.Now()
	if out, err := exec.Command("tmux", "-L", socket, "select-window", "-t", "main:1").CombinedOutput(); err != nil {
		t.Fatalf("select-window: %v\n%s", err, string(out))
	}

	select {
	case <-c.Wait(prev):
		elapsed := time.Since(start)
		t.Logf("control-mode notification arrived in %v", elapsed)
		if elapsed > 500*time.Millisecond {
			t.Errorf("notification took %v, exceeds 500ms hard upper bound", elapsed)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("never observed control-mode notification within 2s")
	}
}
