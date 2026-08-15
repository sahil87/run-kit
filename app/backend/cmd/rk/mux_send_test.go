package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"rk/internal/inject"
	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

// muxFake holds the installed mux-verb seams and their recordings. Defaults:
// server "default" (no $TMUX), pane %5 idle, window targets resolve to %7.
type muxFake struct {
	server      string
	states      map[string]string // pane → gate state ("" = unknown)
	paneExists  map[string]bool
	windowPanes map[string]string // window target → resolved pane

	engineCalls  []muxEngineCall
	engineErr    error
	keysSent     [][]string
	awaitRuns    []awaitParams
	awaitReports []string // consumed one per awaitObserveFn call
	awaitErrs    []error  // per-call errors parallel to awaitReports (nil = awaitErr rides the last)
	awaitErr     error
	stdin        string
	bufferName   string
}

type muxEngineCall struct {
	server, paneID, text string
	submit               bool
	buffer               string
}

// installMuxFakes wires every mux-verb seam to the fake (the
// installPresentFakes pattern) and restores the production defaults on cleanup.
func installMuxFakes(t *testing.T, f *muxFake) {
	t.Helper()

	origTMUX, origFlag := muxOriginalTMUXFn, muxServerFlag
	origEngine, origKeys := muxSendEngineSendFn, muxSendKeysFn
	origState, origExists, origResolve := muxSendAgentStateFn, muxSendPaneExistsFn, muxSendResolveWindowFn
	origAwait, origAwaitDeps := muxAwaitObserveFn, muxAwaitDepsFn
	origStdin, origBuf := muxStdinFn, muxBufferNameFn
	t.Cleanup(func() {
		muxOriginalTMUXFn, muxServerFlag = origTMUX, origFlag
		muxSendEngineSendFn, muxSendKeysFn = origEngine, origKeys
		muxSendAgentStateFn, muxSendPaneExistsFn, muxSendResolveWindowFn = origState, origExists, origResolve
		muxAwaitObserveFn, muxAwaitDepsFn = origAwait, origAwaitDeps
		muxStdinFn, muxBufferNameFn = origStdin, origBuf
		resetMuxFlags()
	})

	if f.states == nil {
		f.states = map[string]string{"%5": tmux.AgentStateIdle}
	}
	if f.windowPanes == nil {
		f.windowPanes = map[string]string{"@3": "%7", "=work:editor": "%7"}
	}
	muxOriginalTMUXFn = func() string { return "" } // server resolves to "default"
	muxServerFlag = f.server

	muxSendAgentStateFn = func(_ context.Context, paneID, _ string) (string, error) {
		return f.states[paneID], nil
	}
	muxSendPaneExistsFn = func(_ context.Context, paneID, _ string) (bool, error) {
		if f.paneExists == nil {
			return true, nil
		}
		return f.paneExists[paneID], nil
	}
	muxSendResolveWindowFn = func(_ context.Context, windowTarget, _ string) (string, error) {
		if p, ok := f.windowPanes[windowTarget]; ok {
			return p, nil
		}
		return "", errors.New("can't find window")
	}
	muxSendEngineSendFn = func(_ context.Context, engine *inject.Engine, _ inject.Tmux, server, paneID, text string, submit bool) error {
		f.engineCalls = append(f.engineCalls, muxEngineCall{server, paneID, text, submit, engine.Buffer()})
		return f.engineErr
	}
	muxSendKeysFn = func(_ context.Context, paneID, _ string, keys ...string) error {
		f.keysSent = append(f.keysSent, append([]string{paneID}, keys...))
		return nil
	}
	muxAwaitObserveFn = func(_ context.Context, _ awaitDeps, _ string, p awaitParams) (string, error) {
		f.awaitRuns = append(f.awaitRuns, p)
		if len(f.awaitReports) > 0 {
			r := f.awaitReports[0]
			f.awaitReports = f.awaitReports[1:]
			var err error
			if len(f.awaitErrs) > 0 {
				err = f.awaitErrs[0]
				f.awaitErrs = f.awaitErrs[1:]
			} else if len(f.awaitReports) == 0 && f.awaitErr != nil {
				// awaitErr rides the LAST scripted report (a mid-composition
				// error would end the sequence before reaching it).
				err = f.awaitErr
			}
			return r, err
		}
		return "running", f.awaitErr
	}
	muxStdinFn = func() io.Reader { return strings.NewReader(f.stdin) }
	muxBufferNameFn = func() string { return "rk-send-4242" }
}

