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

// claudeHooks builds the registry's Claude hook set for merge tests. It reads
// the real registry so the fixture can never drift from what agent-setup
// installs (the SessionStart stamp-only row included).
func claudeHooks() []agentHook {
	return agentRegistry("")[0].hooks
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

	mergeHooks(existing, claudeHooks(), "/opt/homebrew/bin/rk", "claude")

	// Non-hook config preserved.
	if existing["model"] != "opus" {
		t.Errorf("model config lost: %v", existing["model"])
	}
	// Six rk entries installed (one per hook: 5 agent-state + 1 SessionStart chat stamp).
	if got := countRkEntries(existing); got != 6 {
		t.Errorf("rk entries = %d, want 6", got)
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
	mergeHooks(settings, claudeHooks(), "/opt/homebrew/bin/rk", "claude")
	first, _ := json.Marshal(settings)

	// A second merge must not add duplicates and must produce identical output.
	mergeHooks(settings, claudeHooks(), "/opt/homebrew/bin/rk", "claude")
	second, _ := json.Marshal(settings)

	if string(first) != string(second) {
		t.Errorf("merge not idempotent:\nfirst:  %s\nsecond: %s", first, second)
	}
	if got := countRkEntries(settings); got != 6 {
		t.Errorf("rk entries after double-merge = %d, want 6 (no duplicates)", got)
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
	mergeHooks(settings, claudeHooks(), "/opt/homebrew/bin/rk", "claude")
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
	mergeHooks(settings, claudeHooks(), "/opt/homebrew/bin/rk", "claude")
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
	ac := agentConfig{name: "Test", settingsPath: path, comm: "claude", hooks: claudeHooks()}

	var out bytes.Buffer
	// Decline the confirmation.
	if err := applyAgentConfig(&out, bufio.NewReader(strings.NewReader("n\n")), ac, "/opt/homebrew/bin/rk", false); err != nil {
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
	ac := agentConfig{name: "Test", settingsPath: path, comm: "claude", hooks: claudeHooks()}

	var out bytes.Buffer
	if err := applyAgentConfig(&out, bufio.NewReader(strings.NewReader("y\n")), ac, "/opt/homebrew/bin/rk", false); err != nil {
		t.Fatalf("install error: %v", err)
	}
	written, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("settings file should exist after confirm: %v", err)
	}
	// The NEW-generation command no longer inlines @rk_agent_state — it delegates
	// to `rk agent-hook`, so the installed hooks are identified by that marker.
	if !strings.Contains(string(written), rkHookMarkerAgentHook) {
		t.Errorf("written settings missing new rk hook marker (%q): %s", rkHookMarkerAgentHook, written)
	}
	if strings.Contains(string(written), rkHookMarker) {
		t.Errorf("new-generation command should not contain the legacy %q marker: %s", rkHookMarker, written)
	}

	// Second install is a no-op: nothing to do, no prompt consumed.
	out.Reset()
	if err := applyAgentConfig(&out, bufio.NewReader(strings.NewReader("")), ac, "/opt/homebrew/bin/rk", false); err != nil {
		t.Fatalf("second install error: %v", err)
	}
	if !strings.Contains(out.String(), "nothing to do") {
		t.Errorf("re-install should report a no-op, got: %s", out.String())
	}

	// Uninstall with confirmation clears the rk entries.
	out.Reset()
	if err := applyAgentConfig(&out, bufio.NewReader(strings.NewReader("y\n")), ac, "", true); err != nil {
		t.Fatalf("uninstall error: %v", err)
	}
	after, _ := os.ReadFile(path)
	if strings.Contains(string(after), rkHookMarkerAgentHook) {
		t.Errorf("uninstall should remove rk hooks, still present: %s", after)
	}
}

func TestAgentStateHookCommandShape(t *testing.T) {
	cmd := agentStateHookCommand("/opt/homebrew/bin/rk", agentStateWaiting, "claude")
	// The NEW stable form: self-locate via $TMUX_PANE, no-op outside tmux, never
	// fail the agent, and DELEGATE to `rk agent-hook` (all logic — the walk, the
	// value formatting — lives in the binary, so it tracks `brew upgrade rk`).
	for _, want := range []string{
		`[ -n "$TMUX_PANE" ] || exit 0`,
		`"/opt/homebrew/bin/rk"`,      // absolute path, embedded quoted
		" agent-hook --agent claude ", // the delegating invocation
		"waiting",                     // the fixed state literal
		"2>/dev/null",
		"|| true",
	} {
		if !strings.Contains(cmd, want) {
			t.Errorf("hook command missing %q: %s", want, cmd)
		}
	}
	// The logic that MOVED into the binary must no longer appear in the hook body.
	for _, notWant := range []string{rkHookMarker, "set-option", "ps -o comm=", "date +%s"} {
		if strings.Contains(cmd, notWant) {
			t.Errorf("hook command should no longer inline %q (moved to the binary): %s", notWant, cmd)
		}
	}
}

// findRkCommands returns every rk-owned command string under the given event.
func findRkCommands(settings map[string]any, event string) []string {
	var out []string
	for _, e := range asSlice(asMap(settings["hooks"])[event]) {
		entry := asMap(e)
		if !isRkEntry(entry) {
			continue
		}
		for _, hv := range asSlice(entry["hooks"]) {
			if cmd, ok := asMap(hv)["command"].(string); ok {
				out = append(out, cmd)
			}
		}
	}
	return out
}

func TestSessionStartRegistryRowStampsChatOnly(t *testing.T) {
	// The registry must carry exactly one SessionStart row whose token is `stamp`.
	var sessionStart []agentHook
	for _, h := range agentRegistry("")[0].hooks {
		if h.event == "SessionStart" {
			sessionStart = append(sessionStart, h)
		}
	}
	if len(sessionStart) != 1 {
		t.Fatalf("registry SessionStart rows = %d, want 1", len(sessionStart))
	}
	if sessionStart[0].state != agentHookStampToken {
		t.Errorf("SessionStart token = %q, want %q (stamp-only)", sessionStart[0].state, agentHookStampToken)
	}
	if sessionStart[0].matcher != "" {
		t.Errorf("SessionStart matcher = %q, want empty (no matcher)", sessionStart[0].matcher)
	}
}

func TestMergeHooksInstallsSessionStartStampEntry(t *testing.T) {
	settings := map[string]any{}
	mergeHooks(settings, claudeHooks(), "/opt/homebrew/bin/rk", "claude")

	cmds := findRkCommands(settings, "SessionStart")
	if len(cmds) != 1 {
		t.Fatalf("SessionStart rk entries = %d, want 1", len(cmds))
	}
	cmd := cmds[0]
	// The installed command keeps the established wrapper shape and passes `stamp`.
	for _, want := range []string{
		`[ -n "$TMUX_PANE" ] || exit 0`,
		" agent-hook --agent claude stamp ",
		"2>/dev/null",
		"|| true",
	} {
		if !strings.Contains(cmd, want) {
			t.Errorf("SessionStart command missing %q: %s", want, cmd)
		}
	}

	// Idempotent re-run: still exactly one SessionStart entry.
	mergeHooks(settings, claudeHooks(), "/opt/homebrew/bin/rk", "claude")
	if got := len(findRkCommands(settings, "SessionStart")); got != 1 {
		t.Errorf("SessionStart rk entries after re-merge = %d, want 1 (idempotent)", got)
	}

	// Uninstall removes the SessionStart entry.
	unmergeHooks(settings)
	if got := len(findRkCommands(settings, "SessionStart")); got != 0 {
		t.Errorf("SessionStart rk entries after uninstall = %d, want 0", got)
	}
}

// legacyRkEntry builds an old-generation rk hook entry (the pre-indirection
// self-contained one-liner that inlined @rk_agent_state) for migration tests.
func legacyRkEntry(state string) map[string]any {
	legacyCmd := `sh -c '[ -n "$TMUX_PANE" ] || exit 0; p=$PPID; ` +
		`tmux set-option -pt "$TMUX_PANE" ` + rkHookMarker + ` "` + state + `:$(date +%s)" 2>/dev/null || true'`
	return map[string]any{
		"hooks": []any{map[string]any{"type": "command", "command": legacyCmd}},
	}
}

func TestIsRkEntryMatchesBothGenerations(t *testing.T) {
	// Legacy entry (inlines @rk_agent_state, no `agent-hook`).
	if !isRkEntry(legacyRkEntry("active")) {
		t.Error("legacy @rk_agent_state entry should be recognized as rk-owned")
	}
	// New entry (delegates to `rk agent-hook`, no @rk_agent_state).
	newEntry := rkHookEntry(agentHook{event: "Stop", state: agentStateIdle}, "/opt/homebrew/bin/rk", "claude")
	if !isRkEntry(newEntry) {
		t.Error("new agent-hook entry should be recognized as rk-owned")
	}
	// A non-rk entry carries neither marker and must be preserved.
	nonRk := map[string]any{
		"hooks": []any{map[string]any{"type": "command", "command": "/usr/local/bin/guard.sh"}},
	}
	if isRkEntry(nonRk) {
		t.Error("non-rk entry must not be recognized as rk-owned")
	}
}

func TestMergeHooksReplacesLegacyEntriesInPlace(t *testing.T) {
	// A settings file whose rk hooks are all OLD-generation, plus a non-rk hook.
	settings := map[string]any{
		"hooks": map[string]any{
			"UserPromptSubmit": []any{legacyRkEntry("active")},
			"Stop":             []any{legacyRkEntry("idle")},
			"PreToolUse": []any{
				map[string]any{
					"matcher": "Bash",
					"hooks":   []any{map[string]any{"type": "command", "command": "/usr/local/bin/guard.sh"}},
				},
				legacyRkEntry("active"),
			},
		},
	}

	mergeHooks(settings, claudeHooks(), "/opt/homebrew/bin/rk", "claude")

	// Exactly five rk entries — the legacy ones were REPLACED in place, not
	// duplicated alongside the new ones.
	if got := countRkEntries(settings); got != 6 {
		t.Errorf("rk entries after migrating a legacy file = %d, want 6 (replace, not duplicate)", got)
	}
	// No legacy-form command survives.
	root := asMap(settings["hooks"])
	for _, ev := range root {
		for _, e := range asSlice(ev) {
			for _, h := range asSlice(asMap(e)["hooks"]) {
				cmd, _ := asMap(h)["command"].(string)
				if strings.Contains(cmd, "set-option") {
					t.Errorf("a legacy inlined-set-option command survived migration: %s", cmd)
				}
			}
		}
	}
	// The non-rk Bash guard is preserved.
	preTool := asSlice(root["PreToolUse"])
	foundGuard := false
	for _, e := range preTool {
		for _, h := range asSlice(asMap(e)["hooks"]) {
			if cmd, _ := asMap(h)["command"].(string); strings.Contains(cmd, "guard.sh") {
				foundGuard = true
			}
		}
	}
	if !foundGuard {
		t.Error("non-rk guard was dropped during legacy migration")
	}
}

func TestUnmergeHooksRemovesBothGenerations(t *testing.T) {
	settings := map[string]any{
		"hooks": map[string]any{
			"UserPromptSubmit": []any{
				legacyRkEntry("active"),
				rkHookEntry(agentHook{event: "UserPromptSubmit", state: agentStateActive}, "/opt/homebrew/bin/rk", "claude"),
			},
			"PreToolUse": []any{
				map[string]any{
					"matcher": "Bash",
					"hooks":   []any{map[string]any{"type": "command", "command": "/usr/local/bin/guard.sh"}},
				},
			},
		},
	}

	unmergeHooks(settings)

	if got := countRkEntries(settings); got != 0 {
		t.Errorf("both generations should be removed, %d rk entries remain", got)
	}
	preTool := asSlice(asMap(settings["hooks"])["PreToolUse"])
	if len(preTool) != 1 {
		t.Fatalf("non-rk guard should survive, PreToolUse len = %d", len(preTool))
	}
}

func TestResolveRkPathIsAbsoluteAndNotSymlinkResolved(t *testing.T) {
	// resolveRkPath returns "" ONLY on total resolution failure (both
	// exec.LookPath and os.Executable fail); validateHookPath then fails the
	// install fast. A running test process always resolves via one branch or the
	// other, and (when it falls back to os.Executable) must NOT resolve symlinks —
	// resolving would pin the Cellar path and re-freeze the hook. We can't assert
	// the LookPath branch portably, but under a normal test run resolution
	// succeeds, so we assert a non-empty, absolute path is returned.
	got := resolveRkPath()
	if got == "" {
		t.Fatal("resolveRkPath returned empty; resolution should succeed in a test process")
	}
	if !filepath.IsAbs(got) {
		t.Fatalf("resolveRkPath returned non-absolute path %q; the hook needs an absolute path", got)
	}
}

// --- legacy rk-display skill cleanup ---------------------------------------------

// legacyMarkerSkill is an inline fixture standing in for a marker-owned
// rk-display SKILL.md left by an older run-kit. agent-setup no longer ships the
// skill literal, so cleanup tests seed the file directly rather than installing.
const legacyMarkerSkill = "---\nname: rk-display\ndescription: legacy\nmetadata:\n  " +
	skillManagedByMarker + "\n---\n# rk-display\n\nlegacy body\n"

func TestSkillHasMarker(t *testing.T) {
	// A marker-owned legacy file is recognized as rk-owned.
	if !skillHasMarker(legacyMarkerSkill) {
		t.Error("a marker-owned legacy skill should carry the managed-by marker")
	}
	// A file a user rewrote without the frontmatter marker is NOT rk-owned.
	rewritten := "---\nname: rk-display\ndescription: my own thing\n---\n# my skill\n"
	if skillHasMarker(rewritten) {
		t.Error("a marker-less user rewrite must not be recognized as rk-owned")
	}
	if skillHasMarker("") {
		t.Error("empty content must not be recognized as rk-owned")
	}
}

// seedLegacySkill writes the inline marker-owned legacy fixture to
// {skillsDir}/rk-display/SKILL.md and returns the skill dir + file paths.
func seedLegacySkill(t *testing.T, skillsDir, content string) (skillDir, skillPath string) {
	t.Helper()
	skillDir = filepath.Join(skillsDir, rkDisplaySkillDir)
	skillPath = filepath.Join(skillDir, rkDisplaySkillFile)
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(skillPath, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return skillDir, skillPath
}

func TestRemoveLegacySkill(t *testing.T) {
	t.Run("marker-owned file → directory removed on confirm", func(t *testing.T) {
		dir := t.TempDir()
		ac := agentConfig{name: "Test", skillsDir: dir}
		skillDir, skillPath := seedLegacySkill(t, dir, legacyMarkerSkill)

		var out bytes.Buffer
		if err := removeLegacySkill(&out, bufio.NewReader(strings.NewReader("y\n")), ac); err != nil {
			t.Fatalf("removeLegacySkill error: %v", err)
		}
		if _, err := os.Stat(skillDir); !os.IsNotExist(err) {
			t.Errorf("marker-owned skill directory should be removed, stat err = %v", err)
		}
		if _, err := os.Stat(skillPath); !os.IsNotExist(err) {
			t.Errorf("marker-owned SKILL.md should be removed with the directory, stat err = %v", err)
		}
		if !strings.Contains(out.String(), "removed") {
			t.Errorf("output should note the removal, got: %s", out.String())
		}
	})

	t.Run("marker-owned file → declined leaves it in place", func(t *testing.T) {
		dir := t.TempDir()
		ac := agentConfig{name: "Test", skillsDir: dir}
		_, skillPath := seedLegacySkill(t, dir, legacyMarkerSkill)

		var out bytes.Buffer
		if err := removeLegacySkill(&out, bufio.NewReader(strings.NewReader("n\n")), ac); err != nil {
			t.Fatalf("removeLegacySkill error: %v", err)
		}
		if _, err := os.Stat(skillPath); err != nil {
			t.Errorf("declining removal must leave the file, stat err = %v", err)
		}
		if !strings.Contains(out.String(), "left in place") {
			t.Errorf("output should note the decline, got: %s", out.String())
		}
	})

	t.Run("marker-less rewrite → untouched with skip note (no prompt)", func(t *testing.T) {
		dir := t.TempDir()
		ac := agentConfig{name: "Test", skillsDir: dir}
		rewritten := "---\nname: rk-display\n---\n# my own version\n"
		_, skillPath := seedLegacySkill(t, dir, rewritten)

		var out bytes.Buffer
		// Empty reader: a marker-less file must be skipped WITHOUT prompting.
		if err := removeLegacySkill(&out, bufio.NewReader(strings.NewReader("")), ac); err != nil {
			t.Fatalf("removeLegacySkill error: %v", err)
		}
		got, _ := os.ReadFile(skillPath)
		if string(got) != rewritten {
			t.Errorf("marker-less user file content changed: %s", got)
		}
		if !strings.Contains(out.String(), "leaving it untouched") {
			t.Errorf("output should note the marker-less skip, got: %s", out.String())
		}
	})

	t.Run("absent file → silent no-op", func(t *testing.T) {
		dir := t.TempDir()
		ac := agentConfig{name: "Test", skillsDir: dir}
		var out bytes.Buffer
		if err := removeLegacySkill(&out, bufio.NewReader(strings.NewReader("")), ac); err != nil {
			t.Fatalf("removeLegacySkill error: %v", err)
		}
		// A fresh machine must produce ZERO rk-display output — not even a
		// "nothing to do" line.
		if out.Len() != 0 {
			t.Errorf("absent legacy skill must be silent, got: %s", out.String())
		}
	})
}

// TestApplyAgentConfigCleansLegacySkillOnInstall proves the legacy cleanup runs
// on the INSTALL pass (not only --uninstall): re-running plain `rk agent-setup`
// is the documented upgrade action, so the cleanup must fire there.
func TestApplyAgentConfigCleansLegacySkillOnInstall(t *testing.T) {
	dir := t.TempDir()
	settingsPath := filepath.Join(dir, "settings.json")
	skillsDir := filepath.Join(dir, "skills")
	ac := agentConfig{name: "Test", settingsPath: settingsPath, comm: "claude", skillsDir: skillsDir, hooks: claudeHooks()}
	skillDir, _ := seedLegacySkill(t, skillsDir, legacyMarkerSkill)

	var out bytes.Buffer
	// First "y" confirms the hooks write; second "y" confirms the legacy removal.
	if err := applyAgentConfig(&out, bufio.NewReader(strings.NewReader("y\ny\n")), ac, "/opt/homebrew/bin/rk", false); err != nil {
		t.Fatalf("applyAgentConfig error: %v", err)
	}
	if _, err := os.Stat(skillDir); !os.IsNotExist(err) {
		t.Errorf("install-mode run should offer and perform legacy skill removal, stat err = %v", err)
	}
}

// TestApplyAgentConfigFreshMachineWritesNoSkill proves a fresh machine (no legacy
// skill) sees ZERO rk-display output and no skill file is ever created — the
// hooks-only reality.
func TestApplyAgentConfigFreshMachineWritesNoSkill(t *testing.T) {
	dir := t.TempDir()
	settingsPath := filepath.Join(dir, "settings.json")
	skillsDir := filepath.Join(dir, "skills")
	ac := agentConfig{name: "Test", settingsPath: settingsPath, comm: "claude", skillsDir: skillsDir, hooks: claudeHooks()}

	var out bytes.Buffer
	// Single "y" confirms the hooks write; no skill prompt should ever be reached.
	if err := applyAgentConfig(&out, bufio.NewReader(strings.NewReader("y\n")), ac, "/opt/homebrew/bin/rk", false); err != nil {
		t.Fatalf("applyAgentConfig error: %v", err)
	}
	if strings.Contains(out.String(), "rk-display") {
		t.Errorf("a fresh machine must print no rk-display output, got:\n%s", out.String())
	}
	if _, err := os.Stat(filepath.Join(skillsDir, rkDisplaySkillDir)); !os.IsNotExist(err) {
		t.Errorf("no rk-display directory should be created on a fresh machine")
	}
}

func TestApplyAgentConfigSkipsSkillWhenSkillsDirEmpty(t *testing.T) {
	dir := t.TempDir()
	settingsPath := filepath.Join(dir, "settings.json")
	// skillsDir empty → the skill artifact must be skipped entirely.
	ac := agentConfig{name: "NoSkills", settingsPath: settingsPath, comm: "codex", hooks: claudeHooks()}

	var out bytes.Buffer
	// Only the hooks artifact prompts; a single "y" confirms it. If a skill prompt
	// were reached, the empty tail of the reader would surface as a decline, not a
	// hang — so we also assert no skill output appears.
	if err := applyAgentConfig(&out, bufio.NewReader(strings.NewReader("y\n")), ac, "/opt/homebrew/bin/rk", false); err != nil {
		t.Fatalf("applyAgentConfig error: %v", err)
	}
	if strings.Contains(out.String(), "rk-display") {
		t.Errorf("empty skillsDir must skip the skill artifact entirely, got:\n%s", out.String())
	}
	// No rk-display directory was created under the temp dir.
	if _, err := os.Stat(filepath.Join(dir, ".claude", "skills", rkDisplaySkillDir)); !os.IsNotExist(err) {
		t.Errorf("no skill directory should be created for an empty skillsDir")
	}
}

func TestValidateHookPath(t *testing.T) {
	// A valid hook path must be a STABLE, PATH-independent absolute path with no
	// shell-active characters: the rk path is embedded double-quoted inside a
	// single-quoted sh -c string, so any of ' " $ ` \ would break out of or be
	// reinterpreted within that quoting, and a non-absolute path (incl. a bare
	// "rk") would reintroduce the PATH dependency the absolute path exists to
	// avoid. Install must REJECT all these (clear error over fragile escaping or a
	// silent PATH-dependent fallback).
	valid := []string{
		"/opt/homebrew/bin/rk",
		"/home/linuxbrew/.linuxbrew/bin/rk",
		"/path with spaces/rk", // spaces are fine inside double quotes
	}
	for _, p := range valid {
		if err := validateHookPath(p); err != nil {
			t.Errorf("validateHookPath(%q) = %v, want nil", p, err)
		}
	}
	invalid := []string{
		"",                   // total resolution failure — nothing to embed
		"rk",                 // bare name is PATH-dependent, not absolute
		"bin/rk",             // relative path is PATH/cwd-dependent, not absolute
		`/tmp/o'brien/rk`,    // ' terminates the outer single-quoted string
		`/tmp/say"cheese/rk`, // " terminates the double-quoted path
		`/tmp/$HOME/rk`,      // $ expands inside double quotes
		"/tmp/`id`/rk",       // backtick substitutes inside double quotes
		`/tmp/back\slash/rk`, // \ escapes inside double quotes
	}
	for _, p := range invalid {
		if err := validateHookPath(p); err == nil {
			t.Errorf("validateHookPath(%q) = nil, want error (invalid: empty, non-absolute, or shell-unsafe)", p)
		}
	}
}
