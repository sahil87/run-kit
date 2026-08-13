package snapshot

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"testing"
	"time"
)

// tmuxCmd runs one tmux command against the isolated test socket.
func tmuxCmd(t *testing.T, socket string, args ...string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	full := append([]string{"-L", socket}, args...)
	if out, err := exec.CommandContext(ctx, "tmux", full...).CombinedOutput(); err != nil {
		t.Fatalf("tmux %v: %v\n%s", args, err, out)
	}
}

// TestCaptureRestoreRoundTripLiveTmux is the end-to-end proof over a real
// tmux server: build a layout on an isolated rk-test-* socket, capture it,
// kill the server, restore from the snapshot, re-capture, and compare the
// structural content (session names, window indexes/names, pane counts and
// cwds, rk options). Uses the rk-test-* namespace so leaked servers are
// covered by the standard test-socket reaping.
func TestCaptureRestoreRoundTripLiveTmux(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available — skipping integration test")
	}
	socket := fmt.Sprintf("rk-test-snaproundtrip-%d-%d", os.Getpid(), time.Now().UnixNano())
	t.Cleanup(func() {
		_ = exec.Command("tmux", "-L", socket, "kill-server").Run()
		// kill-server can leave the dead socket file behind; remove it so
		// repeated runs don't accumulate residue in /tmp/tmux-<uid>/.
		_ = os.Remove(fmt.Sprintf("/tmp/tmux-%d/%s", os.Getuid(), socket))
	})

	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("no home dir")
	}
	tmpCwd := t.TempDir()

	// Layout: session alpha (2 windows, one split), session beta (1 window),
	// plus rk options.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if out, err := exec.CommandContext(ctx, "tmux", "-L", socket,
		"new-session", "-d", "-s", "alpha", "-n", "serve", "-c", home, "-x", "120", "-y", "40").CombinedOutput(); err != nil {
		t.Skipf("could not start isolated tmux server: %v\n%s", err, out)
	}
	tmuxCmd(t, socket, "set-option", "-g", "exit-empty", "off")
	tmuxCmd(t, socket, "new-window", "-d", "-t", "=alpha:", "-n", "agent", "-c", tmpCwd)
	tmuxCmd(t, socket, "split-window", "-d", "-t", "=alpha:agent", "-c", home)
	tmuxCmd(t, socket, "new-session", "-d", "-s", "beta", "-n", "b", "-c", home, "-x", "120", "-y", "40")
	tmuxCmd(t, socket, "set-option", "-t", "=alpha:", "@session_color", "4")
	tmuxCmd(t, socket, "set-option", "-w", "-t", "=alpha:agent", "@rk_marker", "solid")
	tmuxCmd(t, socket, "set-option", "-w", "-t", "=alpha:agent", "@rk_role", "operator")
	tmuxCmd(t, socket, "set-option", "-s", "@rk_server_rank", "7")

	before, err := CaptureServer(context.Background(), socket)
	if err != nil {
		t.Fatalf("capture before: %v", err)
	}
	if before.SessionCount() != 2 || before.WindowCount() != 3 {
		t.Fatalf("before counts: %d sessions / %d windows\n%+v",
			before.SessionCount(), before.WindowCount(), before)
	}

	tmuxCmd(t, socket, "kill-server")

	// Dead server: capture must error, not read as empty.
	if _, err := CaptureServer(context.Background(), socket); err == nil {
		t.Fatal("capture of dead server must error")
	}

	report, err := Restore(context.Background(), socket, before)
	if err != nil {
		t.Fatalf("restore: %v\nreport: %+v", err, report)
	}
	if len(report.Skipped) != 0 {
		t.Errorf("restore skipped: %v", report.Skipped)
	}

	after, err := CaptureServer(context.Background(), socket)
	if err != nil {
		t.Fatalf("capture after: %v", err)
	}

	// Structural comparison (ids/timestamps/layout checksums legitimately
	// differ across the round trip).
	if after.SessionCount() != 2 || after.WindowCount() != 3 {
		t.Fatalf("after counts: %d sessions / %d windows\n%+v",
			after.SessionCount(), after.WindowCount(), after)
	}
	if after.ServerRank == nil || *after.ServerRank != 7 {
		t.Errorf("server rank after restore = %v, want 7", after.ServerRank)
	}
	for si, sess := range before.Sessions {
		got := after.Sessions[si]
		if got.Name != sess.Name {
			t.Errorf("session[%d] = %q, want %q", si, got.Name, sess.Name)
			continue
		}
		if got.Color != sess.Color {
			t.Errorf("session %s color = %q, want %q", sess.Name, got.Color, sess.Color)
		}
		if len(got.Windows) != len(sess.Windows) {
			t.Errorf("session %s windows = %d, want %d", sess.Name, len(got.Windows), len(sess.Windows))
			continue
		}
		for wi, win := range sess.Windows {
			gw := got.Windows[wi]
			if gw.Index != win.Index || gw.Name != win.Name {
				t.Errorf("session %s window[%d] = (%d,%q), want (%d,%q)",
					sess.Name, wi, gw.Index, gw.Name, win.Index, win.Name)
			}
			if gw.Marker != win.Marker {
				t.Errorf("window %s marker = %q, want %q", win.Name, gw.Marker, win.Marker)
			}
			if gw.Role != win.Role {
				t.Errorf("window %s role = %q, want %q", win.Name, gw.Role, win.Role)
			}
			if len(gw.Panes) != len(win.Panes) {
				t.Errorf("window %s panes = %d, want %d", win.Name, len(gw.Panes), len(win.Panes))
				continue
			}
			for pi, pane := range win.Panes {
				if gw.Panes[pi].Cwd != pane.Cwd {
					t.Errorf("window %s pane[%d] cwd = %q, want %q",
						win.Name, pi, gw.Panes[pi].Cwd, pane.Cwd)
				}
			}
		}
	}
}
