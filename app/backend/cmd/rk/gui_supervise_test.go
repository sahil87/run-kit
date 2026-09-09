package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"rk/internal/gui"
	"rk/internal/testutil"
)

// guiSupLogBuf is a goroutine-safe log capture for the supervisor's log seam.
type guiSupLogBuf struct {
	mu sync.Mutex
	sb strings.Builder
}

func (b *guiSupLogBuf) write(line string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.sb.WriteString(line + "\n")
}

func (b *guiSupLogBuf) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.sb.String()
}

// captureGuiSuperviseLog swaps the log seam for a buffer for one test.
func captureGuiSuperviseLog(t *testing.T) *guiSupLogBuf {
	t.Helper()
	buf := &guiSupLogBuf{}
	orig := guiSuperviseLog
	t.Cleanup(func() { guiSuperviseLog = orig })
	guiSuperviseLog = buf.write
	return buf
}

// captureGuiStamps swaps the tmux stamp seam for an argv recorder.
func captureGuiStamps(t *testing.T) *[][]string {
	t.Helper()
	stamps := &[][]string{}
	orig := guiSuperviseTmuxRun
	t.Cleanup(func() { guiSuperviseTmuxRun = orig })
	guiSuperviseTmuxRun = func(_ context.Context, args ...string) error {
		*stamps = append(*stamps, append([]string(nil), args...))
		return nil
	}
	return stamps
}

// withGuiSuperviseGOOS forks the OS dispatch for one test.
func withGuiSuperviseGOOS(t *testing.T, goos string) {
	t.Helper()
	orig := guiSuperviseGOOS
	t.Cleanup(func() { guiSuperviseGOOS = orig })
	guiSuperviseGOOS = goos
}

// withGuiSuperviseLookPath scripts the binary-resolution seam for one test.
func withGuiSuperviseLookPath(t *testing.T, resolvable map[string]string) {
	t.Helper()
	orig := guiSuperviseLookPath
	t.Cleanup(func() { guiSuperviseLookPath = orig })
	guiSuperviseLookPath = func(name string) (string, error) {
		if p, ok := resolvable[name]; ok {
			return p, nil
		}
		return "", fmt.Errorf("%s not found", name)
	}
}

// waitForGuiLog polls until the captured log contains want (deadline-bounded).
func waitForGuiLog(t *testing.T, buf *guiSupLogBuf, want string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if strings.Contains(buf.String(), want) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("log did not gain %q within 5s; got:\n%s", want, buf.String())
}

// --- line formats ---

func TestGuiSuperviseLineFormats(t *testing.T) {
	if got, want := guiBackendUpLine("Xtigervnc", ":11", "/x/gui/host.sock"),
		"gui: Xtigervnc up on :11 (socket /x/gui/host.sock)"; got != want {
		t.Errorf("up line = %q, want %q", got, want)
	}
	if got, want := guiNoWMLine(),
		"gui: no window manager found (tried openbox, xfwm4, i3, kwin_x11, x-session-manager); running bare — apt install openbox"; got != want {
		t.Errorf("no-WM line = %q, want %q", got, want)
	}
	if got, want := guiBackendExitLine("Xtigervnc", 1, ":10"),
		"gui: Xtigervnc exited (status 1) — display :10 is down; run 'rk gui restart' or turn the GUI off"; got != want {
		t.Errorf("exit line = %q, want %q", got, want)
	}
	if got, want := guiScreenSharingLine(true),
		"Screen Sharing: reachable on 127.0.0.1:5900"; got != want {
		t.Errorf("reachable line = %q, want %q", got, want)
	}
	if got, want := guiScreenSharingLine(false),
		"Screen Sharing: not reachable — enable System Settings › General › Sharing › Screen Sharing"; got != want {
		t.Errorf("unreachable line = %q, want %q", got, want)
	}
}

// --- validation ---

func TestGuiSuperviseRejectsBadID(t *testing.T) {
	err := runGuiSupervise("nope", ":10")
	if err == nil || err.Error() != `gui id must be "host"` {
		t.Errorf("err = %v, want the ValidateGUIID refusal", err)
	}
}

func TestGuiSuperviseRejectsBadDisplay(t *testing.T) {
	for _, display := range []string{"", "10", ":10a", "::1"} {
		if err := runGuiSupervise("host", display); err == nil || !strings.Contains(err.Error(), ":N") {
			t.Errorf("display %q: err = %v, want the :N form error", display, err)
		}
	}
}

// --- darwin dispatch ---

