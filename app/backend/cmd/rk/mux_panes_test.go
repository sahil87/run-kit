package main

import (
	"context"
	"errors"
	"strings"
	"testing"

	"rk/internal/tmux"
)

// TestMuxPanesJSONShape: --json carries exactly the documented key set, with
// null agent fields for the uninstrumented shell pane and an idle duration for
// the instrumented one (R2), and has_agent last: null for the node-foreground
// pane (not walked), true for the shell pane whose default discover fixture
// holds a claude child. The default fake: session work/$3, window @3
// "editor", pane %5 idle at epoch 1_800_000_000 (now 1_800_000_300 → 5m),
// pane %6 uninstrumented with pane pid 1234.
func TestMuxPanesJSONShape(t *testing.T) {
	f := &muxFake{}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "panes", "--json")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	want := "[\n" +
		"  {\n" +
		"    \"session\": \"work\",\n" +
		"    \"session_id\": \"$3\",\n" +
		"    \"window_index\": 0,\n" +
		"    \"window_id\": \"@3\",\n" +
		"    \"window_name\": \"editor\",\n" +
		"    \"window_active\": true,\n" +
		"    \"pane\": \"%5\",\n" +
		"    \"pane_index\": 0,\n" +
		"    \"pane_active\": true,\n" +
		"    \"command\": \"node\",\n" +
		"    \"cwd\": \"/home/x/code/repo\",\n" +
		"    \"agent_state\": \"idle\",\n" +
		"    \"agent_state_duration\": \"5m\",\n" +
		"    \"has_agent\": null\n" +
		"  },\n" +
		"  {\n" +
		"    \"session\": \"work\",\n" +
		"    \"session_id\": \"$3\",\n" +
		"    \"window_index\": 0,\n" +
		"    \"window_id\": \"@3\",\n" +
		"    \"window_name\": \"editor\",\n" +
		"    \"window_active\": true,\n" +
		"    \"pane\": \"%6\",\n" +
		"    \"pane_index\": 1,\n" +
		"    \"pane_active\": false,\n" +
		"    \"command\": \"zsh\",\n" +
		"    \"cwd\": \"/home/x/code/repo\",\n" +
		"    \"agent_state\": null,\n" +
		"    \"agent_state_duration\": null,\n" +
		"    \"has_agent\": true\n" +
		"  }\n" +
		"]\n"
	if stdout != want {
		t.Errorf("stdout = %q, want %q", stdout, want)
	}
	// Substrate facts only: no choreography keys anywhere (R2).
	for _, key := range []string{"change", "stage", "display_state"} {
		if strings.Contains(stdout, `"`+key+`"`) {
			t.Errorf("stdout carries choreography key %q, want substrate facts only", key)
		}
	}
}

// shellPaneWindows is a one-window fixture with a single shell-foreground pane
// carrying the given pane pid and reconciled agent pid.
func shellPaneWindows(command string, panePID, agentPID int) map[string][]tmux.WindowInfo {
	return map[string][]tmux.WindowInfo{
		"work": {{
			Index: 0, WindowID: "@3", Name: "editor", IsActiveWindow: true,
			Panes: []tmux.PaneInfo{
				{PaneID: "%6", PaneIndex: 0, IsActive: true, Cwd: "/repo", Command: command,
					PanePID: panePID, AgentPID: agentPID},
			},
		}},
	}
}

// countDiscoveries wraps the installed discovery seam to count walks; the
// installMuxFakes cleanup restores the original afterwards.
func countDiscoveries(t *testing.T) *int {
	t.Helper()
	calls := 0
	inner := muxProcessDiscoverFn
	muxProcessDiscoverFn = func(ctx context.Context, pid int) ([]processNode, error) {
		calls++
		return inner(ctx, pid)
	}
	return &calls
}

// TestMuxPanesHasAgentFalse: a shell-foreground pane whose tree holds no agent
// node reads has_agent false — the consumer's agent-exited signal.
func TestMuxPanesHasAgentFalse(t *testing.T) {
	f := &muxFake{
		paneWindows: shellPaneWindows("zsh", 1234, 0),
		discoverTree: []processNode{{
			PID: 1234, Comm: "zsh", Cmdline: "-zsh", Classification: "other",
			Children: []processNode{{PID: 1300, PPID: 1234, Comm: "git", Cmdline: "git status",
				Classification: "git", Children: []processNode{}}},
		}},
	}
	installMuxFakes(t, f)

	stdout, stderr, err := runMuxCmd(t, "panes", "--json")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if !strings.Contains(stdout, "\"has_agent\": false\n") {
		t.Errorf("stdout = %q, want has_agent false", stdout)
	}
	if stderr != "" {
		t.Errorf("stderr = %q, want silent", stderr)
	}
}

