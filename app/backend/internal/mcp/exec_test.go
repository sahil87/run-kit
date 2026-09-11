package mcp

import (
	"context"
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
