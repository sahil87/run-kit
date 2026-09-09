package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"rk/internal/config"
	"rk/internal/cron"
	"rk/internal/inject"
	"rk/internal/riff"

	"github.com/spf13/cobra"
)

// NOTE (tmux safety): these tests never start, attach to, or kill any tmux
// server. Every tmux invocation routes through the
// operatorRunFn/operatorRunOutputFn seams (plus the role.go write-path seams
// for the stamp), which the tests stub; the $TMUX seam
// (operatorOriginalTMUXFn) is stubbed likewise because the real
// tmux.OriginalTMUX is fixed at package-init time. The fab precondition routes
// through operatorLookPathFn and the kickoff delivery through
// operatorDeliverFn, both stubbed. The suite must also pass under `env -u TMUX
// -u TMUX_PANE go test ./cmd/rk/` (ambient-env false-green guard) — no test
// may read the ambient tmux env.

// operatorTestSocket is the fake $TMUX the seam serves so every test runs the
// inside-tmux path deterministically. Its basename doubles as the cron server
// slug for the seed step, so it must pass cron.ValidSlug (no dots).
const operatorTestSocket = "/tmp/rk-test-sock,1234,0"

// operatorTestPane / operatorTestWindow are the ids the stubbed
// new-window/display-message print; the stamp and delivery must target them.
const (
	operatorTestPane   = "%42"
	operatorTestWindow = "@42"
)

// operatorCall is one recorded seam invocation: the tmux argv and the child
// env it ran with.
type operatorCall struct {
	args []string
	env  []string
}

// operatorStub owns the stubbed seam state for one test: recorded tmux calls,
// the list-windows probe output, the launcher-resolution inputs, the recorded
// role-stamp sequence, and the recorded kickoff delivery.
type operatorStub struct {
	calls       []operatorCall
	listOutput  string
	lookPathErr error

	repoRoot string
	tier     string
	// skillPrefix is the resolved agent's skill-invocation prefix the stub
	// serves ("/" unless a test overrides it).
	skillPrefix string

	// stampOps records the role write-path sequence in order
	// (clear/set/demote:<id>/move), so tests can pin the role.go sequence.
	stampOps       []string
	stampDisplaced []string

	deliverErr   error
	deliverCalls []operatorDelivery

	// cronDir / cronDirErr drive the seed step's cronDirFn seam (a temp state
	// dir per test; cronDirErr simulates an unresolvable state dir).
	cronDir    string
	cronDirErr error
}

// operatorDelivery records one operatorDeliverFn invocation.
type operatorDelivery struct {
	server, paneID, text string
}

// stubOperatorSeams installs recording stubs for the precondition, tmux,
// launcher, role-stamp, and delivery seams.
func stubOperatorSeams(t *testing.T, listOutput string) *operatorStub {
	t.Helper()
	s := &operatorStub{listOutput: listOutput}

	origTMUX := operatorOriginalTMUXFn
	operatorOriginalTMUXFn = func() string { return operatorTestSocket }
	origLookPath := operatorLookPathFn
	operatorLookPathFn = func(file string) (string, error) {
		if s.lookPathErr != nil {
			return "", s.lookPathErr
		}
		return "/usr/local/bin/" + file, nil
	}
	origRun, origOut := operatorRunFn, operatorRunOutputFn
	operatorRunFn = func(_ context.Context, args, env []string) error {
		s.calls = append(s.calls, operatorCall{args: args, env: env})
		return nil
	}
	operatorRunOutputFn = func(_ context.Context, args, env []string) ([]byte, error) {
		s.calls = append(s.calls, operatorCall{args: args, env: env})
		// The -L/--server path prefixes every call with "-L <name>"; dispatch on
		// the verb past that prefix.
		verb := args[0]
		if verb == "-L" && len(args) > 2 {
			verb = args[2]
		}
		switch verb {
		case "list-windows":
			return []byte(s.listOutput), nil
		case "new-window":
			return []byte(operatorTestPane + "\n"), nil
		case "display-message":
			return []byte(operatorTestWindow + "\n"), nil
		}
		return nil, fmt.Errorf("unexpected RunOutput verb %q", args[0])
	}
	origResolve := operatorResolveAgentFn
	operatorResolveAgentFn = func(_ context.Context, rr, tr string) riff.ResolvedAgent {
		s.repoRoot = rr
		s.tier = tr
		prefix := s.skillPrefix
		if prefix == "" {
			prefix = "/"
		}
		return riff.ResolvedAgent{Launcher: riff.DefaultLauncher, SkillPrefix: prefix}
	}
	origDeliver := operatorDeliverFn
	operatorDeliverFn = func(_ context.Context, _ *inject.Engine, _ inject.Tmux, server, paneID, text string) (inject.Readiness, error) {
		s.deliverCalls = append(s.deliverCalls, operatorDelivery{server: server, paneID: paneID, text: text})
		return inject.ReadyByEcho, s.deliverErr
	}

	// The seed step's cron seams: a temp state dir (never the real
	// $XDG_STATE_HOME) and a fixed caller pane (the suite must pass under
	// `env -u TMUX -u TMUX_PANE` — no ambient-env reads).
	origCronDir, origCronPane := cronDirFn, cronTmuxPaneFn
	s.cronDir = t.TempDir()
	cronDirFn = func() (string, error) { return s.cronDir, s.cronDirErr }
	cronTmuxPaneFn = func() string { return operatorTestPane }

	origClear, origRoleRun := roleClearExceptFn, roleRunFn
	origDemote, origMoveIn := roleDemoteFn, roleMoveInFn
	roleClearExceptFn = func(_ context.Context, _ []string, _ string) ([]string, error) {
		s.stampOps = append(s.stampOps, "clear")
		return s.stampDisplaced, nil
	}
	roleRunFn = func(_ context.Context, args []string) error {
		s.stampOps = append(s.stampOps, "set "+strings.Join(args, " "))
		return nil
	}
	roleDemoteFn = func(_ context.Context, _ []string, windowID string) error {
		s.stampOps = append(s.stampOps, "demote "+windowID)
		return nil
	}
	roleMoveInFn = func(_ context.Context, _ []string, windowID string) error {
		s.stampOps = append(s.stampOps, "move "+windowID)
		return nil
	}

	t.Cleanup(func() {
		operatorOriginalTMUXFn = origTMUX
		operatorLookPathFn = origLookPath
		operatorRunFn, operatorRunOutputFn = origRun, origOut
		operatorResolveAgentFn = origResolve
		operatorDeliverFn = origDeliver
		cronDirFn, cronTmuxPaneFn = origCronDir, origCronPane
		roleClearExceptFn, roleRunFn = origClear, origRoleRun
		roleDemoteFn, roleMoveInFn = origDemote, origMoveIn
	})
	return s
}