// TestMuxPanesHasAgentPIDCrossCheck: a wrapper-launched agent whose comm is
// not in the table still reads true when the pane's reconciled agent pid
// names the wrapper node — the same cross-check rk mux process applies.
func TestMuxPanesHasAgentPIDCrossCheck(t *testing.T) {
	f := &muxFake{
		paneWindows: shellPaneWindows("bash", 1234, 1400),
		discoverTree: []processNode{{
			PID: 1234, Comm: "bash", Cmdline: "bash", Classification: "other",
			Children: []processNode{{PID: 1400, PPID: 1234, Comm: "my-wrapper", Cmdline: "my-wrapper --go",
				Classification: "other", Children: []processNode{}}},
		}},
	}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "panes", "--json")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if !strings.Contains(stdout, "\"has_agent\": true\n") {
		t.Errorf("stdout = %q, want has_agent true via the pid cross-check", stdout)
	}
}

// TestMuxPanesHasAgentNull: the three null cases — a non-shell foreground is
// never walked, a shell pane with no pane pid is never walked, and a failed
// walk on a shell pane degrades to null with exit 0 and a silent stderr.
func TestMuxPanesHasAgentNull(t *testing.T) {
	t.Run("non-shell foreground is not walked", func(t *testing.T) {
		f := &muxFake{paneWindows: shellPaneWindows("node", 1234, 0)}
		installMuxFakes(t, f)
		calls := countDiscoveries(t)

		stdout, _, err := runMuxCmd(t, "panes", "--json")
		if err != nil {
			t.Fatalf("err = %v", err)
		}
		if !strings.Contains(stdout, "\"has_agent\": null\n") {
			t.Errorf("stdout = %q, want has_agent null", stdout)
		}
		if *calls != 0 {
			t.Errorf("discovery ran %d time(s) for a node foreground, want 0", *calls)
		}
	})

	t.Run("shell pane without a pane pid is not walked", func(t *testing.T) {
		f := &muxFake{paneWindows: shellPaneWindows("zsh", 0, 0)}
		installMuxFakes(t, f)
		calls := countDiscoveries(t)

		stdout, _, err := runMuxCmd(t, "panes", "--json")
		if err != nil {
			t.Fatalf("err = %v", err)
		}
		if !strings.Contains(stdout, "\"has_agent\": null\n") {
			t.Errorf("stdout = %q, want has_agent null", stdout)
		}
		if *calls != 0 {
			t.Errorf("discovery ran %d time(s) with no pane pid, want 0", *calls)
		}
	})

	t.Run("failed walk degrades to null silently", func(t *testing.T) {
		f := &muxFake{
			paneWindows: shellPaneWindows("fish", 1234, 0),
			discoverErr: errors.New("proc unreadable"),
		}
		installMuxFakes(t, f)

		stdout, stderr, err := runMuxCmd(t, "panes", "--json")
		if err != nil {
			t.Fatalf("err = %v, want exit 0 despite the failed walk", err)
		}
		if !strings.Contains(stdout, "\"has_agent\": null\n") {
			t.Errorf("stdout = %q, want has_agent null", stdout)
		}
		if stderr != "" {
			t.Errorf("stderr = %q, want silent", stderr)
		}
	})

	t.Run("every shell in the trigger set is walked", func(t *testing.T) {
		for _, shell := range []string{"sh", "bash", "zsh", "fish", "dash", "ksh", "tcsh", "csh", "nu"} {
			f := &muxFake{paneWindows: shellPaneWindows(shell, 1234, 0)}
			installMuxFakes(t, f)
			calls := countDiscoveries(t)
			if _, _, err := runMuxCmd(t, "panes", "--json"); err != nil {
				t.Fatalf("%s: err = %v", shell, err)
			}
			if *calls != 1 {
				t.Errorf("%s: discovery ran %d time(s), want 1", shell, *calls)
			}
		}
	})
}