// resetMuxFlags returns every mux flag (and the root --quiet) to its default so
// no state bleeds between tests (the resetPresentFlagState pattern).
func resetMuxFlags() {
	muxSendKeysFlag = nil
	muxSendAnswerFlag, muxSendForceFlag, muxSendNoEnterFlag = false, false, false
	muxSendAwaitFlag, muxSendTimeoutFlag = "", awaitDefaultTimeoutSec
	awaitUntilFlag, awaitFileFlag = tmux.AgentStateIdle, ""
	awaitAfterActiveFlag = false
	awaitTimeoutFlag = awaitDefaultTimeoutSec
	awaitNotifyFlag = ""
	resetFlagChanged(muxSendCmd, "key", "answer", "force", "no-enter", "await", "timeout")
	resetFlagChanged(muxAwaitCmd, "until", "file", "after-active", "timeout", "notify")
	if f := rootCmd.PersistentFlags().Lookup("quiet"); f != nil {
		_ = rootCmd.PersistentFlags().Set("quiet", "false")
		f.Changed = false
	}
	quiet = false
}

// resetFlagChanged restores each named flag on cmd to its default VALUE and
// clears Changed. Slice flags (StringArray, e.g. --key) go through
// pflag.SliceValue.Replace — a plain Set(DefValue) would append the literal
// "[]" string instead of emptying the slice.
func resetFlagChanged(cmd *cobra.Command, names ...string) {
	for _, name := range names {
		f := cmd.Flags().Lookup(name)
		if f == nil {
			continue
		}
		if sv, ok := f.Value.(interface{ Replace([]string) error }); ok {
			_ = sv.Replace(nil)
		} else {
			_ = f.Value.Set(f.DefValue)
		}
		f.Changed = false
	}
}

// runMuxCmd drives `rk mux <args...>` through the real cobra Execute() seam
// (the runPresentCmd pattern) so flag parsing, mutual exclusion, and exit
// classification run exactly as in production.
func runMuxCmd(t *testing.T, args ...string) (string, string, error) {
	t.Helper()
	resetRootFlagState(t)
	resetMuxFlags()
	t.Cleanup(resetMuxFlags)
	var stdout, stderr bytes.Buffer
	rootCmd.SetOut(&stdout)
	rootCmd.SetErr(&stderr)
	rootCmd.SetArgs(append([]string{"mux"}, args...))
	t.Cleanup(func() {
		rootCmd.SetOut(nil)
		rootCmd.SetErr(nil)
		rootCmd.SetArgs(nil)
	})
	err := rootCmd.Execute()
	return stdout.String(), stderr.String(), err
}

// TestMuxSendGateMatrix drives the full gate matrix (R4) through the real
// cobra path: unknown warns+sends, idle sends, waiting refuses without
// --answer, active refuses even with --answer. Refusals name the state and
// carry exit 1 with NO delivery.
func TestMuxSendGateMatrix(t *testing.T) {
	cases := []struct {
		name        string
		state       string
		args        []string
		wantDeliver bool
		wantErr     bool
		wantInErr   string
		wantWarn    bool
	}{
		{"unknown warns and sends", "", []string{"%5", "hi"}, true, false, "", true},
		{"idle sends", tmux.AgentStateIdle, []string{"%5", "hi"}, true, false, "", false},
		{"waiting refuses plain", tmux.AgentStateWaiting, []string{"%5", "hi"}, false, true, "waiting", false},
		{"waiting sends with --answer", tmux.AgentStateWaiting, []string{"%5", "hi", "--answer"}, true, false, "", false},
		{"active refuses plain", tmux.AgentStateActive, []string{"%5", "hi"}, false, true, "active", false},
		{"active refuses --answer", tmux.AgentStateActive, []string{"%5", "hi", "--answer"}, false, true, "active", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := &muxFake{states: map[string]string{"%5": tc.state}}
			installMuxFakes(t, f)

			stdout, stderr, err := runMuxCmd(t, append([]string{"send"}, tc.args...)...)

			if tc.wantErr {
				if err == nil || exitCode(err) != 1 {
					t.Fatalf("err = %v, want exit-1 refusal", err)
				}
				if !strings.Contains(err.Error(), tc.wantInErr) {
					t.Errorf("refusal %q does not name state %q", err.Error(), tc.wantInErr)
				}
			} else if err != nil {
				t.Fatalf("err = %v, want success", err)
			}
			if got := len(f.engineCalls) > 0; got != tc.wantDeliver {
				t.Errorf("delivered = %v, want %v", got, tc.wantDeliver)
			}
			if tc.wantDeliver {
				if stdout != "delivered %5\n" {
					t.Errorf("stdout = %q, want the single report line", stdout)
				}
				call := f.engineCalls[0]
				if call.paneID != "%5" || call.text != "hi" || !call.submit || call.buffer != "rk-send-4242" {
					t.Errorf("engine call = %+v, want pane %%5 text hi submit buffer rk-send-4242", call)
				}
			} else if tc.wantErr && stdout != "" {
				t.Errorf("stdout = %q on a refusal, want empty", stdout)
			}
			if tc.wantWarn && !strings.Contains(stderr, "no readable agent state") {
				t.Errorf("stderr = %q, want the unknown-state warning", stderr)
			}
		})
	}
}

