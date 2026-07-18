package main

import (
	"bytes"
	"testing"
)

// runURL drives urlCmd with isolated buffers and returns (stdout, stderr).
func runURL(t *testing.T) (string, string) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	urlCmd.SetOut(&stdout)
	urlCmd.SetErr(&stderr)
	t.Cleanup(func() {
		urlCmd.SetOut(nil)
		urlCmd.SetErr(nil)
	})
	if err := urlCmd.RunE(urlCmd, nil); err != nil {
		t.Fatalf("url RunE err = %v, want nil (exit 0)", err)
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

// TestURLDefault asserts the config default (no env) prints the loopback URL
// newline-terminated with empty stderr.
func TestURLDefault(t *testing.T) {
	t.Setenv("RK_HOST", "")
	t.Setenv("RK_PORT", "")

	stdout, stderr := runURL(t)

	if want := "http://127.0.0.1:3000\n"; stdout != want {
		t.Errorf("stdout = %q, want %q", stdout, want)
	}
	if stderr != "" {
		t.Errorf("url wrote to stderr: %q", stderr)
	}
}

// TestURLFromEnv asserts RK_HOST/RK_PORT drive the derivation, byte-equal to the
// retired context.go serverURL() (http://<host>:<port>).
func TestURLFromEnv(t *testing.T) {
	t.Setenv("RK_HOST", "10.0.0.1")
	t.Setenv("RK_PORT", "8080")

	stdout, stderr := runURL(t)

	if want := "http://10.0.0.1:8080\n"; stdout != want {
		t.Errorf("stdout = %q, want %q", stdout, want)
	}
	if stderr != "" {
		t.Errorf("url wrote to stderr: %q", stderr)
	}
}

// TestURLHelpStatesHeuristic pins the R6 contract: the Long text names the value
// a config-derived heuristic, not a liveness probe.
func TestURLHelpStatesHeuristic(t *testing.T) {
	long := urlCmd.Long
	for _, want := range []string{"config-derived", "not proof"} {
		if !bytes.Contains([]byte(long), []byte(want)) {
			t.Errorf("url Long text missing %q; got:\n%s", want, long)
		}
	}
}