func operatorTestCmd() (*cobra.Command, *bytes.Buffer, *bytes.Buffer) {
	outBuf, errBuf := &bytes.Buffer{}, &bytes.Buffer{}
	cmd := &cobra.Command{}
	cmd.SetOut(outBuf)
	cmd.SetErr(errBuf)
	return cmd, outBuf, errBuf
}

// resetOperatorWorkers restores the --workers package var to its default after
// a test mutates it.
func resetOperatorWorkers(t *testing.T) {
	t.Helper()
	orig := operatorWorkersFlag
	t.Cleanup(func() { operatorWorkersFlag = orig })
}

// A --workers value outside the charset is a usage error (exit 2) and runs
// zero subprocesses — the value never reaches a shell string.
func TestOperatorInvalidWorkersUsageError(t *testing.T) {
	resetOperatorWorkers(t)
	for _, bad := range []string{"kimi; rm -rf /", "a b", "x'y", "$(id)", ""} {
		if bad == "" {
			continue // the empty value is the unset case, covered below
		}
		operatorWorkersFlag = bad
		s := stubOperatorSeams(t, "")
		cmd, _, _ := operatorTestCmd()
		err := runOperator(cmd)
		if err == nil {
			t.Fatalf("runOperator() with --workers %q = nil, want a usage error", bad)
		}
		if code := exitCode(err); code != exitUsage {
			t.Errorf("exitCode(--workers %q) = %d, want %d (usage)", bad, code, exitUsage)
		}
		if len(s.calls) != 0 {
			t.Errorf("tmux calls with --workers %q = %v, want none before validation passes", bad, s.calls)
		}
	}
	operatorWorkersFlag = ""
}

// Outside tmux the command fails as an operational error (exit 1) with
// guidance and runs zero tmux subprocesses.
func TestOperatorOutsideTmuxErrors(t *testing.T) {
	resetOperatorWorkers(t)
	s := stubOperatorSeams(t, "")
	origTMUX := operatorOriginalTMUXFn
	operatorOriginalTMUXFn = func() string { return "" }
	t.Cleanup(func() { operatorOriginalTMUXFn = origTMUX })

	cmd, _, _ := operatorTestCmd()
	err := runOperator(cmd)
	if err == nil {
		t.Fatal("runOperator() = nil, want a precondition error")
	}
	var ece *riff.ExitCodeError
	if !errors.As(err, &ece) {
		t.Fatalf("runOperator() error = %T %v, want *riff.ExitCodeError", err, err)
	}
	if ece.Code != riff.ExitPrecondition {
		t.Errorf("exit code = %d, want %d (operational/precondition)", ece.Code, riff.ExitPrecondition)
	}
	if !strings.Contains(ece.Msg, "$TMUX") {
		t.Errorf("message = %q, want guidance naming $TMUX", ece.Msg)
	}
	if len(s.calls) != 0 {
		t.Errorf("tmux calls = %v, want none before the precondition passes", s.calls)
	}
}

