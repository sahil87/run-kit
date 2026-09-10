package main

import (
	"bytes"
	"sort"
	"strings"
	"testing"

	"rk/internal/mcp"
)

// TestMCPTableResolves is the drift guard against the real Cobra tree: every
// policy row's path and flags resolve (docs/specs/mcp.md § Policy table rules
// — a renamed or re-flagged verb fails the build, never the model). Also pins
// the ten seeded tool names, the timeout cap, and the never-tools exclusion.
func TestMCPTableResolves(t *testing.T) {
	resolved, err := mcp.Resolve(rootCmd, mcp.Table)
	if err != nil {
		t.Fatalf("Resolve(rootCmd, Table): %v", err)
	}
	var names []string
	for _, res := range resolved {
		names = append(names, res.Row.Tool)
		if res.Row.Timeout > mcp.ToolTimeoutCap {
			t.Errorf("row %q timeout %s exceeds the cap", res.Row.Tool, res.Row.Timeout)
		}
	}
	sort.Strings(names)
	want := []string{"capture", "cron_list", "gui_status", "panes", "process", "send", "sessions", "status", "tab_show", "tab_web_ls"}
	if strings.Join(names, ",") != strings.Join(want, ",") {
		t.Errorf("tool names = %v, want %v", names, want)
	}

	// The send description override carries the interim-receipt caveat (the
	// plan's named risk: `delivered` is submission verification, not the
	// agent acting).
	for _, res := range resolved {
		if res.Row.Tool == "send" {
			if desc := res.Row.Description; !strings.Contains(desc, "does NOT mean the agent has acted") {
				t.Errorf("send description missing the caveat: %q", desc)
			}
		}
	}
}

// TestMCPVisibleInHelpDump: `rk mcp` is a visible root verb, present in the
// help-dump tree (cli-layering.md § Root).
func TestMCPVisibleInHelpDump(t *testing.T) {
	if mcpCmd.Hidden {
		t.Error("mcpCmd must be visible")
	}
	tree := buildDump(rootCmd, "test")
	found := false
	for _, child := range tree.Root.Commands {
		if child.Name == "mcp" {
			found = true
			if child.Path != "run-kit mcp" {
				t.Errorf("mcp node path = %q", child.Path)
			}
		}
	}
	if !found {
		t.Error("help-dump tree missing the mcp node")
	}
}

// TestMCPHelpNamesConnectorCommand: `rk mcp --help` names the connector
// command a chat client is configured with.
func TestMCPHelpNamesConnectorCommand(t *testing.T) {
	buf := new(bytes.Buffer)
	rootCmd.SetOut(buf)
	rootCmd.SetErr(buf)
	rootCmd.SetArgs([]string{"mcp", "--help"})
	defer rootCmd.SetArgs(nil)
	if err := rootCmd.Execute(); err != nil {
		t.Fatalf("mcp --help: %v", err)
	}
	if !strings.Contains(buf.String(), "ssh <box> rk mcp") {
		t.Errorf("mcp --help does not name the connector command:\n%s", buf.String())
	}
}
