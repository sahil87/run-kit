package mcp

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"rk/internal/testutil"
)

// TestBuildArgvOrder pins argv assembly: flags in Args order, then positionals
// by slot, then literals in Args order.
func TestBuildArgvOrder(t *testing.T) {
	row := syntheticRows()[0] // capture
	got := BuildArgv(row, map[string]any{"server": "s", "target": "%3", "lines": float64(100)})
	want := []string{"mux", "capture", "-L", "s", "-l", "100", "%3", "--json"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("argv = %v, want %v", got, want)
	}
}

// TestBuildArgvSeededNewRows pins argv assembly for the snapshot_list and
// gui_shot rows against the shipped table.
func TestBuildArgvSeededNewRows(t *testing.T) {
	byName := map[string]Row{}
	for _, row := range Table {
		byName[row.Tool] = row
	}
	got := BuildArgv(byName["snapshot_list"], map[string]any{"server": "runkit"})
	want := []string{"mux", "snapshot", "list", "runkit", "--json"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("snapshot_list argv = %v, want %v", got, want)
	}
	got = BuildArgv(byName["gui_shot"], map[string]any{"max_width": float64(800)})
	want = []string{"gui", "shot", "--max-width", "800", "--json"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("gui_shot argv = %v, want %v", got, want)
	}
}

// TestValidateArgsSnapshotListServer: the positional server filter rejects
// anything ValidateServerName would, before exec.
func TestValidateArgsSnapshotListServer(t *testing.T) {
	var row Row
	for _, r := range Table {
		if r.Tool == "snapshot_list" {
			row = r
			break
		}
	}
	if row.Tool == "" {
		t.Fatal("Table has no snapshot_list row")
	}
	if _, err := ValidateArgs(row, json.RawMessage(`{"server":"bad name"}`)); err == nil || !strings.Contains(err.Error(), `"server"`) {
		t.Errorf("bad server name = %v, want a rejection naming \"server\"", err)
	}
	if _, err := ValidateArgs(row, json.RawMessage(`{"server":"runkit"}`)); err != nil {
		t.Errorf("valid server name rejected: %v", err)
	}
}

// TestBuildArgvOmissions: absent optionals and false booleans contribute
// nothing; the stdin input never becomes an argv element.
func TestBuildArgvOmissions(t *testing.T) {
	row := Row{
		Tool: "sessions", Path: "mux sessions",
		Args: []Arg{serverArg, {Name: "all", Flag: "--all", Type: ArgBoolean}, jsonLiteral},
	}
	got := BuildArgv(row, map[string]any{"all": false})
	want := []string{"mux", "sessions", "--json"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("argv = %v, want %v", got, want)
	}
	got = BuildArgv(row, map[string]any{"all": true})
	want = []string{"mux", "sessions", "--all", "--json"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("argv = %v, want %v", got, want)
	}

	send := syntheticRows()[1]
	got = BuildArgv(send, map[string]any{"target": "%3", "message": "hi"})
	want = []string{"mux", "send", "%3", "-"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("send argv = %v, want %v (message rides stdin)", got, want)
	}
}

// TestBuildArgvBoardActionEnum pins argv assembly for the action-enum row:
// flags (in Args order) before positionals (by slot), then the literal — the
// reorder call yields `board -L s --after @3 reorder work @7 --json`, which
// Cobra parses on the reorder child because the flags are persistent on the
// parent.
func TestBuildArgvBoardActionEnum(t *testing.T) {
	row := findRow(t, "board")
	got := BuildArgv(row, map[string]any{
		"action": "reorder", "name": "work", "window": "@7", "after": "@3", "server": "s",
	})
	want := []string{"board", "-L", "s", "--after", "@3", "reorder", "work", "@7", "--json"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("argv = %v, want %v", got, want)
	}
}

// TestBuildArgvDefaultEmittedWhenAbsent: an absent Flag input carrying a
// Default emits `flag Default` at its Args position; a supplied value wins
// over the Default.
func TestBuildArgvDefaultEmittedWhenAbsent(t *testing.T) {
	row := findRow(t, "await")
	got := BuildArgv(row, map[string]any{"server": "s", "target": "%3"})
	want := []string{"mux", "await", "-L", "s", "--timeout", "40", "%3", "--json"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("argv = %v, want %v", got, want)
	}

	got = BuildArgv(row, map[string]any{"server": "s", "target": "%3", "timeout": float64(12)})
	want = []string{"mux", "await", "-L", "s", "--timeout", "12", "%3", "--json"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("argv with supplied timeout = %v, want %v", got, want)
	}
}

// TestBuildArgvWhenConditionalLiterals: a Literal whose When input is absent is
// skipped — the answer row's `--answer`/`-` pair rides the message form only.
func TestBuildArgvWhenConditionalLiterals(t *testing.T) {
	row := findRow(t, "answer")

	got := BuildArgv(row, map[string]any{"target": "%3", "message": "yes"})
	want := []string{"mux", "send", "%3", "--answer", "-", "--json"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("message form argv = %v, want %v", got, want)
	}

	got = BuildArgv(row, map[string]any{"target": "%3", "key": "Enter"})
	want = []string{"mux", "send", "--key", "Enter", "%3", "--json"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("key form argv = %v, want %v", got, want)
	}
}

