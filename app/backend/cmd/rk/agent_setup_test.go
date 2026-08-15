package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// claudeHooks builds the registry's Claude hook set for merge tests. It reads
// the real registry so the fixture can never drift from what agent-setup
// installs (the SessionStart stamp-only row included).
func claudeHooks() []agentHook {
	return agentRegistry("")[0].hooks
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
	// Decline the confirmation (interactive TTY session simulated by feeding "n").
	if err := applyAgentConfig(newSinkWriters(&out, &out), bufio.NewReader(strings.NewReader("n\n")), ac, "/opt/homebrew/bin/rk", false, consent{stdinIsTTY: true}); err != nil {
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
	if err := applyAgentConfig(newSinkWriters(&out, &out), bufio.NewReader(strings.NewReader("y\n")), ac, "/opt/homebrew/bin/rk", false, consent{stdinIsTTY: true}); err != nil {
		t.Fatalf("install error: %v", err)
	}
	written, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("settings file should exist after confirm: %v", err)
	}
	// The NEW-generation command no longer inlines @rk_agent_state — it delegates
	// to `rk agent hook`, so the installed hooks are identified by that marker.
	if !strings.Contains(string(written), rkHookMarkerAgentHookFamily) {
		t.Errorf("written settings missing new rk hook marker (%q): %s", rkHookMarkerAgentHookFamily, written)
	}
	if strings.Contains(string(written), rkHookMarker) {
		t.Errorf("new-generation command should not contain the legacy %q marker: %s", rkHookMarker, written)
	}
	if strings.Contains(string(written), rkHookMarkerAgentHook) {
		t.Errorf("third-generation command should not contain the second-generation %q marker: %s", rkHookMarkerAgentHook, written)
	}

	// Second install is a no-op: nothing to do, no prompt consumed.
	out.Reset()
	if err := applyAgentConfig(newSinkWriters(&out, &out), bufio.NewReader(strings.NewReader("")), ac, "/opt/homebrew/bin/rk", false, consent{stdinIsTTY: true}); err != nil {
		t.Fatalf("second install error: %v", err)
	}
	if !strings.Contains(out.String(), "nothing to do") {
		t.Errorf("re-install should report a no-op, got: %s", out.String())
	}

	// Uninstall with confirmation clears the rk entries.
	out.Reset()
	if err := applyAgentConfig(newSinkWriters(&out, &out), bufio.NewReader(strings.NewReader("y\n")), ac, "", true, consent{stdinIsTTY: true}); err != nil {
		t.Fatalf("uninstall error: %v", err)
	}
	after, err := readSettings(path)
	if err != nil {
		t.Fatalf("read settings after uninstall: %v", err)
	}
	if got := countRkEntries(after); got != 0 {
		t.Errorf("uninstall should remove rk hooks, %d remain: %v", got, after)
	}
}

// TestApplyAgentConfigYesWritesWithoutPrompt pins Principle 1: --yes lets an
// agent consent non-interactively. The write happens with EOF stdin (no prompt
// answer available), which under the interactive path would have declined.
func TestApplyAgentConfigYesWritesWithoutPrompt(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	ac := agentConfig{name: "Test", settingsPath: path, comm: "claude", hooks: claudeHooks()}

	var out bytes.Buffer
	// Empty (EOF) stdin — the interactive path declines on EOF; --yes overrides.
	if err := applyAgentConfig(newSinkWriters(&out, &out), bufio.NewReader(strings.NewReader("")), ac, "/opt/homebrew/bin/rk", false, consent{yes: true}); err != nil {
		t.Fatalf("applyAgentConfig --yes error: %v", err)
	}
	written, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("--yes must write the settings file without prompting: %v", err)
	}
	if !strings.Contains(string(written), rkHookMarkerAgentHookFamily) {
		t.Errorf("written settings missing rk hook marker: %s", written)
	}
	if strings.Contains(out.String(), "skipped") {
		t.Errorf("--yes should not report a skip, got: %s", out.String())
	}
}

// TestApplyAgentConfigDryRunNeverWrites pins Principle 5: --dry-run shows the
// diff and writes nothing, needing no consent (EOF stdin) — and it wins even
// when --yes is also set (a preview must never mutate).
func TestApplyAgentConfigDryRunNeverWrites(t *testing.T) {
	for _, cons := range []consent{{dryRun: true}, {dryRun: true, yes: true}} {
		dir := t.TempDir()
		path := filepath.Join(dir, "settings.json")
		ac := agentConfig{name: "Test", settingsPath: path, comm: "claude", hooks: claudeHooks()}

		var out bytes.Buffer
		if err := applyAgentConfig(newSinkWriters(&out, &out), bufio.NewReader(strings.NewReader("")), ac, "/opt/homebrew/bin/rk", false, cons); err != nil {
			t.Fatalf("applyAgentConfig dry-run error (cons=%+v): %v", cons, err)
		}
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Errorf("dry-run (cons=%+v) must not create the settings file; stat err = %v", cons, err)
		}
		// The diff is still rendered (header present) so the operator/agent sees
		// what WOULD change.
		if !strings.Contains(out.String(), "will install run-kit agent-state hooks") {
			t.Errorf("dry-run should still render the diff, got: %s", out.String())
		}
		if !strings.Contains(out.String(), "dry run") {
			t.Errorf("dry-run should note the no-write, got: %s", out.String())
		}
	}
}

// TestApplyAgentConfigNonTTYNoFlagRefuses pins Principle 1's non-TTY clause: a
// pending write with neither --yes nor --dry-run and a non-TTY stdin (the test
// default) MUST refuse with an error naming --yes, exit non-zero (surfaced as a
// returned error), and leave the settings file byte-unchanged — never a
// success-looking silent no-op, and never a hang on a prompt no one answers.
func TestApplyAgentConfigNonTTYNoFlagRefuses(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	ac := agentConfig{name: "Test", settingsPath: path, comm: "claude", hooks: claudeHooks()}

	var out bytes.Buffer
	// consent{} → no flags, stdinIsTTY false (the non-TTY default). A write is
	// pending (fresh machine), so authorizeWrite must refuse.
	err := applyAgentConfig(newSinkWriters(&out, &out), bufio.NewReader(strings.NewReader("")), ac, "/opt/homebrew/bin/rk", false, consent{})
	if err == nil {
		t.Fatal("non-TTY no-flag run must refuse with an error, got nil")
	}
	if !strings.Contains(err.Error(), "--yes") {
		t.Errorf("refusal error must name --yes, got: %v", err)
	}
	// Nothing written — the settings file must not exist.
	if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
		t.Errorf("refusal must not create the settings file; stat err = %v", statErr)
	}
	// No "skipped"/"wrote" success line — the refusal is an error, not a no-op.
	if strings.Contains(out.String(), "wrote") {
		t.Errorf("refusal must not report a write, got: %s", out.String())
	}
}

// TestRemoveLegacySkillConsentVariants pins the two missing removeLegacySkill
// consent paths: --yes authorizes the os.RemoveAll of a marker-owned legacy
// rk-display directory (no prompt), and --dry-run leaves it in place (needs no
// consent, mutates nothing).
func TestRemoveLegacySkillConsentVariants(t *testing.T) {
	t.Run("--yes removes the marker-owned directory without prompting", func(t *testing.T) {
		dir := t.TempDir()
		ac := agentConfig{name: "Test", skillsDir: dir}
		skillDir, _ := seedLegacySkill(t, dir, legacyMarkerSkill)

		var out bytes.Buffer
		// EOF stdin — the interactive path would decline; --yes authorizes.
		if err := removeLegacySkill(newSinkWriters(&out, &out), bufio.NewReader(strings.NewReader("")), ac, consent{yes: true}); err != nil {
			t.Fatalf("removeLegacySkill --yes error: %v", err)
		}
		if _, err := os.Stat(skillDir); !os.IsNotExist(err) {
			t.Errorf("--yes must remove the marker-owned directory, stat err = %v", err)
		}
		if !strings.Contains(out.String(), "removed") {
			t.Errorf("output should note the removal, got: %s", out.String())
		}
	})

	t.Run("--dry-run leaves the marker-owned directory in place", func(t *testing.T) {
		dir := t.TempDir()
		ac := agentConfig{name: "Test", skillsDir: dir}
		skillDir, skillPath := seedLegacySkill(t, dir, legacyMarkerSkill)

		var out bytes.Buffer
		if err := removeLegacySkill(newSinkWriters(&out, &out), bufio.NewReader(strings.NewReader("")), ac, consent{dryRun: true}); err != nil {
			t.Fatalf("removeLegacySkill --dry-run error: %v", err)
		}
		if _, err := os.Stat(skillDir); err != nil {
			t.Errorf("--dry-run must leave the directory in place, stat err = %v", err)
		}
		if _, err := os.Stat(skillPath); err != nil {
			t.Errorf("--dry-run must leave the SKILL.md in place, stat err = %v", err)
		}
		if !strings.Contains(out.String(), "dry run") {
			t.Errorf("--dry-run should note the no-op, got: %s", out.String())
		}
	})
}

