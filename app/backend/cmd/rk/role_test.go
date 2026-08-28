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

// stubRoleSeams installs recording stubs for the tmux seams and the
// radio-clear / move seams, returning the recorded calls. clearKeepID (when
// non-nil) records the keep-window-id the radio clear was invoked with.
// moveInIDs/demoteIDs record the windows handed to the move-in / demote seams.
func stubRoleSeams(t *testing.T) (calls *[][]string, clearKeepID *string, moveInIDs *[]string, demoteIDs *[]string) {
	t.Helper()
	recorded := [][]string{}
	calls = &recorded
	keep := ""
	clearKeepID = &keep
	movedIn := []string{}
	moveInIDs = &movedIn
	demoted := []string{}
	demoteIDs = &demoted
	origTMUX := roleOriginalTMUXFn
	roleOriginalTMUXFn = func() string { return roleTestSocket + ",1234,0" }
	t.Cleanup(func() { roleOriginalTMUXFn = origTMUX })
	origRun, origOut, origClear := roleRunFn, roleRunOutputFn, roleClearExceptFn
	origMoveIn, origDemote := roleMoveInFn, roleDemoteFn
	roleRunFn = func(_ context.Context, args []string) error {
		recorded = append(recorded, args)
		return nil
	}
	roleRunOutputFn = func(_ context.Context, args []string) ([]byte, error) {
		recorded = append(recorded, args)
		// The only read is the window-id resolution.
		return []byte("@7\n"), nil
	}
	roleClearExceptFn = func(_ context.Context, _ []string, keepWindowID string) ([]string, error) {
		keep = keepWindowID
		return nil, nil
	}
	roleMoveInFn = func(_ context.Context, _ []string, windowID string) error {
		movedIn = append(movedIn, windowID)
		return nil
	}
	roleDemoteFn = func(_ context.Context, _ []string, windowID string) error {
		demoted = append(demoted, windowID)
		return nil
	}
	t.Cleanup(func() {
		roleRunFn, roleRunOutputFn, roleClearExceptFn = origRun, origOut, origClear
		roleMoveInFn, roleDemoteFn = origMoveIn, origDemote
	})
	return calls, clearKeepID, moveInIDs, demoteIDs
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
	calls, _, _, _ := stubRoleSeams(t)

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
	calls, _, _, _ := stubRoleSeams(t)

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
// pane and radio-clear @rk_win_role against whichever server owns the default
// socket.
func TestRoleUnderivableSocketErrors(t *testing.T) {
	t.Setenv("TMUX_PANE", "%3")
	calls, clearKeepID, _, _ := stubRoleSeams(t)
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
	calls, _, _, _ := stubRoleSeams(t)

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
// @rk_win_role=operator on it, moves it into the operator session (option write
// first), and prints a one-line confirmation to stdout.
func TestRoleOperatorSets(t *testing.T) {
	t.Setenv("TMUX_PANE", "%3")
	calls, clearKeepID, moveInIDs, demoteIDs := stubRoleSeams(t)

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
	if got := strings.Join((*calls)[1], " "); !strings.Contains(got, "set-option -w -t @7 @rk_win_role operator") {
		t.Errorf("call[1] = %q, want the role set on @7", got)
	}
	if *clearKeepID != "@7" {
		t.Errorf("radio clear keepWindowID = %q, want @7 (clear others, keep target)", *clearKeepID)
	}
	if len(*moveInIDs) != 1 || (*moveInIDs)[0] != "@7" {
		t.Errorf("move-in window IDs = %v, want [@7]", *moveInIDs)
	}
	if len(*demoteIDs) != 0 {
		t.Errorf("demote window IDs = %v, want none (no displaced carriers)", *demoteIDs)
	}
	if !strings.Contains(buf.String(), "@7 role=operator") {
		t.Errorf("stdout = %q, want the confirmation line", buf.String())
	}
}

// Setting operator with a displaced carrier demotes the displaced window first,
// then moves the new operator in — the radio transfer leaves the operator
// session holding exactly the new operator.
func TestRoleOperatorDemotesDisplaced(t *testing.T) {
	t.Setenv("TMUX_PANE", "%3")
	calls, clearKeepID, moveInIDs, demoteIDs := stubRoleSeams(t)
	origClear := roleClearExceptFn
	roleClearExceptFn = func(_ context.Context, _ []string, keepWindowID string) ([]string, error) {
		*clearKeepID = keepWindowID
		return []string{"@3"}, nil
	}
	t.Cleanup(func() { roleClearExceptFn = origClear })

	cmd, _ := roleTestCmd()
	if err := runRole(cmd, "operator"); err != nil {
		t.Fatalf("runRole() = %v", err)
	}
	if len(*demoteIDs) != 1 || (*demoteIDs)[0] != "@3" {
		t.Errorf("demote window IDs = %v, want [@3] (the displaced carrier)", *demoteIDs)
	}
	if len(*moveInIDs) != 1 || (*moveInIDs)[0] != "@7" {
		t.Errorf("move-in window IDs = %v, want [@7]", *moveInIDs)
	}
	_ = calls
}

// The option set lands BEFORE the physical move — a move failure degrades to
// the cosmetic-only state (role set, window unmoved), never a roleless stray.
func TestRoleOperatorMoveFailureKeepsRoleSet(t *testing.T) {
	t.Setenv("TMUX_PANE", "%3")
	calls, _, _, _ := stubRoleSeams(t)
	origMoveIn := roleMoveInFn
	roleMoveInFn = func(context.Context, []string, string) error { return fmt.Errorf("boom") }
	t.Cleanup(func() { roleMoveInFn = origMoveIn })

	cmd, _ := roleTestCmd()
	err := runRole(cmd, "operator")
	if err == nil || !strings.Contains(err.Error(), "move into operator session") {
		t.Fatalf("runRole() error = %v, want a move-in error", err)
	}
	if len(*calls) != 2 {
		t.Fatalf("tmux calls = %v, want the option set to have landed before the move", *calls)
	}
	if got := strings.Join((*calls)[1], " "); !strings.Contains(got, "set-option -w -t @7 @rk_win_role operator") {
		t.Errorf("call[1] = %q, want the role set to have landed", got)
	}
}

// `rk role clear` unsets @rk_win_role on the current window, skips the radio clear
// (nothing is being marked), and demotes the window out of the operator
// session (a no-op for non-members).
func TestRoleClearUnsets(t *testing.T) {
	t.Setenv("TMUX_PANE", "%3")
	calls, clearKeepID, moveInIDs, demoteIDs := stubRoleSeams(t)

	cmd, buf := roleTestCmd()
	if err := runRole(cmd, "clear"); err != nil {
		t.Fatalf("runRole() = %v", err)
	}
	if len(*calls) != 2 {
		t.Fatalf("tmux calls = %v, want 2 (display-message, set-option -wu — no radio clear)", *calls)
	}
	if got := strings.Join((*calls)[1], " "); !strings.Contains(got, "set-option -wu -t @7 @rk_win_role") {
		t.Errorf("call[1] = %q, want the role unset on @7", got)
	}
	if *clearKeepID != "" {
		t.Errorf("radio clear invoked with keepID %q — an unset must NOT clear others", *clearKeepID)
	}
	if len(*demoteIDs) != 1 || (*demoteIDs)[0] != "@7" {
		t.Errorf("demote window IDs = %v, want [@7]", *demoteIDs)
	}
	if len(*moveInIDs) != 0 {
		t.Errorf("move-in window IDs = %v, want none on clear", *moveInIDs)
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
