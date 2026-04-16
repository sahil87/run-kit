package main

import (
	"bytes"
	"strings"
	"testing"
)

// runContextOutsideTmux is a test helper that runs the context command with
// TMUX_PANE unset and returns the output string.
func runContextOutsideTmux(t *testing.T) string {
	t.Helper()
	t.Setenv("TMUX_PANE", "")

	buf := new(bytes.Buffer)
	contextCmd.SetOut(buf)
	contextCmd.SetErr(buf)
	t.Cleanup(func() {
		contextCmd.SetOut(nil)
		contextCmd.SetErr(nil)
	})

	err := contextCmd.RunE(contextCmd, nil)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	return buf.String()
}

func TestContextCommandRegistered(t *testing.T) {
	found := false
	for _, cmd := range rootCmd.Commands() {
		if cmd.Name() == "context" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected 'context' subcommand to be registered on rootCmd")
	}
}

func TestContextOutsideTmux(t *testing.T) {
	output := runContextOutsideTmux(t)

	if !strings.Contains(output, "(not in tmux)") {
		t.Error("expected '(not in tmux)' in output when TMUX_PANE is unset")
	}
	if !strings.Contains(output, "Server URL") {
		t.Error("expected 'Server URL' in output even outside tmux")
	}
	if !strings.Contains(output, "## Capabilities") {
		t.Error("expected '## Capabilities' section in output")
	}
	if !strings.Contains(output, "## Conventions") {
		t.Error("expected '## Conventions' section in output")
	}
}

func TestContextCapabilitiesSections(t *testing.T) {
	output := runContextOutsideTmux(t)

	// Terminal windows subsection.
	if !strings.Contains(output, "### Terminal Windows") {
		t.Error("expected 'Terminal Windows' subsection")
	}

	// Iframe windows subsection with exact tmux commands.
	if !strings.Contains(output, "### Iframe Windows") {
		t.Error("expected 'Iframe Windows' subsection")
	}
	if !strings.Contains(output, "tmux set-option -w @rk_type iframe") {
		t.Error("expected exact 'tmux set-option -w @rk_type iframe' command in output")
	}
	if !strings.Contains(output, "tmux set-option -w @rk_url") {
		t.Error("expected 'tmux set-option -w @rk_url' command in output")
	}

	// Proxy subsection.
	if !strings.Contains(output, "### Proxy") {
		t.Error("expected 'Proxy' subsection")
	}
	if !strings.Contains(output, "/proxy/{port}/") {
		t.Error("expected proxy URL pattern '/proxy/{port}/...' in output")
	}

	// CLI commands grouped by category.
	if !strings.Contains(output, "### CLI Commands") {
		t.Error("expected 'CLI Commands' subsection")
	}
	for _, category := range []string{"**Server**", "**Diagnostics**", "**Info**"} {
		if !strings.Contains(output, category) {
			t.Errorf("expected CLI command category %s in output", category)
		}
	}

	// All 6 subcommands listed.
	for _, cmd := range []string{"rk serve", "rk update", "rk doctor", "rk status", "rk context", "rk init-conf"} {
		if !strings.Contains(output, cmd) {
			t.Errorf("expected '%s' in CLI commands listing", cmd)
		}
	}
}

func TestContextConventionsSections(t *testing.T) {
	output := runContextOutsideTmux(t)

	if !strings.Contains(output, "@rk_type") {
		t.Error("expected '@rk_type' in conventions section")
	}
	if !strings.Contains(output, "@rk_url") {
		t.Error("expected '@rk_url' in conventions section")
	}
	if !strings.Contains(output, "Window Lifecycle") {
		t.Error("expected 'Window Lifecycle' in conventions section")
	}
	if !strings.Contains(output, "SSE") {
		t.Error("expected SSE reactivity note in conventions section")
	}
}

func TestContextServerURLFromEnv(t *testing.T) {
	t.Setenv("TMUX_PANE", "")
	t.Setenv("RK_HOST", "10.0.0.1")
	t.Setenv("RK_PORT", "8080")

	buf := new(bytes.Buffer)
	contextCmd.SetOut(buf)
	contextCmd.SetErr(buf)
	t.Cleanup(func() {
		contextCmd.SetOut(nil)
		contextCmd.SetErr(nil)
	})

	err := contextCmd.RunE(contextCmd, nil)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}

	output := buf.String()
	if !strings.Contains(output, "http://10.0.0.1:8080") {
		t.Errorf("expected server URL 'http://10.0.0.1:8080' in output, got:\n%s", output)
	}
}

func TestContextExitsZero(t *testing.T) {
	output := runContextOutsideTmux(t)
	if output == "" {
		t.Error("expected non-empty output")
	}
}
