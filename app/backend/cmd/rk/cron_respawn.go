package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	"rk/internal/cron"
	"rk/internal/inject"
	"rk/internal/push"
	"rk/internal/riff"
	"rk/internal/tmux"
)

// cron_respawn.go — the production cron.Deps.Respawner (wired in serve.go):
// brings a dead role:operator target back and delivers the launcher kickoff.
// It lives in cmd/rk because it needs riff.ResolveLauncher and the tmux
// new-window/role-stamp calls that internal/cron cannot import (the
// cronInjectTmux package-boundary comment). The flow is the spec's
// spawn-then-deliver composite (docs/specs/agent-messaging.md § Spawn and
// trust walls): re-probe (defensive — a window may have appeared across the
// 30s tick boundary, and its creator owns its kickoff), create-and-mark via
// the helper extracted from runOperator, then inject.DeliverWhenReady with
// the operatorDeliverDeadline-class bound, delivering the kickoff prompt —
// NEVER fire.Entry.Payload (a fresh session has no tick convention in
// context; the bare payload resumes on the entry's next resolved fire, which
// takes the ordinary Fires branch — no bookkeeping needed).
//
// Walls escalate, never retry: any non-ready classification (parked / narrow
// / gone / readiness timeout) or a send error notifies fail-silently (the
// same rk notify seam if_absent: notify uses) and returns respawn-failed —
// the daemon has no human to spend a judgment round on, and the clock never
// auto-answers walls (docs/specs/cron.md § if_absent ladder). Every tmux call
// is an argv-slice exec.CommandContext addressed at the fire's stamped server
// (-L <slug>), with the daemon's TMUX/TMUX_PANE-scrubbed env (constitution §I
// + the spec's env-discipline guard).

// cronRespawnBuffer is the respawn delivery's named paste buffer — a fixed
// per-client name (the rk-agent-send / rk-cron-send precedent): respawns are
// serialized by the tick flock, so one buffer cannot interleave with itself.
const cronRespawnBuffer = "rk-cron-respawn"

// Seams so the respawner is testable without a live tmux server or push
// subscription (the operator.go pattern).
var (
	cronRespawnRunOutputFn = operatorRunOutputFunc(func(ctx context.Context, args, env []string) ([]byte, error) {
		return tmux.RunOutput(ctx, args, tmux.RunOpts{Env: env})
	})
	cronRespawnResolveLauncherFn = riff.ResolveLauncher
	cronRespawnHomeDirFn         = os.UserHomeDir
	// cronRespawnDeliverFn mirrors operatorDeliverFn: DeliverWhenReady with
	// the reconciled state reader under the operatorDeliverDeadline bound.
	cronRespawnDeliverFn = kickoffDeliverFn(func(ctx context.Context, engine *inject.Engine, t inject.Tmux, server, paneID, text string) (inject.Readiness, error) {
		return inject.DeliverWhenReady(ctx, t, server, paneID, inject.Sanitize(text), true, engine, inject.ReadyOpts{
			State:    boundedPaneAgentState,
			Deadline: operatorDeliverDeadline,
		})
	})
	// cronRespawnNotifyFn is the fail-silent escalation seam — the same
	// production default Deps.Notifier falls back to (push.Notify).
	cronRespawnNotifyFn = func(ctx context.Context, title, body, url string) error {
		_, err := push.Notify(ctx, title, body, url)
		return err
	}
)

// cronRespawnPrefix addresses the daemon's tmux calls at the fire's server:
// bare for the default server, -L <slug> otherwise — never "current server"
// (the daemon has none; internal/tmux's init scrubbed TMUX from the process).
func cronRespawnPrefix(server string) []string {
	if server == "" || server == "default" {
		return nil
	}
	return []string{"-L", server}
}

