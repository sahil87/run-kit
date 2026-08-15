package main

import (
	"errors"
	"strings"
	"testing"

	"rk/internal/tmux"
)

// TestMuxCaptureHumanOutput: the default shape is the header block — context
// line joining only the resolved parts, then the content untrimmed (R2/R3).
func TestMuxCaptureHumanOutput(t *testing.T) {
	f := &muxFake{}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "capture", "%5")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	// Default fake: %5 idle at epoch 1_800_000_000, now 1_800_000_300 → 5m.
	want := "--- pane %5 ---\n" +
		"cwd: /home/x/code/repo | agent: idle (5m)\n" +
		"---\n" +
		"line one\nline two\n"
	if stdout != want {
		t.Errorf("stdout = %q, want %q", stdout, want)
	}
	if len(f.captureCalls) != 1 || f.captureCalls[0].lines != 50 || f.captureCalls[0].server != "default" {
		t.Errorf("capture calls = %+v, want one 50-line capture on the default server", f.captureCalls)
	}
}

// TestMuxCaptureRawByteIdentical: --raw prints exactly the captured text — no
// header, no enrichment, no trimming (R2).
func TestMuxCaptureRawByteIdentical(t *testing.T) {
	content := "  spaced  \n\ntrailing blanks\n\n"
	f := &muxFake{captureContent: map[string]string{"%5": content}}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "capture", "%5", "--raw")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if stdout != content {
		t.Errorf("stdout = %q, want byte-identical %q", stdout, content)
	}
}

// TestMuxCaptureJSONShape: --json carries the documented shape with nulls for
// uninstrumented fields (R2/R3).
func TestMuxCaptureJSONShape(t *testing.T) {
	f := &muxFake{states: map[string]string{"%5": ""}} // uninstrumented
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "capture", "%5", "--json", "--lines", "200")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	want := "{\n" +
		"  \"pane\": \"%5\",\n" +
		"  \"lines\": 200,\n" +
		"  \"content\": \"line one\\nline two\\n\",\n" +
		"  \"cwd\": \"/home/x/code/repo\",\n" +
		"  \"agent_state\": null,\n" +
		"  \"agent_state_duration\": null\n" +
		"}\n"
	if stdout != want {
		t.Errorf("stdout = %q, want %q", stdout, want)
	}
	if f.captureCalls[0].lines != 200 {
		t.Errorf("--lines did not reach the capture: %+v", f.captureCalls[0])
	}
}

// TestMuxCaptureContextLineOmission: an empty cwd or an uninstrumented pane
// drops its part; with zero parts the context line disappears entirely (R3).
func TestMuxCaptureContextLineOmission(t *testing.T) {
	cases := []struct {
		name     string
		facts    tmux.PaneFacts
		wantLine string // "" = no context line at all
	}{
		{"no cwd", tmux.PaneFacts{AgentState: tmux.AgentStateIdle, AgentStateEpoch: 1_800_000_000}, "agent: idle (5m)"},
		{"uninstrumented", tmux.PaneFacts{CWD: "/tmp"}, "cwd: /tmp"},
		{"no parts", tmux.PaneFacts{}, ""},
		{"active carries no duration", tmux.PaneFacts{CWD: "/tmp", AgentState: tmux.AgentStateActive, AgentStateEpoch: 1_800_000_000}, "cwd: /tmp | agent: active"},
		{"waiting carries a duration", tmux.PaneFacts{AgentState: tmux.AgentStateWaiting, AgentStateEpoch: 1_800_000_180}, "agent: waiting (2m)"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := &muxFake{facts: map[string]tmux.PaneFacts{"%5": tc.facts}}
			installMuxFakes(t, f)

			stdout, _, err := runMuxCmd(t, "capture", "%5")
			if err != nil {
				t.Fatalf("err = %v", err)
			}
			lines := strings.Split(stdout, "\n")
			if len(lines) < 2 || lines[0] != "--- pane %5 ---" {
				t.Fatalf("stdout = %q, want the header block", stdout)
			}
			if tc.wantLine == "" {
				if lines[1] != "---" {
					t.Errorf("stdout = %q, want no context line", stdout)
				}
				return
			}
			if lines[1] != tc.wantLine || lines[2] != "---" {
				t.Errorf("context line = %q, want %q", lines[1], tc.wantLine)
			}
		})
	}
}

// TestMuxCaptureValidation: target grammar and flag validation are usage
// errors (exit 2); --json/--raw are mutually exclusive (R1/R2).
func TestMuxCaptureValidation(t *testing.T) {
	f := &muxFake{}
	installMuxFakes(t, f)

	for _, args := range [][]string{
		{"capture", "mysession:win"},             // bare name rejected
		{"capture", "%5", "--lines", "0"},        // < 1
		{"capture", "%5", "--json", "--raw"},     // mutually exclusive
		{"capture"},                              // missing target
		{"capture", "%5", "%6"},                  // extra arg
	} {
		stdout, _, err := runMuxCmd(t, args...)
		if err == nil || exitCode(err) != exitUsage {
			t.Errorf("args %v: err = %v (exit %d), want usage exit 2", args, err, exitCode(err))
		}
		if stdout != "" {
			t.Errorf("args %v: stdout = %q, want empty on usage error", args, stdout)
		}
	}
	if len(f.captureCalls) != 0 {
		t.Errorf("capture ran on usage errors: %v", f.captureCalls)
	}

	_, _, err := runMuxCmd(t, "capture", "mysession:win")
	for _, want := range []string{"%N", "@N", "=session:window"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q missing accepted form %q", err.Error(), want)
		}
	}
}

// TestMuxCaptureWindowTargetResolves: a window target routes to the window's
// agent pane before capture (R1).
func TestMuxCaptureWindowTargetResolves(t *testing.T) {
	f := &muxFake{}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "capture", "@3", "--raw")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(f.captureCalls) != 1 || f.captureCalls[0].paneID != "%7" {
		t.Errorf("capture calls = %+v, want the resolved agent pane %%7", f.captureCalls)
	}
	if stdout == "" {
		t.Error("stdout empty, want the captured text")
	}
}

// TestMuxCaptureOperationalErrors: a tmux capture failure or a missing pane is
// exit 1 carrying the diagnostic (R2, A-010).
func TestMuxCaptureOperationalErrors(t *testing.T) {
	f := &muxFake{captureErr: errors.New("exit status 1: can't find pane: %9")}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "capture", "%9")
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("err = %v, want exit 1", err)
	}
	if !strings.Contains(err.Error(), "can't find pane") {
		t.Errorf("err = %v, want tmux's stderr diagnostic", err)
	}
	if stdout != "" {
		t.Errorf("stdout = %q on a failed capture, want empty", stdout)
	}

	// The enrichment read failing is likewise operational (non-raw modes).
	f.captureErr = nil
	f.factsErr = errors.New("exit status 1: no server running")
	_, _, err = runMuxCmd(t, "capture", "%5")
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("facts read: err = %v, want exit 1", err)
	}
}
