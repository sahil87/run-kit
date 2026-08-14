package main

import (
	"bytes"
	"testing"
)

// runURL drives `rk url` through the real cobra Execute() seam — not urlCmd.RunE
// directly — so the NoArgs validator and cobra's stdout-data / stderr-diagnostic
// paths are exercised exactly as they are in production (exit 0 on success).
// Buffers are attached to the shared rootCmd (children inherit its out/err), and
// root flag/arg state is reset first so a prior test's Execute() cannot bleed in.
func runURL(t *testing.T) (string, string) {
	t.Helper()
	resetRootFlagState(t)
	var stdout, stderr bytes.Buffer
	rootCmd.SetOut(&stdout)
	rootCmd.SetErr(&stderr)
	rootCmd.SetArgs([]string{"url"})
	t.Cleanup(func() {
		rootCmd.SetOut(nil)
		rootCmd.SetErr(nil)
		rootCmd.SetArgs(nil)
	})
	if err := rootCmd.Execute(); err != nil {
		t.Fatalf("url Execute err = %v, want nil (exit 0)", err)
	}
	return stdout.String(), stderr.String()
}

func TestURLCommandRegistered(t *testing.T) {
	found := false
	for _, cmd := range rootCmd.Commands() {
		if cmd.Name() == "url" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected 'url' subcommand to be registered on rootCmd")
	}
}

// TestURLDefault asserts the config default (no env, no covering @rk_origin)
// prints the loopback URL newline-terminated with empty stderr.
func TestURLDefault(t *testing.T) {
	t.Setenv("RK_HOST", "")
	t.Setenv("RK_PORT", "")
	// Outside any pane and no stamp: falls through to the default.
	stubOriginSeams(t, "", "", nil)

	stdout, stderr := runURL(t)

	if want := "http://127.0.0.1:3000\n"; stdout != want {
		t.Errorf("stdout = %q, want %q", stdout, want)
	}
	if stderr != "" {
		t.Errorf("url wrote to stderr: %q", stderr)
	}
}

// TestURLFromEnv asserts RK_HOST/RK_PORT drive the derivation (env wins over
// the tmux option rung), byte-equal to the retired context.go serverURL()
// (http://<host>:<port>).
func TestURLFromEnv(t *testing.T) {
	t.Setenv("RK_HOST", "10.0.0.1")
	t.Setenv("RK_PORT", "8080")
	// A pane WITH a stamped option must still lose to explicit env.
	stubOriginSeams(t, originTestSocket+",1234,0", "http://127.0.0.1:3001\n", nil)

	stdout, stderr := runURL(t)

	if want := "http://10.0.0.1:8080\n"; stdout != want {
		t.Errorf("stdout = %q, want %q", stdout, want)
	}
	if stderr != "" {
		t.Errorf("url wrote to stderr: %q", stderr)
	}
}

// TestURLFromTmuxOption asserts a pane in a covered server (no explicit env)
// prints the daemon-stamped @rk_origin instead of the 3000 default.
func TestURLFromTmuxOption(t *testing.T) {
	t.Setenv("RK_HOST", "")
	t.Setenv("RK_PORT", "")
	stubOriginSeams(t, originTestSocket+",1234,0", "http://127.0.0.1:3001\n", nil)

	stdout, stderr := runURL(t)

	if want := "http://127.0.0.1:3001\n"; stdout != want {
		t.Errorf("stdout = %q, want %q", stdout, want)
	}
	if stderr != "" {
		t.Errorf("url wrote to stderr: %q", stderr)
	}
}

// TestURLHelpStatesHeuristic pins the help contract: the Long text names the
// value a heuristic (not a liveness probe) and documents the
// env → @rk_origin → default precedence rung.
func TestURLHelpStatesHeuristic(t *testing.T) {
	long := urlCmd.Long
	for _, want := range []string{"heuristic", "not proof", "@rk_origin"} {
		if !bytes.Contains([]byte(long), []byte(want)) {
			t.Errorf("url Long text missing %q; got:\n%s", want, long)
		}
	}
}