// TestIsTerminalRejectsNonTTYFiles pins the TTY-detection fix: a char-device
// check alone (os.ModeCharDevice) treats /dev/null as a terminal, which would
// make the Principle 1 non-TTY refusal silently not fire for `agent-setup
// </dev/null` — the exact non-interactive shape an agent uses. term.IsTerminal
// (a TCGETS ioctl) correctly classifies /dev/null and a pipe as NOT a terminal.
func TestIsTerminalRejectsNonTTYFiles(t *testing.T) {
	// /dev/null is a character device but not a terminal.
	devNull, err := os.Open(os.DevNull)
	if err != nil {
		t.Fatalf("open %s: %v", os.DevNull, err)
	}
	defer devNull.Close()
	if isTerminal(devNull) {
		t.Errorf("isTerminal(%s) = true, want false (a char device is not a terminal)", os.DevNull)
	}

	// A pipe (os.Pipe) is not a terminal.
	pr, pw, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	defer pr.Close()
	defer pw.Close()
	if isTerminal(pr) {
		t.Error("isTerminal(pipe reader) = true, want false")
	}

	// A non-*os.File reader (e.g. a test's strings.Reader) is not a terminal.
	if isTerminal(strings.NewReader("")) {
		t.Error("isTerminal(strings.Reader) = true, want false")
	}
}

