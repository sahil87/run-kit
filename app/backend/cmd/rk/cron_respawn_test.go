package main

import (
	"context"
	"errors"
	"strings"
	"testing"

	"rk/internal/cron"
	"rk/internal/inject"
	"rk/internal/riff"
)

// NOTE (tmux safety): like operator_test.go, these tests never touch a real
// tmux server — every tmux invocation routes through the stubbed
// cronRespawnRunOutputFn seam (plus the role.go write-path seams for the
// stamp), the kickoff delivery through cronRespawnDeliverFn, and the
// escalation through cronRespawnNotifyFn.

// cronRespawnStub owns the stubbed seam state for one respawn test.
type cronRespawnStub struct {
	calls       [][]string // recorded tmux argv (post-prefix)
	envs        [][]string
	listOutput  string
	spawnedLine string // extra list-windows line once new-window ran (the created window)
	created     bool
	runOutErr   error
	launcherDir string
	// skillPrefix is the resolved agent's skill-invocation prefix the stub
	// serves ("/" unless a test overrides it).
	skillPrefix string

	stampOps []string

	readiness   inject.Readiness
	deliverErr  error
	deliverText string
	deliverSrv  string
	deliverPane string
	delivered   bool

	notifyCalls []string
	notifyURLs  []string
	notifyErr   error
}

// stubCronRespawnSeams installs recording stubs for every respawner seam.
func stubCronRespawnSeams(t *testing.T, listOutput string) *cronRespawnStub {
	t.Helper()
	s := &cronRespawnStub{listOutput: listOutput, readiness: inject.ReadyByEcho}

	origOut := cronRespawnRunOutputFn
	cronRespawnRunOutputFn = func(_ context.Context, args, env []string) ([]byte, error) {
		s.calls = append(s.calls, args)
		s.envs = append(s.envs, env)
		if s.runOutErr != nil {
			return nil, s.runOutErr
		}
		verb := ""
		for _, a := range args {
			if a == "list-windows" || a == "new-window" || a == "display-message" {
				verb = a
				break
			}
		}
		switch verb {
		case "list-windows":
			out := s.listOutput
			if s.created && s.spawnedLine != "" {
				out += s.spawnedLine
			}
			return []byte(out), nil
		case "new-window":
			s.created = true
			return []byte(operatorTestPane + "\n"), nil
		case "display-message":
			return []byte(operatorTestWindow + "\n"), nil
		}
		return nil, errors.New("unexpected tmux argv: " + strings.Join(args, " "))
	}
	origLauncher := cronRespawnResolveAgentFn
	cronRespawnResolveAgentFn = func(_ context.Context, repoRoot, tier string) riff.ResolvedAgent {
		s.launcherDir = repoRoot
		prefix := s.skillPrefix
		if prefix == "" {
			prefix = "/"
		}
		return riff.ResolvedAgent{Launcher: riff.DefaultLauncher, SkillPrefix: prefix}
	}
	origHome := cronRespawnHomeDirFn
	cronRespawnHomeDirFn = func() (string, error) { return "/home/test", nil }
	origDeliver := cronRespawnDeliverFn
	cronRespawnDeliverFn = func(_ context.Context, _ *inject.Engine, _ inject.Tmux, server, paneID, text string) (inject.Readiness, error) {
		s.delivered = true
		s.deliverSrv, s.deliverPane, s.deliverText = server, paneID, text
		return s.readiness, s.deliverErr
	}
	origNotify := cronRespawnNotifyFn
	cronRespawnNotifyFn = func(_ context.Context, title, body, url string) error {
		s.notifyCalls = append(s.notifyCalls, title+" | "+body)
		s.notifyURLs = append(s.notifyURLs, url)
		return s.notifyErr
	}
	origClear, origRoleRun := roleClearExceptFn, roleRunFn
	origDemote, origMoveIn := roleDemoteFn, roleMoveInFn
	roleClearExceptFn = func(_ context.Context, _ []string, _ string) ([]string, error) {
		s.stampOps = append(s.stampOps, "clear")
		return nil, nil
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
		cronRespawnRunOutputFn = origOut
		cronRespawnResolveAgentFn = origLauncher
		cronRespawnHomeDirFn = origHome
		cronRespawnDeliverFn = origDeliver
		cronRespawnNotifyFn = origNotify
		roleClearExceptFn, roleRunFn = origClear, origRoleRun
		roleDemoteFn, roleMoveInFn = origDemote, origMoveIn
	})
	return s
}

