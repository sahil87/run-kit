package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// claudeHooks builds the registry's Claude hook set for merge tests.
func claudeHooks() []agentHook {
	return []agentHook{
		{event: "UserPromptSubmit", state: agentStateActive},
		{event: "PreToolUse", state: agentStateActive},
		{event: "Notification", matcher: "permission_prompt|elicitation_dialog|agent_needs_input", state: agentStateWaiting},
		{event: "Notification", matcher: "idle_prompt", state: agentStateIdle},
		{event: "Stop", state: agentStateIdle},
	}
}

// countRkEntries counts rk-owned entries across all event arrays under hooks.
func countRkEntries(settings map[string]any) int {
	n := 0
	root := asMap(settings["hooks"])
	for _, ev := range root {
		for _, e := range asSlice(ev) {
			if isRkEntry(asMap(e)) {
				n++
			}
		}
	}
	return n
}

func TestMergeHooksAddsEntriesAndPreservesExisting(t *testing.T) {
	// A pre-existing, unrelated PreToolUse hook must survive the merge.
	existing := map[string]any{
		"model": "opus",
		"hooks": map[string]any{
			"PreToolUse": []any{
				map[string]any{
					"matcher": "Bash",
					"hooks": []any{
						map[string]any{"type": "command", "command": "/usr/local/bin/guard.sh"},
					},
				},
			},
		},
	}

	mergeHooks(existing, claudeHooks())

	// Non-hook config preserved.
	if existing["model"] != "opus" {
		t.Errorf("model config lost: %v", existing["model"])
	}
	// Five rk entries installed (one per hook).
	if got := countRkEntries(existing); got != 5 {
		t.Errorf("rk entries = %d, want 5", got)
	}
	// The pre-existing Bash guard must still be present.
	preTool := asSlice(asMap(existing["hooks"])["PreToolUse"])
	foundGuard := false
	for _, e := range preTool {
		for _, h := range asSlice(asMap(e)["hooks"]) {
			if cmd, _ := asMap(h)["command"].(string); strings.Contains(cmd, "guard.sh") {
				foundGuard = true
			}
		}
	}
	if !foundGuard {
		t.Error("pre-existing non-rk PreToolUse hook was dropped")
	}
	// PreToolUse should now have 2 entries: the guard + the rk entry.
	if len(preTool) != 2 {
		t.Errorf("PreToolUse entries = %d, want 2 (guard + rk)", len(preTool))
	}
}

func TestMergeHooksIdempotent(t *testing.T) {
	settings := map[string]any{}
	mergeHooks(settings, claudeHooks())
	first, _ := json.Marshal(settings)

	// A second merge must not add duplicates and must produce identical output.
	mergeHooks(settings, claudeHooks())
	second, _ := json.Marshal(settings)

	if string(first) != string(second) {
		t.Errorf("merge not idempotent:\nfirst:  %s\nsecond: %s", first, second)
	}
	if got := countRkEntries(settings); got != 5 {
		t.Errorf("rk entries after double-merge = %d, want 5 (no duplicates)", got)
	}
}

func TestUnmergeHooksRemovesOnlyRkEntries(t *testing.T) {
	settings := map[string]any{
		"hooks": map[string]any{
			"PreToolUse": []any{
				map[string]any{
					"matcher": "Bash",
					"hooks":   []any{map[string]any{"type": "command", "command": "/usr/local/bin/guard.sh"}},
				},
			},
		},
	}
	mergeHooks(settings, claudeHooks())
	unmergeHooks(settings)

	if got := countRkEntries(settings); got != 0 {
		t.Errorf("rk entries after uninstall = %d, want 0", got)
	}
	// The non-rk guard must remain, and its event key must survive.
	preTool := asSlice(asMap(settings["hooks"])["PreToolUse"])
	if len(preTool) != 1 {
		t.Fatalf("PreToolUse entries after uninstall = %d, want 1 (the guard)", len(preTool))
	}
	if cmd, _ := asMap(asSlice(asMap(preTool[0])["hooks"])[0])["command"].(string); !strings.Contains(cmd, "guard.sh") {
		t.Errorf("surviving PreToolUse entry is not the guard: %q", cmd)
	}
}

func TestUnmergeHooksDropsEmptyEventAndRoot(t *testing.T) {
	// When rk owns the ONLY entries, uninstall must remove empty event arrays and
	// the now-empty hooks object entirely.
	settings := map[string]any{}
	mergeHooks(settings, claudeHooks())
	unmergeHooks(settings)

	if _, ok := settings["hooks"]; ok {
		t.Errorf("empty hooks object should be removed, got %v", settings["hooks"])
	}
}