func TestAgentStateHookCommandShape(t *testing.T) {
	cmd := agentStateHookCommand("/opt/homebrew/bin/rk", agentStateWaiting, "claude")
	// The NEW stable form: self-locate via $TMUX_PANE, no-op outside tmux, never
	// fail the agent, and DELEGATE to `rk agent hook` (all logic — the walk, the
	// value formatting — lives in the binary, so it tracks `brew upgrade rk`).
	// The interpreter must be absolute: hooks fire under the harness's
	// environment, and a bare `sh` fails on sessions whose PATH lacks /bin.
	if !strings.HasPrefix(cmd, `/bin/sh -c '`) {
		t.Errorf("hook command must start with /bin/sh -c: %s", cmd)
	}
	for _, want := range []string{
		`[ -n "$TMUX_PANE" ] || exit 0`,
		`"/opt/homebrew/bin/rk"`,     // absolute path, embedded quoted
		" agent hook --agent claude", // the delegating invocation (family form)
		"waiting",                    // the fixed state literal
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
		" agent hook --agent claude stamp ",
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

// gen2RkEntry builds a second-generation rk hook entry (the delegating one-liner
// invoking the old root form `agent-hook`, as installed before the `rk agent`
// family existed) for migration tests.
func gen2RkEntry(state string) map[string]any {
	gen2Cmd := `/bin/sh -c '[ -n "$TMUX_PANE" ] || exit 0; ` +
		`"/opt/homebrew/bin/rk" agent-hook --agent claude ` + state + ` 2>/dev/null || true'`
	return map[string]any{
		"hooks": []any{map[string]any{"type": "command", "command": gen2Cmd}},
	}
}

func TestIsRkEntryMatchesAllGenerations(t *testing.T) {
	// Gen-1 entry (inlines @rk_agent_state, no delegation).
	if !isRkEntry(legacyRkEntry("active")) {
		t.Error("legacy @rk_agent_state entry should be recognized as rk-owned")
	}
	// Gen-2 entry (delegates to the old root form `rk agent-hook`).
	if !isRkEntry(gen2RkEntry("active")) {
		t.Error("second-generation `agent-hook` entry should be recognized as rk-owned")
	}
	// Gen-3 entry (delegates to `rk agent hook`, no @rk_agent_state).
	newEntry := rkHookEntry(agentHook{event: "Stop", state: agentStateIdle}, "/opt/homebrew/bin/rk", "claude")
	if !isRkEntry(newEntry) {
		t.Error("new `agent hook` entry should be recognized as rk-owned")
	}
	// A non-rk entry carries no marker and must be preserved.
	nonRk := map[string]any{
		"hooks": []any{map[string]any{"type": "command", "command": "/usr/local/bin/guard.sh"}},
	}
	if isRkEntry(nonRk) {
		t.Error("non-rk entry must not be recognized as rk-owned")
	}
}

func TestMergeHooksReplacesOlderGenerationsInPlace(t *testing.T) {
	// A settings file whose rk hooks are all OLDER-generation (gen-1 inlined and
	// gen-2 `agent-hook`), plus a non-rk hook.
	settings := map[string]any{
		"hooks": map[string]any{
			"UserPromptSubmit": []any{legacyRkEntry("active")},
			"Stop":             []any{gen2RkEntry("idle")},
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

	// Exactly six rk entries — the older ones were REPLACED in place, not
	// duplicated alongside the new ones.
	if got := countRkEntries(settings); got != 6 {
		t.Errorf("rk entries after migrating an old-generation file = %d, want 6 (replace, not duplicate)", got)
	}
	// No gen-1 (inlined set-option) or gen-2 (`agent-hook`) command survives; the
	// surviving rk entries carry the gen-3 family form.
	root := asMap(settings["hooks"])
	foundFamily := false
	for _, ev := range root {
		for _, e := range asSlice(ev) {
			for _, h := range asSlice(asMap(e)["hooks"]) {
				cmd, _ := asMap(h)["command"].(string)
				if strings.Contains(cmd, "set-option") {
					t.Errorf("a legacy inlined-set-option command survived migration: %s", cmd)
				}
				if strings.Contains(cmd, rkHookMarkerAgentHook) {
					t.Errorf("a second-generation `agent-hook` command survived migration: %s", cmd)
				}
				if strings.Contains(cmd, rkHookMarkerAgentHookFamily) {
					foundFamily = true
				}
			}
		}
	}
	if !foundFamily {
		t.Error("no third-generation `agent hook` command present after migration")
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

func TestUnmergeHooksRemovesAllGenerations(t *testing.T) {
	settings := map[string]any{
		"hooks": map[string]any{
			"UserPromptSubmit": []any{
				legacyRkEntry("active"),
				gen2RkEntry("active"),
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
		t.Errorf("all generations should be removed, %d rk entries remain", got)
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
		if err := removeLegacySkill(newSinkWriters(&out, &out), bufio.NewReader(strings.NewReader("y\n")), ac, consent{stdinIsTTY: true}); err != nil {
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
		if err := removeLegacySkill(newSinkWriters(&out, &out), bufio.NewReader(strings.NewReader("n\n")), ac, consent{stdinIsTTY: true}); err != nil {
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
		if err := removeLegacySkill(newSinkWriters(&out, &out), bufio.NewReader(strings.NewReader("")), ac, consent{}); err != nil {
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
		if err := removeLegacySkill(newSinkWriters(&out, &out), bufio.NewReader(strings.NewReader("")), ac, consent{}); err != nil {
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
	if err := applyAgentConfig(newSinkWriters(&out, &out), bufio.NewReader(strings.NewReader("y\ny\n")), ac, "/opt/homebrew/bin/rk", false, consent{stdinIsTTY: true}); err != nil {
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
	if err := applyAgentConfig(newSinkWriters(&out, &out), bufio.NewReader(strings.NewReader("y\n")), ac, "/opt/homebrew/bin/rk", false, consent{stdinIsTTY: true}); err != nil {
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
	if err := applyAgentConfig(newSinkWriters(&out, &out), bufio.NewReader(strings.NewReader("y\n")), ac, "/opt/homebrew/bin/rk", false, consent{stdinIsTTY: true}); err != nil {
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

// --- quiet-gating (Toolkit Principle 9) --------------------------------------

// TestAgentSetup_SplitChannels pins R5's convention: informational status lines
// go to the sink's chatter channel while the settings diff and the interactive
// prompt go to the data channel. With separate buffers, a written install shows
// the "wrote" status on chatter and the diff header on data.
func TestAgentSetup_SplitChannels(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	ac := agentConfig{name: "Test", settingsPath: path, comm: "claude", hooks: claudeHooks()}

	var data, chatter bytes.Buffer
	sink := newSinkWriters(&data, &chatter)
	if err := applyAgentHooks(sink, bufio.NewReader(strings.NewReader("y\n")), ac, "/opt/homebrew/bin/rk", false, consent{stdinIsTTY: true}); err != nil {
		t.Fatalf("applyAgentHooks error: %v", err)
	}

	// The diff header is data — never gated.
	if !strings.Contains(data.String(), "will install run-kit agent-state hooks") {
		t.Errorf("diff header must be on the data channel, got data: %q", data.String())
	}
	// The "wrote" status line is chatter.
	if !strings.Contains(chatter.String(), "wrote") {
		t.Errorf("the wrote status line must be on the chatter channel, got chatter: %q", chatter.String())
	}
	if strings.Contains(data.String(), "wrote") {
		t.Errorf("status line leaked onto the data channel, got data: %q", data.String())
	}
}

// TestAgentSetup_QuietDropsStatusKeepsDiff pins R5: under --quiet (chatter →
// io.Discard) the status lines vanish but the --dry-run diff (requested data)
// survives on the data channel.
func TestAgentSetup_QuietDropsStatusKeepsDiff(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	ac := agentConfig{name: "Test", settingsPath: path, comm: "claude", hooks: claudeHooks()}

	var data bytes.Buffer
	// A quiet sink: data survives, chatter is discarded (what newSink builds when
	// --quiet is set).
	sink := newSinkWriters(&data, io.Discard)
	if err := applyAgentHooks(sink, bufio.NewReader(strings.NewReader("")), ac, "/opt/homebrew/bin/rk", false, consent{dryRun: true}); err != nil {
		t.Fatalf("applyAgentHooks --dry-run error: %v", err)
	}

	// The dry-run diff is requested data — survives --quiet.
	if !strings.Contains(data.String(), "will install run-kit agent-state hooks") {
		t.Errorf("--dry-run diff must survive --quiet on the data channel, got data: %q", data.String())
	}
	// Nothing written (dry-run).
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("dry-run must not write the settings file; stat err = %v", err)
	}
}

// TestAgentSetup_QuietYesSilentOnSuccess pins R5's net-effect clause: a
// --yes --quiet install with a PENDING write is fully silent on success — BOTH
// channels empty. Under --yes the diff is narration of an already-authorized
// action, so it routes to chatter (quiet-gated → discarded); the status line is
// chatter too. Success is verified by the settings file being written, not by
// any output. (This replaces the earlier assertion that only checked the data
// channel for the absent status line while accepting the diff on data — the
// review found that leaked the full diff to stdout, so --yes --quiet was NOT
// silent. The diff now routes per consent mode; see consent.diffWriter.)
func TestAgentSetup_QuietYesSilentOnSuccess(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	ac := agentConfig{name: "Test", settingsPath: path, comm: "claude", hooks: claudeHooks()}

	var data, chatter bytes.Buffer
	// A quiet --yes sink: data is a real buffer (must stay empty), chatter is
	// discarded (what newSink builds when --quiet is set). We buffer chatter here
	// only to prove the diff+status were ROUTED to it (and thus dropped under real
	// --quiet), not to the data channel.
	sink := newSinkWriters(&data, &chatter)
	if err := applyAgentHooks(sink, bufio.NewReader(strings.NewReader("")), ac, "/opt/homebrew/bin/rk", false, consent{yes: true}); err != nil {
		t.Fatalf("applyAgentHooks --yes error: %v", err)
	}
	// The write happened — success is proven by the file, not by output.
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("--yes must write the settings file: %v", err)
	}
	// The data channel must be EMPTY: under --yes the diff is narration (chatter),
	// not requested data. Nothing survives --quiet on stdout — fully silent success.
	if data.Len() != 0 {
		t.Errorf("--yes --quiet must be fully silent on the data channel, got data: %q", data.String())
	}
	// The diff and status DID route to chatter (which real --quiet discards), so a
	// non-quiet --yes still shows them on stderr.
	if !strings.Contains(chatter.String(), "will install run-kit agent-state hooks") {
		t.Errorf("the diff must route to chatter under --yes, got chatter: %q", chatter.String())
	}
	if !strings.Contains(chatter.String(), "wrote") {
		t.Errorf("the wrote status line must route to chatter, got chatter: %q", chatter.String())
	}
}

// TestAgentSetup_YesNonQuietShowsDiffOnStderr pins the other half of the
// per-consent-mode diff routing: `--yes` WITHOUT --quiet still shows the diff, on
// the chatter channel (stderr in production). The data channel stays empty — the
// diff is narration of an authorized action, not machine-consumable data.
func TestAgentSetup_YesNonQuietShowsDiffOnStderr(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	ac := agentConfig{name: "Test", settingsPath: path, comm: "claude", hooks: claudeHooks()}

	var data, chatter bytes.Buffer
	// Non-quiet: chatter is a live buffer (would be os.Stderr in production).
	sink := newSinkWriters(&data, &chatter)
	if err := applyAgentHooks(sink, bufio.NewReader(strings.NewReader("")), ac, "/opt/homebrew/bin/rk", false, consent{yes: true}); err != nil {
		t.Fatalf("applyAgentHooks --yes error: %v", err)
	}
	// The diff renders on stderr (chatter) so a non-quiet --yes is not silent.
	if !strings.Contains(chatter.String(), "will install run-kit agent-state hooks") {
		t.Errorf("--yes non-quiet must show the diff on stderr, got chatter: %q", chatter.String())
	}
	// The data channel is empty — the diff is not on stdout under --yes.
	if data.Len() != 0 {
		t.Errorf("--yes must not put the diff on the data channel, got data: %q", data.String())
	}
}

// TestAgentSetup_InteractiveDryRunDiffOnData pins that the diff STILL routes to
// the data channel on the paths R5 forbids gating — the interactive [y/N] prompt
// and --dry-run — so consent.diffWriter's per-mode split did not over-rotate the
// non-yes paths onto chatter.
func TestAgentSetup_InteractiveDryRunDiffOnData(t *testing.T) {
	t.Run("interactive prompt → diff on data", func(t *testing.T) {
		dir := t.TempDir()
		path := filepath.Join(dir, "settings.json")
		ac := agentConfig{name: "Test", settingsPath: path, comm: "claude", hooks: claudeHooks()}

		var data, chatter bytes.Buffer
		// Decline ("n") on a simulated TTY so nothing is written; the diff must
		// still have rendered on the data channel to inform the [y/N] decision.
		if err := applyAgentHooks(newSinkWriters(&data, &chatter), bufio.NewReader(strings.NewReader("n\n")), ac, "/opt/homebrew/bin/rk", false, consent{stdinIsTTY: true}); err != nil {
			t.Fatalf("applyAgentHooks interactive error: %v", err)
		}
		if !strings.Contains(data.String(), "will install run-kit agent-state hooks") {
			t.Errorf("interactive diff must be on the data channel, got data: %q", data.String())
		}
	})

	t.Run("--dry-run → diff on data", func(t *testing.T) {
		dir := t.TempDir()
		path := filepath.Join(dir, "settings.json")
		ac := agentConfig{name: "Test", settingsPath: path, comm: "claude", hooks: claudeHooks()}

		var data, chatter bytes.Buffer
		if err := applyAgentHooks(newSinkWriters(&data, &chatter), bufio.NewReader(strings.NewReader("")), ac, "/opt/homebrew/bin/rk", false, consent{dryRun: true}); err != nil {
			t.Fatalf("applyAgentHooks --dry-run error: %v", err)
		}
		if !strings.Contains(data.String(), "will install run-kit agent-state hooks") {
			t.Errorf("--dry-run diff must be on the data channel (requested output), got data: %q", data.String())
		}
	})
}

// TestAgentSetup_QuietRefusalSurvives pins R5's error clause: the non-TTY
// refusal (an error naming --yes) is not gated by --quiet — it surfaces as a
// returned error and nothing is written.
func TestAgentSetup_QuietRefusalSurvives(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	ac := agentConfig{name: "Test", settingsPath: path, comm: "claude", hooks: claudeHooks()}

	var data bytes.Buffer
	sink := newSinkWriters(&data, io.Discard)
	// consent{} → no flags, non-TTY: a pending write must refuse with an error.
	err := applyAgentHooks(sink, bufio.NewReader(strings.NewReader("")), ac, "/opt/homebrew/bin/rk", false, consent{})
	if err == nil {
		t.Fatal("non-TTY no-flag run must refuse with an error even under --quiet, got nil")
	}
	if !strings.Contains(err.Error(), "--yes") {
		t.Errorf("refusal error must name --yes, got: %v", err)
	}
	if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
		t.Errorf("refusal must not create the settings file; stat err = %v", statErr)
	}
}

// TestAgentSetup_QuietFlagWiredThroughRoot proves the production seam: invoking
// via rootCmd.Execute() with `agent-setup --dry-run --quiet` resolves the
// persistent --quiet flag so newSink discards chatter, while the dry-run diff
// (data) still reaches stdout. Uses --dry-run so nothing is written to the real
// ~/.claude/settings.json. It also pins the deprecation-alias contract: the old
// root form still runs (the diff renders) AND prints a one-line pointer naming
// `rk agent setup`, while the family form stays warning-free.
func TestAgentSetup_QuietFlagWiredThroughRoot(t *testing.T) {
	// Hermetic: point HOME at a temp dir so the run never reads the invoking
	// user's real ~/.claude/settings.json or scans their real skills dir
	// (os.UserHomeDir reads $HOME on Unix). --dry-run writes nothing regardless;
	// this isolates the READ side too.
	t.Setenv("HOME", t.TempDir())

	var stdout, stderr bytes.Buffer
	rootCmd.SetOut(&stdout)
	rootCmd.SetErr(&stderr)
	rootCmd.SetArgs([]string{"agent-setup", "--dry-run", "--quiet"})
	t.Cleanup(func() {
		rootCmd.SetOut(nil)
		rootCmd.SetErr(nil)
		rootCmd.SetArgs(nil)
		_ = rootCmd.PersistentFlags().Set("quiet", "false")
		quiet = false
		_ = agentSetupAliasCmd.Flags().Set("dry-run", "false")
	})

	if err := rootCmd.Execute(); err != nil {
		t.Fatalf("agent-setup --dry-run --quiet via rootCmd.Execute() error: %v", err)
	}
	// The dry-run diff is data — survives --quiet on stdout.
	if !strings.Contains(stdout.String(), "run-kit agent-state hooks") {
		t.Errorf("--dry-run --quiet must still render the diff on stdout, got stdout: %q", stdout.String())
	}
	// The alias still runs (above) AND warns once, pointing at the new form.
	// Cobra emits the deprecation via OutOrStderr — stderr in production, the
	// SetOut buffer here.
	if got := stdout.String() + stderr.String(); !strings.Contains(got, `Command "agent-setup" is deprecated, use `+"`rk agent setup`") {
		t.Errorf("the deprecated alias must print a pointer naming `rk agent setup`, got stdout: %q stderr: %q", stdout.String(), stderr.String())
	}
	if !agentSetupAliasCmd.Hidden {
		t.Error("the agent-setup alias must be hidden from help and the help-dump")
	}
}

// TestAgentSetupFamilyMemberNoDeprecation pins the other half of the alias
// contract: the family form `rk agent setup` is the canonical spelling and must
// NOT carry any deprecation warning.
func TestAgentSetupFamilyMemberNoDeprecation(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	var stdout, stderr bytes.Buffer
	rootCmd.SetOut(&stdout)
	rootCmd.SetErr(&stderr)
	rootCmd.SetArgs([]string{"agent", "setup", "--dry-run"})
	t.Cleanup(func() {
		rootCmd.SetOut(nil)
		rootCmd.SetErr(nil)
		rootCmd.SetArgs(nil)
		_ = agentSetupFamilyCmd.Flags().Set("dry-run", "false")
	})

	if err := rootCmd.Execute(); err != nil {
		t.Fatalf("agent setup --dry-run via rootCmd.Execute() error: %v", err)
	}
	if !strings.Contains(stdout.String(), "run-kit agent-state hooks") {
		t.Errorf("agent setup --dry-run must render the diff, got stdout: %q", stdout.String())
	}
	if got := stdout.String() + stderr.String(); strings.Contains(got, "deprecated") {
		t.Errorf("the family form must not print a deprecation warning, got stdout: %q stderr: %q", stdout.String(), stderr.String())
	}
}

// --- tmux guard shim artifact ---------------------------------------------------

// NOTE (tmux safety): every tmux-shim test operates on t.TempDir() homes only —
// no test ever writes the invoking user's real startup files or shim dir, and
// no tmux server is started, attached to, or killed.

// installShim runs the install pass of applyTmuxShim into a temp home with
// non-interactive consent, failing the test on error.
func installShim(t *testing.T, home, rkPath string) {
	t.Helper()
	var out bytes.Buffer
	sink := newSinkWriters(&out, &out)
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("")), home, "", rkPath, false, consent{yes: true}); err != nil {
		t.Fatalf("applyTmuxShim install error: %v", err)
	}
}

func readFileOrEmpty(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return ""
		}
		t.Fatal(err)
	}
	return string(data)
}

func TestTmuxShimFreshInstall(t *testing.T) {
	home := t.TempDir()
	installShim(t, home, "/opt/homebrew/bin/rk")

	// Shim file: present, executable, marker-owned, exec'ing `mux guard` via the
	// absolute rk path (second-generation form).
	shim := readFileOrEmpty(t, tmuxShimPath(home))
	if !strings.Contains(shim, tmuxShimMarker) {
		t.Errorf("shim missing ownership marker: %q", shim)
	}
	if !strings.Contains(shim, `exec "/opt/homebrew/bin/rk" mux guard "$@"`) {
		t.Errorf("shim missing the mux guard exec line: %q", shim)
	}
	info, err := os.Stat(tmuxShimPath(home))
	if err != nil {
		t.Fatalf("stat shim: %v", err)
	}
	if info.Mode().Perm()&0o111 == 0 {
		t.Errorf("shim is not executable: %v", info.Mode())
	}

	// PATH block: in .zshenv and .bashrc; .bash_profile NOT created.
	for _, name := range []string{".zshenv", ".bashrc"} {
		content := readFileOrEmpty(t, filepath.Join(home, name))
		if !strings.Contains(content, tmuxGuardBlockBegin) || !strings.Contains(content, tmuxGuardBlockEnd) {
			t.Errorf("%s missing the marker-owned PATH block: %q", name, content)
		}
		if !strings.Contains(content, `.local/share/rk/shims`) {
			t.Errorf("%s block does not prepend the shims dir: %q", name, content)
		}
	}
	if _, err := os.Stat(filepath.Join(home, ".bash_profile")); !os.IsNotExist(err) {
		t.Errorf(".bash_profile must not be created by the install; stat err = %v", err)
	}
}

func TestTmuxShimInstallIntoExistingBashProfile(t *testing.T) {
	home := t.TempDir()
	profile := filepath.Join(home, ".bash_profile")
	if err := os.WriteFile(profile, []byte("# mine\nsource ~/.bashrc\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	installShim(t, home, "/opt/homebrew/bin/rk")

	content := readFileOrEmpty(t, profile)
	if !strings.Contains(content, "# mine") || !strings.Contains(content, "source ~/.bashrc") {
		t.Errorf("existing .bash_profile content lost: %q", content)
	}
	if !strings.Contains(content, tmuxGuardBlockBegin) {
		t.Errorf("existing .bash_profile did not receive the PATH block: %q", content)
	}
}

func TestTmuxShimIdempotentReinstall(t *testing.T) {
	home := t.TempDir()
	installShim(t, home, "/opt/homebrew/bin/rk")
	files := []string{tmuxShimPath(home), filepath.Join(home, ".zshenv"), filepath.Join(home, ".bashrc")}
	first := make([]string, len(files))
	for i, f := range files {
		first[i] = readFileOrEmpty(t, f)
	}

	// Second run must be a no-op: byte-identical files, "nothing to do" notes,
	// and no prompt (consent{} would refuse if a write were pending).
	var out bytes.Buffer
	sink := newSinkWriters(&out, &out)
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("")), home, "", "/opt/homebrew/bin/rk", false, consent{}); err != nil {
		t.Fatalf("idempotent re-run must not need consent, got: %v", err)
	}
	if !strings.Contains(out.String(), "nothing to do") {
		t.Errorf("re-run should report nothing to do, got: %q", out.String())
	}
	for i, f := range files {
		if got := readFileOrEmpty(t, f); got != first[i] {
			t.Errorf("%s changed on idempotent re-run:\nfirst:  %q\nsecond: %q", f, first[i], got)
		}
	}
}

// TestTmuxShimReinstallRepairsLostExecBit pins the cycle-2 should-fix: an
// rk-owned shim whose exec bit was stripped (a stray chmod 0644) is content-
// current, but the old content-only comparison reported "nothing to do" while
// the PATH block kept fronting a non-executable shim — every tmux call died
// "Permission denied". A re-install must repair the bit (chmod 0755) on the
// already-current path, without a consent prompt (it is rk's own artifact) and
// without touching the content.
func TestTmuxShimReinstallRepairsLostExecBit(t *testing.T) {
	home := t.TempDir()
	installShim(t, home, "/opt/homebrew/bin/rk")
	shimPath := tmuxShimPath(home)
	content := readFileOrEmpty(t, shimPath)
	if err := os.Chmod(shimPath, 0o644); err != nil {
		t.Fatal(err)
	}

	// consent{} is non-TTY with no flags: it would refuse if a write prompt
	// were pending, so passing proves the repair needs no consent.
	var out bytes.Buffer
	sink := newSinkWriters(&out, &out)
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("")), home, "", "/opt/homebrew/bin/rk", false, consent{}); err != nil {
		t.Fatalf("re-install over a chmod-0644 shim must not error, got: %v", err)
	}
	info, err := os.Stat(shimPath)
	if err != nil {
		t.Fatalf("stat shim: %v", err)
	}
	if info.Mode().Perm() != 0o755 {
		t.Errorf("exec bit not repaired: mode = %v, want 0755", info.Mode().Perm())
	}
	if got := readFileOrEmpty(t, shimPath); got != content {
		t.Errorf("repair must not touch the shim content:\nbefore: %q\nafter:  %q", content, got)
	}
	if !strings.Contains(out.String(), "exec bit") {
		t.Errorf("expected an exec-bit repair note, got: %q", out.String())
	}

	// Dry run over the same broken state previews the repair without chmodding.
	if err := os.Chmod(shimPath, 0o644); err != nil {
		t.Fatal(err)
	}
	out.Reset()
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("")), home, "", "/opt/homebrew/bin/rk", false, consent{dryRun: true}); err != nil {
		t.Fatalf("dry run over a chmod-0644 shim must not error, got: %v", err)
	}
	info, err = os.Stat(shimPath)
	if err != nil {
		t.Fatalf("stat shim: %v", err)
	}
	if info.Mode().Perm() != 0o644 {
		t.Errorf("dry run must not chmod: mode = %v, want 0644", info.Mode().Perm())
	}
	if !strings.Contains(out.String(), "would chmod") {
		t.Errorf("dry run should preview the chmod, got: %q", out.String())
	}
}

func TestTmuxShimReplacesEditedBlockInPlace(t *testing.T) {
	home := t.TempDir()
	installShim(t, home, "/opt/homebrew/bin/rk")

	// Corrupt the block body and surround it with user content.
	zshenv := filepath.Join(home, ".zshenv")
	content := "export EDITOR=vim\n" + tmuxGuardBlockBegin + "\n# hand-edited\n" + tmuxGuardBlockEnd + "\n" + "alias ll='ls -l'\n"
	if err := os.WriteFile(zshenv, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	installShim(t, home, "/opt/homebrew/bin/rk")
	got := readFileOrEmpty(t, zshenv)
	if strings.Contains(got, "# hand-edited") {
		t.Errorf("edited block body must be replaced, got: %q", got)
	}
	if !strings.Contains(got, "export EDITOR=vim") || !strings.Contains(got, "alias ll='ls -l'") {
		t.Errorf("user content around the block must survive, got: %q", got)
	}
	if n := strings.Count(got, tmuxGuardBlockBegin); n != 1 {
		t.Errorf("block must appear exactly once, got %d in %q", n, got)
	}
}

func TestTmuxShimMarkerlessFileUntouched(t *testing.T) {
	home := t.TempDir()
	shimPath := tmuxShimPath(home)
	if err := os.MkdirAll(filepath.Dir(shimPath), 0o755); err != nil {
		t.Fatal(err)
	}
	userShim := "#!/bin/sh\n# my own wrapper\nexec /usr/bin/tmux \"$@\"\n"
	if err := os.WriteFile(shimPath, []byte(userShim), 0o755); err != nil {
		t.Fatal(err)
	}

	var out bytes.Buffer
	sink := newSinkWriters(&out, &out)
	// Install: marker-less shim must be left untouched (no consent needed for a skip).
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("")), home, "", "/opt/homebrew/bin/rk", false, consent{yes: true}); err != nil {
		t.Fatalf("install over marker-less shim error: %v", err)
	}
	if got := readFileOrEmpty(t, shimPath); got != userShim {
		t.Errorf("marker-less shim was overwritten: %q", got)
	}
	if !strings.Contains(out.String(), "leaving it untouched") {
		t.Errorf("expected a skip note, got: %q", out.String())
	}
	// must-fix #3: the PATH block must not be wired in front of a foreign file.
	for _, name := range []string{".zshenv", ".bashrc"} {
		if _, statErr := os.Stat(filepath.Join(home, name)); !os.IsNotExist(statErr) {
			t.Errorf("PATH block must not be installed over a foreign shim; %s exists (stat err = %v)", name, statErr)
		}
	}

	// Uninstall: marker-less shim must survive too.
	out.Reset()
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("")), home, "", "", true, consent{yes: true}); err != nil {
		t.Fatalf("uninstall over marker-less shim error: %v", err)
	}
	if got := readFileOrEmpty(t, shimPath); got != userShim {
		t.Errorf("marker-less shim was removed/overwritten on uninstall: %q", got)
	}
}

func TestTmuxShimUninstallRemovesExactly(t *testing.T) {
	home := t.TempDir()
	// Pre-existing user content in a startup file.
	zshenv := filepath.Join(home, ".zshenv")
	if err := os.WriteFile(zshenv, []byte("export EDITOR=vim\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	installShim(t, home, "/opt/homebrew/bin/rk")

	var out bytes.Buffer
	sink := newSinkWriters(&out, &out)
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("")), home, "", "", true, consent{yes: true}); err != nil {
		t.Fatalf("applyTmuxShim uninstall error: %v", err)
	}

	if _, err := os.Stat(tmuxShimPath(home)); !os.IsNotExist(err) {
		t.Errorf("shim file must be removed; stat err = %v", err)
	}
	got := readFileOrEmpty(t, zshenv)
	if got != "export EDITOR=vim\n" {
		t.Errorf(".zshenv must be restored to its pre-install content, got: %q", got)
	}
	for _, name := range []string{".zshenv", ".bashrc"} {
		content := readFileOrEmpty(t, filepath.Join(home, name))
		if strings.Contains(content, tmuxGuardBlockBegin) || strings.Contains(content, "rk/shims") {
			t.Errorf("%s still carries the PATH block after uninstall: %q", name, content)
		}
	}

	// Re-uninstall on a clean home is silent for the absent shim and writes nothing.
	out.Reset()
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("")), home, "", "", true, consent{}); err != nil {
		t.Fatalf("re-uninstall must be a no-op, got: %v", err)
	}
}

func TestTmuxShimDryRunWritesNothing(t *testing.T) {
	home := t.TempDir()
	var out bytes.Buffer
	sink := newSinkWriters(&out, &out)
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("")), home, "", "/opt/homebrew/bin/rk", false, consent{dryRun: true}); err != nil {
		t.Fatalf("applyTmuxShim dry-run error: %v", err)
	}
	if _, err := os.Stat(tmuxShimPath(home)); !os.IsNotExist(err) {
		t.Errorf("dry run must not write the shim; stat err = %v", err)
	}
	for _, name := range []string{".zshenv", ".bashrc"} {
		if _, err := os.Stat(filepath.Join(home, name)); !os.IsNotExist(err) {
			t.Errorf("dry run must not create %s; stat err = %v", name, err)
		}
	}
	if !strings.Contains(out.String(), "dry run") {
		t.Errorf("dry run should say so, got: %q", out.String())
	}
}