// TestMuxSendPayloadValidation: zero payloads and mixed kinds are usage errors
// (exit 2); the gate/delivery never runs (R3).
func TestMuxSendPayloadValidation(t *testing.T) {
	f := &muxFake{}
	installMuxFakes(t, f)

	for _, args := range [][]string{
		{"send", "%5"},                                // no payload
		{"send", "%5", "hi", "--key", "Enter"},        // message + key
		{"send", "%5", "hi", "--answer", "--force"},   // mutually exclusive
		{"send", "%5", "   "},                         // whitespace-only message
		{"send", "%5", "hi", "--await", "--no-enter"}, // nothing submitted to wait on
		{"send", "%5", "hi", "--timeout", "-5"},       // negative timeout
		{"send", "%5", "hi", "--await=busy"},          // unknown state
	} {
		stdout, _, err := runMuxCmd(t, args...)
		if err == nil || exitCode(err) != exitUsage {
			t.Errorf("args %v: err = %v (exit %d), want usage exit 2", args, err, exitCode(err))
		}
		if stdout != "" {
			t.Errorf("args %v: stdout = %q, want empty on usage error", args, stdout)
		}
	}
	if len(f.engineCalls) != 0 || len(f.keysSent) != 0 {
		t.Errorf("delivery ran on usage errors: engine=%v keys=%v", f.engineCalls, f.keysSent)
	}
}

// TestMuxSendTargetGrammar: bare session:window names are rejected as usage
// errors naming the three accepted forms (R2); window forms resolve to the
// agent pane.
func TestMuxSendTargetGrammar(t *testing.T) {
	f := &muxFake{}
	installMuxFakes(t, f)

	_, _, err := runMuxCmd(t, "send", "mysession:win", "hi")
	if err == nil || exitCode(err) != exitUsage {
		t.Fatalf("bare name: err = %v, want exit 2", err)
	}
	for _, want := range []string{"%N", "@N", "=session:window"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q missing accepted form %q", err.Error(), want)
		}
	}
	if len(f.engineCalls) != 0 {
		t.Error("delivery ran for a rejected target")
	}

	for _, target := range []string{"@3", "=work:editor"} {
		stdout, _, err := runMuxCmd(t, "send", target, "hi")
		if err != nil {
			t.Fatalf("target %s: err = %v", target, err)
		}
		call := f.engineCalls[len(f.engineCalls)-1]
		if call.paneID != "%7" {
			t.Errorf("target %s resolved to pane %q, want the agent pane %%7", target, call.paneID)
		}
		if stdout != "delivered %7\n" {
			t.Errorf("target %s: stdout = %q, want delivered %%7", target, stdout)
		}
	}
}

// TestMuxSendStdinPayload: `-` reads the message from stdin; multi-line text
// arrives as ONE sanitized payload (R3).
func TestMuxSendStdinPayload(t *testing.T) {
	f := &muxFake{stdin: "line one\r\nline two\x1b[201~ tail"}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "send", "%5", "-")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if stdout != "delivered %5\n" {
		t.Errorf("stdout = %q", stdout)
	}
	want := "line one\nline two[201~ tail" // CRLF normalized, ESC stripped
	if got := f.engineCalls[0].text; got != want {
		t.Errorf("stdin payload = %q, want sanitized %q", got, want)
	}
}

