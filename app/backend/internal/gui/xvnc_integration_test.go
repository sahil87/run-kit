//go:build linux

package gui

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

// TestXtigervncProbeIntegration launches the real Xtigervnc with the fixed
// BackendArgv on a temp-dir unix socket (a high display, so nothing real is
// collided with), runs Probe against it, and asserts the RFB 003.008 banner
// handshake completes with the 1920x1080 geometry. Capability-gated: skips
// when Xtigervnc is not installed. Cleanup SIGTERMs the X server (a clean
// exit unlinks its socket) and escalates to SIGKILL so no X server ever
// outlives the test.
func TestXtigervncProbeIntegration(t *testing.T) {
	bin, err := exec.LookPath("Xtigervnc")
	if err != nil {
		t.Skip("Xtigervnc not installed")
	}

	dir := t.TempDir()
	sock := filepath.Join(dir, "host.sock")
	if err := ValidateSocketPath(sock); err != nil {
		t.Fatalf("temp socket path unusable: %v", err)
	}
	n, err := FreeDisplay(90)
	if err != nil {
		t.Fatalf("no free display: %v", err)
	}
	display := fmt.Sprintf(":%d", n)

	argv := BackendArgv(bin, display, sock, GeometryDefault)
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Stdout = os.Stderr // the backend log is diagnostic on failure
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		t.Fatalf("starting Xtigervnc: %v", err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Signal(syscall.SIGTERM)
		done := make(chan error, 1)
		go func() { done <- cmd.Wait() }()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			_ = cmd.Process.Kill()
			<-done
		}
		// The X server unlinks its socket on a clean exit; a SIGKILLed one
		// leaves it behind — either way no listener may remain.
		if _, err := os.Stat(sock); !errors.Is(err, fs.ErrNotExist) {
			t.Errorf("socket %s still exists after the backend exit", sock)
		}
		// Sweep the X lock artifacts the display claim created (a SIGKILL
		// would leak them and poison later FreeDisplay probes).
		_ = os.Remove(fmt.Sprintf("/tmp/.X%d-lock", n))
		_ = os.Remove(filepath.Join("/tmp/.X11-unix", fmt.Sprintf("X%d", n)))
	})

	deadline := time.Now().Add(10 * time.Second)
	for {
		if _, err := os.Stat(sock); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("Xtigervnc did not create %s within 10s", sock)
		}
		time.Sleep(100 * time.Millisecond)
	}

	info, err := Probe(context.Background(), "unix", sock)
	if err != nil {
		t.Fatalf("probe: %v", err)
	}
	if !info.Reachable {
		t.Fatalf("probe reports unreachable (reason %q) against a live Xtigervnc", info.Reason)
	}
	if info.Width != 1920 || info.Height != 1080 {
		t.Errorf("geometry = %dx%d, want 1920x1080 (the fixed -geometry argv)", info.Width, info.Height)
	}
}
