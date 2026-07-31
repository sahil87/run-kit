package tmux

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestWrapStderr pins the error-wrapping convention at the unit level:
// trimmed stderr is appended as "%w: %s"; empty/whitespace-only stderr
// falls back to the bare error unchanged.
func TestWrapStderr(t *testing.T) {
	sentinel := errors.New("exit status 1")

	if got := wrapStderr(sentinel, ""); got != sentinel {
		t.Errorf("wrapStderr(err, \"\") = %v, want the bare error", got)
	}
	if got := wrapStderr(sentinel, " \n\t"); got != sentinel {
		t.Errorf("wrapStderr(err, whitespace) = %v, want the bare error", got)
	}

	wrapped := wrapStderr(sentinel, " no server running\n")
	if !errors.Is(wrapped, sentinel) {
		t.Errorf("wrapped error does not unwrap to the original: %v", wrapped)
	}
	if want := "exit status 1: no server running"; wrapped.Error() != want {
		t.Errorf("wrapped error = %q, want %q", wrapped.Error(), want)
	}
}

// TestRun_WrapsTrimmedStderr proves a failing tmux invocation surfaces tmux's
// stderr diagnostic in the returned error (the text callers pattern-match on)
// while still unwrapping to the underlying *exec.ExitError via %w.
// kill-server against a never-started socket fails without birthing a server,
// so no cleanup is needed.
func TestRun_WrapsTrimmedStderr(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not in PATH")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err := Run(ctx, []string{"-L", testSocketName("runcore-err"), "kill-server"}, RunOpts{})
	if err == nil {
		t.Fatal("Run() on a dead socket: want error, got nil")
	}
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		t.Errorf("error does not unwrap to *exec.ExitError: %v", err)
	}
	// The exact diagnostic wording varies by tmux version ("no server
	// running…" / "error connecting to…"), so assert the shape instead: the
	// message is the exit error plus a non-empty trimmed-stderr suffix.
	prefix := exitErr.Error() + ": "
	if !strings.HasPrefix(err.Error(), prefix) || len(err.Error()) == len(prefix) {
		t.Errorf("error %q does not carry tmux's stderr diagnostic appended to %q", err, exitErr.Error())
	}
}

// TestRunOutput_ReturnsStdout proves stdout comes back on success (tmux -V
// needs no server).
func TestRunOutput_ReturnsStdout(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not in PATH")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	out, err := RunOutput(ctx, []string{"-V"}, RunOpts{})
	if err != nil {
		t.Fatalf("RunOutput(-V): %v", err)
	}
	if !strings.HasPrefix(string(out), "tmux") {
		t.Errorf("RunOutput(-V) = %q, want tmux version string", out)
	}
}

// TestRun_EnvAndDirOverrides proves RunOpts.Env and RunOpts.Dir reach the
// subprocess: a server birthed through Run records the override env in its
// global environment and the override dir as the session's start path.
func TestRun_EnvAndDirOverrides(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not in PATH")
	}
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	sock := testSocketName("runcore")
	dir := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	env := append(os.Environ(), "RK_RUNCORE_PROBE=probe42")
	if err := Run(ctx, []string{"-L", sock, "new-session", "-d", "-s", "runcore"}, RunOpts{Env: env, Dir: dir}); err != nil {
		t.Skipf("could not start isolated tmux server %q: %v", sock, err)
	}
	t.Cleanup(func() {
		killCtx, cancelKill := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelKill()
		_ = exec.CommandContext(killCtx, "tmux", "-L", sock, "kill-server").Run()
	})

	// Env: the server's global environment is seeded from the birthing
	// client's environment — the override marker must be visible.
	envOut, err := RunOutput(ctx, []string{"-L", sock, "show-environment", "-g", "RK_RUNCORE_PROBE"}, RunOpts{})
	if err != nil {
		t.Fatalf("show-environment: %v", err)
	}
	if !strings.Contains(string(envOut), "probe42") {
		t.Errorf("global env = %q, want RK_RUNCORE_PROBE=probe42 (RunOpts.Env not applied)", envOut)
	}

	// Dir: a session created with no -c records the client's cwd — the
	// override dir — as its session_path. Resolve symlinks on both sides
	// (tmux records the physical getcwd; TempDir may be symlinked).
	pathOut, err := RunOutput(ctx, []string{"-L", sock, "display-message", "-t", "=runcore:", "-p", "#{session_path}"}, RunOpts{})
	if err != nil {
		t.Fatalf("display-message session_path: %v", err)
	}
	got, err := filepath.EvalSymlinks(strings.TrimSpace(string(pathOut)))
	if err != nil {
		t.Fatalf("EvalSymlinks(session_path): %v", err)
	}
	want, err := filepath.EvalSymlinks(dir)
	if err != nil {
		t.Fatalf("EvalSymlinks(dir): %v", err)
	}
	if got != want {
		t.Errorf("session_path = %q, want %q (RunOpts.Dir not applied)", got, want)
	}
}
