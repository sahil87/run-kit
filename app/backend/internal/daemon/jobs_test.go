package daemon

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

// jobCall records one seam invocation: the tmux argv (minus the runner's own
// -L prefix, which the seams sit below) for run/output calls, or the probe
// target for the window-state seam.
type jobCall struct {
	op   string // "run" | "output" | "state"
	args []string
}

// jobFixture stubs every RunJob seam for one test and returns the recorded
// calls plus knobs to script the tmux world: daemon running or not, session
// presence, per-target window state, and per-op error hooks. Restores via
// t.Cleanup.
type jobFixture struct {
	calls         *[]jobCall
	daemonRunning bool
	sessionExists bool
	// state answers the jobWindowState seam; nil means "every window absent".
	state func(target string) (id string, dead bool, exists bool)
	// runErr / outputErr fail the corresponding seam when non-nil.
	runErr    error
	outputErr error
	// output is what the output seam returns (the spawned window id).
	output string
}

func withJobSeams(t *testing.T, f *jobFixture) {
	t.Helper()
	f.calls = &[]jobCall{}
	if f.output == "" {
		f.output = "@7\n"
	}

	origRunning, origSession, origState := jobDaemonRunning, jobSessionExists, jobWindowState
	origRun, origOutput, origHome := jobRunTmux, jobRunTmuxOutput, jobUserHomeDir
	t.Cleanup(func() {
		jobDaemonRunning, jobSessionExists, jobWindowState = origRunning, origSession, origState
		jobRunTmux, jobRunTmuxOutput, jobUserHomeDir = origRun, origOutput, origHome
	})

	// Home is stubbed for every test so none can ever write to the real ~/.rk
	// (the withCodeServerSeams guarantee).
	home := t.TempDir()
	jobUserHomeDir = func() (string, error) { return home, nil }
	jobDaemonRunning = func(context.Context) bool { return f.daemonRunning }
	jobSessionExists = func(context.Context, string) bool { return f.sessionExists }
	jobWindowState = func(_ context.Context, target string) (string, bool, bool) {
		*f.calls = append(*f.calls, jobCall{op: "state", args: []string{target}})
		if f.state == nil {
			return "", false, false
		}
		return f.state(target)
	}
	jobRunTmux = func(_ context.Context, args ...string) error {
		*f.calls = append(*f.calls, jobCall{op: "run", args: append([]string(nil), args...)})
		return f.runErr
	}
	jobRunTmuxOutput = func(_ context.Context, args ...string) ([]byte, error) {
		*f.calls = append(*f.calls, jobCall{op: "output", args: append([]string(nil), args...)})
		if f.outputErr != nil {
			return nil, f.outputErr
		}
		return []byte(f.output), nil
	}
}

// callsOf filters the recorded calls by op.
func callsOf(calls []jobCall, op string) [][]string {
	var out [][]string
	for _, c := range calls {
		if c.op == op {
			out = append(out, c.args)
		}
	}
	return out
}

func TestRunJobDaemonGateRefusesWithoutServer(t *testing.T) {
	f := &jobFixture{daemonRunning: false}
	withJobSeams(t, f)

	_, started, err := RunJob(context.Background(), "update", []string{"shll", "update"})

	if err == nil {
		t.Fatal("RunJob must error when the daemon is not running")
	}
	if !strings.Contains(err.Error(), "not running") {
		t.Errorf("error = %q, want it to name the daemon requirement", err)
	}
	if started {
		t.Error("started = true, want false on the gate refusal")
	}
	if len(*f.calls) != 0 {
		t.Errorf("tmux calls = %v, want none — the gate must run before any tmux command (no server birth)", *f.calls)
	}
}