// respawnTestFire is the absent role:operator fire the tick hands the seam.
func respawnTestFire(server string) cron.Fire {
	return cron.Fire{
		Server: server,
		Entry: cron.Entry{
			ID:       "a3f9",
			Name:     "operator tick",
			Target:   cron.Target{Kind: cron.TargetRole, Role: cron.RoleOperator},
			Payload:  "operator tick",
			IfAbsent: cron.IfAbsentRespawn,
		},
	}
}

func (s *cronRespawnStub) calledVerb(verb string) bool {
	for _, args := range s.calls {
		for _, a := range args {
			if a == verb {
				return true
			}
		}
	}
	return false
}

// TestCronRespawnCreatesMarksAndKicksOff: with no operator window on the
// fire's server, the respawner re-probes (-L-addressed), creates the window
// via the shared create-and-mark helper (role write-path stamp), and delivers
// the KICKOFF prompt — never the entry's bare payload — on a ready
// classification. Outcome: respawned, no escalation.
func TestCronRespawnCreatesMarksAndKicksOff(t *testing.T) {
	s := stubCronRespawnSeams(t, "@3\t\tother\n")
	outcome := rkCronRespawnRole(context.Background(), respawnTestFire("work"))

	if outcome.Status != "respawned" {
		t.Fatalf("outcome = %+v, want respawned", outcome)
	}
	if !s.calledVerb("new-window") {
		t.Fatalf("no new-window call: %v", s.calls)
	}
	for _, args := range s.calls {
		if len(args) < 2 || args[0] != "-L" || args[1] != "work" {
			t.Errorf("tmux argv %v lacks the -L work prefix (never \"current server\")", args)
		}
	}
	for _, env := range s.envs {
		if env != nil {
			t.Errorf("env = %v, want nil (the daemon's scrubbed process env)", env)
		}
	}
	if len(s.stampOps) == 0 || !strings.Contains(strings.Join(s.stampOps, ";"), "@rk_win_role") {
		t.Errorf("stamp ops = %v, want the role write-path marking @rk_win_role", s.stampOps)
	}
	if !s.delivered {
		t.Fatal("no kickoff delivery")
	}
	if s.deliverSrv != "work" || s.deliverPane != operatorTestPane {
		t.Errorf("delivery target = %s/%s, want work/%s", s.deliverSrv, s.deliverPane, operatorTestPane)
	}
	if s.deliverText != operatorKickoffPrompt {
		t.Errorf("delivered text = %q, want the kickoff %q — a respawn never delivers the bare payload %q",
			s.deliverText, operatorKickoffPrompt, "operator tick")
	}
	if len(s.notifyCalls) != 0 {
		t.Errorf("notify calls = %v, want none on success", s.notifyCalls)
	}
}

// TestCronRespawnCodexPrefixRendersKickoff: when the operator tier resolves to
// a codex provider (skill_prefix `$`), the respawned window's typed kickoff is
// the rendered `$fab-operator`, not the canonical slash constant.
func TestCronRespawnCodexPrefixRendersKickoff(t *testing.T) {
	s := stubCronRespawnSeams(t, "@3\t\tother\n")
	s.skillPrefix = "$"

	outcome := rkCronRespawnRole(context.Background(), respawnTestFire("work"))
	if outcome.Status != "respawned" {
		t.Fatalf("outcome = %+v, want respawned", outcome)
	}
	if !s.delivered {
		t.Fatal("no kickoff delivery")
	}
	if want := "$fab-operator"; s.deliverText != want {
		t.Errorf("delivered text = %q, want the prefix-rendered kickoff %q", s.deliverText, want)
	}
}

// TestCronRespawnProbeHitSkipsCreation: a window carrying the role appeared
// between evaluation and respawn (the tick-boundary race) — its creator owns
// the kickoff, so the respawner creates nothing and delivers nothing.
func TestCronRespawnProbeHitSkipsCreation(t *testing.T) {
	s := stubCronRespawnSeams(t, "@7\toperator\toperator\n")
	outcome := rkCronRespawnRole(context.Background(), respawnTestFire("work"))

	if outcome.Status != "respawned" {
		t.Fatalf("outcome = %+v, want respawned (the role is back)", outcome)
	}
	if s.calledVerb("new-window") {
		t.Errorf("new-window issued despite the probe hit: %v", s.calls)
	}
	if s.delivered {
		t.Error("kickoff delivered into a window another creator owns")
	}
	if len(s.notifyCalls) != 0 {
		t.Errorf("notify calls = %v, want none", s.notifyCalls)
	}
}

