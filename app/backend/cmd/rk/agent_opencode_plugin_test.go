package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// agent_opencode_plugin_test.go — executes the ACTUAL installed opencode
// plugin under node against synthetic root/child/resumed/unrelated event
// fixtures, with rk invocations captured by a shim. Proves the root-session
// rule end-to-end: child sessions (parentID set) and unresolvable sessions
// never reach the pane, resumed roots (no session.created) work, and the
// plugin no-ops outside tmux. Fully isolated: temp HOME, temp capture log, no
// tmux, no live agent.

// TestOpencodePluginExecutedRootChildFixtures drives the installed plugin.
func TestOpencodePluginExecutedRootChildFixtures(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not available — skipping plugin execution test")
	}
	home := t.TempDir()
	ac := registryEntry(t, home, "opencode")

	// The capture shim stands in for the rk binary: it logs argv and the stdin
	// payload per invocation.
	logPath := filepath.Join(t.TempDir(), "rk-calls.log")
	shim := filepath.Join(t.TempDir(), "rk-capture")
	shimBody := fmt.Sprintf("#!/bin/sh\n{ printf '%%s\\n' \"$*\"; cat; printf '\\n'; } >> %s\n", logPath)
	if err := os.WriteFile(shim, []byte(shimBody), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := validateHookPath(shim); err != nil {
		t.Fatalf("shim path must pass validateHookPath: %v", err)
	}
	applyYes(t, ac, shim, false)

	installed, err := os.ReadFile(ac.filePath)
	if err != nil {
		t.Fatal(err)
	}
	// node needs ESM markers to load the plugin's `export`: the installed .js
	// bytes are copied VERBATIM to a .mjs (a loader hint, not a content change —
	// opencode/Bun loads the .js as-is).
	workDir := t.TempDir()
	pluginMJS := filepath.Join(workDir, "plugin.mjs")
	if err := os.WriteFile(pluginMJS, installed, 0o644); err != nil {
		t.Fatal(err)
	}

	// The driver feeds the event fixtures through the real plugin with a mock
	// SDK client: ses_root/ses_resumed are parentless roots, ses_child has
	// parentID, ses_unknown fails the lookup.
	sessions := map[string]any{
		"ses_root":    map[string]any{},
		"ses_resumed": map[string]any{},
		"ses_child":   map[string]any{"parentID": "ses_root"},
	}
	events := []map[string]any{
		{"type": "session.created", "properties": map[string]any{"info": map[string]any{"id": "ses_root"}}},
		{"type": "session.status", "properties": map[string]any{"sessionID": "ses_root", "status": map[string]any{"type": "busy"}}},
		{"type": "session.created", "properties": map[string]any{"info": map[string]any{"id": "ses_child", "parentID": "ses_root"}}},
		{"type": "session.idle", "properties": map[string]any{"sessionID": "ses_child"}},
		{"type": "session.status", "properties": map[string]any{"sessionID": "ses_child", "status": map[string]any{"type": "busy"}}},
		// A resumed root fires no session.created — its first event must still work.
		{"type": "session.status", "properties": map[string]any{"sessionID": "ses_resumed", "status": map[string]any{"type": "busy"}}},
		{"type": "permission.updated", "properties": map[string]any{"sessionID": "ses_root"}},
		{"type": "session.idle", "properties": map[string]any{"sessionID": "ses_unknown"}},
		{"type": "session.idle", "properties": map[string]any{"sessionID": "ses_root"}},
	}
	sessionsJSON, _ := json.Marshal(sessions)
	eventsJSON, _ := json.Marshal(events)

	driver := `import { runKit } from "./plugin.mjs";
const sessions = JSON.parse(process.env.RK_SESSIONS_JSON);
const events = JSON.parse(process.env.RK_EVENTS_JSON);
const client = { session: { get: async ({ path }) => {
  const s = sessions[path.id];
  if (s === undefined) throw new Error("unknown session");
  return { data: s };
}}};
const hooks = await runKit({ client });
for (const event of events) { await hooks.event({ event }); }
`
	driverPath := filepath.Join(workDir, "driver.mjs")
	if err := os.WriteFile(driverPath, []byte(driver), 0o644); err != nil {
		t.Fatal(err)
	}

	runDriver := func(tmuxPane string) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", driverPath)
		cmd.Dir = workDir
		cmd.Env = []string{
			"PATH=" + os.Getenv("PATH"),
			"HOME=" + home,
			"RK_SESSIONS_JSON=" + string(sessionsJSON),
			"RK_EVENTS_JSON=" + string(eventsJSON),
		}
		if tmuxPane != "" {
			cmd.Env = append(cmd.Env, "TMUX_PANE="+tmuxPane)
		}
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("driver failed: %v\n%s", err, string(out))
		}
	}

	// Outside tmux the plugin must no-op entirely.
	runDriver("")
	if data, _ := os.ReadFile(logPath); len(data) != 0 {
		t.Fatalf("plugin fired outside tmux: %s", data)
	}

	runDriver("%999")
	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("capture log: %v", err)
	}
	log := string(data)

	// Exactly the root/resumed-root fires reach rk, in order: stamp, active
	// (root busy), active (resumed busy), waiting (root permission), idle
	// (root idle). Child and unknown sessions contribute NOTHING.
	var tokens []string
	for _, line := range strings.Split(strings.TrimSpace(log), "\n") {
		if strings.HasPrefix(line, "agent hook") {
			tokens = append(tokens, strings.Fields(line)[len(strings.Fields(line))-1])
		}
		if strings.Contains(line, "ses_child") || strings.Contains(line, "ses_unknown") {
			t.Errorf("child/unknown session reached rk: %s", line)
		}
	}
	want := []string{"stamp", "active", "active", "waiting", "idle"}
	if strings.Join(tokens, ",") != strings.Join(want, ",") {
		t.Errorf("rk invocation tokens = %v, want %v\nfull log:\n%s", tokens, want, log)
	}
	if !strings.Contains(log, `"session_id":"ses_root"`) || !strings.Contains(log, `"session_id":"ses_resumed"`) {
		t.Errorf("payloads must carry the root/resumed session ids, log:\n%s", log)
	}
}