func TestReadSettingsTolerant(t *testing.T) {
	dir := t.TempDir()

	t.Run("missing file → empty object", func(t *testing.T) {
		m, err := readSettings(filepath.Join(dir, "nope.json"))
		if err != nil {
			t.Fatalf("missing file should not error: %v", err)
		}
		if len(m) != 0 {
			t.Errorf("missing file should yield empty map, got %v", m)
		}
	})

	t.Run("empty file → empty object", func(t *testing.T) {
		p := filepath.Join(dir, "empty.json")
		if err := os.WriteFile(p, []byte("   \n"), 0o600); err != nil {
			t.Fatal(err)
		}
		m, err := readSettings(p)
		if err != nil || len(m) != 0 {
			t.Errorf("empty file should yield empty map, got (%v, %v)", m, err)
		}
	})

	t.Run("corrupt file → error", func(t *testing.T) {
		p := filepath.Join(dir, "corrupt.json")
		if err := os.WriteFile(p, []byte("{not json"), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := readSettings(p); err == nil {
			t.Error("corrupt file should surface an error, not silently clobber")
		}
	})
}

func TestConfirmGate(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"y\n", true},
		{"Y\n", true},
		{"yes\n", true},
		{"YES\n", true},
		{"n\n", false},
		{"\n", false},
		{"nope\n", false},
		{"", false},
	}
	for _, c := range cases {
		got := confirm(bufio.NewReader(strings.NewReader(c.in)))
		if got != c.want {
			t.Errorf("confirm(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestApplyAgentConfigDeclineDoesNotWrite(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	ac := agentConfig{name: "Test", settingsPath: path, hooks: claudeHooks()}

	var out bytes.Buffer
	// Decline the confirmation.
	if err := applyAgentConfig(&out, bufio.NewReader(strings.NewReader("n\n")), ac, false); err != nil {
		t.Fatalf("applyAgentConfig error: %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("declining must not create the settings file; stat err = %v", err)
	}
	if !strings.Contains(out.String(), "skipped") {
		t.Errorf("output should note the skip, got: %s", out.String())
	}
}

func TestApplyAgentConfigConfirmWritesAndIsIdempotent(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	ac := agentConfig{name: "Test", settingsPath: path, hooks: claudeHooks()}

	var out bytes.Buffer
	if err := applyAgentConfig(&out, bufio.NewReader(strings.NewReader("y\n")), ac, false); err != nil {
		t.Fatalf("install error: %v", err)
	}
	written, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("settings file should exist after confirm: %v", err)
	}
	if !strings.Contains(string(written), rkHookMarker) {
		t.Errorf("written settings missing rk hook marker: %s", written)
	}

	// Second install is a no-op: nothing to do, no prompt consumed.
	out.Reset()
	if err := applyAgentConfig(&out, bufio.NewReader(strings.NewReader("")), ac, false); err != nil {
		t.Fatalf("second install error: %v", err)
	}
	if !strings.Contains(out.String(), "nothing to do") {
		t.Errorf("re-install should report a no-op, got: %s", out.String())
	}

	// Uninstall with confirmation clears the rk entries.
	out.Reset()
	if err := applyAgentConfig(&out, bufio.NewReader(strings.NewReader("y\n")), ac, true); err != nil {
		t.Fatalf("uninstall error: %v", err)
	}
	after, _ := os.ReadFile(path)
	if strings.Contains(string(after), rkHookMarker) {
		t.Errorf("uninstall should remove rk hooks, still present: %s", after)
	}
}

func TestAgentStateHookCommandShape(t *testing.T) {
	cmd := agentStateHookCommand(agentStateWaiting)
	// Must self-locate via $TMUX_PANE, no-op outside tmux, never fail the agent,
	// carry the marker + state, and write the epoch + agent-pid segments (the
	// pid — $PPID = the hook shell's parent, i.e. the agent — feeds the
	// PID-liveness reconciler).
	for _, want := range []string{`[ -n "$TMUX_PANE" ] || exit 0`, rkHookMarker, "waiting:", "date +%s", `:$PPID"`, "|| true"} {
		if !strings.Contains(cmd, want) {
			t.Errorf("hook command missing %q: %s", want, cmd)
		}
	}
}