func TestRunJobFreshSpawnEnsuresSessionAndSpawns(t *testing.T) {
	f := &jobFixture{daemonRunning: true, sessionExists: false}
	withJobSeams(t, f)

	target, started, err := RunJob(context.Background(), "update", []string{"shll", "update", "wt"})
	if err != nil {
		t.Fatalf("RunJob: %v", err)
	}
	if !started {
		t.Error("started = false, want true on a fresh spawn")
	}
	want := JobTarget{Server: serverSocket, Session: "rk-jobs", Window: "update", WindowID: "@7"}
	if target != want {
		t.Errorf("target = %+v, want %+v", target, want)
	}

	runs := callsOf(*f.calls, "run")
	if len(runs) != 3 {
		t.Fatalf("run calls = %v, want [new-session, set-option, pipe-pane]", runs)
	}
	if got := strings.Join(runs[0], " "); got != "new-session -d -s rk-jobs" {
		t.Errorf("session ensure argv = %q, want %q", got, "new-session -d -s rk-jobs")
	}
	if got := strings.Join(runs[1], " "); got != "set-option -w -t =rk-jobs:=update remain-on-exit failed" {
		t.Errorf("remain-on-exit argv = %q", got)
	}
	pipe := strings.Join(runs[2], " ")
	if !strings.HasPrefix(pipe, "pipe-pane -o -t =rk-jobs:=update cat >> '") || !strings.HasSuffix(pipe, ".rk/update.log'") {
		t.Errorf("pipe-pane argv = %q, want a cat >> '…/.rk/update.log' tee on the exact-match target", pipe)
	}

	outputs := callsOf(*f.calls, "output")
	if len(outputs) != 1 {
		t.Fatalf("output calls = %v, want [new-window]", outputs)
	}
	if got := strings.Join(outputs[0], " "); got != "new-window -d -t =rk-jobs: -n update -P -F #{window_id} shll update wt" {
		t.Errorf("spawn argv = %q", got)
	}

	states := callsOf(*f.calls, "state")
	if len(states) != 1 || states[0][0] != "=rk-jobs:=update" {
		t.Errorf("window-state probes = %v, want one exact-match probe on =rk-jobs:=update", states)
	}
}

func TestRunJobQuotesLogPathForPipePane(t *testing.T) {
	f := &jobFixture{daemonRunning: true, sessionExists: true}
	withJobSeams(t, f)
	// A home with a space (e.g. /Users/Jane Doe) must not break the shell-
	// interpreted pipe-pane redirection — the path is single-quoted.
	jobUserHomeDir = func() (string, error) { return "/Users/Jane Doe", nil }

	if _, _, err := RunJob(context.Background(), "update", []string{"shll", "update"}); err != nil {
		t.Fatalf("RunJob: %v", err)
	}

	var pipe []string
	for _, r := range callsOf(*f.calls, "run") {
		if r[0] == "pipe-pane" {
			pipe = r
		}
	}
	if pipe == nil {
		t.Fatal("no pipe-pane call recorded")
	}
	want := "cat >> '/Users/Jane Doe/.rk/update.log'"
	if got := pipe[len(pipe)-1]; got != want {
		t.Errorf("pipe-pane command = %q, want %q", got, want)
	}
}

func TestRunJobSkipsSessionEnsureWhenPresent(t *testing.T) {
	f := &jobFixture{daemonRunning: true, sessionExists: true}
	withJobSeams(t, f)

	if _, _, err := RunJob(context.Background(), "update", []string{"shll", "update"}); err != nil {
		t.Fatalf("RunJob: %v", err)
	}
	for _, r := range callsOf(*f.calls, "run") {
		if r[0] == "new-session" {
			t.Errorf("new-session ran with rk-jobs already present: %v", r)
		}
	}
}

func TestRunJobToleratesDuplicateSessionRace(t *testing.T) {
	f := &jobFixture{daemonRunning: true, sessionExists: false, runErr: fmt.Errorf("exit status 1: duplicate session: rk-jobs")}
	withJobSeams(t, f)

	// The create loses a concurrent-ensure race; RunJob proceeds to spawn
	// (the remaining run calls also error — set-option/pipe-pane are
	// best-effort, so the spawn still reports success).
	_, started, err := RunJob(context.Background(), "update", []string{"true"})
	if err != nil {
		t.Fatalf("RunJob: %v", err)
	}
	if !started {
		t.Error("started = false, want true — a duplicate-session race is the ensured state")
	}
}