// TestOpencodePluginLauncherFallback pins the two-path report end-to-end: with
// RK (the launcher) naming a MISSING binary, the spawn-level exec failure
// falls back to RK_FALLBACK and the report still lands; with BOTH paths
// missing the plugin must not throw (the never-fail contract — a hook error
// must never break the agent).
func TestOpencodePluginLauncherFallback(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not available — skipping plugin execution test")
	}
	home := t.TempDir()

	// The capture shim stands in for the rk binary (the RK_FALLBACK side).
	logPath := filepath.Join(t.TempDir(), "rk-calls.log")
	shim := filepath.Join(t.TempDir(), "rk-capture")
	shimBody := fmt.Sprintf("#!/bin/sh\n{ printf '%%s\\n' \"$*\"; cat; printf '\\n'; } >> %s\n", logPath)
	if err := os.WriteFile(shim, []byte(shimBody), 0o755); err != nil {
		t.Fatal(err)
	}
	missing := filepath.Join(t.TempDir(), "no-such-rk")

	// One root busy event through the real plugin.
	sessionsJSON := `{"ses_root":{}}`
	eventsJSON := `[{"type":"session.status","properties":{"sessionID":"ses_root","status":{"type":"busy"}}}]`
	driver := `import { runKit } from "./plugin.mjs";
const sessions = JSON.parse(process.env.RK_SESSIONS_JSON);
const events = JSON.parse(process.env.RK_EVENTS_JSON);
const client = { session: { get: async ({ path }) => {
  const s = sessions[path.id];
  if (s === undefined) throw new Error("unknown session");
  return { data: s };
}}};
const hooks = await runKit({ client });
for (const event of events) { await hooks.event({ event }); }
`

	workDir := t.TempDir()
	driverPath := filepath.Join(workDir, "driver.mjs")
	if err := os.WriteFile(driverPath, []byte(driver), 0o644); err != nil {
		t.Fatal(err)
	}
	pluginMJS := filepath.Join(workDir, "plugin.mjs")
	runDriver := func() {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", driverPath)
		cmd.Dir = workDir
		cmd.Env = []string{
			"PATH=" + os.Getenv("PATH"),
			"HOME=" + home,
			"TMUX_PANE=%42",
			"RK_SESSIONS_JSON=" + sessionsJSON,
			"RK_EVENTS_JSON=" + eventsJSON,
		}
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("driver failed (never-fail contract broken): %v\n%s", err, string(out))
		}
	}

	// Launcher missing → the fallback (shim) receives the report.
	if err := os.WriteFile(pluginMJS, []byte(opencodePluginFile(missing, shim)), 0o644); err != nil {
		t.Fatal(err)
	}
	runDriver()
	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("capture log: %v", err)
	}
	if !strings.Contains(string(data), "agent hook --agent opencode active") {
		t.Errorf("fallback did not reach RK_FALLBACK, log:\n%s", data)
	}

	// Both paths missing → no throw, no report.
	if err := os.WriteFile(pluginMJS, []byte(opencodePluginFile(missing, missing)), 0o644); err != nil {
		t.Fatal(err)
	}
	runDriver()
	data2, _ := os.ReadFile(logPath)
	if string(data2) != string(data) {
		t.Errorf("a both-missing report must be swallowed, log grew:\n%s", data2)
	}
}
