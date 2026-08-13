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

// stubRoleSeams installs recording stubs for the tmux seams and the radio-clear
// seam, returning the recorded calls. clearKeepID (when non-nil) records the
// keep-window-id the radio clear was invoked with.
func stubRoleSeams(t *testing.T) (calls *[][]string, clearKeepID *string) {
	t.Helper()
	recorded := [][]string{}
	calls = &recorded
	keep := ""
	clearKeepID = &keep
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