func TestTmuxShimNonTTYRefusal(t *testing.T) {
	home := t.TempDir()
	var out bytes.Buffer
	sink := newSinkWriters(&out, &out)
	// consent{} → no flags, non-TTY: the pending shim write must refuse.
	err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("")), home, "", "/opt/homebrew/bin/rk", false, consent{})
	if err == nil {
		t.Fatal("non-TTY no-flag install must refuse with an error")
	}
	if !strings.Contains(err.Error(), "--yes") {
		t.Errorf("refusal error must name --yes, got: %v", err)
	}
	if _, statErr := os.Stat(tmuxShimPath(home)); !os.IsNotExist(statErr) {
		t.Errorf("refusal must not create the shim; stat err = %v", statErr)
	}
}

// TestTmuxShimZDOTDIRHonored pins the cycle-3 should-fix: when $ZDOTDIR is
// set, zsh reads $ZDOTDIR/.zshenv and NEVER ~/.zshenv — writing the home copy
// would report success while the zsh half of the install stays inert. The
// block must land in (and be stripped from) $ZDOTDIR/.zshenv; bash files stay
// home-anchored (ZDOTDIR is a zsh-only concept).
func TestTmuxShimZDOTDIRHonored(t *testing.T) {
	home := t.TempDir()
	zdot := t.TempDir()
	var out bytes.Buffer
	sink := newSinkWriters(&out, &out)
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("")), home, zdot, "/opt/homebrew/bin/rk", false, consent{yes: true}); err != nil {
		t.Fatalf("applyTmuxShim install error: %v", err)
	}

	if got := readFileOrEmpty(t, filepath.Join(zdot, ".zshenv")); !strings.Contains(got, tmuxGuardBlockBegin) {
		t.Errorf("$ZDOTDIR/.zshenv must carry the PATH block, got: %q", got)
	}
	if _, err := os.Stat(filepath.Join(home, ".zshenv")); !os.IsNotExist(err) {
		t.Errorf("~/.zshenv must not be created when ZDOTDIR is set; stat err = %v", err)
	}
	if got := readFileOrEmpty(t, filepath.Join(home, ".bashrc")); !strings.Contains(got, tmuxGuardBlockBegin) {
		t.Errorf("~/.bashrc must still carry the PATH block, got: %q", got)
	}

	// Uninstall locates .zshenv through the same seam — symmetric removal.
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("")), home, zdot, "", true, consent{yes: true}); err != nil {
		t.Fatalf("applyTmuxShim uninstall error: %v", err)
	}
	if got := readFileOrEmpty(t, filepath.Join(zdot, ".zshenv")); strings.Contains(got, tmuxGuardBlockBegin) {
		t.Errorf("$ZDOTDIR/.zshenv must have the block stripped on uninstall, got: %q", got)
	}
}