// TestCronRespawnWallsEscalate: every non-ready classification (parked /
// gone / readiness timeout) escalates fail-silently and returns
// respawn-failed with a "readiness:" detail — never a blind delivery, never
// an in-tick retry.
func TestCronRespawnWallsEscalate(t *testing.T) {
	cases := []struct {
		name       string
		readiness  inject.Readiness
		deliverErr error
		wantDetail string
	}{
		{"parked (trust wall)", 0, &inject.ParkedError{Snippet: "Do you trust?"}, "readiness: "},
		{"gone", 0, inject.ErrGone, "readiness: "},
		{"readiness timeout", 0, inject.ErrNotReady, "readiness: "},
		{"send error after ready", inject.ReadyByEcho, errors.New("paste failed"), "send: paste failed"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := stubCronRespawnSeams(t, "@3\t\tother\n")
			s.readiness, s.deliverErr = tc.readiness, tc.deliverErr

			outcome := rkCronRespawnRole(context.Background(), respawnTestFire("work"))
			if outcome.Status != "respawn-failed" {
				t.Fatalf("outcome = %+v, want respawn-failed", outcome)
			}
			if !strings.HasPrefix(outcome.Detail, tc.wantDetail) {
				t.Errorf("detail = %q, want prefix %q", outcome.Detail, tc.wantDetail)
			}
			if len(s.notifyCalls) != 1 {
				t.Fatalf("notify calls = %v, want exactly one escalation", s.notifyCalls)
			}
			if !strings.Contains(s.notifyCalls[0], "operator tick") || !strings.Contains(s.notifyCalls[0], "work") {
				t.Errorf("notify = %q, want it naming the entry and server", s.notifyCalls[0])
			}
			if s.notifyURLs[0] != "" {
				t.Errorf("notify url = %q, want empty (no live operator window resolves)", s.notifyURLs[0])
			}
		})
	}
}

// TestCronRespawnEscalationDeepLink: a delivery wall hit AFTER the window was
// created leaves a live operator window, so the escalation notify carries the
// activity-tab deep link to it.
func TestCronRespawnEscalationDeepLink(t *testing.T) {
	s := stubCronRespawnSeams(t, "@3\t\tother\n")
	s.spawnedLine = operatorTestWindow + "\toperator\toperator\n"
	s.readiness, s.deliverErr = 0, inject.ErrGone

	outcome := rkCronRespawnRole(context.Background(), respawnTestFire("work"))
	if outcome.Status != "respawn-failed" {
		t.Fatalf("outcome = %+v, want respawn-failed", outcome)
	}
	if len(s.notifyCalls) != 1 {
		t.Fatalf("notify calls = %v, want exactly one escalation", s.notifyCalls)
	}
	if want := "/work/42?tab=activity"; s.notifyURLs[0] != want {
		t.Errorf("notify url = %q, want %q", s.notifyURLs[0], want)
	}
}

// TestCronRespawnNotifyFailSilent: a failing notifier still yields the
// respawn-failed outcome — the escalation channel never changes the result.
func TestCronRespawnNotifyFailSilent(t *testing.T) {
	s := stubCronRespawnSeams(t, "@3\t\tother\n")
	s.readiness, s.deliverErr = 0, inject.ErrGone
	s.notifyErr = errors.New("push service unreachable")

	outcome := rkCronRespawnRole(context.Background(), respawnTestFire("work"))
	if outcome.Status != "respawn-failed" {
		t.Errorf("outcome = %+v, want respawn-failed even when the notify fails", outcome)
	}
}

// TestCronRespawnProbeFailureEscalates: when the re-probe itself fails, the
// respawner escalates instead of creating blind.
func TestCronRespawnProbeFailureEscalates(t *testing.T) {
	s := stubCronRespawnSeams(t, "")
	s.runOutErr = errors.New("no server running")
	outcome := rkCronRespawnRole(context.Background(), respawnTestFire("work"))
	if outcome.Status != "respawn-failed" || !strings.Contains(outcome.Detail, "list-windows") {
		t.Errorf("outcome = %+v, want respawn-failed with a list-windows detail", outcome)
	}
	if len(s.notifyCalls) != 1 {
		t.Errorf("notify calls = %v, want one escalation", s.notifyCalls)
	}
}

// TestCronRespawnDefaultServerNoPrefix: the default server addresses tmux
// bare (no -L), matching serverArgs.
func TestCronRespawnDefaultServerNoPrefix(t *testing.T) {
	s := stubCronRespawnSeams(t, "@3\t\tother\n")
	outcome := rkCronRespawnRole(context.Background(), respawnTestFire("default"))
	if outcome.Status != "respawned" {
		t.Fatalf("outcome = %+v, want respawned", outcome)
	}
	for _, args := range s.calls {
		if args[0] == "-L" {
			t.Errorf("argv %v carries -L for the default server", args)
		}
	}
}
