package main

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

// NOTE (tmux safety): these tests never start, attach to, or kill any tmux
// server. Every tmux invocation routes through the roleRunFn/roleRunOutputFn
// seams, which the tests stub.

// roleTestSocket is the fake $TMUX the seam serves so every test runs the
// derived-socket path deterministically (the real tmux.OriginalTMUX is fixed at
// package-init time and varies with whether `go test` itself ran inside tmux).
const roleTestSocket = "/tmp/rk-test.sock"

// stubRoleSeams installs recording stubs for the tmux seams and the radio-clear
// seam, returning the recorded calls. clearKeepID (when non-nil) records the
// keep-window-id the radio clear was invoked with.
func stubRoleSeams(t *testing.T) (calls *[][]string, clearKeepID *string) {
	t.Helper()
	recorded := [][]string{}
	calls = &recorded
	keep := ""
	clearKeepID = &keep
	origTMUX := roleOriginalTMUXFn
	roleOriginalTMUXFn = func() string { return roleTestSocket + ",1234,0" }
	t.Cleanup(func() { roleOriginalTMUXFn = origTMUX })
	origRun, origOut, origClear := roleRunFn, roleRunOutputFn, roleClearExceptFn
	roleRunFn = func(_ context.Context, args []string) error {
		recorded = append(recorded, args)
		return nil
	}
	roleRunOutputFn = func(_ context.Context, args []string) ([]byte, error) {
		recorded = append(recorded, args)
		// The only read is the window-id resolution.
		return []byte("@7\n"), nil
	}
	roleClearExceptFn = func(_ context.Context, _ []string, keepWindowID string) error {
		keep = keepWindowID
		return nil
	}
	t.Cleanup(func() { roleRunFn, roleRunOutputFn, roleClearExceptFn = origRun, origOut, origClear })
	return calls, clearKeepID
}

func roleTestCmd() (*cobra.Command, *bytes.Buffer) {
	buf := &bytes.Buffer{}
	cmd := &cobra.Command{}
	cmd.SetOut(buf)
	return cmd, buf
}

// Outside tmux ($TMUX_PANE unset) the command errors and issues zero tmux calls.
func TestRoleOutsideTmuxErrors(t *testing.T) {
	t.Setenv("TMUX_PANE", "")
	calls, _ := stubRoleSeams(t)

	cmd, _ := roleTestCmd()
	err := runRole(cmd, "operator")
	if err == nil || !strings.Contains(err.Error(), "not inside a tmux pane") {
		t.Fatalf("runRole() error = %v, want a not-inside-tmux error", err)
	}
	if len(*calls) != 0 {
		t.Errorf("tmux calls = %v, want none", *calls)
	}
}

// Every tmux call is prefixed with `-S <socket>` derived from the original
// $TMUX, so the write lands on the PANE's server, never the default one.
func TestRoleTargetsPaneOwnSocket(t *testing.T) {
	t.Setenv("TMUX_PANE", "%3")
	calls, _ := stubRoleSeams(t)

	cmd, _ := roleTestCmd()
	if err := runRole(cmd, "operator"); err != nil {
		t.Fatalf("runRole() = %v", err)
	}
	for i, call := range *calls {
		if len(call) < 2 || call[0] != "-S" || call[1] != roleTestSocket {
			t.Errorf("call[%d] = %v, want the -S %s prefix", i, call, roleTestSocket)
		}
	}
}

// $TMUX_PANE without a usable $TMUX (the `tmux run-shell` shape) must hard-error
// rather than fall back to a bare invocation — a bare call would resolve the
// pane and radio-clear @rk_role against whichever server owns the default
// socket.
func TestRoleUnderivableSocketErrors(t *testing.T) {
	t.Setenv("TMUX_PANE", "%3")
	calls, clearKeepID := stubRoleSeams(t)
	roleOriginalTMUXFn = func() string { return "" }

	cmd, _ := roleTestCmd()
	err := runRole(cmd, "operator")
	if err == nil || !strings.Contains(err.Error(), "cannot derive this pane's tmux server socket") {
		t.Fatalf("runRole() error = %v, want an underivable-socket error", err)
	}
	if len(*calls) != 0 {
		t.Errorf("tmux calls = %v, want none", *calls)
	}
	if *clearKeepID != "" {
		t.Errorf("radio clear invoked with keepID %q — no server may be touched", *clearKeepID)
	}
}