// TestTmuxShimZDOTDIRCreatedWhenMissing pins the PR-review should-fix: a
// $ZDOTDIR that names a not-yet-created directory (a common dotfiles setup)
// must not ENOENT-abort the install — the directory is created and the PATH
// block written, and the other startup files are still processed.
func TestTmuxShimZDOTDIRCreatedWhenMissing(t *testing.T) {
	home := t.TempDir()
	zdot := filepath.Join(t.TempDir(), "config", "zsh") // never created
	var out bytes.Buffer
	sink := newSinkWriters(&out, &out)
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("")), home, zdot, "/opt/homebrew/bin/rk", false, consent{yes: true}); err != nil {
		t.Fatalf("a missing $ZDOTDIR must not abort the install, got: %v", err)
	}
	if got := readFileOrEmpty(t, filepath.Join(zdot, ".zshenv")); !strings.Contains(got, tmuxGuardBlockBegin) {
		t.Errorf("$ZDOTDIR/.zshenv must carry the PATH block after the dir is created, got: %q", got)
	}
	if got := readFileOrEmpty(t, filepath.Join(home, ".bashrc")); !strings.Contains(got, tmuxGuardBlockBegin) {
		t.Errorf("~/.bashrc must still carry the PATH block, got: %q", got)
	}
}

