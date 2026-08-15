package main

import (
	"errors"
	"strings"
	"testing"

	"rk/internal/tmux"
)

// TestMuxKillGateMatrix drives the full gate matrix (R4) through the real
// cobra path: active and waiting refuse (naming the state, no tmux mutation),
// idle and unknown kill.
func TestMuxKillGateMatrix(t *testing.T) {
	cases := []struct {
		name      string
		state     string
		wantKill  bool
		wantState string // state named in the refusal ("" = no refusal)
	}{
		{"unknown kills", "", true, ""},
		{"idle kills", tmux.AgentStateIdle, true, ""},
		{"waiting refuses", tmux.AgentStateWaiting, false, "waiting"},
		{"active refuses", tmux.AgentStateActive, false, "active"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := &muxFake{states: map[string]string{"%5": tc.state}}
			installMuxFakes(t, f)

			stdout, _, err := runMuxCmd(t, "kill", "%5")

			if tc.wantKill {
				if err != nil {
					t.Fatalf("err = %v, want the kill to proceed", err)
				}
				if stdout != "killed %5\n" {
					t.Errorf("stdout = %q, want the single report line", stdout)
				}
				if len(f.killCalls) != 1 || f.killCalls[0] != "%5" {
					t.Errorf("kill calls = %v, want one kill of %%5", f.killCalls)
				}
				return
			}

			// Refusal: exit 1, names the state, and provably performs no kill.
			if err == nil || exitCode(err) != 1 {
				t.Fatalf("err = %v, want exit-1 refusal", err)
			}
			if !strings.Contains(err.Error(), tc.wantState) {
				t.Errorf("refusal %q does not name state %q", err.Error(), tc.wantState)
			}
			if len(f.killCalls) != 0 {
				t.Errorf("kill ran on a refusal: %v", f.killCalls)
			}
			if stdout != "" {
				t.Errorf("stdout = %q on a refusal, want empty", stdout)
			}
		})
	}
}

// TestMuxKillForce: --force skips the gate (an active pane dies without a state
// read mattering) but still validates existence — a missing pane is exit 1 (R4).
func TestMuxKillForce(t *testing.T) {
	f := &muxFake{
		states:     map[string]string{"%5": tmux.AgentStateActive}, // would refuse unforced
		paneExists: map[string]bool{"%5": true},
	}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "kill", "%5", "--force")
	if err != nil {
		t.Fatalf("err = %v (the active gate must be skipped under --force)", err)
	}
	if stdout != "killed %5\n" {
		t.Errorf("stdout = %q", stdout)
	}

	f.paneExists["%5"] = false
	f.killCalls = nil
	_, _, err = runMuxCmd(t, "kill", "%5", "--force")
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("missing pane under --force: err = %v, want exit 1", err)
	}
	if len(f.killCalls) != 0 {
		t.Errorf("kill ran for a missing pane: %v", f.killCalls)
	}
}

// TestMuxKillTargetAndErrors: bare session:window names are usage errors (exit
// 2) naming the accepted forms; window targets resolve to the agent pane; a
// tmux kill failure is exit 1 carrying tmux's diagnostic (R1/R4).
func TestMuxKillTargetAndErrors(t *testing.T) {
	f := &muxFake{}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "kill", "mysession:win")
	if err == nil || exitCode(err) != exitUsage {
		t.Fatalf("bare name: err = %v, want exit 2", err)
	}
	for _, want := range []string{"%N", "@N", "=session:window"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q missing accepted form %q", err.Error(), want)
		}
	}
	if stdout != "" || len(f.killCalls) != 0 {
		t.Errorf("kill ran for a rejected target: stdout=%q kills=%v", stdout, f.killCalls)
	}

	stdout, _, err = runMuxCmd(t, "kill", "@3")
	if err != nil {
		t.Fatalf("window target: err = %v", err)
	}
	if stdout != "killed %7\n" {
		t.Errorf("stdout = %q, want the kill of the resolved agent pane %%7", stdout)
	}

	f.killErr = errors.New("exit status 1: can't find pane: %5")
	_, _, err = runMuxCmd(t, "kill", "%5")
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("tmux kill failure: err = %v, want exit 1", err)
	}
	if !strings.Contains(err.Error(), "can't find pane") {
		t.Errorf("err = %v, want tmux's stderr diagnostic", err)
	}
}