// An unknown token errors before any tmux call (arg validation first).
func TestRoleUnknownTokenErrors(t *testing.T) {
	t.Setenv("TMUX_PANE", "%3")
	calls, _ := stubRoleSeams(t)

	cmd, _ := roleTestCmd()
	err := runRole(cmd, "manager")
	if err == nil || !strings.Contains(err.Error(), "unknown role action") {
		t.Fatalf("runRole() error = %v, want an unknown-action error", err)
	}
	if len(*calls) != 0 {
		t.Errorf("tmux calls = %v, want none", *calls)
	}
}

// `rk role operator` resolves the current window, runs the radio clear, sets
// @rk_role=operator on it, and prints a one-line confirmation to stdout.
func TestRoleOperatorSets(t *testing.T) {
	t.Setenv("TMUX_PANE", "%3")
	calls, clearKeepID := stubRoleSeams(t)

	cmd, buf := roleTestCmd()
	if err := runRole(cmd, "operator"); err != nil {
		t.Fatalf("runRole() = %v", err)
	}
	if len(*calls) != 2 {
		t.Fatalf("tmux calls = %v, want 2 (display-message, set-option)", *calls)
	}
	if got := strings.Join((*calls)[0], " "); !strings.Contains(got, "display-message -pt %3 #{window_id}") {
		t.Errorf("call[0] = %q, want the window-id resolution", got)
	}
	if got := strings.Join((*calls)[1], " "); !strings.Contains(got, "set-option -w -t @7 @rk_role operator") {
		t.Errorf("call[1] = %q, want the role set on @7", got)
	}
	if *clearKeepID != "@7" {
		t.Errorf("radio clear keepWindowID = %q, want @7 (clear others, keep target)", *clearKeepID)
	}
	if !strings.Contains(buf.String(), "@7 role=operator") {
		t.Errorf("stdout = %q, want the confirmation line", buf.String())
	}
}

// `rk role clear` unsets @rk_role on the current window and skips the radio
// clear (nothing is being marked).
func TestRoleClearUnsets(t *testing.T) {
	t.Setenv("TMUX_PANE", "%3")
	calls, clearKeepID := stubRoleSeams(t)

	cmd, buf := roleTestCmd()
	if err := runRole(cmd, "clear"); err != nil {
		t.Fatalf("runRole() = %v", err)
	}
	if len(*calls) != 2 {
		t.Fatalf("tmux calls = %v, want 2 (display-message, set-option -wu — no radio clear)", *calls)
	}
	if got := strings.Join((*calls)[1], " "); !strings.Contains(got, "set-option -wu -t @7 @rk_role") {
		t.Errorf("call[1] = %q, want the role unset on @7", got)
	}
	if *clearKeepID != "" {
		t.Errorf("radio clear invoked with keepID %q — an unset must NOT clear others", *clearKeepID)
	}
	if !strings.Contains(buf.String(), "@7 role cleared") {
		t.Errorf("stdout = %q, want the confirmation line", buf.String())
	}
}

// A failure resolving the current window surfaces as an error, not a write to
// a guessed target.
func TestRoleWindowResolutionFailure(t *testing.T) {
	t.Setenv("TMUX_PANE", "%3")
	origTMUX := roleOriginalTMUXFn
	roleOriginalTMUXFn = func() string { return roleTestSocket + ",1234,0" }
	t.Cleanup(func() { roleOriginalTMUXFn = origTMUX })
	origOut := roleRunOutputFn
	roleRunOutputFn = func(context.Context, []string) ([]byte, error) {
		return nil, fmt.Errorf("boom")
	}
	t.Cleanup(func() { roleRunOutputFn = origOut })
	runCalled := false
	origRun := roleRunFn
	roleRunFn = func(context.Context, []string) error { runCalled = true; return nil }
	t.Cleanup(func() { roleRunFn = origRun })

	cmd, _ := roleTestCmd()
	if err := runRole(cmd, "operator"); err == nil {
		t.Fatal("runRole() = nil, want an error when the window cannot be resolved")
	}
	if runCalled {
		t.Error("no tmux write must follow a failed window-id resolution")
	}
}