// TestTmuxShimUnreadableStartupFileContinues pins half of the cycle-3
// read-error should-fix: a startup file that cannot be READ (here: a
// directory occupying ~/.zshenv) is skipped with a note exactly like a
// malformed marker block — it must not abort the run, or ~/.bashrc would
// never be processed.
func TestTmuxShimUnreadableStartupFileContinues(t *testing.T) {
	home := t.TempDir()
	if err := os.Mkdir(filepath.Join(home, ".zshenv"), 0o755); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	sink := newSinkWriters(&out, &out)
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("")), home, "", "/opt/homebrew/bin/rk", false, consent{yes: true}); err != nil {
		t.Fatalf("a read-failing startup file must not abort the install, got: %v", err)
	}
	if !strings.Contains(out.String(), "cannot read") {
		t.Errorf("expected a cannot-read skip note, got: %q", out.String())
	}
	if got := readFileOrEmpty(t, filepath.Join(home, ".bashrc")); !strings.Contains(got, tmuxGuardBlockBegin) {
		t.Errorf(".bashrc must still be processed after the .zshenv skip, got: %q", got)
	}
}

// TestTmuxShimUninstallUnreadableShimContinues pins the other half: a shim
// path that cannot be read (here: a directory) must not hard-fail --uninstall
// — the PATH blocks must still be stripped, or PATH would keep fronting every
// tmux invocation with a file rk cannot vouch for.
func TestTmuxShimUninstallUnreadableShimContinues(t *testing.T) {
	home := t.TempDir()
	installShim(t, home, "/opt/homebrew/bin/rk")
	shim := tmuxShimPath(home)
	if err := os.Remove(shim); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(shim, 0o755); err != nil {
		t.Fatal(err)
	}

	var out bytes.Buffer
	sink := newSinkWriters(&out, &out)
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("")), home, "", "", true, consent{yes: true}); err != nil {
		t.Fatalf("an unreadable shim path must not abort --uninstall, got: %v", err)
	}
	if !strings.Contains(out.String(), "cannot read") {
		t.Errorf("expected a cannot-read skip note, got: %q", out.String())
	}
	if _, err := os.Stat(shim); err != nil {
		t.Errorf("the unreadable occupant must be left in place; stat err = %v", err)
	}
	for _, name := range []string{".zshenv", ".bashrc"} {
		content := readFileOrEmpty(t, filepath.Join(home, name))
		if strings.Contains(content, tmuxGuardBlockBegin) {
			t.Errorf("%s must have the PATH block stripped despite the shim skip: %q", name, content)
		}
	}
}

func TestRemoveMarkerBlockEdgeCases(t *testing.T) {
	block := tmuxGuardBlockBegin + "\nexport PATH=x\n" + tmuxGuardBlockEnd + "\n"
	cases := []struct {
		name    string
		content string
		want    string
	}{
		{"no block", "foo\n", "foo\n"},
		{"block only", block, ""},
		{"block at end", "foo\n" + block, "foo\n"},
		{"block in middle", "foo\n" + block + "bar\n", "foo\nbar\n"},
		{"empty content", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := removeMarkerBlock(tc.content, tmuxGuardBlockBegin, tmuxGuardBlockEnd)
			if err != nil {
				t.Fatalf("removeMarkerBlock(%q) error: %v", tc.content, err)
			}
			if got != tc.want {
				t.Errorf("removeMarkerBlock(%q) = %q, want %q", tc.content, got, tc.want)
			}
		})
	}
}

// TestMarkerBlockUnterminatedIsError pins must-fix #2 (rework cycle 1) and the
// duplicated-begin must-fix (rework cycle 2): a malformed marker region — a
// begin with no end marker, or a SECOND begin before the end — makes the
// region's extent unknowable, so both helpers must error instead of claiming
// (and destroying) user lines. The unterminated shape used to delete every
// user line after the begin marker; the duplicated-begin shape used to delete
// every user line between the two begins.
func TestMarkerBlockUnterminatedIsError(t *testing.T) {
	cases := []struct {
		name    string
		content string
	}{
		{
			name:    "unterminated (begin without end)",
			content: "keep-a\n" + tmuxGuardBlockBegin + "\nexport PATH=x\nkeep-b\nkeep-c\n",
		},
		{
			name: "duplicated begin before end",
			content: "user-top\n" + tmuxGuardBlockBegin + "\nMY-IMPORTANT-EXPORT\n" +
				tmuxGuardBlockBegin + "\nexport PATH=x\n" + tmuxGuardBlockEnd + "\nuser-bottom\n",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := removeMarkerBlock(tc.content, tmuxGuardBlockBegin, tmuxGuardBlockEnd); err == nil {
				t.Error("removeMarkerBlock must error on a malformed block")
			}
			if _, err := upsertMarkerBlock(tc.content, tmuxGuardBlockBegin, tmuxGuardBlockEnd, tmuxGuardPathBlock); err == nil {
				t.Error("upsertMarkerBlock must error on a malformed block")
			}
		})
	}
}

// TestTmuxShimDuplicateBeginRefused pins the cycle-2 must-fix end-to-end: a
// startup file carrying a stray SECOND begin marker above the real block (a
// botched hand-edit / copy-paste) is left byte-identical on both install and
// uninstall — the user line between the two begins (MY-IMPORTANT-EXPORT) must
// survive — with a skip note, while the other startup files still proceed.
func TestTmuxShimDuplicateBeginRefused(t *testing.T) {
	home := t.TempDir()
	zshenv := filepath.Join(home, ".zshenv")
	corrupt := "user-top\n" + tmuxGuardBlockBegin + "\nMY-IMPORTANT-EXPORT\n" +
		tmuxGuardBlockBegin + "\nexport PATH=\"$HOME/.local/share/rk/shims:$PATH\"\n" +
		tmuxGuardBlockEnd + "\nuser-bottom\n"
	if err := os.WriteFile(zshenv, []byte(corrupt), 0o644); err != nil {
		t.Fatal(err)
	}

	var out bytes.Buffer
	sink := newSinkWriters(&out, &out)
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("")), home, "", "/opt/homebrew/bin/rk", false, consent{yes: true}); err != nil {
		t.Fatalf("install with a duplicated-begin block must not error, got: %v", err)
	}
	if got := readFileOrEmpty(t, zshenv); got != corrupt {
		t.Errorf("duplicated-begin .zshenv must be left byte-identical (MY-IMPORTANT-EXPORT must survive), got: %q", got)
	}
	if !strings.Contains(out.String(), "begins again") {
		t.Errorf("expected a duplicated-begin skip note, got: %q", out.String())
	}
	// The healthy .bashrc still received the block.
	if !strings.Contains(readFileOrEmpty(t, filepath.Join(home, ".bashrc")), tmuxGuardBlockBegin) {
		t.Error(".bashrc must still be processed after the malformed .zshenv is skipped")
	}

	// Uninstall refuses the malformed file the same way.
	out.Reset()
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("")), home, "", "", true, consent{yes: true}); err != nil {
		t.Fatalf("uninstall with a duplicated-begin block must not error, got: %v", err)
	}
	if got := readFileOrEmpty(t, zshenv); got != corrupt {
		t.Errorf("duplicated-begin .zshenv must survive uninstall byte-identical, got: %q", got)
	}
}

// TestUpsertMarkerBlockReplacesInPosition pins should-fix #1's first half: a
// re-install over a file whose block sits BEFORE later user lines keeps the
// block in position — moving it to EOF would hop it past a user's later PATH
// edits and silently change PATH precedence.
func TestUpsertMarkerBlockReplacesInPosition(t *testing.T) {
	content := "top\n" + tmuxGuardBlockBegin + "\n# stale body\n" + tmuxGuardBlockEnd + "\nexport PATH=\"/user/bin:$PATH\"\n"
	got, err := upsertMarkerBlock(content, tmuxGuardBlockBegin, tmuxGuardBlockEnd, tmuxGuardPathBlock)
	if err != nil {
		t.Fatalf("upsertMarkerBlock error: %v", err)
	}
	want := "top\n" + tmuxGuardPathBlock + "export PATH=\"/user/bin:$PATH\"\n"
	if got != want {
		t.Errorf("block not replaced in position:\ngot:  %q\nwant: %q", got, want)
	}
	// And re-running on the result is byte-idempotent.
	again, err := upsertMarkerBlock(got, tmuxGuardBlockBegin, tmuxGuardBlockEnd, tmuxGuardPathBlock)
	if err != nil {
		t.Fatalf("idempotent re-upsert error: %v", err)
	}
	if again != got {
		t.Errorf("re-upsert not byte-idempotent:\nfirst:  %q\nsecond: %q", got, again)
	}
}

// TestMarkerBlockRoundTripByteExact pins should-fix #1's second half: install
// followed by uninstall restores the original bytes exactly — including a file
// that lacked a trailing newline (the old append-at-EOF added one that the
// removal could never take back).
func TestMarkerBlockRoundTripByteExact(t *testing.T) {
	for _, original := range []string{
		"",
		"export EDITOR=vim\n",
		"export EDITOR=vim",       // no trailing newline
		"a\n\nb\n",                // interior blank line, trailing newline
		"# only a comment, no NL", // no trailing newline
	} {
		installed, err := upsertMarkerBlock(original, tmuxGuardBlockBegin, tmuxGuardBlockEnd, tmuxGuardPathBlock)
		if err != nil {
			t.Fatalf("upsertMarkerBlock(%q) error: %v", original, err)
		}
		restored, err := removeMarkerBlock(installed, tmuxGuardBlockBegin, tmuxGuardBlockEnd)
		if err != nil {
			t.Fatalf("removeMarkerBlock(%q) error: %v", installed, err)
		}
		if restored != original {
			t.Errorf("round trip not byte-exact:\noriginal: %q\ninstalled: %q\nrestored: %q", original, installed, restored)
		}
	}
}

