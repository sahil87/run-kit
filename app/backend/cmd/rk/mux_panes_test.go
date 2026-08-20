package main

import (
	"errors"
	"strings"
	"testing"

	"rk/internal/tmux"
)

// TestMuxPanesJSONShape: --json carries exactly the documented key set, with
// null agent fields for the uninstrumented shell pane and an idle duration for
// the instrumented one (R2). The default fake: session work/$3, window @3
// "editor", pane %5 idle at epoch 1_800_000_000 (now 1_800_000_300 → 5m),
// pane %6 uninstrumented.
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
		"    \"agent_state_duration\": \"5m\"\n" +
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
		"    \"agent_state_duration\": null\n" +
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
	if !strings.HasPrefix(lines[0], "SESSION") {
		t.Errorf("header = %q, want the SESSION-... column header", lines[0])
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