// TestExecutorStdinRoundTrip: a stub that cats stdin proves the plumbing, and
// echoing argv proves no shell string is involved.
func TestExecutorStdinRoundTrip(t *testing.T) {
	dir := t.TempDir()
	testutil.WriteStub(t, dir, "rk-stub", "#!/bin/sh\nprintf '%s\n' \"$@\"\ncat\n")
	exe := Executor{Exe: dir + "/rk-stub"}
	out := exe.Run(context.Background(), []string{"mux", "send", "%3", "-"}, "hello\nworld", 5*time.Second)
	if out.TimedOut || out.ExitCode != 0 {
		t.Fatalf("outcome = %+v", out)
	}
	if got := string(out.Stdout); got != "mux\nsend\n%3\n-\nhello\nworld" {
		t.Errorf("stdout = %q", got)
	}
}

// TestExecutorStdinEmpty: an empty stdin leaves the child with no piped input
// beyond EOF — the stub must see an empty read.
func TestExecutorStdinEmpty(t *testing.T) {
	dir := t.TempDir()
	testutil.WriteStub(t, dir, "rk-stub", "#!/bin/sh\nout=$(cat)\nprintf '[%s]' \"$out\"\n")
	exe := Executor{Exe: dir + "/rk-stub"}
	out := exe.Run(context.Background(), nil, "", 5*time.Second)
	if string(out.Stdout) != "[]" {
		t.Errorf("stdout = %q, want [] (no stdin content)", out.Stdout)
	}
}

// TestExecutorTimeout: a sleeping stub under a 200 ms deadline is killed
// promptly and reported TimedOut.
func TestExecutorTimeout(t *testing.T) {
	dir := t.TempDir()
	testutil.WriteStub(t, dir, "rk-stub", "#!/bin/sh\nexec sleep 5\n")
	exe := Executor{Exe: dir + "/rk-stub"}
	start := time.Now()
	out := exe.Run(context.Background(), nil, "", 200*time.Millisecond)
	elapsed := time.Since(start)
	if !out.TimedOut {
		t.Error("TimedOut = false, want true")
	}
	if elapsed > time.Second {
		t.Errorf("took %s, want the deadline kill well under 1s", elapsed)
	}
}

// TestExecutorTimeoutWedgeBound: when a killed child's own child keeps the
// captured pipes open (a sleeping grandchild), Run still returns within
// WaitDelay rather than wedging the tool call.
func TestExecutorTimeoutWedgeBound(t *testing.T) {
	dir := t.TempDir()
	testutil.WriteStub(t, dir, "rk-stub", "#!/bin/sh\nsleep 5\n")
	exe := Executor{Exe: dir + "/rk-stub"}
	start := time.Now()
	out := exe.Run(context.Background(), nil, "", 200*time.Millisecond)
	elapsed := time.Since(start)
	if !out.TimedOut {
		t.Error("TimedOut = false, want true")
	}
	if elapsed > waitDelay+time.Second {
		t.Errorf("took %s, want within the %s WaitDelay bound", elapsed, waitDelay)
	}
}

// TestExecutorStripsTmuxEnv: TMUX/TMUX_PANE set in the parent never reach the
// child (the target rule); the rest of the environment does.
func TestExecutorStripsTmuxEnv(t *testing.T) {
	t.Setenv("TMUX", "/tmp/fake,1,0")
	t.Setenv("TMUX_PANE", "%42")
	dir := t.TempDir()
	testutil.WriteStub(t, dir, "rk-stub", "#!/bin/sh\nprintf 'tmux=[%s] pane=[%s] home=[%s]\n' \"$TMUX\" \"$TMUX_PANE\" \"$HOME\"\n")
	exe := Executor{Exe: dir + "/rk-stub"}
	out := exe.Run(context.Background(), nil, "", 5*time.Second)
	got := string(out.Stdout)
	if !strings.Contains(got, "tmux=[] pane=[]") {
		t.Errorf("stdout = %q, want TMUX/TMUX_PANE stripped", got)
	}
	if !strings.Contains(got, "home=[/") {
		t.Errorf("stdout = %q, want the rest of the environment inherited", got)
	}
}

// TestExecutorFailureExit: a stub exiting 3 with a stderr diagnostic surfaces
// both, separately.
func TestExecutorFailureExit(t *testing.T) {
	dir := t.TempDir()
	testutil.WriteStub(t, dir, "rk-stub", "#!/bin/sh\necho out\necho err >&2\nexit 3\n")
	exe := Executor{Exe: dir + "/rk-stub"}
	out := exe.Run(context.Background(), nil, "", 5*time.Second)
	if out.ExitCode != 3 || out.TimedOut {
		t.Errorf("outcome = %+v", out)
	}
	if string(out.Stdout) != "out\n" || string(out.Stderr) != "err\n" {
		t.Errorf("stdout=%q stderr=%q", out.Stdout, out.Stderr)
	}
}