// TestTmuxShimUnterminatedBlockRefused pins must-fix #2 end-to-end: a startup
// file whose PATH block lost its end marker is left byte-identical on both
// install and uninstall, with a skip note, and the run does not error (the
// other startup files still proceed).
func TestTmuxShimUnterminatedBlockRefused(t *testing.T) {
	home := t.TempDir()
	zshenv := filepath.Join(home, ".zshenv")
	corrupt := tmuxGuardBlockBegin + "\nexport PATH=\"$HOME/.local/share/rk/shims:$PATH\"\nexport EDITOR=vim\nalias ll='ls -l'\n"
	if err := os.WriteFile(zshenv, []byte(corrupt), 0o644); err != nil {
		t.Fatal(err)
	}

	var out bytes.Buffer
	sink := newSinkWriters(&out, &out)
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("")), home, "", "/opt/homebrew/bin/rk", false, consent{yes: true}); err != nil {
		t.Fatalf("install with a malformed block must not error, got: %v", err)
	}
	if got := readFileOrEmpty(t, zshenv); got != corrupt {
		t.Errorf("malformed .zshenv must be left byte-identical, got: %q", got)
	}
	if !strings.Contains(out.String(), "no end marker") {
		t.Errorf("expected a malformed-block skip note, got: %q", out.String())
	}
	// The healthy .bashrc still received the block.
	if !strings.Contains(readFileOrEmpty(t, filepath.Join(home, ".bashrc")), tmuxGuardBlockBegin) {
		t.Error(".bashrc must still be processed after the malformed .zshenv is skipped")
	}

	// Uninstall refuses the malformed file the same way.
	out.Reset()
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("")), home, "", "", true, consent{yes: true}); err != nil {
		t.Fatalf("uninstall with a malformed block must not error, got: %v", err)
	}
	if got := readFileOrEmpty(t, zshenv); got != corrupt {
		t.Errorf("malformed .zshenv must survive uninstall byte-identical, got: %q", got)
	}
}

// TestTmuxShimZeroByteMarkerlessProtected pins must-fix #5: a zero-byte
// marker-less user file at the shim path is an EXISTING user file — install
// must not overwrite it (and must not wire PATH in front of it), and uninstall
// must not remove it.
func TestTmuxShimZeroByteMarkerlessProtected(t *testing.T) {
	home := t.TempDir()
	shimPath := tmuxShimPath(home)
	if err := os.MkdirAll(filepath.Dir(shimPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(shimPath, nil, 0o644); err != nil {
		t.Fatal(err)
	}

	var out bytes.Buffer
	sink := newSinkWriters(&out, &out)
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("")), home, "", "/opt/homebrew/bin/rk", false, consent{yes: true}); err != nil {
		t.Fatalf("install over zero-byte file error: %v", err)
	}
	info, err := os.Stat(shimPath)
	if err != nil {
		t.Fatalf("stat shim path: %v", err)
	}
	if info.Size() != 0 {
		t.Errorf("zero-byte marker-less file was overwritten (size %d): %q", info.Size(), readFileOrEmpty(t, shimPath))
	}
	if !strings.Contains(out.String(), "leaving it untouched") {
		t.Errorf("expected a marker-less skip note, got: %q", out.String())
	}
	// PATH block must not be wired in front of a foreign file.
	for _, name := range []string{".zshenv", ".bashrc"} {
		if _, err := os.Stat(filepath.Join(home, name)); !os.IsNotExist(err) {
			t.Errorf("PATH block must not be installed when the shim is foreign; %s exists (stat err = %v)", name, err)
		}
	}

	// Uninstall leaves it alone too.
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("")), home, "", "", true, consent{yes: true}); err != nil {
		t.Fatalf("uninstall over zero-byte file error: %v", err)
	}
	if _, err := os.Stat(shimPath); err != nil {
		t.Errorf("zero-byte marker-less file must survive uninstall; stat err = %v", err)
	}
}

// TestTmuxShimDeclinedWriteSkipsPathBlock pins must-fix #3: when the user
// declines the shim write at the interactive prompt, the PATH block must not
// be installed — PATH would otherwise point at a shims dir with no shim in it.
func TestTmuxShimDeclinedWriteSkipsPathBlock(t *testing.T) {
	home := t.TempDir()
	var out bytes.Buffer
	sink := newSinkWriters(&out, &out)
	// Interactive session ("n" to the shim prompt). stdinIsTTY simulates a TTY.
	err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("n\n")), home, "", "/opt/homebrew/bin/rk", false, consent{stdinIsTTY: true})
	if err != nil {
		t.Fatalf("declined install error: %v", err)
	}
	if _, statErr := os.Stat(tmuxShimPath(home)); !os.IsNotExist(statErr) {
		t.Errorf("declined shim must not be written; stat err = %v", statErr)
	}
	for _, name := range []string{".zshenv", ".bashrc"} {
		if _, statErr := os.Stat(filepath.Join(home, name)); !os.IsNotExist(statErr) {
			t.Errorf("PATH block must not be installed after a declined shim; %s exists (stat err = %v)", name, statErr)
		}
	}
	if !strings.Contains(out.String(), "skipping the PATH block") {
		t.Errorf("expected a PATH-block skip note, got: %q", out.String())
	}
}

// --- consent summaries (260812-7a58) ---------------------------------------------
//
// On the interactive and --yes paths every pending write renders a SEMANTIC
// summary — the full current+proposed bodies are --dry-run-only preview data.
// These tests pin both halves: the summaries carry the honest content (entry
// list, counts, the owned PATH block) and never dump full bodies or echo user
// file content; --dry-run still renders the full renderArtifactDiff blocks.

func TestApplyAgentHooksSummaryFreshInstall(t *testing.T) {
	dir := t.TempDir()
	ac := agentConfig{name: "Test", settingsPath: filepath.Join(dir, "settings.json"), comm: "claude", hooks: claudeHooks()}

	var out bytes.Buffer
	if err := applyAgentConfig(newSinkWriters(&out, &out), bufio.NewReader(strings.NewReader("y\n")), ac, "/opt/homebrew/bin/rk", false, consent{stdinIsTTY: true}); err != nil {
		t.Fatalf("install error: %v", err)
	}
	got := out.String()
	for _, want := range []string{
		"+ UserPromptSubmit → active",
		"+ PreToolUse → active",
		"+ Notification (permission_prompt|elicitation_dialog|agent_needs_input) → waiting",
		"+ Notification (idle_prompt) → idle",
		"+ Stop → idle",
		"+ SessionStart → chat stamp",
		"(all other settings and non-rk hooks preserved)",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("fresh-install summary missing %q, got: %q", want, got)
		}
	}
	// The full-body diff is dry-run-only.
	if strings.Contains(got, "--- current") || strings.Contains(got, "+++ proposed") {
		t.Errorf("interactive consent must not dump full bodies, got: %q", got)
	}
	// The installed hook command (the sh -c one-liner) appears only in the file,
	// never in the summary.
	if strings.Contains(got, "/bin/sh -c") {
		t.Errorf("summary must not print hook command bodies, got: %q", got)
	}
}

func TestApplyAgentHooksSummaryReplacementCount(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	// Seed ONE legacy-generation rk entry (identified by the inlined option
	// name) so the merge replaces it in place and the summary must say so with
	// a count derived from the file — singular form included.
	seed := map[string]any{
		"hooks": map[string]any{
			"Stop": []any{
				map[string]any{"hooks": []any{
					map[string]any{"type": "command", "command": "tmux set-option -p " + rkHookMarker + " idle"},
				}},
			},
		},
	}
	if err := writeSettings(path, seed); err != nil {
		t.Fatal(err)
	}
	ac := agentConfig{name: "Test", settingsPath: path, comm: "claude", hooks: claudeHooks()}

	var out bytes.Buffer
	if err := applyAgentConfig(newSinkWriters(&out, &out), bufio.NewReader(strings.NewReader("y\n")), ac, "/opt/homebrew/bin/rk", false, consent{stdinIsTTY: true}); err != nil {
		t.Fatalf("install error: %v", err)
	}
	if !strings.Contains(out.String(), "(replaces 1 existing rk-owned entry in place; all other settings and non-rk hooks preserved)") {
		t.Errorf("replacement summary missing or count wrong, got: %q", out.String())
	}
}

func TestApplyAgentHooksSummaryUninstall(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	ac := agentConfig{name: "Test", settingsPath: path, comm: "claude", hooks: claudeHooks()}
	var out bytes.Buffer
	if err := applyAgentConfig(newSinkWriters(&out, &out), bufio.NewReader(strings.NewReader("")), ac, "/opt/homebrew/bin/rk", false, consent{yes: true}); err != nil {
		t.Fatalf("install error: %v", err)
	}

	out.Reset()
	if err := applyAgentConfig(newSinkWriters(&out, &out), bufio.NewReader(strings.NewReader("y\n")), ac, "", true, consent{stdinIsTTY: true}); err != nil {
		t.Fatalf("uninstall error: %v", err)
	}
	got := out.String()
	// The count derives from the file's actual rk entries — the whole registry
	// was just installed, so it must equal the registry row count.
	want := "- removes " + strconv.Itoa(len(claudeHooks())) + " rk-owned hook entries; all other settings and non-rk hooks preserved"
	if !strings.Contains(got, want) {
		t.Errorf("uninstall summary missing %q, got: %q", want, got)
	}
	if strings.Contains(got, "+++ proposed") {
		t.Errorf("uninstall consent must not dump full bodies, got: %q", got)
	}
}