// TestMuxPanesActiveStateDuration: an active pane surfaces its state but never
// a duration (the mux capture semantics, R2).
func TestMuxPanesActiveStateDuration(t *testing.T) {
	f := &muxFake{paneWindows: map[string][]tmux.WindowInfo{
		"work": {{
			Index: 0, WindowID: "@3", Name: "editor", IsActiveWindow: true,
			Panes: []tmux.PaneInfo{
				{PaneID: "%5", PaneIndex: 0, IsActive: true, Cwd: "/repo", Command: "node",
					AgentState: tmux.AgentStateActive, AgentStateEpoch: 1_800_000_000},
			},
		}},
	}}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "panes", "--json")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if !strings.Contains(stdout, `"agent_state": "active"`) {
		t.Errorf("stdout = %q, want the active state", stdout)
	}
	if !strings.Contains(stdout, `"agent_state_duration": null`) {
		t.Errorf("stdout = %q, want a null duration for active", stdout)
	}
}

// TestMuxPanesTableOutput: the default shape is an aligned table, one pane per
// row, on stdout (R3).
func TestMuxPanesTableOutput(t *testing.T) {
	f := &muxFake{}
	installMuxFakes(t, f)

	stdout, stderr, err := runMuxCmd(t, "panes")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	lines := strings.Split(strings.TrimRight(stdout, "\n"), "\n")
	if len(lines) != 3 {
		t.Fatalf("stdout = %q, want header + 2 rows", stdout)
	}
	// The column set is fixed — has_agent is a --json-only field.
	if got := strings.Join(strings.Fields(lines[0]), " "); got != "SESSION WINDOW PANE ACTIVE AGENT COMMAND CWD" {
		t.Errorf("header = %q, want the fixed seven-column header", lines[0])
	}
	for _, want := range []string{"work", "0:editor", "%5", "idle (5m)", "%6", "zsh"} {
		if !strings.Contains(stdout, want) {
			t.Errorf("stdout = %q, missing %q", stdout, want)
		}
	}
	if stderr != "" {
		t.Errorf("stderr = %q, want silent on success", stderr)
	}
}

// TestMuxPanesEmptyEnumeration: an alive server with nothing to list is a
// success — [] under --json, the bare header otherwise (R4).
func TestMuxPanesEmptyEnumeration(t *testing.T) {
	f := &muxFake{paneSessions: []tmux.SessionInfo{}, paneSessionsSet: true}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "panes", "--json")
	if err != nil {
		t.Fatalf("err = %v, want exit 0 on an empty enumeration", err)
	}
	if stdout != "[]\n" {
		t.Errorf("stdout = %q, want []", stdout)
	}

	stdout, _, err = runMuxCmd(t, "panes")
	if err != nil {
		t.Fatalf("table: err = %v", err)
	}
	if lines := strings.Split(strings.TrimRight(stdout, "\n"), "\n"); len(lines) != 1 {
		t.Errorf("stdout = %q, want the header line only", stdout)
	}
}

// TestMuxPanesNoServer: no server on the resolved socket is an operational
// failure (exit 1) carrying tmux's diagnostic; a tmux enumeration failure is
// likewise exit 1 (R4).
func TestMuxPanesNoServer(t *testing.T) {
	f := &muxFake{
		paneSessions:    []tmux.SessionInfo{},
		paneSessionsSet: true,
		paneAliveErr:    errors.New("exit status 1: no server running on /tmp/tmux-1000/nope"),
	}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "panes", "-L", "nope")
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("err = %v, want exit 1", err)
	}
	if !strings.Contains(err.Error(), "no server running") {
		t.Errorf("err = %v, want tmux's diagnostic", err)
	}
	if stdout != "" {
		t.Errorf("stdout = %q on a dead server, want empty", stdout)
	}

	// A tmux failure on the listing itself is operational too.
	f2 := &muxFake{paneSessionsErr: errors.New("exit status 1: tmux exploded")}
	installMuxFakes(t, f2)
	_, _, err = runMuxCmd(t, "panes")
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("listing failure: err = %v, want exit 1", err)
	}
}

// TestMuxPanesUsage: a stray positional argument is a usage error (exit 2)
// with nothing on stdout (R4).
func TestMuxPanesUsage(t *testing.T) {
	f := &muxFake{}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "panes", "%5")
	if err == nil || exitCode(err) != exitUsage {
		t.Fatalf("err = %v, want usage exit 2", err)
	}
	if stdout != "" {
		t.Errorf("stdout = %q on a usage error, want empty", stdout)
	}
}