// A missing fab is a HARD refusal (exit 1) naming fab-kit — no default-launcher
// degrade — and zero tmux subprocesses run.
func TestOperatorFabMissingErrors(t *testing.T) {
	resetOperatorWorkers(t)
	s := stubOperatorSeams(t, "")
	s.lookPathErr = errors.New("executable file not found in $PATH")

	cmd, _, _ := operatorTestCmd()
	err := runOperator(cmd)
	var ece *riff.ExitCodeError
	if !errors.As(err, &ece) {
		t.Fatalf("runOperator() error = %T %v, want *riff.ExitCodeError", err, err)
	}
	if ece.Code != riff.ExitPrecondition {
		t.Errorf("exit code = %d, want %d (hard refusal, no degrade)", ece.Code, riff.ExitPrecondition)
	}
	if !strings.Contains(ece.Msg, "fab-kit") {
		t.Errorf("message = %q, want it naming fab-kit as the required companion tool", ece.Msg)
	}
	if len(s.calls) != 0 {
		t.Errorf("tmux calls = %v, want none before the preconditions pass", s.calls)
	}
}

// The singleton matcher: a role-option hit beats a name hit regardless of
// order; the name fallback exact-matches the LAST tab field — no
// prefix/substring hits, tab-containing names never match.
func TestFindOperatorWindowID(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"role hit", "@7\toperator\tmain", "@7"},
		{"role beats an earlier name hit", "@3\t\toperator\n@7\toperator\tmain", "@7"},
		{"role beats a later name hit", "@7\toperator\tmain\n@3\t\toperator", "@7"},
		{"name fallback", "@3\t\toperator", "@3"},
		{"first name hit wins", "@3\t\toperator\n@9\t\toperator", "@3"},
		{"no match", "@3\t\tother\n@4\t\tshell", ""},
		{"no prefix match", "@3\t\toperator-2", ""},
		{"no substring match", "@3\t\tmy operator", ""},
		{"tab-containing name never exact-matches", "@5\t\tmy\toperator", ""},
		{"role value must be exact; name fallback still applies", "@5\toperator-2\toperator", "@5"},
		{"other roles do not match", "@5\tsidekick\tmain", ""},
		{"empty output", "", ""},
		{"lines missing columns skipped", "garbage\n@2\t\toperator", "@2"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := findOperatorWindowID(tc.in); got != tc.want {
				t.Errorf("findOperatorWindowID(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// A role-marked operator window — even in ANOTHER session — is selected by its
// @N id, switch-client is attempted, no new window is created, no delivery
// runs, and the switch is reported verbatim.
func TestOperatorSelectsExistingRoleWindow(t *testing.T) {
	resetOperatorWorkers(t)
	// A name-only 'operator' window appears FIRST; the role-marked one wins.
	s := stubOperatorSeams(t, "@3\t\toperator\n@7\toperator\tmain\n")
	cmd, outBuf, _ := operatorTestCmd()
	if err := runOperator(cmd); err != nil {
		t.Fatalf("runOperator() = %v", err)
	}
	want := []operatorCall{
		{args: []string{"list-windows", "-a", "-F", operatorListFormat}},
		{args: []string{"select-window", "-t", "@7"}},
		{args: []string{"switch-client", "-t", "@7"}},
	}
	if len(s.calls) != len(want) {
		t.Fatalf("tmux calls = %v, want %v", s.calls, want)
	}
	for i, c := range s.calls {
		if strings.Join(c.args, " ") != strings.Join(want[i].args, " ") {
			t.Errorf("call %d argv = %v, want %v", i, c.args, want[i].args)
		}
		if !strings.Contains(strings.Join(c.env, "\n"), "TMUX="+operatorTestSocket) {
			t.Errorf("call %d env lacks restored TMUX=%s", i, operatorTestSocket)
		}
	}
	if len(s.stampOps) != 0 {
		t.Errorf("stamp ops = %v, want none when switching to an existing tab", s.stampOps)
	}
	if len(s.deliverCalls) != 0 {
		t.Errorf("deliveries = %v, want none when returning to an existing tab", s.deliverCalls)
	}
	if got := outBuf.String(); got != "Switched to existing operator tab.\n" {
		t.Errorf("stdout = %q, want the exact switch report", got)
	}
}

// A failing switch-client is ignored — the window may live in another session
// and the singleton invariant is already preserved by select-window.
func TestOperatorSwitchClientFailureIgnored(t *testing.T) {
	resetOperatorWorkers(t)
	stubOperatorSeams(t, "@7\toperator\tmain\n")
	origRun := operatorRunFn
	operatorRunFn = func(ctx context.Context, args, env []string) error {
		if args[0] == "switch-client" {
			return errors.New("no current client")
		}
		return origRun(ctx, args, env)
	}
	t.Cleanup(func() { operatorRunFn = origRun })

	cmd, outBuf, _ := operatorTestCmd()
	if err := runOperator(cmd); err != nil {
		t.Fatalf("runOperator() = %v, want nil (switch-client is best-effort)", err)
	}
	if got := outBuf.String(); got != "Switched to existing operator tab.\n" {
		t.Errorf("stdout = %q, want the switch report", got)
	}
}

// The launcher resolves with tier exactly "operator", rooted at the git root
// of the process cwd.
func TestOperatorTierPlumbing(t *testing.T) {
	resetOperatorWorkers(t)
	s := stubOperatorSeams(t, "@3\t\tother\n")
	cmd, _, _ := operatorTestCmd()
	if err := runOperator(cmd); err != nil {
		t.Fatalf("runOperator() = %v", err)
	}
	if s.tier != operatorTier {
		t.Errorf("ResolveAgent tier = %q, want %q", s.tier, operatorTier)
	}
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd: %v", err)
	}
	if want := config.FindGitRoot(cwd); s.repoRoot != want {
		t.Errorf("ResolveAgent repoRoot = %q, want %q (FindGitRoot of cwd)", s.repoRoot, want)
	}
}

// With no operator window on the server, a new window named 'operator' opens
// at the git root running the BARE launcher, the pane id is captured, the role
// write-path stamps it IN ORDER (radio clear → option write → demote displaced
// → move in), and the kickoff is delivered through the inject composite
// targeting the new pane on the caller's server. No degrade note is printed on
// the happy path.
func TestOperatorCreatesStampsAndDelivers(t *testing.T) {
	resetOperatorWorkers(t)
	s := stubOperatorSeams(t, "@3\t\tother\n")
	s.stampDisplaced = []string{"@9"}
	cmd, outBuf, errBuf := operatorTestCmd()
	if err := runOperator(cmd); err != nil {
		t.Fatalf("runOperator() = %v", err)
	}
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd: %v", err)
	}
	windowDir := config.FindGitRoot(cwd)
	if windowDir == "" {
		windowDir = cwd
	}

	var newWindow []string
	for _, c := range s.calls {
		if c.args[0] == "new-window" {
			newWindow = c.args
		}
		if !strings.Contains(strings.Join(c.env, "\n"), "TMUX="+operatorTestSocket) {
			t.Errorf("call %v env lacks restored TMUX=%s", c.args, operatorTestSocket)
		}
	}
	wantNewWindow := []string{
		"new-window", "-P", "-F", "#{pane_id}", "-c", windowDir, "-n", "operator",
		`${SHELL:-/bin/sh} -i -c 'claude --dangerously-skip-permissions'; exec "${SHELL:-/bin/sh}"`,
	}
	if strings.Join(newWindow, " ") != strings.Join(wantNewWindow, " ") {
		t.Errorf("new-window argv =\n  %v\nwant\n  %v", newWindow, wantNewWindow)
	}

	// The stamp runs the full role write-path in order, targeting the new
	// window id, with the server socket prefix derived from $TMUX.
	if len(s.stampOps) != 4 {
		t.Fatalf("stamp ops = %v, want clear → set → demote → move", s.stampOps)
	}
	if s.stampOps[0] != "clear" {
		t.Errorf("stamp op 0 = %q, want the radio clear first", s.stampOps[0])
	}
	setOp := s.stampOps[1]
	for _, frag := range []string{"-S", "/tmp/rk-test-sock", "set-option", "-t", operatorTestWindow, "@rk_win_role", "operator"} {
		if !strings.Contains(setOp, frag) {
			t.Errorf("stamp op 1 = %q, want it to contain %q", setOp, frag)
		}
	}
	if s.stampOps[2] != "demote @9" {
		t.Errorf("stamp op 2 = %q, want the displaced carrier demoted before the move", s.stampOps[2])
	}
	if s.stampOps[3] != "move "+operatorTestWindow {
		t.Errorf("stamp op 3 = %q, want the promotion of the new window", s.stampOps[3])
	}

	if len(s.deliverCalls) != 1 {
		t.Fatalf("deliveries = %v, want exactly one", s.deliverCalls)
	}
	d := s.deliverCalls[0]
	if d.paneID != operatorTestPane || d.text != operatorKickoffPrompt {
		t.Errorf("delivery = (pane %q, text %q), want (%s, %q)", d.paneID, d.text, operatorTestPane, operatorKickoffPrompt)
	}
	if d.server != "rk-test-sock" {
		t.Errorf("delivery server = %q, want the $TMUX socket basename %q", d.server, "rk-test-sock")
	}

	if got := outBuf.String(); got != "Opened operator tab (window \"operator\").\n" {
		t.Errorf("stdout = %q, want the launch report", got)
	}
	if errBuf.Len() != 0 {
		t.Errorf("stderr = %q, want empty on a verified delivery", errBuf.String())
	}
}

// An empty or malformed window id from display-message fails (exit 3) BEFORE
// the role write-path runs — stampOperatorRole with keepWindowID "" would
// radio-clear @rk_win_role from every window on the server.
func TestOperatorInvalidWindowIDFailsBeforeStamp(t *testing.T) {
	for _, winOut := range []string{"\n", "42\n"} {
		t.Run(fmt.Sprintf("winOut=%q", winOut), func(t *testing.T) {
			resetOperatorWorkers(t)
			s := stubOperatorSeams(t, "@3\t\tother\n")
			origOut := operatorRunOutputFn
			operatorRunOutputFn = func(ctx context.Context, args, env []string) ([]byte, error) {
				if args[0] == "display-message" {
					return []byte(winOut), nil
				}
				return origOut(ctx, args, env)
			}
			t.Cleanup(func() { operatorRunOutputFn = origOut })

			cmd, _, _ := operatorTestCmd()
			err := runOperator(cmd)
			if err == nil {
				t.Fatalf("runOperator() with window id output %q = nil, want a subprocess error", winOut)
			}
			var ece *riff.ExitCodeError
			if !errors.As(err, &ece) {
				t.Fatalf("runOperator() error = %T %v, want *riff.ExitCodeError", err, err)
			}
			if ece.Code != riff.ExitSubprocess {
				t.Errorf("exit code = %d, want %d (subprocess)", ece.Code, riff.ExitSubprocess)
			}
			if len(s.stampOps) != 0 {
				t.Errorf("stamp ops = %v, want none — an invalid window id must never reach the role write-path", s.stampOps)
			}
			if len(s.deliverCalls) != 0 {
				t.Errorf("deliveries = %v, want none after a failed window-id resolve", s.deliverCalls)
			}
		})
	}
}

// A valid --workers value prefixes the AGENT COMMAND ONLY, inside the shell
// string, before the interactive wrap.
func TestOperatorWorkersPrefixComposition(t *testing.T) {
	resetOperatorWorkers(t)
	operatorWorkersFlag = "kimi"
	s := stubOperatorSeams(t, "@3\t\tother\n")
	cmd, _, _ := operatorTestCmd()
	if err := runOperator(cmd); err != nil {
		t.Fatalf("runOperator() = %v", err)
	}
	var newWindow []string
	for _, c := range s.calls {
		if c.args[0] == "new-window" {
			newWindow = c.args
		}
	}
	want := `${SHELL:-/bin/sh} -i -c 'FAB_AGENT_WORKERS=kimi claude --dangerously-skip-permissions'; exec "${SHELL:-/bin/sh}"`
	if got := newWindow[len(newWindow)-1]; got != want {
		t.Errorf("new-window shell string =\n  %q\nwant\n  %q", got, want)
	}
}

// The composition helper pins both forms byte-for-byte: unset --workers is the
// bare SkillPaneCommand composition; a valid value scopes the env prefix to
// layer 1.
func TestOperatorShellCommand(t *testing.T) {
	bare := operatorShellCommand(riff.DefaultLauncher, "")
	if want := riff.SkillPaneCommand(riff.DefaultLauncher, ""); bare != want {
		t.Errorf("operatorShellCommand(unset) =\n  %q\nwant byte-identical\n  %q", bare, want)
	}
	got := operatorShellCommand(riff.DefaultLauncher, "kimi")
	want := `${SHELL:-/bin/sh} -i -c 'FAB_AGENT_WORKERS=kimi claude --dangerously-skip-permissions'; exec "${SHELL:-/bin/sh}"`
	if got != want {
		t.Errorf("operatorShellCommand(kimi) =\n  %q\nwant\n  %q", got, want)
	}
	if strings.Contains(bare, "FAB_AGENT_WORKERS") || strings.Contains(bare, "fab-operator") {
		t.Errorf("bare composition %q must not embed the workers prefix or the kickoff prompt", bare)
	}
}

// When the delivery fails (readiness deadline, probe failure, …), the command
// still succeeds — the window exists — and stderr carries the
// paste-it-yourself note with the exact kickoff text.
func TestOperatorDeliveryDegradesToPasteNote(t *testing.T) {
	resetOperatorWorkers(t)
	s := stubOperatorSeams(t, "@3\t\tother\n")
	s.deliverErr = inject.ErrNotReady

	cmd, outBuf, errBuf := operatorTestCmd()
	if err := runOperator(cmd); err != nil {
		t.Fatalf("runOperator() = %v, want nil (delivery miss degrades, never errors)", err)
	}
	if !strings.Contains(outBuf.String(), "Opened operator tab") {
		t.Errorf("stdout = %q, want the launch report", outBuf.String())
	}
	if !strings.Contains(errBuf.String(), operatorKickoffPrompt) {
		t.Errorf("stderr = %q, want the paste-it-yourself note carrying the kickoff text", errBuf.String())
	}
}

// A codex-resolved operator tier (skill_prefix `$`) gets the kickoff rendered
// for its provider: the typed delivery and the paste-it-yourself degrade note
// both carry `$fab-operator`. The claude (slash) case is byte-identical to
// pre-change behavior — covered by TestOperatorCreatesStampsAndDelivers.
func TestOperatorCodexPrefixRendersKickoff(t *testing.T) {
	resetOperatorWorkers(t)
	s := stubOperatorSeams(t, "@3\t\tother\n")
	s.skillPrefix = "$"

	cmd, _, _ := operatorTestCmd()
	if err := runOperator(cmd); err != nil {
		t.Fatalf("runOperator() = %v", err)
	}
	if len(s.deliverCalls) != 1 {
		t.Fatalf("deliveries = %v, want exactly one", s.deliverCalls)
	}
	if want := "$fab-operator"; s.deliverCalls[0].text != want {
		t.Errorf("delivered kickoff = %q, want the prefix-rendered %q", s.deliverCalls[0].text, want)
	}
}

// The degrade note on a codex-resolved tier shows the RENDERED kickoff, not
// the canonical slash constant.
func TestOperatorCodexPrefixDegradeNoteRendered(t *testing.T) {
	resetOperatorWorkers(t)
	s := stubOperatorSeams(t, "@3\t\tother\n")
	s.skillPrefix = "$"
	s.deliverErr = inject.ErrNotReady

	cmd, _, errBuf := operatorTestCmd()
	if err := runOperator(cmd); err != nil {
		t.Fatalf("runOperator() = %v, want nil (delivery miss degrades, never errors)", err)
	}
	if !strings.Contains(errBuf.String(), "$fab-operator") {
		t.Errorf("stderr = %q, want the paste-it-yourself note carrying the rendered kickoff $fab-operator", errBuf.String())
	}
	if strings.Contains(errBuf.String(), "/fab-operator") {
		t.Errorf("stderr = %q, must not carry the canonical slash form for a codex operator", errBuf.String())
	}
}

// A failing list-windows probe is a subprocess-class (exit 3) error.
func TestOperatorListWindowsFailure(t *testing.T) {
	resetOperatorWorkers(t)
	s := stubOperatorSeams(t, "")
	origOut := operatorRunOutputFn
	operatorRunOutputFn = func(_ context.Context, _, _ []string) ([]byte, error) {
		return nil, fmt.Errorf("boom")
	}
	t.Cleanup(func() { operatorRunOutputFn = origOut })

	cmd, _, _ := operatorTestCmd()
	err := runOperator(cmd)
	var ece *riff.ExitCodeError
	if !errors.As(err, &ece) || ece.Code != riff.ExitSubprocess {
		t.Errorf("runOperator() error = %v, want *riff.ExitCodeError code %d", err, riff.ExitSubprocess)
	}
	if len(s.calls) != 0 {
		// The failing call itself went through the replaced seam, not the recorder.
		t.Errorf("recorded calls = %v, want none past the failed probe", s.calls)
	}
}

// --- Operator-tick seeding ---
//
// The seed step runs on every runOperator invocation, before the singleton
// probe: a fresh state dir gains the spec'd entry, a re-run leaves a user's
// edits untouched, and a seed failure degrades to a stderr warning without
// affecting the exit code or the window open.

// TestOperatorSeedsOperatorTickEntry: a fresh state dir gains exactly one
// entry carrying the spec's fixed operator-tick field values (backoff 60s→30m,
// wake_on agent-state-change/server/10s, role:operator target, "operator tick"
// payload, immediate delivery, if_absent respawn with the caller-supplied
// `rk operator -L {server}` argv, pinned), with created_by auto-captured from
// the caller's pane.
func TestOperatorSeedsOperatorTickEntry(t *testing.T) {
	resetOperatorWorkers(t)
	s := stubOperatorSeams(t, "@3\t\tother\n")
	cmd, _, _ := operatorTestCmd()
	if err := runOperator(cmd); err != nil {
		t.Fatalf("runOperator() = %v", err)
	}

	entries, diags := cron.LoadEntries(filepath.Join(s.cronDir, "rk-test-sock.yaml"))
	if len(diags) != 0 || len(entries) != 1 {
		t.Fatalf("entries = %v diags = %v, want exactly one seeded entry", entries, diags)
	}
	e := entries[0]
	if len(e.ID) != 4 {
		t.Errorf("id = %q, want an Add-assigned 4-char id", e.ID)
	}
	wantSched := cron.Schedule{
		Kind: cron.ScheduleBackoff,
		Min:  cron.Duration{Duration: 60 * time.Second},
		Max:  cron.Duration{Duration: 30 * time.Minute},
	}
	if e.Schedule != wantSched {
		t.Errorf("schedule = %+v, want %+v", e.Schedule, wantSched)
	}
	if e.WakeOn == nil || e.WakeOn.Event != cron.WakeAgentStateChange || e.WakeOn.Scope != cron.WakeScopeServer || e.WakeOn.Debounce.Duration != 60*time.Second {
		t.Errorf("wake_on = %+v, want agent-state-change/server/60s", e.WakeOn)
	}
	if e.Target != (cron.Target{Kind: cron.TargetRole, Role: cron.RoleOperator}) {
		t.Errorf("target = %+v, want role:operator", e.Target)
	}
	if e.Name != "operator tick" || e.Payload != "operator tick" {
		t.Errorf("name/payload = %q/%q, want \"operator tick\"/\"operator tick\"", e.Name, e.Payload)
	}
	if e.Deliver != cron.DeliverImmediate || e.IfAbsent != cron.IfAbsentRespawn || !e.Pinned || e.Muted {
		t.Errorf("deliver/if_absent/pinned/muted = %q/%q/%v/%v, want immediate/respawn/true/false",
			e.Deliver, e.IfAbsent, e.Pinned, e.Muted)
	}
	if want := []string{"rk", "operator", "-L", "{server}"}; strings.Join(e.Respawn, " ") != strings.Join(want, " ") {
		t.Errorf("respawn = %v, want %v", e.Respawn, want)
	}
	if e.CreatedBy.Pane != operatorTestPane || e.CreatedBy.Session != "" || e.CreatedBy.At == 0 {
		t.Errorf("created_by = %+v, want {pane: %s, at: <now>} with session empty", e.CreatedBy, operatorTestPane)
	}
}

// TestOperatorSeedIsIdempotent: a second run leaves the seeded entry — and
// any user edit to it — untouched (the role target is the idempotency key;
// re-seeding is not config reconciliation).
func TestOperatorSeedIsIdempotent(t *testing.T) {
	resetOperatorWorkers(t)
	s := stubOperatorSeams(t, "@3\t\tother\n")
	cmd, _, _ := operatorTestCmd()
	if err := runOperator(cmd); err != nil {
		t.Fatalf("first runOperator() = %v", err)
	}
	path := filepath.Join(s.cronDir, "rk-test-sock.yaml")
	entries, _ := cron.LoadEntries(path)
	if len(entries) != 1 {
		t.Fatalf("entries = %v, want the seeded entry", entries)
	}
	// A user mute between runs must survive the re-seed.
	if ok, err := cron.SetMuted(s.cronDir, "rk-test-sock", entries[0].ID, true); err != nil || !ok {
		t.Fatalf("SetMuted: ok=%v err=%v", ok, err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	cmd2, _, _ := operatorTestCmd()
	if err := runOperator(cmd2); err != nil {
		t.Fatalf("second runOperator() = %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Error("re-run rewrote the entry file — the user's mute must survive re-seeding")
	}
}

// TestOperatorSeedFailureIsNonFatal: an unresolvable cron state dir degrades
// to one stderr warning — the command still opens and marks the window and
// exits 0.
func TestOperatorSeedFailureIsNonFatal(t *testing.T) {
	resetOperatorWorkers(t)
	s := stubOperatorSeams(t, "@3\t\tother\n")
	s.cronDirErr = errors.New("state dir unwritable")
	cmd, outBuf, errBuf := operatorTestCmd()
	if err := runOperator(cmd); err != nil {
		t.Fatalf("runOperator() = %v, want success despite the seed failure", err)
	}
	if !strings.Contains(errBuf.String(), "could not seed the operator-tick cron entry") {
		t.Errorf("stderr = %q, want the seed-failure warning", errBuf.String())
	}
	if got := outBuf.String(); got != "Opened operator tab (window \"operator\").\n" {
		t.Errorf("stdout = %q, want the launch report (window open unaffected)", got)
	}
	opened := false
	for _, c := range s.calls {
		if c.args[0] == "new-window" {
			opened = true
		}
	}
	if !opened || len(s.stampOps) == 0 {
		t.Errorf("window open/stamp missing: calls = %v, stamp ops = %v", s.calls, s.stampOps)
	}
}

// --- rk operator -L/--server (daemon-invocable) ---
//
// With -L the inside-tmux precondition is waived, every tmux call is addressed
// at -L <name> with no restored $TMUX, a singleton hit switches no client, and
// a created window opens in the home directory. Without the flag every path is
// the interactive one above.

// resetOperatorServer restores the -L/--server package var after a test.
func resetOperatorServer(t *testing.T) {
	t.Helper()
	orig := operatorServerFlag
	operatorServerFlag = ""
	t.Cleanup(func() { operatorServerFlag = orig })
}

// TestOperatorServerFlagCreatesWithoutTMUX: $TMUX unset + -L runKit + no
// operator window ⇒ the probe and new-window run with a leading "-L runKit"
// and a nil env, the role is stamped, the kickoff is delivered addressed at
// runKit, the window opens in the home directory, the entry seeds under the
// runKit slug, and no select-window/switch-client is ever recorded.
func TestOperatorServerFlagCreatesWithoutTMUX(t *testing.T) {
	resetOperatorWorkers(t)
	resetOperatorServer(t)
	operatorServerFlag = "runKit"
	s := stubOperatorSeams(t, "@3\t\tother\n")
	origTMUX := operatorOriginalTMUXFn
	operatorOriginalTMUXFn = func() string { return "" }
	t.Cleanup(func() { operatorOriginalTMUXFn = origTMUX })

	cmd, outBuf, _ := operatorTestCmd()
	if err := runOperator(cmd); err != nil {
		t.Fatalf("runOperator() = %v", err)
	}

	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("UserHomeDir: %v", err)
	}
	var probe, newWindow []string
	for _, c := range s.calls {
		if len(c.env) != 0 {
			t.Errorf("call %v env = %v, want nil (nothing restored in server mode)", c.args, c.env)
		}
		if len(c.args) < 2 || c.args[0] != "-L" || c.args[1] != "runKit" {
			t.Errorf("call argv = %v, want a leading -L runKit", c.args)
		}
		switch {
		case len(c.args) > 2 && c.args[2] == "list-windows":
			probe = c.args
		case len(c.args) > 2 && c.args[2] == "new-window":
			newWindow = c.args
		case len(c.args) > 2 && (c.args[2] == "select-window" || c.args[2] == "switch-client"):
			t.Errorf("client-switching call %v must never run in server mode", c.args)
		}
	}
	if probe == nil {
		t.Error("no list-windows probe recorded")
	}
	wantNewWindow := []string{
		"-L", "runKit", "new-window", "-P", "-F", "#{pane_id}", "-c", home, "-n", "operator",
		`${SHELL:-/bin/sh} -i -c 'claude --dangerously-skip-permissions'; exec "${SHELL:-/bin/sh}"`,
	}
	if strings.Join(newWindow, " ") != strings.Join(wantNewWindow, " ") {
		t.Errorf("new-window argv =\n  %v\nwant\n  %v", newWindow, wantNewWindow)
	}
	if len(s.stampOps) != 3 || s.stampOps[0] != "clear" || s.stampOps[2] != "move "+operatorTestWindow {
		t.Errorf("stamp ops = %v, want clear → set → move (no displaced carriers)", s.stampOps)
	} else if !strings.Contains(s.stampOps[1], "-L runKit") || !strings.Contains(s.stampOps[1], "@rk_win_role operator") {
		t.Errorf("stamp set op = %q, want it -L-addressed at runKit writing @rk_win_role=operator", s.stampOps[1])
	}
	if len(s.deliverCalls) != 1 || s.deliverCalls[0].server != "runKit" {
		t.Errorf("deliveries = %v, want one kickoff addressed at runKit", s.deliverCalls)
	}
	if got := outBuf.String(); got != "Opened operator tab (window \"operator\").\n" {
		t.Errorf("stdout = %q, want the launch report", got)
	}

	entries, diags := cron.LoadEntries(filepath.Join(s.cronDir, "runKit.yaml"))
	if len(diags) != 0 || len(entries) != 1 {
		t.Fatalf("entries = %v diags = %v, want the entry seeded under the -L slug", entries, diags)
	}
}

// TestOperatorServerFlagSingletonHit: an operator window already present on the
// named server ⇒ exit 0 with "Operator tab already present." and no
// select-window/switch-client, stamp, or delivery.
func TestOperatorServerFlagSingletonHit(t *testing.T) {
	resetOperatorWorkers(t)
	resetOperatorServer(t)
	operatorServerFlag = "runKit"
	s := stubOperatorSeams(t, "@7\toperator\tmain\n")
	origTMUX := operatorOriginalTMUXFn
	operatorOriginalTMUXFn = func() string { return "" }
	t.Cleanup(func() { operatorOriginalTMUXFn = origTMUX })

	cmd, outBuf, _ := operatorTestCmd()
	if err := runOperator(cmd); err != nil {
		t.Fatalf("runOperator() = %v", err)
	}
	if got := outBuf.String(); got != "Operator tab already present.\n" {
		t.Errorf("stdout = %q, want the already-present report (no switch happened)", got)
	}
	for _, c := range s.calls {
		for _, a := range c.args {
			if a == "select-window" || a == "switch-client" {
				t.Errorf("call %v must never run on a server-mode singleton hit", c.args)
			}
		}
	}
	if len(s.stampOps) != 0 || len(s.deliverCalls) != 0 {
		t.Errorf("stamp ops = %v, deliveries = %v, want none", s.stampOps, s.deliverCalls)
	}
}

// TestOperatorServerPrefix: bare for ""/default, else -L <server>.
func TestOperatorServerPrefix(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want []string
	}{
		{"", nil},
		{"default", nil},
		{"runKit", []string{"-L", "runKit"}},
	} {
		if got := operatorServerPrefix(tc.in); strings.Join(got, " ") != strings.Join(tc.want, " ") {
			t.Errorf("operatorServerPrefix(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}