func TestApplyAgentHooksDryRunFullBodies(t *testing.T) {
	dir := t.TempDir()
	ac := agentConfig{name: "Test", settingsPath: filepath.Join(dir, "settings.json"), comm: "claude", hooks: claudeHooks()}

	var out bytes.Buffer
	if err := applyAgentConfig(newSinkWriters(&out, &out), bufio.NewReader(strings.NewReader("")), ac, "/opt/homebrew/bin/rk", false, consent{dryRun: true}); err != nil {
		t.Fatalf("dry-run error: %v", err)
	}
	got := out.String()
	if !strings.Contains(got, "--- current") || !strings.Contains(got, "+++ proposed") {
		t.Errorf("--dry-run must keep the full-body diff, got: %q", got)
	}
	// The proposed body is the real merged document — hook commands included.
	if !strings.Contains(got, rkHookMarkerAgentHookFamily) {
		t.Errorf("--dry-run proposed body should carry the hook commands, got: %q", got)
	}
}

func TestTmuxShimConsentSummaries(t *testing.T) {
	home := t.TempDir()
	// Seed user content in a startup file — the summary must never echo it.
	if err := os.WriteFile(filepath.Join(home, ".zshenv"), []byte("# my private zshenv line\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	var out bytes.Buffer
	sink := newSinkWriters(&out, &out)
	// Interactive: y to the shim, y to each startup file (.zshenv, .bashrc).
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("y\ny\ny\n")), home, "", "/opt/homebrew/bin/rk", false, consent{stdinIsTTY: true}); err != nil {
		t.Fatalf("install error: %v", err)
	}
	got := out.String()

	// Shim: one summary line with the path and a line count — never the script.
	if !strings.Contains(got, "will install the tmux shim at "+tmuxShimPath(home)+" (rk-owned guard script,") {
		t.Errorf("shim summary line missing, got: %q", got)
	}
	if strings.Contains(got, tmuxShimMarker) {
		t.Errorf("shim script body leaked into consent output, got: %q", got)
	}

	// PATH block: the owned 3 lines + placement — never the user's content.
	if !strings.Contains(got, "(appended at end):") {
		t.Errorf("PATH-block placement wording missing, got: %q", got)
	}
	if !strings.Contains(got, `export PATH="$HOME/.local/share/rk/shims:$PATH"`) {
		t.Errorf("PATH-block excerpt missing the export line, got: %q", got)
	}
	if strings.Contains(got, "# my private zshenv line") {
		t.Errorf("user startup-file content echoed back in consent output, got: %q", got)
	}
	if strings.Contains(got, "--- current") {
		t.Errorf("interactive consent must not render full-body diffs, got: %q", got)
	}
}

func TestTmuxShimUpdateSummaryLine(t *testing.T) {
	home := t.TempDir()
	installShim(t, home, "/opt/homebrew/bin/rk")

	// Same home, different rk path → rk-owned shim content changes → update line.
	var out bytes.Buffer
	sink := newSinkWriters(&out, &out)
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("y\n")), home, "", "/usr/local/bin/rk", false, consent{stdinIsTTY: true}); err != nil {
		t.Fatalf("re-install error: %v", err)
	}
	if !strings.Contains(out.String(), "will update the rk-owned tmux shim at "+tmuxShimPath(home)) {
		t.Errorf("rk-owned update summary line missing, got: %q", out.String())
	}
	if strings.Contains(out.String(), "+++ proposed") {
		t.Errorf("update consent must not dump the script diff, got: %q", out.String())
	}
}

// TestTmuxShimOldGenerationRollsOver pins the generation rollover: a
// marker-owned shim still exec'ing the pre-move `tmux-guard` form is a content
// change under the existing consent flow — replace-in-place, marker intact,
// mode 0755, no migration and no new file. The permanent `tmux-guard` root
// alias keeps untouched installs working; only a re-run rewrites them.
func TestTmuxShimOldGenerationRollsOver(t *testing.T) {
	home := t.TempDir()
	const rkPath = "/opt/homebrew/bin/rk"
	oldForm := strings.Replace(tmuxShimScript(rkPath),
		`exec "`+rkPath+`" mux guard "$@"`,
		`exec "`+rkPath+`" tmux-guard "$@"`, 1)
	if !strings.Contains(oldForm, tmuxShimMarker) || !strings.Contains(oldForm, `" tmux-guard "$@"`) {
		t.Fatal("old-generation fixture is malformed")
	}
	writeStub(t, rkShimsDir(home), "tmux", oldForm, 0o755)

	var out bytes.Buffer
	sink := newSinkWriters(&out, &out)
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("y\n")), home, "", rkPath, false, consent{stdinIsTTY: true}); err != nil {
		t.Fatalf("re-install error: %v", err)
	}
	if !strings.Contains(out.String(), "will update the rk-owned tmux shim at "+tmuxShimPath(home)) {
		t.Errorf("an old-generation shim must register as a content change, got: %q", out.String())
	}

	shim := readFileOrEmpty(t, tmuxShimPath(home))
	if !strings.Contains(shim, `exec "`+rkPath+`" mux guard "$@"`) {
		t.Errorf("shim was not rolled to the new form: %q", shim)
	}
	if !strings.Contains(shim, tmuxShimMarker) {
		t.Errorf("the ownership marker must survive the rollover: %q", shim)
	}
	info, err := os.Stat(tmuxShimPath(home))
	if err != nil {
		t.Fatalf("stat shim: %v", err)
	}
	if info.Mode().Perm() != 0o755 {
		t.Errorf("shim mode = %v, want 0755", info.Mode().Perm())
	}
}

func TestTmuxShimPathBlockReplaceInPositionWording(t *testing.T) {
	home := t.TempDir()
	// Seed a well-formed but stale rk block (edited inner line) so upsert
	// replaces it in position.
	stale := "# user top\n" + tmuxGuardBlockBegin + "\nexport PATH=\"$HOME/old:$PATH\"\n" + tmuxGuardBlockEnd + "\n"
	if err := os.WriteFile(filepath.Join(home, ".zshenv"), []byte(stale), 0o644); err != nil {
		t.Fatal(err)
	}
	// Pre-install the shim so the run reaches the PATH blocks directly.
	installShim(t, home, "/opt/homebrew/bin/rk")

	// installShim used --yes, so the block is already replaced; re-seed the stale
	// block and run interactively to capture the wording.
	if err := os.WriteFile(filepath.Join(home, ".zshenv"), []byte(stale), 0o644); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	sink := newSinkWriters(&out, &out)
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("y\n")), home, "", "/opt/homebrew/bin/rk", false, consent{stdinIsTTY: true}); err != nil {
		t.Fatalf("re-install error: %v", err)
	}
	if !strings.Contains(out.String(), "(replaced in position):") {
		t.Errorf("in-position replace wording missing, got: %q", out.String())
	}
	if strings.Contains(out.String(), "# user top") {
		t.Errorf("user content echoed back, got: %q", out.String())
	}
}

func TestTmuxShimUninstallSummaryLine(t *testing.T) {
	home := t.TempDir()
	if err := os.WriteFile(filepath.Join(home, ".bashrc"), []byte("# my bashrc\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	installShim(t, home, "/opt/homebrew/bin/rk")

	// Uninstall interactively: y to the shim removal, y per PATH block.
	var out bytes.Buffer
	sink := newSinkWriters(&out, &out)
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("y\ny\ny\n")), home, "", "", true, consent{stdinIsTTY: true}); err != nil {
		t.Fatalf("uninstall error: %v", err)
	}
	got := out.String()
	if !strings.Contains(got, "will remove the 3-line rk tmux guard PATH block from") {
		t.Errorf("PATH-block removal summary missing, got: %q", got)
	}
	if strings.Contains(got, "# my bashrc") {
		t.Errorf("user content echoed back on uninstall, got: %q", got)
	}
	if strings.Contains(got, "--- current") {
		t.Errorf("uninstall consent must not render full-body diffs, got: %q", got)
	}
}

func TestTmuxShimDryRunFullBodies(t *testing.T) {
	home := t.TempDir()
	var out bytes.Buffer
	sink := newSinkWriters(&out, &out)
	if err := applyTmuxShim(sink, bufio.NewReader(strings.NewReader("")), home, "", "/opt/homebrew/bin/rk", false, consent{dryRun: true}); err != nil {
		t.Fatalf("dry-run error: %v", err)
	}
	got := out.String()
	if !strings.Contains(got, "--- current") || !strings.Contains(got, "+++ proposed") {
		t.Errorf("--dry-run must keep the full-body diffs, got: %q", got)
	}
	// The shim script itself is the requested preview data on this path.
	if !strings.Contains(got, tmuxShimMarker) {
		t.Errorf("--dry-run shim preview should include the script body, got: %q", got)
	}
}