func TestGuiSuperviseDarwinProbesAndSpawnsNothing(t *testing.T) {
	withGuiSuperviseGOOS(t, "darwin")
	buf := captureGuiSuperviseLog(t)
	stamps := captureGuiStamps(t)
	origProbe := guiSuperviseProbe
	t.Cleanup(func() { guiSuperviseProbe = origProbe })
	guiSuperviseProbe = func(context.Context, string, string) (gui.Info, error) {
		return gui.Info{Reachable: true}, nil
	}
	backendStarts := 0
	origStart := guiSuperviseStartBackend
	t.Cleanup(func() { guiSuperviseStartBackend = origStart })
	guiSuperviseStartBackend = func(context.Context, []string) (*exec.Cmd, error) {
		backendStarts++
		return nil, fmt.Errorf("darwin spawns nothing")
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // already signalled: probe once, log, exit 0
	if err := runGuiSuperviseCtx(ctx, "host", ":10"); err != nil {
		t.Fatal(err)
	}

	if !strings.Contains(buf.String(), "Screen Sharing: reachable on 127.0.0.1:5900") {
		t.Errorf("log =\n%s\nwant the reachable line", buf.String())
	}
	want := []string{"set-option", "-t", "=rk-gui", "@rk_gui_backend", "screen-sharing"}
	if len(*stamps) != 1 || strings.Join((*stamps)[0], " ") != strings.Join(want, " ") {
		t.Errorf("stamps = %v, want exactly [%v]", *stamps, want)
	}
	if backendStarts != 0 {
		t.Errorf("backend starts = %d, want 0 — darwin spawns nothing", backendStarts)
	}
}

func TestGuiSuperviseDarwinUnreachableLine(t *testing.T) {
	withGuiSuperviseGOOS(t, "darwin")
	buf := captureGuiSuperviseLog(t)
	captureGuiStamps(t)
	origProbe := guiSuperviseProbe
	t.Cleanup(func() { guiSuperviseProbe = origProbe })
	guiSuperviseProbe = func(context.Context, string, string) (gui.Info, error) {
		return gui.Info{Reachable: false, Reason: "not running"}, nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := runGuiSuperviseCtx(ctx, "host", ":10"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.String(), "Screen Sharing: not reachable — enable System Settings › General › Sharing › Screen Sharing") {
		t.Errorf("log =\n%s\nwant the not-reachable line", buf.String())
	}
}

// --- linux dispatch ---

// guiBackendStub is a fake Xvnc: it creates the socket named by its
// -rfbunixpath argv element, then either sleeps (stays up) or exits 3
// (self-exit), per the tail.
const guiBackendStubUp = `#!/bin/sh
sock=""
while [ $# -gt 0 ]; do
  case "$1" in -rfbunixpath) sock="$2"; shift ;; esac
  shift
done
touch "$sock"
exec sleep 60
`

const guiBackendStubExit = `#!/bin/sh
sock=""
while [ $# -gt 0 ]; do
  case "$1" in -rfbunixpath) sock="$2"; shift ;; esac
  shift
done
touch "$sock"
exit 3
`

func TestGuiSuperviseLinuxNoBackendErrors(t *testing.T) {
	withGuiSuperviseGOOS(t, "linux")
	withGuiSuperviseLookPath(t, map[string]string{})
	t.Setenv("XDG_STATE_HOME", t.TempDir())

	err := runGuiSuperviseCtx(context.Background(), "host", ":10")
	if err == nil || !strings.Contains(err.Error(), "no VNC backend installed") {
		t.Errorf("err = %v, want the no-backend error naming the install hint", err)
	}
}

func TestGuiSuperviseLinuxSignalTeardown(t *testing.T) {
	withGuiSuperviseGOOS(t, "linux")
	stateHome := t.TempDir()
	t.Setenv("XDG_STATE_HOME", stateHome)
	stubDir := testutil.StubOnPath(t, "Xtigervnc", guiBackendStubUp)
	withGuiSuperviseLookPath(t, map[string]string{
		"Xtigervnc": filepath.Join(stubDir, "Xtigervnc"),
		// no WM resolves ⇒ the bare line must be logged
	})
	buf := captureGuiSuperviseLog(t)
	stamps := captureGuiStamps(t)

	sock, err := gui.SocketPath("host")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- runGuiSuperviseCtx(ctx, "host", ":11") }()

	waitForGuiLog(t, buf, guiBackendUpLine("Xtigervnc", ":11", sock))
	wantStamp := []string{"set-option", "-t", "=rk-gui", "@rk_gui_display", ":11"}
	found := false
	for _, s := range *stamps {
		if strings.Join(s, " ") == strings.Join(wantStamp, " ") {
			found = true
		}
	}
	if !found {
		t.Errorf("stamps = %v, want one %v", *stamps, wantStamp)
	}
	if !strings.Contains(buf.String(), guiNoWMLine()) {
		t.Errorf("log =\n%s\nwant the bare-WM line", buf.String())
	}
	// The socket must be 0600 in a 0700 dir.
	info, err := os.Stat(sock)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("socket mode = %o, want 600", info.Mode().Perm())
	}

	cancel()
	if err := <-done; err != nil {
		t.Errorf("signal teardown err = %v, want nil (exit 0)", err)
	}
	if _, err := os.Stat(sock); !os.IsNotExist(err) {
		t.Errorf("socket still present after teardown: %v", err)
	}
}

