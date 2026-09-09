package tmux

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/creack/pty"
)

// TestManagedConfSplitUnderNarrowerClientDoesNotWedge reproduces the geometry
// that spins a tmux ≤3.7c server for ~21s per redraw — a sized client narrower
// than the window it views, and a pane whose status line straddles that
// client's right edge — and asserts the managed conf keeps it unreachable.
//
// Geometry: a 200×50 client attaches first, a 105×40 client second, and a
// focus-in event makes the wide client the most recently active one. Under
// `window-size latest` that leaves the window 200 columns wide with the narrow
// client clipped; a horizontal split then places the right pane's status line
// at column 103, straddling the narrow client's edge at 105, and
// screen_redraw_draw_pane_status computes `width = size - x` in u_int, which
// underflows whenever the status text is shorter than its x offset. The
// managed conf's `window-size smallest` sizes the window to 105 columns
// instead, so nothing is ever clipped and the split completes instantly.
//
// The probes run under 5s contexts: on the pre-guard conf the server spins for
// >40s, the contexts expire, and the test fails closed. No agent TUI is needed
// — the defect is purely geometric — so the panes run `sleep`.
func TestManagedConfSplitUnderNarrowerClientDoesNotWedge(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not on PATH")
	}
	sock := testSocketName("wedge")
	conf := filepath.Join(t.TempDir(), "tmux.conf")
	if err := os.WriteFile(conf, DefaultConfigBytes(), 0o644); err != nil {
		t.Fatalf("write conf: %v", err)
	}

	run := func(timeout time.Duration, args ...string) (string, error) {
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()
		out, err := exec.CommandContext(ctx, "tmux", append([]string{"-L", sock}, args...)...).CombinedOutput()
		return strings.TrimSpace(string(out)), err
	}

	if out, err := run(5*time.Second, "-f", conf, "new-session", "-d", "-s", "s",
		"-x", "200", "-y", "50", "sleep", "1000"); err != nil {
		t.Skipf("could not start isolated tmux server %q: %v\n%s", sock, err, out)
	}
	// Capture the server pid BEFORE any client attaches: if the guard regresses
	// the server spins and every tmux command against it blocks, so cleanup needs
	// a signal-based backstop that does not go through the socket.
	pidOut, err := run(5*time.Second, "display", "-p", "#{pid}")
	if err != nil {
		t.Fatalf("read server pid: %v %s", err, pidOut)
	}
	serverPID, _ := strconv.Atoi(pidOut)
	t.Cleanup(func() {
		_, _ = run(10*time.Second, "kill-server")
		if serverPID > 0 {
			_ = syscall.Kill(serverPID, syscall.SIGKILL)
		}
	})

	// attach starts a sized `tmux attach-session` client on a pty — the same
	// shape as the web relay's clients — and drains its output so tmux never
	// blocks on a full pty.
	attach := func(cols, rows uint16) *os.File {
		cmd := exec.Command("tmux", "-L", sock, "attach-session", "-t", "s")
		cmd.Env = append(os.Environ(), "TERM=xterm-256color")
		f, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: cols, Rows: rows})
		if err != nil {
			t.Skipf("pty unavailable: %v", err)
		}
		t.Cleanup(func() {
			_ = cmd.Process.Kill()
			_, _ = cmd.Process.Wait()
			_ = f.Close()
		})
		go func() {
			buf := make([]byte, 64<<10)
			for {
				if _, err := f.Read(buf); err != nil {
					return
				}
			}
		}()
		return f
	}
	wide := attach(200, 50)
	waitForClients(t, run, 1)
	attach(105, 40)
	waitForClients(t, run, 2)

	// Focus-in makes the wide client the most recently active one — the input
	// that, under `window-size latest`, would grow the window to 200 columns and
	// clip the narrow client.
	if _, err := wide.Write([]byte("\x1b[I")); err != nil {
		t.Fatalf("focus-in write: %v", err)
	}
	time.Sleep(300 * time.Millisecond)

	timed := func(what string, args ...string) string {
		start := time.Now()
		out, err := run(5*time.Second, args...)
		took := time.Since(start)
		if err != nil {
			t.Fatalf("%s did not complete in %v (server wedged?): %v %s", what, took, err, out)
		}
		if took > 2*time.Second {
			t.Fatalf("%s took %v; the pane-status draw is spinning the server", what, took)
		}
		return out
	}
	timed("split-window", "split-window", "-h", "-t", "s:1", "sleep", "1000")
	if out := timed("display probe", "display", "-p", "ok"); out != "ok" {
		t.Fatalf("display probe returned %q, want ok", out)
	}

	if got := timed("window width", "display", "-p", "-t", "s:1", "#{window_width}"); got != "105" {
		t.Errorf("window_width = %s, want 105 (the narrowest viewer)", got)
	}
	if got := timed("window-size", "show", "-gv", "window-size"); got != "smallest" {
		t.Errorf("window-size = %q, want smallest", got)
	}
	if got := timed("aggressive-resize", "show", "-gwv", "aggressive-resize"); got != "on" {
		t.Errorf("aggressive-resize = %q, want on", got)
	}
}

// waitForClients polls list-clients until n sized clients are attached (a
// freshly spawned attach client needs a moment to negotiate its terminal).
func waitForClients(t *testing.T, run func(time.Duration, ...string) (string, error), n int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		out, err := run(5*time.Second, "list-clients", "-F", "#{client_width}")
		if err == nil && out != "" && len(strings.Split(out, "\n")) >= n {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("expected %d attached clients", n)
}