func TestRunJobInFlightWindowReturnsExistingTarget(t *testing.T) {
	f := &jobFixture{
		daemonRunning: true,
		sessionExists: true,
		state:         func(string) (string, bool, bool) { return "@9", false, true },
	}
	withJobSeams(t, f)

	target, started, err := RunJob(context.Background(), "update", []string{"shll", "update"})
	if err != nil {
		t.Fatalf("RunJob: %v", err)
	}
	if started {
		t.Error("started = true, want false for a live in-flight window")
	}
	if target.WindowID != "@9" {
		t.Errorf("target.WindowID = %q, want the existing window id @9", target.WindowID)
	}
	if n := len(callsOf(*f.calls, "output")); n != 0 {
		t.Errorf("new-window spawns = %d, want 0 (no duplicate window)", n)
	}
	for _, r := range callsOf(*f.calls, "run") {
		if r[0] == "kill-window" {
			t.Errorf("kill-window ran against a LIVE window: %v", r)
		}
	}
}

func TestRunJobDeadPaneWindowIsReapedAndRespawned(t *testing.T) {
	f := &jobFixture{
		daemonRunning: true,
		sessionExists: true,
		state:         func(string) (string, bool, bool) { return "@4", true, true },
	}
	withJobSeams(t, f)

	target, started, err := RunJob(context.Background(), "update", []string{"shll", "update"})
	if err != nil {
		t.Fatalf("RunJob: %v", err)
	}
	if !started {
		t.Error("started = false, want true — the stale window is reaped and respawned")
	}
	if target.WindowID != "@7" {
		t.Errorf("target.WindowID = %q, want the FRESH spawn's id @7, not the reaped @4", target.WindowID)
	}
	runs := callsOf(*f.calls, "run")
	if len(runs) == 0 || strings.Join(runs[0], " ") != "kill-window -t =rk-jobs:=update" {
		t.Errorf("first run call = %v, want the kill-window reap of the dead window", runs)
	}
}

func TestRunJobSpawnErrorPropagates(t *testing.T) {
	f := &jobFixture{daemonRunning: true, sessionExists: true, outputErr: fmt.Errorf("exit status 1")}
	withJobSeams(t, f)

	_, started, err := RunJob(context.Background(), "update", []string{"shll", "update"})
	if err == nil {
		t.Fatal("RunJob must propagate a spawn failure")
	}
	if started {
		t.Error("started = true, want false on a spawn failure")
	}
	if !strings.Contains(err.Error(), "spawning") {
		t.Errorf("error = %q, want it to name the spawn step", err)
	}
}

func TestRunJobPostSpawnOptionFailuresAreBestEffort(t *testing.T) {
	// Every run-op (set-option + pipe-pane) fails; the spawn still succeeds.
	f := &jobFixture{daemonRunning: true, sessionExists: true, runErr: fmt.Errorf("tmux 3.1: unknown option")}
	withJobSeams(t, f)

	_, started, err := RunJob(context.Background(), "update", []string{"shll", "update"})
	if err != nil {
		t.Fatalf("RunJob must not fail on post-spawn option errors: %v", err)
	}
	if !started {
		t.Error("started = false, want true")
	}
}

func TestRunJobValidatesWindowName(t *testing.T) {
	for _, name := range []string{"", "-evil", "has space", "semi;colon", "colon:name", "dot.name"} {
		t.Run(fmt.Sprintf("name=%q", name), func(t *testing.T) {
			f := &jobFixture{daemonRunning: true, sessionExists: true}
			withJobSeams(t, f)

			_, _, err := RunJob(context.Background(), name, []string{"true"})
			if err == nil {
				t.Errorf("RunJob(window=%q) must reject the name before it becomes a tmux target", name)
			}
			if len(*f.calls) != 0 {
				t.Errorf("tmux calls = %v, want none — validation precedes every tmux command", *f.calls)
			}
		})
	}
}

func TestRunJobRejectsEmptyArgv(t *testing.T) {
	f := &jobFixture{daemonRunning: true, sessionExists: true}
	withJobSeams(t, f)

	if _, _, err := RunJob(context.Background(), "update", nil); err == nil {
		t.Error("RunJob with an empty argv must error (a window running nothing)")
	}
	if len(*f.calls) != 0 {
		t.Errorf("tmux calls = %v, want none", *f.calls)
	}
}
