package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"testing"
	"time"

	"rk/internal/testutil"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// mcp_e2e_test.go — the MCP end-to-end proof: a REAL rk binary (go build into
// t.TempDir — the server child calls os.Executable() per tool, so the
// RK_RIFF_SUBPROC test-binary re-exec pattern cannot serve here) serving stdio
// MCP to a real SDK client (CommandTransport), against an isolated tmux server
// (rk-test-mcp-<pid>-<ns>, never a user server). Skips when tmux or go are
// absent. Asserts the tool list, annotations, schema shape, the instructions
// block, and the full sessions → send → capture loop plus the two negative
// classes (schema rejection, verb failure).

// TestMCPEndToEnd drives the whole proxy shape: policy table → Cobra-derived
// schema → argv exec → bare-JSON/text → MCP content.
func TestMCPEndToEnd(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available — skipping MCP e2e test")
	}
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("go not available — skipping MCP e2e test")
	}

	// Build the real binary. The tmux.conf embed input is generated (see
	// scripts/build.sh), so seed it the same way when absent — and remove a
	// seeded copy on cleanup so the test never leaves the working tree dirty.
	backendRoot := filepath.Join("..", "..")
	confPath := filepath.Join(backendRoot, "build", "tmux.conf")
	if _, err := os.Stat(confPath); os.IsNotExist(err) {
		src, err := os.ReadFile(filepath.Join("..", "..", "..", "configs", "tmux", "default.conf"))
		if err != nil {
			t.Fatalf("read canonical tmux.conf: %v", err)
		}
		if err := os.WriteFile(confPath, src, 0o644); err != nil {
			t.Fatalf("seed build/tmux.conf: %v", err)
		}
		t.Cleanup(func() { _ = os.Remove(confPath) })
	}
	bin := filepath.Join(t.TempDir(), "rk")
	buildCtx, buildCancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer buildCancel()
	if out, err := exec.CommandContext(buildCtx, "go", "build", "-o", bin, ".").CombinedOutput(); err != nil {
		t.Fatalf("go build: %v\n%s", err, string(out))
	}

	// Isolated tmux server with one shell session.
	server := fmt.Sprintf("rk-test-mcp-%d-%d", os.Getpid(), time.Now().UnixNano())
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if out, err := exec.CommandContext(ctx, "tmux", "-L", server, "new-session", "-d", "-s", "boot").CombinedOutput(); err != nil {
		t.Skipf("could not start isolated tmux server %q: %v\n%s", server, err, string(out))
	}
	t.Cleanup(func() {
		killCtx, cancelKill := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelKill()
		_ = exec.CommandContext(killCtx, "tmux", "-L", server, "kill-server").Run()
	})
	paneOut, err := exec.CommandContext(ctx, "tmux", "-L", server, "display-message", "-p", "#{pane_id}").CombinedOutput()
	if err != nil {
		t.Fatalf("display-message: %v\n%s", err, string(paneOut))
	}
	pane := strings.TrimSpace(string(paneOut))

	// Connect a real MCP client over the command transport, TMUX/TMUX_PANE
	// unset in the child (the stdio server has no pane of its own).
	serverCmd := exec.Command(bin, "mcp")
	env := make([]string, 0, len(os.Environ()))
	for _, kv := range os.Environ() {
		if strings.HasPrefix(kv, "TMUX=") || strings.HasPrefix(kv, "TMUX_PANE=") {
			continue
		}
		env = append(env, kv)
	}
	serverCmd.Env = env
	client := mcpsdk.NewClient(&mcpsdk.Implementation{Name: "rk-e2e"}, nil)
	connectCtx, connectCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer connectCancel()
	session, err := client.Connect(connectCtx, &mcpsdk.CommandTransport{Command: serverCmd}, nil)
	if err != nil {
		t.Fatalf("MCP connect: %v", err)
	}
	defer session.Close()

	// Instructions are the core skill bundle, verbatim.
	if got := session.InitializeResult().Instructions; got != string(skillBundle) {
		t.Errorf("instructions mismatch: got %d bytes, want the %d-byte skill bundle", len(got), len(skillBundle))
	}

	// ListTools: exactly the eleven seeded tools, with annotations and schemas.
	tools, err := session.ListTools(connectCtx, nil)
	if err != nil {
		t.Fatalf("ListTools: %v", err)
	}
	byName := map[string]*mcpsdk.Tool{}
	var names []string
	for _, tool := range tools.Tools {
		byName[tool.Name] = tool
		names = append(names, tool.Name)
	}
	sort.Strings(names)
	want := []string{"board", "capture", "cron_list", "gui_status", "panes", "process", "send", "sessions", "status", "tab_show", "tab_web_ls"}
	if strings.Join(names, ",") != strings.Join(want, ",") {
		t.Fatalf("tools = %v, want %v", names, want)
	}
	for _, banned := range []string{"kill", "serve", "mcp"} {
		if _, ok := byName[banned]; ok {
			t.Errorf("never-tool %q must not be listed", banned)
		}
	}
	for _, name := range []string{"sessions", "capture"} {
		ann := byName[name].Annotations
		if ann == nil || !ann.ReadOnlyHint {
			t.Errorf("%s must carry readOnlyHint:true", name)
		}
	}
	if ann := byName["send"].Annotations; ann != nil && ann.ReadOnlyHint {
		t.Error("send must not be read-only")
	}
	for name, tool := range byName {
		schema, ok := tool.InputSchema.(map[string]any)
		if !ok || schema["type"] != "object" {
			t.Errorf("%s inputSchema is not an object schema: %v", name, tool.InputSchema)
		}
	}
	captureSchema := byName["capture"].InputSchema.(map[string]any)
	captureProps := captureSchema["properties"].(map[string]any)
	if req, _ := captureSchema["required"].([]any); len(req) != 1 || req[0] != "target" {
		t.Errorf("capture required = %v, want [target]", captureSchema["required"])
	}
	lines := captureProps["lines"].(map[string]any)
	if lines["minimum"] != float64(1) || lines["maximum"] != float64(2000) {
		t.Errorf("capture lines bounds = %v", lines)
	}
	if !strings.Contains(byName["send"].Description, "does NOT mean the agent has acted") {
		t.Errorf("send description missing the interim-receipt caveat: %q", byName["send"].Description)
	}

	call := func(name string, args map[string]any) *mcpsdk.CallToolResult {
		t.Helper()
		callCtx, callCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer callCancel()
		res, err := session.CallTool(callCtx, &mcpsdk.CallToolParams{Name: name, Arguments: args})
		if err != nil {
			t.Fatalf("CallTool %s: %v", name, err)
		}
		return res
	}
	textOf := func(res *mcpsdk.CallToolResult) string {
		t.Helper()
		if len(res.Content) != 1 {
			t.Fatalf("content blocks = %d, want 1", len(res.Content))
		}
		tc, ok := res.Content[0].(*mcpsdk.TextContent)
		if !ok {
			t.Fatalf("content[0] is %T, want *TextContent", res.Content[0])
		}
		return tc.Text
	}

	// sessions: the isolated server's boot session appears in the bare JSON.
	res := call("sessions", map[string]any{"server": server})
	if res.IsError {
		t.Fatalf("sessions IsError: %s", textOf(res))
	}
	var sessionRows []map[string]any
	if err := json.Unmarshal([]byte(textOf(res)), &sessionRows); err != nil {
		t.Fatalf("sessions text is not a JSON array: %v\n%s", err, textOf(res))
	}
	foundBoot := false
	for _, row := range sessionRows {
		if row["name"] == "boot" {
			foundBoot = true
		}
	}
	if !foundBoot {
		t.Errorf("sessions rows = %v, want one named boot", sessionRows)
	}

	// send: an uninstrumented shell pane is unknown-state — the verb warns on
	// stderr and sends; the tool maps the report line as the text receipt.
	res = call("send", map[string]any{"server": server, "target": pane, "message": "echo MCP_E2E_OK"})
	if res.IsError {
		t.Fatalf("send IsError: %s", textOf(res))
	}
	if got := textOf(res); got != "delivered "+pane {
		t.Errorf("send receipt = %q, want %q", got, "delivered "+pane)
	}

	// capture: poll until the echo lands in the scrollback.
	var captured string
	ok := testutil.WaitUntil(t, 10*time.Second, func() bool {
		res := call("capture", map[string]any{"server": server, "target": pane, "lines": 50})
		if res.IsError {
			return false
		}
		captured = textOf(res)
		var doc map[string]any
		if err := json.Unmarshal([]byte(captured), &doc); err != nil {
			return false
		}
		content, _ := doc["content"].(string)
		return strings.Contains(content, "MCP_E2E_OK")
	})
	if !ok {
		t.Fatalf("capture never showed MCP_E2E_OK; last capture: %s", captured)
	}

	// Negative 1: the schema pattern rejects a bogus target before exec.
	res = call("capture", map[string]any{"server": server, "target": "bogus"})
	if !res.IsError || !strings.Contains(textOf(res), `"target"`) {
		t.Errorf("bogus target = IsError %v, text %q", res.IsError, textOf(res))
	}

	// Negative 2: a well-formed but nonexistent pane surfaces the verb's stderr.
	res = call("capture", map[string]any{"server": server, "target": "%999"})
	if !res.IsError {
		t.Error("nonexistent pane must be IsError")
	}
	if text := textOf(res); !strings.Contains(text, "operational") || !strings.Contains(text, "%999") {
		t.Errorf("nonexistent pane text = %q, want the verb's diagnostic", text)
	}

	// Close ends the server process — CommandTransport closes stdin, escalates
	// to SIGTERM, and reaps the child itself (a second Wait errors).
	if err := session.Close(); err != nil {
		t.Errorf("session Close: %v", err)
	}
	if serverCmd.Process != nil {
		testutil.MustWaitUntil(t, 10*time.Second, func() bool {
			return serverCmd.Process.Signal(syscall.Signal(0)) != nil
		}, "mcp server process %d still alive after Close", serverCmd.Process.Pid)
	}
}