// TestMuxSendNoEnter: --no-enter stages the text (submit=false reaches the
// engine) and reports `staged %N` (R5/R7).
func TestMuxSendNoEnter(t *testing.T) {
	f := &muxFake{}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "send", "%5", "hi", "--no-enter")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if stdout != "staged %5\n" {
		t.Errorf("stdout = %q, want staged report", stdout)
	}
	if f.engineCalls[0].submit {
		t.Error("submit=true reached the engine under --no-enter")
	}
}

// TestMuxSendProbeFailure: a probe failure sends no Enter, carries the
// staged-text message on stderr, and exits 1 (R5 — the 409's CLI analog).
func TestMuxSendProbeFailure(t *testing.T) {
	f := &muxFake{engineErr: inject.ProbeFailure{}}
	installMuxFakes(t, f)

	stdout, stderr, err := runMuxCmd(t, "send", "%5", "hi")
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("err = %v, want exit 1", err)
	}
	if stdout != "" {
		t.Errorf("stdout = %q, want no report on probe failure", stdout)
	}
	if !strings.Contains(stderr, "Enter withheld") || !strings.Contains(stderr, "before retrying") {
		t.Errorf("stderr = %q, want the staged-text warning", stderr)
	}
}

// TestMuxSendKeyArm: --key sends raw tmux key names post-gate — no paste, no
// probe, report `sent %N` (R5).
func TestMuxSendKeyArm(t *testing.T) {
	f := &muxFake{}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "send", "%5", "--key", "Enter", "--key", "C-c")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if stdout != "sent %5\n" {
		t.Errorf("stdout = %q, want sent report", stdout)
	}
	if len(f.keysSent) != 1 || strings.Join(f.keysSent[0], " ") != "%5 Enter C-c" {
		t.Errorf("keys = %v, want one send-keys of [Enter C-c] to %%5", f.keysSent)
	}
	if len(f.engineCalls) != 0 {
		t.Errorf("engine ran for a --key send: %v", f.engineCalls)
	}
}

// TestMuxSendForceSkipsGate: --force skips the gate (no state read) but still
// validates target existence (R4).
func TestMuxSendForceSkipsGate(t *testing.T) {
	f := &muxFake{
		states:     map[string]string{"%5": tmux.AgentStateActive}, // would refuse unforced
		paneExists: map[string]bool{"%5": true},
	}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "send", "%5", "hi", "--force")
	if err != nil {
		t.Fatalf("err = %v (active state must be skipped under --force)", err)
	}
	if stdout != "delivered %5\n" {
		t.Errorf("stdout = %q", stdout)
	}

	// A missing pane under --force is an operational failure.
	f.paneExists["%5"] = false
	_, _, err = runMuxCmd(t, "send", "%5", "hi", "--force")
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("missing pane under --force: err = %v, want exit 1", err)
	}
}

// TestMuxSendAwaitComposition: --await first watches the active flip under the
// grace, then awaits the requested state set; the await report word is stdout's
// single line (R6/R7).
func TestMuxSendAwaitComposition(t *testing.T) {
	f := &muxFake{awaitReports: []string{"active", "waiting"}}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "send", "%5", "question", "--await")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if stdout != "waiting %5\n" {
		t.Errorf("stdout = %q, want the await report word", stdout)
	}
	if len(f.awaitRuns) != 2 {
		t.Fatalf("await runs = %d, want 2 (grace flip-watch + await)", len(f.awaitRuns))
	}
	grace, main := f.awaitRuns[0], f.awaitRuns[1]
	if len(grace.until) != 1 || grace.until[0] != tmux.AgentStateActive {
		t.Errorf("grace until = %v, want [active]", grace.until)
	}
	if grace.timeout != sendAwaitActiveGrace {
		t.Errorf("grace timeout = %v, want %v", grace.timeout, sendAwaitActiveGrace)
	}
	if strings.Join(main.until, ",") != "idle,waiting" {
		t.Errorf("await until = %v, want the default idle,waiting", main.until)
	}
	if main.timeout != awaitDefaultTimeoutSec*1e9 {
		t.Errorf("await timeout = %v, want the default 300s", main.timeout)
	}
}