// rkCronRespawnRole is the production Respawner wired into cron.Deps in
// serve.go. Role-target fires only — the tick's disposition switch enforces
// that gate.
func rkCronRespawnRole(ctx context.Context, fire cron.Fire) cron.Outcome {
	server := fire.Server
	prefix := cronRespawnPrefix(server)
	// runOutput addresses every tmux call at the stamped server; the nil env
	// inherits the daemon's (already TMUX-scrubbed) process environment.
	runOutput := func(ctx context.Context, args, env []string) ([]byte, error) {
		return cronRespawnRunOutputFn(ctx, append(prefix, args...), env)
	}

	// Defensive re-probe: if_absent fired because evaluation found no role
	// carrier, but a window may have appeared since (the tick-boundary race).
	// Its creator owns the kickoff, so a hit is success without a delivery.
	out, err := runOutput(ctx, []string{"list-windows", "-a", "-F", operatorListFormat}, nil)
	if err != nil {
		return cronRespawnEscalate(ctx, fire, "list-windows: "+err.Error())
	}
	if id := findOperatorWindowID(string(out)); id != "" {
		return cron.Outcome{Status: "respawned", Detail: "operator window " + id + " already present"}
	}

	// The daemon has no project cwd; the respawned window opens in the home
	// directory (the neutral default — fab's launcher resolution degrades to
	// riff.DefaultLauncher on any failure either way).
	home, err := cronRespawnHomeDirFn()
	if err != nil {
		return cronRespawnEscalate(ctx, fire, "home dir: "+err.Error())
	}
	launcher := cronRespawnResolveLauncherFn(ctx, "", operatorTier)
	paneID, err := createMarkedOperatorWindow(ctx, runOutput, nil, prefix, home, operatorShellCommand(launcher, ""))
	if err != nil {
		return cronRespawnEscalate(ctx, fire, err.Error())
	}

	// Spawn-then-deliver: the context outlives the readiness wait by one
	// command timeout so the engine's bounded subprocesses still fit after a
	// slow boot (the deliverAgentKickoff shape).
	dctx, cancel := context.WithTimeout(ctx, operatorDeliverDeadline+operatorCmdTimeout)
	defer cancel()
	engine := inject.NewEngine(cronRespawnBuffer)
	readiness, err := cronRespawnDeliverFn(dctx, engine, awaitReadyTmux{}, server, paneID, operatorKickoffPrompt)
	if err != nil {
		// DeliverWhenReady's contract: a readiness classification error
		// (parked/narrow/gone/timeout) returns the zero Readiness; a send
		// error returns the readiness that fired — the phase prefix keeps the
		// two apart in the logged detail.
		if readiness != 0 {
			return cronRespawnEscalate(ctx, fire, "send: "+err.Error())
		}
		return cronRespawnEscalate(ctx, fire, "readiness: "+err.Error())
	}
	return cron.Outcome{Status: "respawned"}
}

// cronRespawnEscalate notifies fail-silently (naming the entry and server)
// and returns the respawn-failed outcome. A notify failure is logged, never
// propagated — the outcome (and its anchor advance) stands either way.
func cronRespawnEscalate(ctx context.Context, fire cron.Fire, detail string) cron.Outcome {
	name := fire.Entry.Name
	if name == "" {
		name = fire.Entry.ID
	}
	url := cron.PushURL(fire.Server, cronRespawnOperatorWindow(ctx, fire.Server))
	if err := cronRespawnNotifyFn(ctx, "cron: "+name, fmt.Sprintf("operator respawn failed on %s: %s", fire.Server, detail), url); err != nil {
		slog.Warn("cron respawn escalation notify failed", "server", fire.Server, "entry", fire.Entry.ID, "err", err)
	}
	return cron.Outcome{Status: "respawn-failed", Detail: detail}
}

// cronRespawnOperatorWindow best-effort resolves the operator window for the
// escalation's deep-link: a respawn that failed AFTER creating the window
// (delivery wall) leaves a live operator window to link to. Any failure ⇒ ""
// — the notify fires URL-less, never blocking the tick.
func cronRespawnOperatorWindow(ctx context.Context, server string) string {
	out, err := cronRespawnRunOutputFn(ctx, append(cronRespawnPrefix(server), "list-windows", "-a", "-F", operatorListFormat), nil)
	if err != nil {
		return ""
	}
	return findOperatorWindowID(string(out))
}