func TestGuiSuperviseLinuxLaunchesWMWithDisplay(t *testing.T) {
	withGuiSuperviseGOOS(t, "linux")
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	stubDir := testutil.StubOnPath(t, "Xtigervnc", guiBackendStubUp)
	displayFile := filepath.Join(t.TempDir(), "wm-display")
	t.Setenv("GUI_WM_DISPLAY_FILE", displayFile)
	wmDir := testutil.StubOnPath(t, "kwin_x11", "#!/bin/sh\necho \"$DISPLAY\" > \"$GUI_WM_DISPLAY_FILE\"\nexec sleep 60\n")
	withGuiSuperviseLookPath(t, map[string]string{
		"Xtigervnc": filepath.Join(stubDir, "Xtigervnc"),
		"kwin_x11":  filepath.Join(wmDir, "kwin_x11"),
	})
	buf := captureGuiSuperviseLog(t)
	captureGuiStamps(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- runGuiSuperviseCtx(ctx, "host", ":12") }()

	waitForGuiLog(t, buf, "gui: Xtigervnc up on :12")
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if data, err := os.ReadFile(displayFile); err == nil && strings.TrimSpace(string(data)) == ":12" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	data, err := os.ReadFile(displayFile)
	if err != nil || strings.TrimSpace(string(data)) != ":12" {
		t.Errorf("WM DISPLAY file = %q (%v), want :12", data, err)
	}
	if strings.Contains(buf.String(), guiNoWMLine()) {
		t.Errorf("log =\n%s\nwant no bare-WM line when kwin_x11 resolves", buf.String())
	}
	cancel()
	if err := <-done; err != nil {
		t.Errorf("teardown err = %v, want nil", err)
	}
}

func TestGuiSuperviseLinuxBackendExitStaysIdle(t *testing.T) {
	withGuiSuperviseGOOS(t, "linux")
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	stubDir := testutil.StubOnPath(t, "Xtigervnc", guiBackendStubExit)
	withGuiSuperviseLookPath(t, map[string]string{
		"Xtigervnc": filepath.Join(stubDir, "Xtigervnc"),
	})
	buf := captureGuiSuperviseLog(t)
	captureGuiStamps(t)

	sock, err := gui.SocketPath("host")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- runGuiSuperviseCtx(ctx, "host", ":10") }()

	waitForGuiLog(t, buf, "gui: Xtigervnc exited (status 3) — display :10 is down; run 'rk gui restart' or turn the GUI off")
	if _, err := os.Stat(sock); !os.IsNotExist(err) {
		t.Errorf("socket still present after the backend exit: %v", err)
	}
	// R6: the supervisor BLOCKS after the backend's own exit — no auto-respawn,
	// no process exit, so the pane keeps the exit line readable.
	select {
	case err := <-done:
		t.Fatalf("supervise returned %v after the backend exit, want it to block until signalled", err)
	case <-time.After(200 * time.Millisecond):
	}
	cancel()
	if err := <-done; err != nil {
		t.Errorf("err = %v, want nil on signal", err)
	}
}

func TestGuiSuperviseLinuxRemovesStaleSocket(t *testing.T) {
	withGuiSuperviseGOOS(t, "linux")
	stateHome := t.TempDir()
	t.Setenv("XDG_STATE_HOME", stateHome)
	stubDir := testutil.StubOnPath(t, "Xtigervnc", guiBackendStubUp)
	withGuiSuperviseLookPath(t, map[string]string{
		"Xtigervnc": filepath.Join(stubDir, "Xtigervnc"),
	})
	buf := captureGuiSuperviseLog(t)
	captureGuiStamps(t)

	// A stale socket from a crashed supervisor must not block the bind.
	sock, err := gui.SocketPath("host")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(sock), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(sock, []byte("stale"), 0o600); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- runGuiSuperviseCtx(ctx, "host", ":13") }()

	waitForGuiLog(t, buf, "gui: Xtigervnc up on :13")
	cancel()
	if err := <-done; err != nil {
		t.Errorf("err = %v, want nil", err)
	}
}

func TestGuiSuperviseLinuxSocketWaitTimeoutKillsBackend(t *testing.T) {
	withGuiSuperviseGOOS(t, "linux")
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	// Backend that never creates the socket.
	stubDir := testutil.StubOnPath(t, "Xtigervnc", "#!/bin/sh\nexec sleep 60\n")
	withGuiSuperviseLookPath(t, map[string]string{
		"Xtigervnc": filepath.Join(stubDir, "Xtigervnc"),
	})
	captureGuiSuperviseLog(t)
	captureGuiStamps(t)
	origTimeout, origPoll := guiSocketWaitTimeout, guiSocketWaitPoll
	t.Cleanup(func() { guiSocketWaitTimeout, guiSocketWaitPoll = origTimeout, origPoll })
	guiSocketWaitTimeout = 100 * time.Millisecond
	guiSocketWaitPoll = 10 * time.Millisecond

	sock, err := gui.SocketPath("host")
	if err != nil {
		t.Fatal(err)
	}
	err = runGuiSuperviseCtx(context.Background(), "host", ":14")
	if err == nil || !strings.Contains(err.Error(), "did not create "+sock) {
		t.Errorf("err = %v, want the socket-wait timeout naming %s", err, sock)
	}
}