// TestMuxSendAwaitGraceFallsThrough: a grace expiry (`running` from the
// flip-watch) still runs the await (hooks may lag), and its report is the
// final word (R6, plan decision).
func TestMuxSendAwaitGraceFallsThrough(t *testing.T) {
	f := &muxFake{awaitReports: []string{"running", "idle"}}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "send", "%5", "q", "--await=idle", "--timeout", "120")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if stdout != "idle %5\n" {
		t.Errorf("stdout = %q", stdout)
	}
	if len(f.awaitRuns) != 2 {
		t.Fatalf("await runs = %d, want the await to follow the expired grace", len(f.awaitRuns))
	}
	if got := f.awaitRuns[1].until; len(got) != 1 || got[0] != "idle" {
		t.Errorf("await until = %v, want [idle] from --await=idle", got)
	}
	if f.awaitRuns[1].timeout != 120*1e9 {
		t.Errorf("await timeout = %v, want 120s", f.awaitRuns[1].timeout)
	}
}

// TestMuxSendAwaitPeerGone: the peer dying during the composition reports
// `gone` and exits 1 (the await contract's operational failure).
func TestMuxSendAwaitPeerGone(t *testing.T) {
	f := &muxFake{
		awaitReports: []string{"active", "gone"},
		awaitErr:     errors.New("pane %5 is gone"),
	}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "send", "%5", "q", "--await")
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("err = %v, want exit 1", err)
	}
	if stdout != "gone %5\n" {
		t.Errorf("stdout = %q, want the gone report", stdout)
	}
}

// TestMuxSendQuietKeepsReport: --quiet drops the unknown-state warning (chatter)
// but never the stdout report line (Toolkit Principle 9, R11).
func TestMuxSendQuietKeepsReport(t *testing.T) {
	f := &muxFake{states: map[string]string{"%5": ""}}
	installMuxFakes(t, f)

	stdout, stderr, err := runMuxCmd(t, "send", "%5", "hi", "--quiet")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if stdout != "delivered %5\n" {
		t.Errorf("stdout = %q, want the report even under --quiet", stdout)
	}
	if strings.Contains(stderr, "no readable agent state") {
		t.Errorf("stderr = %q, want the warning suppressed under --quiet", stderr)
	}
}

// TestMuxSendAwaitUninstrumentedFallsThrough: on an UNINSTRUMENTED pane the
// grace watch's nothing-observable verdict is a fall-through, not the end of
// the composition — the delivery stands, and the main await applies its own
// uninstrumented rule (here the pane gained state in the meantime, so the wait
// completes normally).
func TestMuxSendAwaitUninstrumentedFallsThrough(t *testing.T) {
	f := &muxFake{
		states:       map[string]string{"%5": ""}, // gate: unknown → warn + send
		awaitReports: []string{"", "idle"},
		awaitErrs:    []error{errUnobservable, nil},
	}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "send", "%5", "q", "--await")
	if err != nil {
		t.Fatalf("err = %v, want the await to proceed past the grace verdict", err)
	}
	if stdout != "idle %5\n" {
		t.Errorf("stdout = %q, want the await report word", stdout)
	}
	if len(f.awaitRuns) != 2 {
		t.Fatalf("await runs = %d, want grace + main await", len(f.awaitRuns))
	}
}

// TestMuxSendAwaitUninstrumentedStillErrors: when the pane is STILL
// uninstrumented at the main await, the delivery report prints (the send
// succeeded) and the nothing-observable error exits 1.
func TestMuxSendAwaitUninstrumentedStillErrors(t *testing.T) {
	f := &muxFake{
		states:       map[string]string{"%5": ""},
		awaitReports: []string{"", ""},
		awaitErrs:    []error{errUnobservable, errUnobservable},
	}
	installMuxFakes(t, f)

	stdout, _, err := runMuxCmd(t, "send", "%5", "q", "--await")
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("err = %v, want exit 1", err)
	}
	if !errors.Is(err, errUnobservable) {
		t.Errorf("err = %v, want the nothing-observable verdict", err)
	}
	if stdout != "delivered %5\n" {
		t.Errorf("stdout = %q, want the delivery report (the send succeeded)", stdout)
	}
}
